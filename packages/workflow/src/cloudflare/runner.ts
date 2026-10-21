import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import type { Contract } from '../contract';
import { type RegisteredAction, RegistryActionInvoker } from '../engine/actions';
import type {
  ActionInvoker,
  EngineStep,
  JourneyObserver,
  JourneyOutcome,
  MessageSender,
  MessageValidator,
} from '../engine/ports';
import { isRetryable } from '../engine/retry';
import { type JourneyRunParts, executeJourney } from '../host/execute';
import { LogMessageSender, WebhookMessageSender } from '../host/senders';
import { type JourneyRuntimeOptions, resolveRuntime } from '../runtime';
import type { JourneyStore } from '../store/index';
import { type JourneyEnv, type JourneyParams, WAKE_EVENT_TYPE, wakeExpired } from './bindings';
import { d1Store } from './d1-env';

/**
 * Adapts CF's WorkflowStep to EngineStep.
 * subscribe/unsubscribe write the subscription table inside durable steps (the
 * router wakes instances from that table); waitForWake parks on CF's
 * waitForEvent, which signals a timeout by throwing — and so does every other
 * failure in there, so only the clock, against the checkpointed deadline, can
 * tell them apart (see wakeExpired).
 */
class CfEngineStep implements EngineStep {
  constructor(
    private readonly step: WorkflowStep,
    private readonly store: JourneyStore,
    private readonly userId: string,
    private readonly instanceId: string
  ) {}

  /**
   * A failure a retry would only repeat (`isRetryable`: a template refusing its props, the
   * contract refusing an emitted event, a provider rejecting the request) ends the step at
   * once instead of burning the retry budget. The engine recognizes a NonRetryableError by its
   * `name`, so the original's name is not written over it — the original travels as `cause`.
   */
  do<T>(name: string, fn: () => Promise<T>): Promise<T> {
    return this.step.do(name, async () => {
      try {
        return await fn();
      } catch (error) {
        if (error instanceof Error && !isRetryable(error)) {
          const permanent = new NonRetryableError(error.message);
          permanent.cause = error;
          throw permanent;
        }
        throw error;
      }
    });
  }

  sleep(name: string, ms: number): Promise<void> {
    return this.step.sleep(name, ms);
  }

  subscribe(name: string, events: readonly string[]): Promise<void> {
    // Idempotent in the store: the interpreter re-subscribes on every wait
    // attempt (one-shot-callback contract) and registrations persist here.
    return this.step.do(name, () =>
      this.store.subscribe(this.instanceId, this.userId, events, Date.now())
    );
  }

  unsubscribe(name: string): Promise<void> {
    return this.step.do(name, () => this.store.unsubscribe(this.instanceId));
  }

  async waitForWake(
    name: string,
    { timeoutMs, deadlineMs }: { timeoutMs: number; deadlineMs: number }
  ): Promise<'event' | 'timeout'> {
    try {
      await this.step.waitForEvent(name, { type: WAKE_EVENT_TYPE, timeout: timeoutMs });
      return 'event';
    } catch (error) {
      /*
       * Only the deadline can tell a real timeout from a failure (see wakeExpired). The
       * deadline is the interpreter's checkpoint, so the verdict is the same on the attempt
       * that parked and on a replay after an eviction — which is where the wait usually
       * resurfaces: the instance is rebuilt, the wait is already over, and the first thing to
       * run is this step. The verdict is checkpointed too, so later replays reuse it.
       */
      const timedOut = await this.step.do(`${name}:timed-out`, async () =>
        wakeExpired(deadlineMs, Date.now())
      );
      if (timedOut) return 'timeout';
      throw error;
    }
  }
}

/**
 * The generic journey executor: one class runs every workflow, because IR is
 * data. It is loaded from the store by the contentHash pinned at entry —
 * content addressing makes it immutable, so reading it outside a step is
 * replay-safe.
 */
export class JourneyRunner extends WorkflowEntrypoint<JourneyEnv, JourneyParams> {
  /**
   * The data plane. D1 from the env by default; an app on Postgres
   * overrides this (and `closeStore` if its client needs closing):
   *
   *   protected override createStore() { return new PostgresJourneyStore(client(this.env)); }
   */
  protected createStore(): JourneyStore {
    return d1Store(this.env);
  }

  /** Called once `run` is over, success or not — release whatever `createStore` opened. */
  protected async closeStore(_store: JourneyStore): Promise<void> {}

  /**
   * Runtime options for this instance — typed configuration, resolved by the app (typically
   * `resolveRuntime(config.runtime, mode)` over its workflow.config.ts, with the mode coming from
   * an ENVIRONMENT var). The instance params are passed so the decision can also be per user:
   * a tester account in production can run in fast-forward while everyone else runs in real
   * time. Defaults: real time, quiet.
   *
   *   protected override runtime({ userId }) {
   *     return resolveRuntime(workflowConfig.runtime, isTester(userId) ? 'test' : this.env.ENVIRONMENT);
   *   }
   */
  protected runtime(_params: JourneyParams): JourneyRuntimeOptions {
    return resolveRuntime(undefined, 'production');
  }

  /**
   * Message outlet; an app overrides this to plug in real channels (say
   * an EmailSender over a transport with a react-email renderer). By default it picks the webhook
   * or logging sender based on the environment.
   */
  protected createMessageSender(): MessageSender {
    return this.env.MESSAGE_WEBHOOK_URL
      ? new WebhookMessageSender(this.env.MESSAGE_WEBHOOK_URL)
      : new LogMessageSender();
  }

  /**
   * Custom-action registry; an app overrides this returning the same
   * `action(...)` objects its workflows reference (an ActionRef is a
   * RegisteredAction structurally) — the code plane of the dual-plane model:
   *
   *   protected override actions() { return [syncCrm, issueCoupon]; }
   */
  protected actions(): readonly RegisteredAction[] {
    return [];
  }

  /**
   * The contract events this journey emits (`.sendEvent()`) are checked
   * against, exactly like ingest; journeyWorker passes its config's.
   */
  protected contract(): Contract | undefined {
    return undefined;
  }

  /**
   * Template props check before every send; an app overrides this with
   * `registryValidator({ emails, pushes })` (journeyWorker does it from its
   * registries). By default props go out as resolved.
   */
  protected createMessageValidator(): MessageValidator | undefined {
    return undefined;
  }

  /**
   * Reporting hooks: node arrivals, every copy sent, how each instance ended. The host stores
   * what it needs for its dashboards; by default nothing is reported.
   */
  protected createObserver(_store: JourneyStore): JourneyObserver | undefined {
    return undefined;
  }

  /** Override for a different version policy ('warn' by default) or a fully custom invoker (e.g. webhook degradation for hosted tenants). */
  protected createActionInvoker(): ActionInvoker {
    return new RegistryActionInvoker(this.actions());
  }

  /**
   * Everything one run is wired to. By default it is composed from the methods above; a host
   * that assembles the whole set itself (journeyWorker) overrides this one instead.
   */
  protected createRunParts(store: JourneyStore, params: JourneyParams): JourneyRunParts {
    return {
      store,
      env: this.env,
      runtime: this.runtime(params),
      messages: this.createMessageSender(),
      actions: this.createActionInvoker(),
      contract: this.contract(),
      validator: this.createMessageValidator(),
      observer: this.createObserver(store),
    };
  }

  async run(event: WorkflowEvent<JourneyParams>, step: WorkflowStep): Promise<JourneyOutcome> {
    const store = this.createStore();
    try {
      const { userId } = event.payload;
      return await executeJourney(
        {
          instanceId: event.instanceId,
          params: event.payload,
          // Trigger-event creation time: replay-stable, unlike Date.now() here
          enteredAtMs: event.timestamp.getTime(),
          step: new CfEngineStep(step, store, userId, event.instanceId),
        },
        this.createRunParts(store, event.payload)
      );
    } finally {
      await this.closeStore(store);
    }
  }
}
