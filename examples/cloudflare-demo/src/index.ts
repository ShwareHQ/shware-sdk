import type { EmailBindingLike, JourneyEnv } from '../../../packages/workflow/src/cloudflare';
import { deployBundle, handleRequest } from '../../../packages/workflow/src/cloudflare/router';
import { JourneyRunner } from '../../../packages/workflow/src/cloudflare/runner';
import { CfEmailSender } from '../../../packages/workflow/src/cloudflare/senders';
import type { RegisteredAction } from '../../../packages/workflow/src/engine/actions';
import type { MessageSender } from '../../../packages/workflow/src/engine/ports';
import { demoBundle, grantCoupon } from './journeys';
import { renderEmail } from './render';

interface DemoEnv extends JourneyEnv {
  /** Cloudflare Email Service's send_email binding (local dev has none, so it falls back to logging). */
  EMAIL?: EmailBindingLike;
  EMAIL_FROM?: string;
}

/** Local-dev fallback: print what was rendered. The pipeline is identical to a real send — only the last hop differs. */
const logEmailBinding: EmailBindingLike = {
  async send(message) {
    console.log(
      `[email] to=${message.to} from=${message.from} subject=${JSON.stringify(message.subject)} htmlBytes=${message.html.length}`
    );
    console.log(`[email:html] ${message.html.slice(0, 240).replace(/\s+/g, ' ')}…`);
    return { ok: true };
  },
};

/** The app overrides the message outlet: CF Email Service plus a react-email renderer. */
export class DemoJourneyRunner extends JourneyRunner {
  protected override createMessageSender(): MessageSender {
    const env = this.env as DemoEnv;
    return new CfEmailSender(
      env.EMAIL ?? logEmailBinding,
      env.EMAIL_FROM ?? 'noreply@demo.example',
      renderEmail
    );
  }

  /**
   * Custom-action registry: the same action(...) objects the journeys
   * reference (an ActionRef is a RegisteredAction structurally). The default
   * invoker warns when the deployed code drifts from the hash pinned in a
   * journey's IR.
   */
  protected override actions(): readonly RegisteredAction[] {
    return [grantCoupon];
  }
}

export default {
  async fetch(request: Request, env: DemoEnv): Promise<Response> {
    const url = new URL(request.url);

    // Demo convenience endpoint: compile and deploy the bundle server-side (a real project would POST /deploy from a CLI)
    if (request.method === 'POST' && url.pathname === '/deploy-demo') {
      const result = await deployBundle(env, demoBundle());
      return Response.json(result);
    }

    // Email preview: registry plus renderer straight to HTML — a lightweight
    // stand-in for react-email dev, and the future data source for card thumbnails
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
