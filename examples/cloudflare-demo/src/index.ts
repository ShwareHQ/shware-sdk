import type { EmailBindingLike, JourneyEnv } from '../../../packages/workflow/src/cloudflare';
import { deployBundle, handleRequest } from '../../../packages/workflow/src/cloudflare/router';
import { JourneyRunner } from '../../../packages/workflow/src/cloudflare/runner';
import { CfEmailSender } from '../../../packages/workflow/src/cloudflare/senders';
import type { MessageSender } from '../../../packages/workflow/src/engine/ports';
import { demoBundle } from './journeys';
import { renderEmail } from './render';

interface DemoEnv extends JourneyEnv {
  /** Cloudflare Email Service 的 send_email 绑定（本地 dev 无绑定时走日志回退）。 */
  EMAIL?: EmailBindingLike;
  EMAIL_FROM?: string;
}

/** 本地开发回退：打印渲染结果，链路与真实发送完全一致（只换最后一跳）。 */
const logEmailBinding: EmailBindingLike = {
  async send(message) {
    console.log(
      `[email] to=${message.to} from=${message.from} subject=${JSON.stringify(message.subject)} htmlBytes=${message.html.length}`
    );
    console.log(`[email:html] ${message.html.slice(0, 240).replace(/\s+/g, ' ')}…`);
    return { ok: true };
  },
};

/** 应用覆盖消息出口：CF Email Service + react-email 渲染器。 */
export class DemoJourneyRunner extends JourneyRunner {
  protected override createMessageSender(): MessageSender {
    const env = this.env as DemoEnv;
    return new CfEmailSender(
      env.EMAIL ?? logEmailBinding,
      env.EMAIL_FROM ?? 'noreply@demo.example',
      renderEmail
    );
  }
}

export default {
  async fetch(request: Request, env: DemoEnv): Promise<Response> {
    const url = new URL(request.url);

    // 演示便捷端点：服务端编译 demo bundle 并部署（真实项目走 CLI POST /deploy）
    if (request.method === 'POST' && url.pathname === '/deploy-demo') {
      const result = await deployBundle(env, demoBundle());
      return Response.json(result);
    }

    // 邮件预览：registry + 渲染器直接出 HTML（react-email dev 的轻量替代，
    // 也是将来画布卡片缩略图的数据源）
    if (request.method === 'GET' && url.pathname.startsWith('/preview/')) {
      const key = url.pathname.slice('/preview/'.length);
      const props = Object.fromEntries(url.searchParams);
      const { subject, html } = await renderEmail(key, props);
      return new Response(html, {
        headers: { 'content-type': 'text/html; charset=utf-8', 'x-subject': subject },
      });
    }

    return handleRequest(request, env);
  },
};
