import type { JourneyParams, WorkflowInstanceLike } from '../../src/host/platform';
import { FakeJourney } from '../fake-cloudflare';

/**
 * Cloudflare Workflows, as far as a journey can tell: `FakeJourney` (the binding the worker
 * tests use) with the instances it creates actually run. `runner.test.ts` runs one instance
 * over a step that answers at once (`FakeCfStep`); here a sleep, a wait and a retry park the
 * instance until the clock or an event releases it, so a whole journey can be walked through
 * time. The clock is `Date`, which the driver fakes.
 *
 * What is modelled is what the platform documents: an instance starts some time after
 * `create` returns (here: at the next `settle`); `step.do` retries a throw 5 times, 10 s apart
 * and doubling, and not at all for a `NonRetryableError`; `waitForEvent` takes an event sent
 * before the wait began (events are buffered per instance) and throws when its timeout
 * passes; `terminate` stops an instance where it stands and refuses one that already ended.
 * Not modelled: eviction and replay (`stubs/cf-step.ts` and `runner.test.ts` cover those).
 */

/** Workflows' defaults for `step.do` (`retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' }`). */
export const CF_RETRY_LIMIT = 5;
export const CF_RETRY_DELAY_MS = 10_000;
/** `waitForEvent`'s default timeout. */
const CF_WAIT_TIMEOUT_MS = 24 * 60 * 60_000;

type State = 'queued' | 'running' | 'waiting' | 'complete' | 'errored' | 'terminated';

interface Instance {
  id: string;
  params: JourneyParams;
  createdAt: Date;
  state: State;
  /** Parked: when the clock releases it, the event type that does so sooner, and how to resume. */
  parked?: { wakeAt: number; type?: string; resume: (how: 'time' | 'event') => void };
  /** Event types sent and not yet consumed by a wait. */
  inbox: string[];
  error?: unknown;
}

export interface WorkflowRun {
  payload: JourneyParams;
  timestamp: Date;
  instanceId: string;
}

function take(inbox: string[], type: string): boolean {
  const at = inbox.indexOf(type);
  if (at === -1) return false;
  inbox.splice(at, 1);
  return true;
}

/** The `WorkflowStep` an instance runs on. */
class InstanceStep {
  constructor(
    private readonly instance: Instance,
    private readonly changed: () => void
  ) {}

  async do<T>(_name: string, ...rest: unknown[]): Promise<T> {
    // step.do(name, callback) or step.do(name, config, callback)
    const callback = rest.at(-1) as () => Promise<T>;
    for (let attempt = 0; ; attempt++) {
      await this.alive();
      try {
        return await callback();
      } catch (error) {
        const permanent = error instanceof Error && error.name === 'NonRetryableError';
        if (permanent || attempt >= CF_RETRY_LIMIT) throw error;
        await this.park({ wakeAt: Date.now() + CF_RETRY_DELAY_MS * 2 ** attempt });
      }
    }
  }

  async sleep(_name: string, ms: number): Promise<void> {
    await this.alive();
    if (!(ms >= 0)) throw new RangeError(`sleep: negative duration ${ms}`);
    if (ms > 0) await this.park({ wakeAt: Date.now() + ms });
  }

  async waitForEvent(
    name: string,
    options: { type: string; timeout?: number | string }
  ): Promise<{ payload: unknown; timestamp: Date; type: string }> {
    await this.alive();
    if (typeof options.timeout === 'string') {
      throw new TypeError(`waitForEvent '${name}': this runtime takes a timeout in ms`);
    }
    const timeout = options.timeout ?? CF_WAIT_TIMEOUT_MS;
    const how = await this.park({ wakeAt: Date.now() + timeout, type: options.type });
    if (how === 'time') throw new Error(`waitForEvent '${name}' timed out`);
    return { payload: {}, timestamp: new Date(), type: options.type };
  }

  /** Never resolves for a terminated instance: it stops where it stands. */
  private alive(): Promise<void> {
    return this.instance.state === 'terminated' ? new Promise(() => {}) : Promise.resolve();
  }

  private park(until: { wakeAt: number; type?: string }): Promise<'time' | 'event'> {
    const { instance } = this;
    if (until.type !== undefined && take(instance.inbox, until.type)) {
      return Promise.resolve('event');
    }
    return new Promise((resume) => {
      instance.parked = { ...until, resume };
      instance.state = 'waiting';
      this.changed();
    });
  }
}

export class WorkflowsRuntime extends FakeJourney {
  private readonly instances = new Map<string, Instance>();
  private readonly waiters: (() => void)[] = [];

  /** `run` is the Workflow entrypoint: `new Runner(ctx, env).run(event, step)`. */
  constructor(private readonly run: (event: WorkflowRun, step: unknown) => Promise<unknown>) {
    super();
  }

  override async create(options: { id: string; params: unknown }): Promise<WorkflowInstanceLike> {
    const base = await super.create(options);
    this.instances.set(options.id, {
      id: options.id,
      params: options.params as JourneyParams,
      createdAt: new Date(),
      state: 'queued',
      inbox: [],
    });
    return this.handle(base);
  }

  override async get(id: string): Promise<WorkflowInstanceLike> {
    return this.handle(await super.get(id));
  }

  private handle(base: WorkflowInstanceLike): WorkflowInstanceLike {
    const instance = this.instances.get(base.id);
    if (instance === undefined) return base;
    const ended = () =>
      instance.state === 'complete' ||
      instance.state === 'errored' ||
      instance.state === 'terminated';
    return {
      id: base.id,
      sendEvent: async (event) => {
        await base.sendEvent(event);
        if (!ended()) instance.inbox.push(event.type);
      },
      status: async () => ({ status: instance.state }),
      terminate: async () => {
        if (ended()) throw new Error(`instance ${base.id} is ${instance.state}: cannot terminate`);
        instance.state = 'terminated';
        delete instance.parked;
      },
    };
  }

  /**
   * Start what was created, release what is due, and wait until every instance is parked or
   * over. One instance at a time, oldest first, each run until it parks: two instances due at
   * once act in a fixed order, as turns do on a host that takes them one by one.
   */
  async settle(): Promise<void> {
    while (this.moveOne()) {
      while ([...this.instances.values()].some((instance) => instance.state === 'running')) {
        await new Promise<void>((wake) => {
          this.waiters.push(wake);
        });
      }
    }
  }

  /** Start or release the first instance that has something to do; false when none has. */
  private moveOne(): boolean {
    for (const instance of this.instances.values()) {
      if (instance.state === 'queued') {
        this.start(instance);
        return true;
      }
      if (instance.state !== 'waiting' || instance.parked === undefined) continue;
      const { parked } = instance;
      const event = parked.type !== undefined && take(instance.inbox, parked.type);
      if (!event && parked.wakeAt > Date.now()) continue;
      delete instance.parked;
      instance.state = 'running';
      parked.resume(event ? 'event' : 'time');
      return true;
    }
    return false;
  }

  /** When the clock next releases an instance, if any is parked on it. */
  nextWake(): number | undefined {
    const wakes = [...this.instances.values()].flatMap((instance) =>
      instance.state === 'waiting' && instance.parked !== undefined ? [instance.parked.wakeAt] : []
    );
    return wakes.length === 0 ? undefined : Math.min(...wakes);
  }

  /** A state changed: whoever waits for the running instances to park looks again. */
  private changed(): void {
    for (const wake of this.waiters.splice(0)) wake();
  }

  private start(instance: Instance): void {
    instance.state = 'running';
    const end = (state: 'complete' | 'errored', error?: unknown) => {
      // A terminated instance stays terminated, whatever its last step came to
      if (instance.state !== 'terminated') {
        instance.state = state;
        instance.error = error;
      }
      this.changed();
    };
    void this.run(
      { payload: instance.params, timestamp: instance.createdAt, instanceId: instance.id },
      new InstanceStep(instance, () => {
        this.changed();
      })
    ).then(
      () => {
        end('complete');
      },
      (error: unknown) => {
        end('errored', error);
      }
    );
  }
}
