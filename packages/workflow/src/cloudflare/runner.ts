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
 * CF WorkflowStep → EngineStep 适配。
 * waitForEvent：先在 step 内登记订阅（Router 据表唤醒），等待，事后清理；
 * CF 超时是 throw 语义，翻译成端口的 'timeout' 返回值。
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
 * 通用旅程执行器：一个类跑所有 workflow——IR 是数据，按入流时 pin 的
 * contentHash 从 KV 载入（内容寻址不可变，在 step 外读取也是 replay 安全的）。
 */
export class JourneyRunner extends WorkflowEntrypoint<JourneyEnv, JourneyParams> {
  /**
   * 消息出口：应用可覆盖以接入真实渠道（如 CfEmailSender + react-email 渲染器）。
   * 缺省按环境选 webhook / 日志发送器。
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

    // send_event 直接回注 Router 逻辑（同 Worker 内函数调用，跨 workflow 事件边）
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
