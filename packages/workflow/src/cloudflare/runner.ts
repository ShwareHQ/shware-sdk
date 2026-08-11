import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { runJourney } from '../engine/interpreter';
import type { EngineStep, EventSink, JourneyOutcome, MessageSender } from '../engine/ports';
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
 * waitForEvent registers the subscription inside a step first (the router wakes
 * instances from that table), waits, then cleans up. CF signals a timeout by
 * throwing, which is translated into the port's 'timeout' return value.
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

  async waitForEvent(
    name: string,
    opts: { events: readonly string[]; timeoutMs: number }
  ): Promise<'event' | 'timeout'> {
    await this.step.do(`${name}:subscribe`, async () => {
      for (const event of opts.events) {
        await this.db
          .prepare(
            'INSERT INTO subscriptions (user_id, event, wake_handle, ts) VALUES (?, ?, ?, ?)'
          )
          .bind(this.userId, event, this.instanceId, Date.now())
          .run();
      }
    });

    let outcome: 'event' | 'timeout';
    try {
      await this.step.waitForEvent(name, { type: WAKE_EVENT_TYPE, timeout: opts.timeoutMs });
      outcome = 'event';
    } catch {
      outcome = 'timeout';
    }

    await this.step.do(`${name}:unsubscribe`, async () => {
      await this.db
        .prepare('DELETE FROM subscriptions WHERE wake_handle = ?')
        .bind(this.instanceId)
        .run();
    });

    return outcome;
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
      step: new CfEngineStep(step, env.DB, userId, event.instanceId),
      facts: new D1FactSource(env.DB, userId),
      messages,
      events,
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
