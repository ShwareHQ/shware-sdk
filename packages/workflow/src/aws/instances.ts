import {
  InstanceNotFoundError,
  type JourneyParams,
  type WorkflowBindingLike,
  type WorkflowInstanceLike,
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
  /** When the instance was created (as Cloudflare's event timestamp): its entry anchor, fixed with the start. */
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

/**
 * The durable execution name for one start of an instance: the instance id, cut to fit, with a
 * fingerprint of the whole id (so a cut never makes two instances collide) and the attempt's
 * token. Every retry of that start reuses the recorded name; a new attempt gets a new token.
 */
export function executionName(instanceId: string, attempt: string): string {
  const safe = instanceId.replace(/[^a-zA-Z0-9_-]/g, '-');
  const token = attempt.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
  const fingerprint = `${murmur3(utf8.encode(instanceId)).toString(36)}${murmur3(utf8.encode(instanceId), 0x9747b28c).toString(36)}`;
  const suffix = `-${fingerprint}-${token}`;
  return `${safe.slice(0, 64 - suffix.length)}${suffix}`;
}

export interface AwsInstancesOptions {
  store: JourneyStore;
  executions: ExecutionRegistry;
  lambda: LambdaApi;
  /**
   * The qualified function ARN an execution pinned to `contentHash` must run on; `version` is
   * the code version whose routes named it.
   */
  target(contentHash: string, version?: string): Promise<string>;
  /**
   * How long an unconfirmed start keeps being retried. It must stay shorter than the durable
   * execution retention: past that the platform forgets the name, and a retry would start a
   * second execution. Twelve hours by default.
   */
  startRetryMs?: number;
  /** How stale a running instance's last check must be before maintenance looks again. */
  reconcileEveryMs?: number;
  /**
   * How long after a stop an invocation already running may still act: Lambda cannot interrupt
   * one, and it runs on to its next checkpoint. An erasure waits this long before it erases.
   * The function's timeout is enough; 15 minutes (Lambda's maximum) by default.
   */
  stopDrainMs?: number;
  now?: () => number;
}

const MINUTE = 60_000;

export class AwsInstances implements WorkflowBindingLike {
  private readonly now: () => number;
  private readonly startRetryMs: number;
  private readonly reconcileEveryMs: number;
  private readonly stopDrainMs: number;

  constructor(private readonly options: AwsInstancesOptions) {
    this.now = options.now ?? Date.now;
    this.startRetryMs = options.startRetryMs ?? 12 * 60 * MINUTE;
    this.reconcileEveryMs = options.reconcileEveryMs ?? 15 * MINUTE;
    this.stopDrainMs = options.stopDrainMs ?? 15 * MINUTE;
  }

  /**
   * A start, planned for one entry attempt. Its name is new every time: a failed entry reclaimed
   * under the same instance id (an event replayed with its ts) must start a new execution — the
   * old name would return the closed one. Retries of this attempt reuse the recorded name.
   */
  async plan(options: {
    id: string;
    params: JourneyParams;
    ts: number;
    version?: string | undefined;
  }): Promise<ExecutionStart> {
    const input: RunInput = {
      type: RUN_EVENT_TYPE,
      instanceId: options.id,
      params: options.params,
      // The moment the instance is created, like Cloudflare's: an event's own ts may be long past
      enteredAtMs: this.now(),
    };
    return {
      name: executionName(options.id, crypto.randomUUID().slice(0, 8)),
      target: await this.options.target(options.params.contentHash, options.version),
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
      throw new InstanceNotFoundError(id);
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

  /**
   * Past the start retry budget, an execution still nowhere to be seen never started: any queued
   * invoke has expired by then. Before that, not finding it says nothing.
   */
  private vanished(record: ExecutionRecord): boolean {
    return this.now() - record.createdAt > this.startRetryMs;
  }

  /** Stopped so recently that an invocation running at the time may still be acting. */
  private draining(record: ExecutionRecord): boolean {
    return record.stoppedAt !== undefined && this.now() - record.stoppedAt < this.stopDrainMs;
  }

  private async reconcile(record: ExecutionRecord, now: number): Promise<void> {
    const arn = await this.arnOf(record);
    const state = arn === undefined ? undefined : await this.options.lambda.executionState(arn);
    // Only a state that will never run another step — or one missing for good — ends the entry;
    // a run still queued, or not visible yet, is left alone
    const ended =
      state === 'failed' ||
      state === 'stopped' ||
      state === 'timed_out' ||
      (state === undefined && this.vanished(record));
    if (ended) {
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
      if (record === undefined) throw new InstanceNotFoundError(id);
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
        // Stopped before: done once an invocation that was running then has had time to end
        if (record.stoppedAt !== undefined) {
          if (this.draining(record)) {
            throw new Error(`${id} was stopped; its running invocation may still be finishing`);
          }
          return;
        }
        if (record.submittedAt === undefined && record.unresolvedAt === undefined) {
          // No retry may start it after this
          await executions.markUnresolved(id, this.now());
        }
        const arn = await this.arnOf(record);
        if (arn === undefined) {
          // Not visible yet is not stopped: the erasure stays pending, and the sweep retries
          if (this.vanished(record)) return;
          throw new Error(`cannot stop ${id} yet: its execution is not visible`);
        }
        // One that finished on its own has no invocation left to drain
        const state = await lambda.executionState(arn);
        if (state === 'succeeded' || state === 'failed' || state === 'timed_out') return;
        if (!(await lambda.stopExecution(arn))) throw new Error(`stopping ${id} failed`);
        // A stop does not interrupt an invocation already running: it goes on to its next
        // checkpoint, side effects included. The erasure waits (see stopDrainMs)
        await executions.markStopped(id, this.now());
        throw new Error(`${id} is stopped; its running invocation may still be finishing`);
      },
      status: async () => {
        const record = await current();
        if (this.draining(record)) return { status: 'running' };
        const arn = await this.arnOf(record);
        // Not visible yet may still run: only one missing past the budget is gone
        if (arn === undefined) return { status: this.vanished(record) ? 'terminated' : 'running' };
        const state = await lambda.executionState(arn);
        // In the router's vocabulary (Cloudflare's): what will never run another step
        if (state === 'succeeded') return { status: 'complete' };
        if (state === 'failed') return { status: 'errored' };
        if (state === 'running') return { status: 'running' };
        return { status: 'terminated' };
      },
    };
  }
}
