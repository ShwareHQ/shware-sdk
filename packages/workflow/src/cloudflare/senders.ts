import type { MessageSender, OutboundMessage } from '../engine/ports';
import type { ScalarIR } from '../ir';

/** Cloudflare Email Service 的 send_email 绑定（结构化子集）。 */
export interface EmailBindingLike {
  send(message: { to: string; from: string; subject: string; html: string }): Promise<unknown>;
}

/**
 * 模板渲染器：由应用注入——包内保持零 react-email 依赖。
 * 应用侧实现通常是 registry 查表 + @react-email/render。
 */
export type EmailRenderer = (
  template: string,
  props: Record<string, ScalarIR | undefined>
) => Promise<{ subject: string; html: string }>;

/**
 * 经 Cloudflare Email Service 直发（绑定调用，无出网 HTTP）。
 * 抛错交给 CF step 重试；投递侧按 idempotencyKey 去重。
 */
export class CfEmailSender implements MessageSender {
  constructor(
    private readonly email: EmailBindingLike,
    private readonly from: string,
    private readonly render: EmailRenderer
  ) {}

  async send(message: OutboundMessage): Promise<void> {
    if (message.channel !== 'email') {
      throw new Error(`CfEmailSender: unsupported channel '${message.channel}'`);
    }
    if (message.recipient === undefined) {
      throw new Error(`CfEmailSender: no recipient for user '${message.userId}'`);
    }
    const { subject, html } = await this.render(message.template, message.props);
    await this.email.send({ to: message.recipient, from: this.from, subject, html });
  }
}

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
