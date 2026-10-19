import {
  CallbackTimeoutError,
  type DurableContext,
  type DurablePromise,
  type RetryDecision,
} from '@aws/durable-execution-sdk-js';
import type { EngineStep } from '../engine/ports';
import { isRetryable } from '../engine/retry';
import type { ExecutionRegistry, JourneyStore } from '../store/index';
import type { LambdaApi } from './lambda-api';

/**
 * EngineStep over a Lambda durable execution.
 *
 * Steps, sleeps and wakes map onto the SDK's `step`, `wait` and callbacks. A wake handle is a
 * callback, which is one-shot, so every wait arms a fresh one (the interpreter subscribes on
 * every attempt): created where the durable context allows it — outside any step, so its id
 * replays — then recorded in Postgres together with the subscription rows, numbered by a
 * generation so a late wake or cleanup of an older wait cannot touch a newer one. The callback
 * is only a hint; the facts the wait re-checks are Postgres'.
 */

/** What the step retries, bounded: 6 attempts with exponential backoff up to a minute. */
export function stepRetry(error: Error, attempt: number): RetryDecision {
  if (!isRetryable(error) || attempt >= 6) return { shouldRetry: false };
  return { shouldRetry: true, delay: { seconds: Math.min(60, 2 ** attempt) } };
}

interface Armed {
  promise: DurablePromise<string>;
  callbackId: string;
  generation: number;
  /** The wait consumed it (woken or timed out): there is nothing left to close. */
  settled: boolean;
}

export class AwsEngineStep implements EngineStep {
  private generation = 0;
  private armed: Armed | undefined;

  constructor(
    private readonly context: DurableContext,
    private readonly store: JourneyStore,
    private readonly executions: ExecutionRegistry,
    private readonly lambda: LambdaApi,
    private readonly userId: string,
    private readonly instanceId: string
  ) {}

  do<T>(name: string, fn: () => Promise<T>): Promise<T> {
    return this.context.step(name, () => fn(), { retryStrategy: stepRetry });
  }

  async sleep(name: string, ms: number): Promise<void> {
    // A wait is whole seconds: rounded up, so it never ends early; nothing to wait at zero
    if (!(ms > 0)) return;
    await this.context.wait(name, { seconds: Math.ceil(ms / 1000) });
  }

  async sleepUntil(name: string, timestampMs: number): Promise<void> {
    // The remaining time is checkpointed: a replay must not recompute it from a later clock
    const remaining = await this.context.step(
      `${name}:remaining`,
      async () => timestampMs - Date.now()
    );
    await this.sleep(name, remaining);
  }

  async subscribe(
    name: string,
    events: readonly string[],
    options: { deadlineMs?: number } = {}
  ): Promise<void> {
    const generation = ++this.generation;
    const { deadlineMs } = options;
    // The callback's own timeout is the wait's deadline: fixed when it is created
    const seconds =
      deadlineMs === undefined
        ? undefined
        : await this.context.step(`${name}:timeout`, async () =>
            Math.max(1, Math.ceil((deadlineMs - Date.now()) / 1000))
          );
    const [promise, callbackId] = await this.context.createCallback(
      `${name}:callback`,
      seconds === undefined ? {} : { timeout: { seconds } }
    );
    const previous = this.armed;
    this.armed = { promise, callbackId, generation, settled: false };
    await this.context.step(
      name,
      async () => {
        // Rows first, then the callback: a wake that lands in between finds the rows and the
        // callback of the last wait — its completion is refused, and this wait checks the facts
        await this.store.subscribe(this.instanceId, this.userId, events, Date.now());
        await this.executions.armCallback(this.instanceId, {
          id: callbackId,
          generation,
          deadlineAt: deadlineMs,
        });
        if (previous !== undefined && !previous.settled) {
          await this.lambda.completeCallback(previous.callbackId, '{}');
        }
      },
      { retryStrategy: stepRetry }
    );
    if (previous !== undefined) previous.settled = true;
  }

  async unsubscribe(name: string): Promise<void> {
    const armed = this.armed;
    await this.context.step(
      name,
      async () => {
        await this.store.unsubscribe(this.instanceId);
        if (armed === undefined) return;
        await this.executions.clearCallback(this.instanceId, armed.generation);
        // The condition held before the wait parked: its callback is closed through the public
        // API (a closed one answers false), rather than left open until it times out
        if (!armed.settled) await this.lambda.completeCallback(armed.callbackId, '{}');
      },
      { retryStrategy: stepRetry }
    );
    if (armed !== undefined) armed.settled = true;
    this.armed = undefined;
  }

  async waitForWake(name: string, _timeoutMs: number): Promise<'event' | 'timeout'> {
    const armed = this.armed;
    if (armed === undefined) {
      throw new Error(`waitForWake '${name}' without a subscribe: nothing is armed to wake it`);
    }
    try {
      await armed.promise;
      return 'event';
    } catch (error) {
      // Only the callback's own expiry is a timeout; any other failure is a failure
      if (error instanceof CallbackTimeoutError) return 'timeout';
      throw error;
    } finally {
      armed.settled = true;
    }
  }
}
