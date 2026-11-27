import type { EngineStep, JourneyOutcome } from '../engine/ports';
import { isRetryable } from '../engine/retry';
import {
  InstanceNotFoundError,
  type JourneyParams,
  type WorkflowBindingLike,
  type WorkflowInstanceLike,
} from '../host/platform';
import { type JourneyStore, instanceOwner } from '../store/index';
import type { ClaimedRun, RunStore, StepRecord, Suspension } from './runs';

/**
 * The self-hosted runtime: journeys as rows, run a turn at a time.
 *
 * A turn claims one due run, replays the journey from the top with the run's checkpoints in
 * memory, and ends in one of three ways: the journey returned, it threw, or it reached something
 * that has to wait (a sleep, a retry's backoff, a wait for a wake) and was **suspended** — its
 * state written, its lease released, to be claimed again when that is due.
 *
 * This is the model both other hosts run on (Cloudflare Workflows, Lambda durable functions);
 * here the process is the runtime and Postgres its only state.
 */

/** A step's retries, as Cloudflare Workflows defaults them. */
export interface StepRetryPolicy {
  /** Retries after the first attempt. */
  limit: number;
  /** The wait before the first retry; doubled before each one after. */
  delayMs: number;
  /** How long one attempt may run before it counts as failed. */
  timeoutMs: number;
}

export const DEFAULT_STEP_RETRY: StepRetryPolicy = {
  limit: 5,
  delayMs: 10_000,
  timeoutMs: 10 * 60_000,
};

/** How long a claim holds before another worker may take the run; a running turn keeps extending it. */
export const DEFAULT_LEASE_MS = 60_000;

/** What one run of the journey is given: the store it reads and writes, and how to close it. */
export interface TurnParts {
  store: JourneyStore;
  /** Run the journey once over `step`: `executeJourney` with the host's outlets. */
  execute(step: EngineStep): Promise<JourneyOutcome>;
  close(): Promise<void>;
}

export interface NodeRuntimeOptions {
  runs: RunStore;
  /** Everything one turn of `instanceId` needs. Called once per turn. */
  open(run: { instanceId: string; params: JourneyParams; enteredAtMs: number }): TurnParts;
  /** This worker's name on the leases it holds. */
  owner?: string;
  now?: () => number;
  leaseMs?: number;
  retry?: Partial<StepRetryPolicy>;
  /** Told when a run becomes due at once (a create, a wake), so an idle worker need not poll for it. */
  onDue?: () => void;
}

/** How a turn ended. */
export type TurnResult =
  | { instanceId: string; ended: 'complete'; outcome: JourneyOutcome }
  | { instanceId: string; ended: 'errored'; error: unknown }
  | { instanceId: string; ended: 'suspended'; wakeAt: number }
  /** The run was taken from this turn (its lease ran out, or it was terminated): nothing was written. */
  | { instanceId: string; ended: 'abandoned' };

/** A promise nothing settles: where a suspended turn's journey stays parked. */
const never = <T>(): Promise<T> => new Promise<T>(() => {});

const messageOf = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

/**
 * One turn's `EngineStep`. A call with a checkpoint answers from it; the first call without one
 * does the work. A call that has to wait does not throw through the interpreter — a `catch`
 * there would swallow it and the journey would run on past its own sleep. It reports the
 * suspension to the driver and returns a promise nothing settles, so the journey simply stops
 * where it stands.
 */
class TurnStep implements EngineStep {
  private readonly seen = new Map<string, number>();
  private readonly inFlight = new Set<Promise<unknown>>();
  /** The wake counter as the latest `subscribe` read it: what the next wait compares against. */
  private baseline = 0;
  private stopped = false;

  constructor(
    private readonly run: ClaimedRun,
    private readonly records: Map<string, StepRecord>,
    private readonly runs: RunStore,
    private readonly store: JourneyStore,
    private readonly userId: string,
    private readonly now: () => number,
    private readonly retry: StepRetryPolicy,
    private readonly stop: (how: Suspension | 'abandoned') => void
  ) {}

  /** The step bodies still running: the driver lets them finish before it releases the run. */
  settled(): Promise<unknown> {
    return Promise.allSettled(this.inFlight);
  }

  /** A name used twice in one run is two steps: the key carries which occurrence this is. */
  private key(name: string): string {
    const n = (this.seen.get(name) ?? 0) + 1;
    this.seen.set(name, n);
    return n === 1 ? name : `${name}#${n}`;
  }

  private halt<T>(how: Suspension | 'abandoned'): Promise<T> {
    if (!this.stopped) {
      this.stopped = true;
      this.stop(how);
    }
    return never<T>();
  }

  /** Write a checkpoint; a write the fence refuses ends the turn, with nothing more written. */
  private async save(key: string, record: StepRecord): Promise<boolean> {
    if (this.stopped) return false;
    const kept = await this.runs.checkpoint(this.run, key, record, this.now());
    if (kept) this.records.set(key, record);
    else void this.halt('abandoned');
    return kept;
  }

  async do<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const key = this.key(name);
    const record = this.records.get(key);
    if (record?.done === true) return record.result as T;
    if (this.stopped) return never<T>();

    const failed = record?.attempts ?? 0;
    // Woken before its backoff was over (a wake meant for a later wait): not yet
    const retryAt = record?.result as number | undefined;
    if (failed > 0 && retryAt !== undefined && this.now() < retryAt) {
      return this.halt({ status: 'sleeping', wakeAt: retryAt });
    }

    const attempt = this.attempt(fn);
    this.inFlight.add(attempt);
    let result: T;
    try {
      result = await attempt;
    } catch (error) {
      this.inFlight.delete(attempt);
      // The same on every attempt (a template refusing its props, a provider's 4xx), or out of
      // retries: the journey gets the error, as on the other runtimes
      if (!isRetryable(error) || failed >= this.retry.limit) throw error;
      const wakeAt = this.now() + this.retry.delayMs * 2 ** failed;
      const kept = await this.save(key, {
        kind: 'do',
        done: false,
        result: wakeAt,
        attempts: failed + 1,
      });
      if (kept) {
        console.warn(
          `[workflow] step ${name} of ${this.run.instanceId} failed (attempt ${failed + 1}), retrying: ${messageOf(error)}`
        );
      }
      return this.halt({ status: 'sleeping', wakeAt });
    }
    this.inFlight.delete(attempt);
    const kept = await this.save(key, { kind: 'do', done: true, result, attempts: failed + 1 });
    return kept ? result : never<T>();
  }

  /** One attempt, given up on after the step timeout. */
  private attempt<T>(fn: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`step timed out after ${this.retry.timeoutMs} ms`));
      }, this.retry.timeoutMs);
    });
    return Promise.race([fn(), timeout]).finally(() => {
      clearTimeout(timer);
    });
  }

  async sleep(name: string, ms: number): Promise<void> {
    const key = this.key(name);
    let until = this.records.get(key)?.result as number | undefined;
    if (until === undefined) {
      if (this.stopped) return never();
      // The instant is fixed the first time the sleep is reached: a replay sleeps to the same one
      until = this.now() + ms;
      if (!(await this.save(key, { kind: 'sleep', done: true, result: until, attempts: 0 }))) {
        return never();
      }
    }
    if (this.now() >= until) return;
    return this.halt({ status: 'sleeping', wakeAt: until });
  }

  async subscribe(name: string, events: readonly string[]): Promise<void> {
    // The counter is read before the registration is written and kept with the step: a wake
    // that lands any time after this — before the wait is even reached — has moved it
    this.baseline = await this.do(name, async () => {
      const signals = await this.runs.signals(this.run.instanceId);
      // The instance may have changed hands (a visitor who signed in): its wakes follow the owner
      const owner = await instanceOwner(this.store, this.run.instanceId, this.userId);
      await this.store.subscribe(this.run.instanceId, owner, events, this.now());
      return signals;
    });
  }

  unsubscribe(name: string): Promise<void> {
    return this.do(name, () => this.store.unsubscribe(this.run.instanceId));
  }

  async waitForWake(
    name: string,
    { deadlineMs }: { timeoutMs: number; deadlineMs: number }
  ): Promise<'event' | 'timeout'> {
    const key = this.key(name);
    const record = this.records.get(key);
    if (record?.done === true) return record.result as 'event' | 'timeout';
    if (this.stopped) return never();

    const answer = async (verdict: 'event' | 'timeout') =>
      (await this.save(key, { kind: 'wait', done: true, result: verdict, attempts: 0 }))
        ? verdict
        : never<'event' | 'timeout'>();
    // A wake first: one that arrived at the deadline is still a wake
    if ((await this.runs.signals(this.run.instanceId)) > this.baseline) return answer('event');
    if (this.now() >= deadlineMs) return answer('timeout');
    // Parked only if the counter is still where the subscribe found it; otherwise the run is
    // queued again at once and the replay answers 'event' above
    return this.halt({ status: 'waiting', wakeAt: deadlineMs, ifSignals: this.baseline });
  }
}

export class NodeRuntime {
  private readonly runs: RunStore;
  private readonly owner: string;
  private readonly now: () => number;
  private readonly leaseMs: number;
  private readonly retry: StepRetryPolicy;

  constructor(private readonly options: NodeRuntimeOptions) {
    this.runs = options.runs;
    this.owner = options.owner ?? `node-${crypto.randomUUID()}`;
    // Read through `Date` at each call, not captured: a test that fakes the clock later is followed
    this.now = options.now ?? (() => Date.now());
    this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    this.retry = { ...DEFAULT_STEP_RETRY, ...options.retry };
  }

  /** The runtime port the rest of the host starts, wakes and stops instances through. */
  readonly binding: WorkflowBindingLike = {
    create: async ({ id, params }) => {
      const journey = params as JourneyParams;
      // The trigger's time is the entry anchor, as Cloudflare's event timestamp is for its runner
      const created = await this.runs.create(
        id,
        journey,
        journey.trigger.ts ?? this.now(),
        this.now()
      );
      if (!created) throw new Error(`instance ${id} already exists`);
      this.options.onDue?.();
      return this.instance(id);
    },
    get: async (id) => {
      if ((await this.runs.status(id)) === undefined) throw new InstanceNotFoundError(id);
      return this.instance(id);
    },
  };

  private instance(id: string): WorkflowInstanceLike {
    return {
      id,
      sendEvent: async () => {
        // A run that is over takes no wake: the host reads its status and drops the subscription
        if (await this.runs.signal(id, this.now())) this.options.onDue?.();
      },
      status: async () => {
        const status = await this.runs.status(id);
        if (status === undefined) throw new InstanceNotFoundError(id);
        // The states between turns are all "it is running", as far as the host is concerned
        const live = status === 'queued' || status === 'sleeping' || status === 'waiting';
        return { status: live ? 'running' : status };
      },
      terminate: async () => {
        await this.runs.terminate(id, this.now());
      },
    };
  }

  /**
   * Claim the earliest due run and take it one turn further. Undefined when nothing is due.
   */
  async turn(): Promise<TurnResult | undefined> {
    const run = await this.runs.claim(this.owner, this.now(), this.leaseMs);
    if (run === undefined) return undefined;
    const { instanceId } = run;

    // Held for as long as the turn runs: a slow action is not a dead worker
    const beat = setInterval(
      () => {
        void this.runs.extend(run, this.now() + this.leaseMs).catch(() => {});
      },
      Math.max(1_000, this.leaseMs / 3)
    );
    const parts = this.options.open(run);
    try {
      let stop!: (how: Suspension | 'abandoned') => void;
      const stopped = new Promise<Suspension | 'abandoned'>((resolve) => {
        stop = resolve;
      });
      const step = new TurnStep(
        run,
        await this.runs.steps(instanceId),
        this.runs,
        parts.store,
        run.params.userId,
        this.now,
        this.retry,
        stop
      );
      const end = await Promise.race([
        parts.execute(step).then(
          (outcome) => ({ outcome }),
          (error: unknown) => ({ error })
        ),
        stopped.then((how) => ({ how })),
      ]);

      if ('how' in end) {
        // Steps running beside the one that stopped the turn (a push to several devices) get
        // to their own checkpoints before the run is let go
        await step.settled();
        if (end.how === 'abandoned') return { instanceId, ended: 'abandoned' };
        await this.runs.suspend(run, end.how, this.now());
        return { instanceId, ended: 'suspended', wakeAt: end.how.wakeAt };
      }
      if ('error' in end) {
        await this.runs.finish(run, 'errored', this.now(), messageOf(end.error));
        return { instanceId, ended: 'errored', error: end.error };
      }
      await this.runs.finish(run, 'complete', this.now());
      return { instanceId, ended: 'complete', outcome: end.outcome };
    } finally {
      clearInterval(beat);
      await parts.close();
    }
  }

  /** Every run that is due now, one after another; what each turn came to. */
  async drain(limit = Number.POSITIVE_INFINITY): Promise<TurnResult[]> {
    const results: TurnResult[] = [];
    while (results.length < limit) {
      const result = await this.turn();
      if (result === undefined) break;
      results.push(result);
    }
    return results;
  }

  /** When the next run is due, if any is waiting on the clock. */
  nextWake(): Promise<number | undefined> {
    return this.runs.nextWake();
  }

  /** Remove the runs that ended more than `olderThanMs` ago. */
  prune(olderThanMs: number): Promise<number> {
    return this.runs.prune(this.now() - olderThanMs);
  }
}
