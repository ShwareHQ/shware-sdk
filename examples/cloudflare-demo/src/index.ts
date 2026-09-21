import type { EmailBindingLike, JourneyEnv } from '../../../packages/workflow/src/cloudflare';
import { CfEmailSender } from '../../../packages/workflow/src/cloudflare/senders';
import { journeyWorker } from '../../../packages/workflow/src/cloudflare/worker';
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
    const to = typeof message.to === 'string' ? message.to : message.to.email;
    console.log(
      `[email] to=${to} subject=${JSON.stringify(message.subject)} htmlBytes=${message.html.length}`
    );
    console.log(`[email:html] ${message.html.slice(0, 240).replace(/\s+/g, ' ')}…`);
    return { ok: true };
  },
};

/**
 * The whole host in one call: D1 + KV store from the bindings (the default),
 * emails through Email Service with the react-email renderer, the demo's
 * custom action, and the bundle deployed with `POST /bundle/deploy`.
 * Email previews: `GET /preview/<key>?prop=value`.
 */
const journeys = journeyWorker<DemoEnv>({
  messages: (env, store) =>
    new CfEmailSender({
      binding: env.EMAIL ?? logEmailBinding,
      from: env.EMAIL_FROM ?? 'noreply@demo.example',
      render: renderEmail,
      profile: store,
    }),
  actions: [grantCoupon],
  bundle: demoBundle,
  preview: renderEmail,
});

export const DemoJourneyRunner = journeys.Runner;

export default { fetch: journeys.fetch };
