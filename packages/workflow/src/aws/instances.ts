import type {
  JourneyParams,
  WorkflowBindingLike,
  WorkflowInstanceLike,
} from '../cloudflare/bindings';
import { murmur3 } from '../engine/bucket';
import type {
  ExecutionRecord,
  ExecutionRegistry,
  ExecutionStart,
  JourneyStore,
} from '../store/index';
import type { LambdaApi } from './lambda-api';

/**
 * The router's instance port over Lambda durable executions: an instance is one execution of
 * this same function, started by an asynchronous self-invoke under a stable execution name;
 * a wake completes the callback its current wait parks on; stopping stops the execution.
 */

/** The top-level shape of an internal run: what the self-invoke sends, never an HTTP body. */
export const RUN_EVENT_TYPE = '$workflow.run';

export interface RunInput {
  type: typeof RUN_EVENT_TYPE;
  instanceId: string;
  params: JourneyParams;
  /** The trigger's time: the instance's entry anchor, fixed with the start. */
  enteredAtMs: number;
}

export function isRunInput(event: unknown): event is RunInput {
  if (typeof event !== 'object' || event === null) return false;
  const candidate = event as {
    type?: unknown;
    instanceId?: unknown;
    enteredAtMs?: unknown;
    params?: unknown;
    requestContext?: unknown;
  };
  return (
    candidate.type === RUN_EVENT_TYPE &&
    candidate.requestContext === undefined &&
    typeof candidate.instanceId === 'string' &&
    typeof candidate.enteredAtMs === 'number' &&
    typeof candidate.params === 'object' &&
    candidate.params !== null
  );
}

const utf8 = new TextEncoder();
const NAME = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * The durable execution name for an instance: the instance id itself when it fits, otherwise a
 * prefix of it with a fingerprint of the whole — stable, so every retry of the start reuses it.
 */
export function executionName(instanceId: string): string {
  if (NAME.test(instanceId)) return instanceId;
  const safe = instanceId.replace(/[^a-zA-Z0-9_-]/g, '-');
  const fingerprint = `${murmur3(utf8.encode(instanceId)).toString(36)}${murmur3(utf8.encode(instanceId), 0x9747b28c).toString(36)}`;
  return `${safe.slice(0, 63 - fingerprint.length)}-${fingerprint}`;
}

export interface AwsInstancesOptions {
  store: JourneyStore;
  executions: ExecutionRegistry;
  lambda: LambdaApi;
  /** The qualified function ARN an execution pinned to `contentHash` must run on. */
  target(contentHash: string): Promise<string>;
  /**
   * How long an unconfirmed start keeps being retried. It must stay shorter than the durable
   * execution retention: past that the platform forgets the name, and a retry would start a
   * second execution. Twelve hours by default.
   */
  startRetryMs?: number;
  /** How stale a running instance's last check must be before maintenance looks again. */
  reconcileEveryMs?: number;
  now?: () => number;
}

const MINUTE = 60_000;

export class AwsInstances implements WorkflowBindingLike {
  private readonly now: () => number;
  private readonly startRetryMs: number;
  private readonly reconcileEveryMs: number;

  constructor(private readonly options: AwsInstancesOptions) {
    this.now = options.now ?? Date.now;
    this.startRetryMs = options.startRetryMs ?? 12 * 60 * MINUTE;
    this.reconcileEveryMs = options.reconcileEveryMs ?? 15 * MINUTE;
  }

  async plan(options: { id: string; params: JourneyParams; ts: number }): Promise<ExecutionStart> {
    const input: RunInput = {
      type: RUN_EVENT_TYPE,
      instanceId: options.id,
      params: options.params,
      enteredAtMs: options.ts,
    };
    return {
      name: executionName(options.id),
      target: await this.options.target(options.params.contentHash),
      input: JSON.stringify(input),
    };
  }

  async create(options: { id: string; params: unknown }): Promise<WorkflowInstanceLike> {
    const record = await this.options.executions.get(options.id);
    if (record === undefined) {
      throw new Error(`no start is recorded for ${options.id}: the entry must be planned first`);
    }
    await this.submit(record);
    return this.instance(options.id);
  }

  async get(id: string): Promise<WorkflowInstanceLike> {
    // A read of the registry alone: a Lambda failure must never read as "no such instance"
    if ((await this.options.executions.get(id)) === undefined) {
      throw new Error(`no such instance: ${id}`);
    }
    return this.instance(id);
  }

  async resume(entry: { workflow: string; userId: string }): Promise<void> {
    for (const record of await this.options.executions.pendingStarts({ ...entry, limit: 1 })) {
      if (!(await this.giveUpIfStale(record))) await this.submit(record);
    }
  }

  async maintain(): Promise<void> {
    const now = this.now();
    const failures: unknown[] = [];
    // Starts whose submit never confirmed: retried with the recorded name and payload
    for (const record of await this.options.executions.pendingStarts({
      createdBefore: now - MINUTE,
      limit: 25,
    })) {
      try {
        if (!(await this.giveUpIfStale(record))) await this.submit(record);
      } catch (error) {
        failures.push(error);
      }
    }
    // Executions the platform ended without the run finalizing (a timeout, a stop, a crash)
    for (const record of await this.options.executions.toReconcile(
      25,
      now - this.reconcileEveryMs
    )) {
      try {
        await this.reconcile(record, now);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw failures[0];
  }

  private async submit(record: ExecutionRecord): Promise<void> {
    const { arn } = await this.options.lambda.startExecution({
      target: record.target,
      name: record.name,
      payload: record.input,
    });
    await this.options.executions.markSubmitted(record.instanceId, arn, this.now());
  }

  /** Past the retry budget a start is unresolved for good: no retry could tell a duplicate apart. */
  private async giveUpIfStale(record: ExecutionRecord): Promise<boolean> {
    if (this.now() - record.createdAt <= this.startRetryMs) return false;
    await this.options.executions.markUnresolved(record.instanceId, this.now());
    console.error(
      `[workflow] the start of ${record.instanceId} (${record.name}) was never confirmed: left unresolved`
    );
    return true;
  }

  private async arnOf(record: ExecutionRecord): Promise<string | undefined> {
    if (record.arn !== undefined) return record.arn;
    const arn = await this.options.lambda.findExecution(record.target, record.name);
    if (arn !== undefined) await this.options.executions.setArn(record.instanceId, arn);
    return arn;
  }

  private async reconcile(record: ExecutionRecord, now: number): Promise<void> {
    const arn = await this.arnOf(record);
    const state = arn === undefined ? undefined : await this.options.lambda.executionState(arn);
    if (state !== 'running') {
      // Ended without its finalize step: the ledger must not show it running forever
      const { store } = this.options;
      await store.setEntryStatus(record.instanceId, 'failed');
      await store.reporting?.instanceFinished({
        workflow: record.workflow,
        instanceId: record.instanceId,
        userId: record.userId,
        status: 'failed',
        at: now,
      });
      console.warn(
        `[workflow] ${record.instanceId} ended on the platform (${state ?? 'unknown'}) without finishing: recorded as failed`
      );
    }
    await this.options.executions.markChecked(record.instanceId, now);
  }

  private instance(id: string): WorkflowInstanceLike {
    const { executions, lambda } = this.options;
    const current = async () => {
      const record = await executions.get(id);
      if (record === undefined) throw new Error(`no such instance: ${id}`);
      return record;
    };
    return {
      id,
      sendEvent: async (event) => {
        // The wait parked now, read at the moment of the wake: a newer wait's callback replaces
        // an older one, and a wake for none (the instance is between waits) is nothing to do —
        // its next wait re-reads the facts before parking
        const { callbackId } = await current();
        if (callbackId === undefined) return;
        await lambda.completeCallback(callbackId, JSON.stringify(event.payload ?? {}));
      },
      terminate: async () => {
        const record = await current();
        if (record.submittedAt === undefined && record.unresolvedAt === undefined) {
          // No retry may start it after this
          await executions.markUnresolved(id, this.now());
        }
        const arn = await this.arnOf(record);
        if (arn === undefined) return;
        if (!(await lambda.stopExecution(arn))) throw new Error(`stopping ${id} failed`);
      },
      status: async () => {
        const record = await current();
        const arn = await this.arnOf(record);
        const state = arn === undefined ? undefined : await lambda.executionState(arn);
        // In the router's vocabulary (Cloudflare's): what will never run another step
        if (state === 'succeeded') return { status: 'complete' };
        if (state === 'failed') return { status: 'errored' };
        if (state === 'running') return { status: 'running' };
        return { status: 'terminated' };
      },
    };
  }
}
