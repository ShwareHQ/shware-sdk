import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { type RegisteredAction, RegistryActionInvoker } from '../engine/actions';
import { runJourney } from '../engine/interpreter';
import type {
  ActionInvoker,
  EngineStep,
  EventSink,
  JourneyOutcome,
  MessageSender,
} from '../engine/ports';
import { scaleDurations } from '../engine/time-scale';
import { type JourneyRuntimeOptions, resolveRuntime } from '../runtime';
import { JourneyFactSource } from '../store/facts';
import type { JourneyStore } from '../store/index';
import { type JourneyEnv, type JourneyParams, WAKE_EVENT_TYPE } from './bindings';
import { d1Store } from './d1-env';
import { ingestEvent } from './router';
import { LogMessageSender, WebhookMessageSender } from './senders';

/**
 * Adapts CF's WorkflowStep to EngineStep.
 * subscribe/unsubscribe write the subscription table inside durable steps (the
 * router wakes instances from that table); waitForWake parks on CF's
 * waitForEvent, which signals a timeout by throwing — translated into the
 * port's 'timeout' return value.
 */
class CfEngineStep implements EngineStep {
  constructor(
    private readonly step: WorkflowStep,
    private readonly store: JourneyStore,
    private readonly userId: string,
    private readonly instanceId: string
  ) {}

  do<T>(name: string, fn: () => Promise<T>): Promise<T> {
    return this.step.do(name, fn);
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
    try {
      await this.step.waitForEvent(name, { type: WAKE_EVENT_TYPE, timeout: timeoutMs });
      return 'event';
    } catch {
      return 'timeout';
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
      await sender.send(message);
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
    const { workflowName, contentHash, userId } = event.payload;
    const env = this.env;

    const stored = await store.getWorkflowIR(contentHash);
    if (stored === undefined) {
      throw new Error(`WorkflowIR not found: ${workflowName}@${contentHash}`);
    }
    const runtime = resolveRuntime({ current: this.runtime(event.payload) }, 'current');
    // Development runs the journey in fast-forward; the pinned hash still names the version.
    const ir = scaleDurations(stored, runtime.timeScale);

    const messages = runtime.logMessages
      ? logging(this.createMessageSender())
      : this.createMessageSender();

    // send_event feeds straight back into the router logic — an in-Worker call forming the event edge between workflows
    const events: EventSink = {
      emit: async (name, payload) => {
        await ingestEvent(env, { userId, event: name, payload }, store);
      },
    };

    const outcome = await runJourney(ir, {
      userId,
      instanceId: event.instanceId,
      // Trigger-event creation time: replay-stable, unlike Date.now() here
      enteredAtMs: event.timestamp.getTime(),
      step: new CfEngineStep(step, store, userId, event.instanceId),
      facts: new JourneyFactSource(store, userId),
      messages,
      events,
      actions: this.createActionInvoker(),
    });

    await step.do('finalize', async () => {
      await store.setEntryStatus(event.instanceId, outcome.status);
      await store.unsubscribe(event.instanceId);
    });

    return outcome;
  }
}
