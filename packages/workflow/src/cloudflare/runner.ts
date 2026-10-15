import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { type Contract, ContractValidationError, checkEvent } from '../contract';
import { type RegisteredAction, RegistryActionInvoker } from '../engine/actions';
import { runJourney } from '../engine/interpreter';
import type {
  ActionInvoker,
  EngineStep,
  EventSink,
  JourneyObserver,
  JourneyOutcome,
  MessageSender,
  MessageValidator,
} from '../engine/ports';
import { scaleDurations } from '../engine/time-scale';
import { type JourneyRuntimeOptions, resolveRuntime } from '../runtime';
import { JourneyFactSource } from '../store/facts';
import type { JourneyStore } from '../store/index';
import { type JourneyEnv, type JourneyParams, WAKE_EVENT_TYPE, wakeExpired } from './bindings';
import { d1Store } from './d1-env';
import { ingestEvent } from './router';
import { LogMessageSender, WebhookMessageSender } from './senders';

/**
 * Adapts CF's WorkflowStep to EngineStep.
 * subscribe/unsubscribe write the subscription table inside durable steps (the
 * router wakes instances from that table); waitForWake parks on CF's
 * waitForEvent, which signals a timeout by throwing — and so does every other
 * failure in there, so only the clock can tell them apart (see wakeExpired).
 */
/** Refusals a retry would only repeat: a template's props, an emitted event's payload. */
const NON_RETRYABLE = new Set(['TemplateValidationError', 'ContractValidationError']);

class CfEngineStep implements EngineStep {
  constructor(
    private readonly step: WorkflowStep,
    private readonly store: JourneyStore,
    private readonly userId: string,
    private readonly instanceId: string
  ) {}

  /**
   * A template refusing its props, or the contract refusing an emitted event,
   * is deterministic — a retry hits the same refusal — so it ends the step at
   * once instead of burning the retry budget.
   */
  do<T>(name: string, fn: () => Promise<T>): Promise<T> {
    return this.step.do(name, async () => {
      try {
        return await fn();
      } catch (error) {
        if (error instanceof Error && NON_RETRYABLE.has(error.name)) {
          throw new NonRetryableError(error.message, error.name);
        }
        throw error;
      }
    });
  }

  sleep(name: string, ms: number): Promise<void> {
    return this.step.sleep(name, ms);
  }

  sleepUntil(name: string, timestampMs: number): Promise<void> {
    return this.step.sleepUntil(name, timestampMs);
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

  async waitForWake(name: string, timeoutMs: number): Promise<'event' | 'timeout'> {
    const startedAt = Date.now();
    try {
      await this.step.waitForEvent(name, { type: WAKE_EVENT_TYPE, timeout: timeoutMs });
      return 'event';
    } catch (error) {
      /*
       * Only the deadline can tell a real timeout from a failure (see
       * wakeExpired). `startedAt` is not replay-stable, but it is read only
       * inside the step body below, and a step body runs on the live attempt
       * alone — a replay returns the persisted verdict without touching the
       * clock.
       */
      const timedOut = await this.step.do(`${name}:timed-out`, async () =>
        wakeExpired(startedAt, timeoutMs, Date.now())
      );
      if (timedOut) return 'timeout';
      throw error;
    }
  }
}

/** Development aid: echo each outbound message before handing it to the real sender. */
function logging(sender: MessageSender): MessageSender {
  return {
    async send(message) {
      console.log(
        `[journey] ${message.channel} ${message.template} → ${message.recipient ?? message.userId} ${JSON.stringify(message.props)}`
      );
      return sender.send(message);
    },
  };
}

/**
 * The generic journey executor: one class runs every workflow, because IR is
 * data. It is loaded from the store by the contentHash pinned at entry —
 * content addressing makes it immutable, so reading it outside a step is
 * replay-safe.
 */
export class JourneyRunner extends WorkflowEntrypoint<JourneyEnv, JourneyParams> {
  /**
   * The data plane. D1 + KV from the env by default; an app on Postgres
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
   * CfEmailSender with a react-email renderer). By default it picks the webhook
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

  async run(event: WorkflowEvent<JourneyParams>, step: WorkflowStep): Promise<JourneyOutcome> {
    const store = this.createStore();
    try {
      return await this.execute(event, step, store);
    } finally {
      await this.closeStore(store);
    }
  }

  private async execute(
    event: WorkflowEvent<JourneyParams>,
    step: WorkflowStep,
    store: JourneyStore
  ): Promise<JourneyOutcome> {
    const { workflowId, contentHash, userId } = event.payload;
    const env = this.env;

    const stored = await store.getWorkflowIR(contentHash);
    if (stored === undefined) {
      throw new Error(`WorkflowIR not found: ${workflowId}@${contentHash}`);
    }
    const runtime = resolveRuntime({ current: this.runtime(event.payload) }, 'current');
    // Development runs the journey in fast-forward; the pinned hash still names the version.
    const ir = scaleDurations(stored, runtime.timeScale);

    const observer = this.createObserver(store);
    const finished = (status: JourneyOutcome['status'] | 'failed', convertedAt?: number) =>
      observer?.finished?.({
        workflow: workflowId,
        instanceId: event.instanceId,
        userId,
        status,
        at: Date.now(),
        ...(convertedAt === undefined ? {} : { convertedAt }),
      });

    const messages = runtime.logMessages
      ? logging(this.createMessageSender())
      : this.createMessageSender();

    // send_event feeds straight back into the router logic — an in-Worker call
    // forming the event edge between workflows. The step's identity travels as
    // the event id, so a retried emit records the occurrence once.
    // An emitted event passes the same contract check as one arriving over HTTP.
    const contract = this.contract();
    const events: EventSink = {
      emit: async (name, payload, id) => {
        let accepted: Record<string, unknown> = payload;
        if (contract !== undefined) {
          const verdict = checkEvent(contract, name, payload);
          if (!verdict.ok) throw new ContractValidationError(name, verdict.issues);
          accepted = verdict.data;
        }
        await ingestEvent(env, { id, userId, event: name, payload: accepted }, store);
      },
    };

    let outcome: JourneyOutcome;
    try {
      outcome = await runJourney(ir, {
        userId,
        instanceId: event.instanceId,
        // Trigger-event creation time: replay-stable, unlike Date.now() here
        enteredAtMs: event.timestamp.getTime(),
        step: new CfEngineStep(step, store, userId, event.instanceId),
        facts: new JourneyFactSource(store, userId),
        messages,
        events,
        actions: this.createActionInvoker(),
        validator: this.createMessageValidator(),
        observer,
      });
    } catch (error) {
      /*
       * An error escaping run() ends the instance, and the ledger is the only
       * place anyone looks afterwards: leaving it at 'running' meant a dead
       * journey stayed indistinguishable from a waiting one, in the dashboard
       * and in the once-policy, forever.
       *
       * Subscriptions are deliberately left in place. They are cleaned up on
       * every ordinary ending, but here the wake rows are the only evidence of
       * what the instance was waiting for, and dropping them would also break
       * the instance if the platform does re-run it.
       */
      await step.do('finalize:failed', async () => {
        await store.setEntryStatus(event.instanceId, 'failed');
        await finished('failed');
      });
      throw error;
    }

    await step.do('finalize', async () => {
      await store.setEntryStatus(event.instanceId, outcome.status);
      await store.unsubscribe(event.instanceId);
      await finished(outcome.status, outcome.convertedAt);
    });

    return outcome;
  }
}
