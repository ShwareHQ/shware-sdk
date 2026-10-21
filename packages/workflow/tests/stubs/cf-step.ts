/**
 * Stand-in for Cloudflare's `WorkflowStep`, with the two behaviours the adapter's wait
 * semantics hang on and the real runtime only shows in production:
 *
 * - **Replay.** Every `do` result is recorded under its step name; `replay()` makes a step that
 *   answers recorded names from the record without running the body, and runs the rest — what
 *   the runtime does when it rebuilds an evicted instance, usually much later on the clock.
 * - **A wait that throws.** `waitForEvent` signals a timeout by throwing, and throws for any
 *   other failure too: the script per call says which (`'event'` resolves, `'timeout'` rejects
 *   with the runtime's timeout error, an Error rejects with it).
 *
 * `evictAt` names the step at which the isolate dies: that call and every later one throw an
 * `EvictionError` and record nothing, so the checkpoints stop there, as they would.
 */

export class EvictionError extends Error {
  override readonly name = 'EvictionError';
  constructor(step: string) {
    super(`isolate evicted at '${step}'`);
  }
}

/** The shape of the runtime's timeout: only its message is known, the adapter does not rely on it. */
export class WaitTimeoutError extends Error {
  override readonly name = 'WaitTimeoutError';
  constructor(name: string) {
    super(`waitForEvent '${name}' timed out`);
  }
}

/** One `waitForEvent` outcome; a function decides at the time of the wait (and can plant the event it wakes for). */
export type WakeScript = 'event' | 'timeout' | Error | (() => 'event' | 'timeout' | Error);

export class FakeCfStep {
  /** Every step call, in order (do, sleep, waitForEvent). */
  readonly names: string[] = [];
  readonly sleeps: { name: string; ms: number }[] = [];
  /** Checkpoints: `do` results by step name. */
  readonly results: Map<string, unknown>;
  /** What each `waitForEvent` does, consumed in order; an exhausted script resolves. */
  wakes: WakeScript[] = [];
  /** The step name at which the isolate dies (see the header). */
  evictAt: string | undefined;

  constructor(recorded?: ReadonlyMap<string, unknown>) {
    this.results = new Map(recorded);
  }

  /** A fresh step holding this one's checkpoints: what a rebuilt instance runs on. */
  replay(): FakeCfStep {
    return new FakeCfStep(this.results);
  }

  async do<T>(name: string, callback: () => Promise<T>): Promise<T> {
    this.guard(name);
    this.names.push(name);
    if (this.results.has(name)) return this.results.get(name) as T;
    const result = await callback();
    this.results.set(name, result);
    return result;
  }

  async sleep(name: string, ms: number): Promise<void> {
    this.guard(name);
    this.names.push(name);
    // The runtime refuses a negative duration: a wait computed from the wrong clock fails here
    if (!(ms >= 0)) throw new RangeError(`sleep '${name}': negative duration ${ms}`);
    this.sleeps.push({ name, ms });
  }

  async waitForEvent(
    name: string,
    _options: { type: string; timeout?: number | string }
  ): Promise<{ payload: unknown; timestamp: Date; type: string }> {
    this.guard(name);
    this.names.push(name);
    const scripted = this.wakes.shift() ?? 'event';
    const wake = typeof scripted === 'function' ? scripted() : scripted;
    if (wake === 'timeout') throw new WaitTimeoutError(name);
    if (wake instanceof Error) throw wake;
    return { payload: {}, timestamp: new Date(), type: 'wake' };
  }

  private dead = false;

  /** Dies at `evictAt`, and stays dead: nothing after it runs or is recorded. */
  private guard(name: string): void {
    if (this.dead) throw new EvictionError(name);
    if (this.evictAt !== undefined && name === this.evictAt) {
      this.dead = true;
      throw new EvictionError(name);
    }
  }
}
