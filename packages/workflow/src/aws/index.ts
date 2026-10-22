import { AsyncLocalStorage } from 'node:async_hooks';
import {
  type DurableContext,
  type DurableExecutionInvocationInput,
  type DurableExecutionInvocationOutput,
  withDurableExecution,
} from '@aws/durable-execution-sdk-js';
import { longestJourneyMs } from '../engine/duration';
import type { JourneyOutcome } from '../engine/ports';
import { PermanentError } from '../engine/retry';
import { executeJourney } from '../host/execute';
import { readWithRetry } from '../host/fresh-read';
import {
  SWEEP_PAGE_SIZE,
  type SweepResult,
  sweepMaintenance,
  sweepSegmentsPaged,
} from '../host/ingest';
import { type JourneyHostOptions, createJourneyHost } from '../host/journey-host';
import type { JourneyEnv } from '../host/platform';
import { http2Fetch } from '../http2-client';
import type { BundleVersion, ExecutionRegistry, JourneyStore, StoreLease } from '../store/index';
import { AwsEngineStep } from './engine-step';
import {
  type FunctionUrlEvent,
  type FunctionUrlResult,
  fromResponse,
  isFunctionUrlEvent,
  toRequest,
} from './function-url';
import { AwsInstances, type RunInput, isRunInput } from './instances';
import { type LambdaApi, sdkLambdaApi } from './lambda-api';

/**
 * `@shware/workflow/aws` — the journey host as one Lambda durable function behind a Function
 * URL, on Postgres.
 *
 * The one handler tells three inputs apart by the event's top-level shape: a Function URL
 * request (the HTTP API — ingest, identify, devices, tracking, bundle, preview), an internal run
 * (one journey instance: one durable execution, started by an asynchronous invoke of this
 * function's own numbered version), and a scheduled maintenance tick. An HTTP body can never
 * pass for the other two: the Function URL always wraps it.
 *
 *   const journeys = journeyLambda({
 *     config,
 *     env,                                        // parsed from process.env (zod)
 *     store: (env, database) => postgresJsStore(env.DATABASE_URL, database),
 *     email: (env) => sesEmailTransport({ region: env.AWS_REGION }),
 *   });
 *   export const handler = journeys.handler;
 */

/** The scheduled tick (EventBridge Scheduler's payload): the segment sweep and maintenance. */
export const SWEEP_EVENT_TYPE = '$workflow.sweep';

/** What journeyLambda reads from its env: `JourneyEnv` without the binding it supplies itself. */
export type JourneyLambdaEnv = Omit<JourneyEnv, 'JOURNEY' | 'DB' | 'EMAIL'>;

export interface JourneyLambdaOptions<Env extends JourneyLambdaEnv> extends Omit<
  JourneyHostOptions<Env & JourneyEnv>,
  'env' | 'store'
> {
  /** The validated environment (parsed from `process.env` with zod by the app). */
  env: Env;
  /** The Postgres store: AWS needs its execution registry (`postgresJsStore`). */
  store: (env: Env, database: { schema: string }) => JourneyStore | StoreLease;
  /** The Lambda control plane; `@aws-sdk/client-lambda` with the execution role by default. */
  lambda?: LambdaApi;
  /** How long an unconfirmed start is retried (default 12 hours; keep it under the retention). */
  startRetryMs?: number;
  /**
   * How long an erasure waits after stopping an execution before it erases: an invocation
   * running at the stop goes on to its next checkpoint. Set it to at least the function's
   * timeout; 15 minutes (Lambda's maximum) by default.
   */
  stopDrainMs?: number;
  /**
   * The function's `DurableConfig.ExecutionTimeout`, in milliseconds. With it, a workflow that
   * can outlive it (`longestJourneyMs`) fails the handler's creation — a deploy's smoke test —
   * instead of being stopped by the platform midway and recorded as failed.
   */
  executionTimeoutMs?: number;
}

/**
 * The Lambda invocation context, as far as the handler's signature needs it — declared here so
 * the package's types do not depend on `@types/aws-lambda`. Lambda passes the full object.
 */
export interface LambdaContext {
  functionName: string;
  functionVersion: string;
  invokedFunctionArn: string;
  awsRequestId: string;
  getRemainingTimeInMillis(): number;
}

export interface JourneyLambda {
  /** Export as the function's handler. */
  handler: (
    event: DurableExecutionInvocationInput,
    context: LambdaContext
  ) => Promise<DurableExecutionInvocationOutput>;
}

interface Invocation {
  lease?: Required<StoreLease>;
}

/** This function's ARN without its qualifier, from the ARN it was invoked under. */
function unqualified(invokedFunctionArn: string): string {
  return invokedFunctionArn.split(':').slice(0, 7).join(':');
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function journeyLambda<Env extends JourneyLambdaEnv>(
  options: JourneyLambdaOptions<Env>
): JourneyLambda {
  type HostEnv = Env & JourneyEnv;
  const {
    env: baseEnv,
    lambda: lambdaOption,
    startRetryMs,
    stopDrainMs,
    executionTimeoutMs,
    ...hostOptions
  } = options;
  const host = createJourneyHost<HostEnv>(
    { ...hostOptions, store: (env, database) => options.store(env, database) },
    // Node 24's fetch cannot reach APNs (HTTP/2 only): see http2-client.ts for when this can go
    { apnsFetch: http2Fetch() }
  );
  if (executionTimeoutMs !== undefined) {
    const tooLong = host
      .bundle()
      .workflows.filter((workflow) => longestJourneyMs(workflow) > executionTimeoutMs);
    if (tooLong.length > 0) {
      const days = (ms: number) => `${Math.ceil(ms / 86_400_000)} days`;
      throw new RangeError(
        `${tooLong.map((w) => `'${w.id}' can run ${days(longestJourneyMs(w))}`).join(', ')}, ` +
          `longer than the execution timeout (${days(executionTimeoutMs)}): raise ExecutionTimeout (up to 366 days)`
      );
    }
  }
  const lambda = lambdaOption ?? sdkLambdaApi();
  const ownHashes = new Set(host.bundle().workflows.map((workflow) => workflow.contentHash));
  const scope = new AsyncLocalStorage<Invocation>();

  /** The version this code was published as: `$LATEST` while developing. */
  const ownVersion = () => process.env.AWS_LAMBDA_FUNCTION_VERSION ?? '$LATEST';
  /** Numbered versions are ordered: the bundle compiled into a later one goes live by itself. */
  const bundleVersion = (): BundleVersion | undefined => {
    const version = ownVersion();
    return /^\d+$/.test(version) ? { id: version, createdAt: Number(version) } : undefined;
  };

  /** The store and the env (with the instance port) of this invocation, opened on first use. */
  const open = (
    context: DurableContext
  ): { store: JourneyStore; env: HostEnv; executions: ExecutionRegistry } => {
    const invocation = scope.getStore();
    if (invocation === undefined) throw new Error('journeyLambda: outside an invocation');
    const placeholder = { ...baseEnv } as unknown as HostEnv;
    invocation.lease ??= host.lease(placeholder);
    const { store } = invocation.lease;
    const { executions } = store;
    const functionArn = unqualified(context.lambdaContext.invokedFunctionArn);
    const target = async (contentHash: string, version?: string): Promise<string> => {
      // An execution runs the code its IR was compiled with: the version whose bundle put the
      // route there, read in the same row as the hash — never a separately read "live" version,
      // which a release between the two reads would make another bundle's
      if (version !== undefined && /^\d+$/.test(version)) return `${functionArn}:${version}`;
      // A forced deploy records no version: only this code's own workflows can run here
      if (ownHashes.has(contentHash)) return `${functionArn}:${ownVersion()}`;
      throw new Error(`no published version is known to carry workflow IR ${contentHash}`);
    };
    const instances = new AwsInstances({
      store,
      executions,
      lambda,
      target,
      ...(startRetryMs === undefined ? {} : { startRetryMs }),
      ...(stopDrainMs === undefined ? {} : { stopDrainMs }),
    });
    return { store, env: { ...baseEnv, JOURNEY: instances }, executions };
  };

  const run = async (input: RunInput, context: DurableContext): Promise<JourneyOutcome> => {
    const { store, env, executions } = open(context);
    const { instanceId, params } = input;
    // Only a start the router recorded may run, byte for byte: the function can be invoked by
    // anything its policy lets through, and an input of this shape would otherwise run any
    // workflow for any user. A stopped execution (an erasure) may not come back either. Outside
    // any step — a step would replay the first invocation's "not stopped" on every wake — so the
    // execution fails at once on a refusal; only the read itself is retried, briefly, when the
    // database stumbled.
    const record = await readWithRetry(() => executions.get(instanceId), {
      what: 'run entry',
      instanceId,
    });
    if (
      record === undefined ||
      record.stoppedAt !== undefined ||
      record.input !== JSON.stringify(input)
    ) {
      throw new PermanentError('journeyLambda: run input is not a recorded start');
    }
    // Running is the proof the start got through, whatever became of the invoke's response
    await context.step('$workflow:started', async () => {
      await executions.markSubmitted(
        instanceId,
        context.executionContext.durableExecutionArn,
        Date.now()
      );
    });
    return executeJourney(
      {
        instanceId,
        params,
        enteredAtMs: input.enteredAtMs,
        step: new AwsEngineStep(context, store, executions, lambda, params.userId, instanceId),
      },
      host.runParts(env, store, params)
    );
  };

  const http = (event: FunctionUrlEvent, context: DurableContext): Promise<FunctionUrlResult> => {
    const serve = async (): Promise<FunctionUrlResult> => {
      const method = event.requestContext.http.method;
      try {
        const { store, env } = open(context);
        const request = toRequest(event);
        // Only the bundle compiled into a version may route: one is never swapped in by hand
        if (new URL(request.url).pathname === '/deploy') {
          return await fromResponse(
            json(
              {
                error:
                  'deploy by publishing a version (POST /bundle/deploy applies its own bundle)',
              },
              409
            ),
            method
          );
        }
        const version = bundleVersion();
        await host.applyOwnBundle(env, version);
        return await fromResponse(await host.handle(request, env, store, version), method);
      } catch (error) {
        console.error('[workflow] request failed', error);
        return fromResponse(json({ error: 'internal error' }, 500), method);
      }
    };
    // A read (the bundle, a preview, a tracked link or pixel) answers straight from the handler:
    // its body can be large, and a step would checkpoint all of it. A write runs in one step,
    // never retried — the caller is waiting, and retries the request itself
    const method = event.requestContext.http.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD') return serve();
    return context.step('http', serve, { retryStrategy: () => ({ shouldRetry: false }) });
  };

  /**
   * The sweep as durable steps, one per page of users: an invocation cut short (the function's
   * timeout) is re-invoked, and the re-invocation replays the pages already checkpointed
   * instead of evaluating everyone again. No step retries on its own — a page that failed is
   * evaluated again by the next tick.
   */
  const sweep = async (context: DurableContext): Promise<SweepResult> => {
    const once = { retryStrategy: () => ({ shouldRetry: false }) };
    await context.step(
      'sweep:maintain',
      async () => {
        const { store, env } = open(context);
        await host.applyOwnBundle(env, bundleVersion());
        await sweepMaintenance(env, store);
      },
      once
    );
    let users = 0;
    const started: string[] = [];
    let after: string | undefined;
    for (let n = 0; ; n++) {
      const page = await context.step(
        `sweep:page:${n}`,
        async () => {
          const { store, env } = open(context);
          return sweepSegmentsPaged(env, store, { after, limit: SWEEP_PAGE_SIZE });
        },
        once
      );
      users += page.users;
      started.push(...page.started);
      if (!page.more || page.lastUserId === undefined) break;
      after = page.lastUserId;
    }
    const sizes = await context.step(
      'sweep:snapshot',
      async () => {
        const { store } = open(context);
        return store.reporting.snapshotSegments(Date.now());
      },
      once
    );
    return { users, started, sizes };
  };

  const durable = withDurableExecution(async (input: unknown, context: DurableContext) => {
    if (isFunctionUrlEvent(input)) return http(input, context);
    if (isRunInput(input)) return run(input, context);
    if (
      typeof input === 'object' &&
      input !== null &&
      (input as { type?: unknown }).type === SWEEP_EVENT_TYPE
    ) {
      return sweep(context);
    }
    throw new Error('journeyLambda: unrecognized event (not a Function URL request, run or sweep)');
  });

  const handler = async (
    event: DurableExecutionInvocationInput,
    context: LambdaContext
  ): Promise<DurableExecutionInvocationOutput> => {
    const invocation: Invocation = {};
    try {
      // The durable wrapper reads the whole context Lambda passed, not just the fields above
      return await scope.run(invocation, () =>
        durable(event, context as Parameters<typeof durable>[1])
      );
    } finally {
      // Outside the durable wrapper: a suspended run returns PENDING without unwinding the
      // handler, so a `finally` in there would never release the connection
      await invocation.lease?.close().catch((error: unknown) => {
        console.error('[workflow] closing the store failed', error);
      });
    }
  };

  return { handler };
}

export { AwsEngineStep, stepRetry } from './engine-step';
export { AwsInstances, RUN_EVENT_TYPE, executionName, isRunInput } from './instances';
export type { AwsInstancesOptions, RunInput } from './instances';
export { sdkLambdaApi } from './lambda-api';
export { bearerMatches, timingSafeEqual } from '../host/auth';
export type { Authorize } from '../host/auth';
export type { ExecutionState, LambdaApi } from './lambda-api';
export { fromResponse, isFunctionUrlEvent, toRequest } from './function-url';
export type { FunctionUrlEvent, FunctionUrlResult } from './function-url';
