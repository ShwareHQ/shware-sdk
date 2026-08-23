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
import { WorkflowIR } from '../ir';
import {
  type D1DatabaseLike,
  type JourneyEnv,
  type JourneyParams,
  WAKE_EVENT_TYPE,
} from './bindings';
import { D1FactSource } from './facts';
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
    private readonly db: D1DatabaseLike,
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
    return this.step.do(name, async () => {
      for (const event of events) {
        // OR IGNORE on the (wake_handle, event) PK: the interpreter re-subscribes
        // on every wait attempt (one-shot-callback contract) and rows persist here
        await this.db
          .prepare(
            'INSERT OR IGNORE INTO subscriptions (user_id, event, wake_handle, ts) VALUES (?, ?, ?, ?)'
          )
          .bind(this.userId, event, this.instanceId, Date.now())
          .run();
      }
    });
  }

  unsubscribe(name: string): Promise<void> {
    return this.step.do(name, async () => {
      await this.db
        .prepare('DELETE FROM subscriptions WHERE wake_handle = ?')
        .bind(this.instanceId)
        .run();
    });
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

/**
 * The generic journey executor: one class runs every workflow, because IR is
 * data. It is loaded from KV by the contentHash pinned at entry — content
 * addressing makes it immutable, so reading it outside a step is replay-safe.
 */
export class JourneyRunner extends WorkflowEntrypoint<JourneyEnv, JourneyParams> {
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
    const { workflowName, contentHash, userId } = event.payload;
    const env = this.env;

    const raw = await env.WORKFLOW_KV.get(`wf:${contentHash}`);
    if (raw === null) {
      throw new Error(`WorkflowIR not found: ${workflowName}@${contentHash}`);
    }
    const ir = WorkflowIR.parse(JSON.parse(raw));

    const messages = this.createMessageSender();

    // send_event feeds straight back into the router logic — an in-Worker call forming the event edge between workflows
    const events: EventSink = {
      emit: async (name, payload) => {
        await ingestEvent(env, { userId, event: name, payload });
      },
    };

    const outcome = await runJourney(ir, {
      userId,
      instanceId: event.instanceId,
      // Trigger-event creation time: replay-stable, unlike Date.now() here
      enteredAtMs: event.timestamp.getTime(),
      step: new CfEngineStep(step, env.DB, userId, event.instanceId),
      facts: new D1FactSource(env.DB, userId),
      messages,
      events,
      actions: this.createActionInvoker(),
    });

    await step.do('finalize', async () => {
      await env.DB.prepare('UPDATE entries SET status = ? WHERE instance_id = ?')
        .bind(outcome.status, event.instanceId)
        .run();
      await env.DB.prepare('DELETE FROM subscriptions WHERE wake_handle = ?')
        .bind(event.instanceId)
        .run();
    });

    return outcome;
  }
}
