import type { MessageSender, OutboundMessage } from '../engine/ports';

/** 开发用发送器：结构化日志，肉眼验证链路。 */
export class LogMessageSender implements MessageSender {
  async send(message: OutboundMessage): Promise<void> {
    console.log(`[send] ${JSON.stringify(message)}`);
  }
}

/**
 * Webhook 发送器：POST 给外部投递服务（Resend/SES 网关等），
 * 幂等键随行——重试/replay 的去重由接收方按 idempotencyKey 执行。
 */
export class WebhookMessageSender implements MessageSender {
  constructor(private readonly url: string) {}

  async send(message: OutboundMessage): Promise<void> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': message.idempotencyKey,
      },
      body: JSON.stringify(message),
    });
    if (!response.ok) {
      throw new Error(`message webhook failed: ${response.status}`);
    }
  }
}
