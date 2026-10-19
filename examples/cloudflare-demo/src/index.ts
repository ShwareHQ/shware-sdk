import { type JourneyEnv, journeyWorker } from '@shware/workflow/cloudflare';
import { cloudflareEmailTransport } from '@shware/workflow/transports/cloudflare-email';
import config from '../workflow.config';

/**
 * The whole host in one call: D1 + KV store from the bindings (the default),
 * emails through the `EMAIL` send_email binding (local dev writes them to
 * files), the demo's custom action, and the bundle deployed with
 * `POST /bundle/deploy`. Email previews: `GET /preview/<key>?props=<JSON>`.
 *
 * The email transport is chosen here, not by the runtime: swap in
 * `sesEmailTransport(...)` from `@shware/workflow/transports/ses` to send through SES.
 */
const journeys = journeyWorker<JourneyEnv & { EMAIL: NonNullable<JourneyEnv['EMAIL']> }>({
  config,
  email: (env) => cloudflareEmailTransport({ binding: env.EMAIL }),
});

export const DemoJourneyRunner = journeys.Runner;

export default { fetch: journeys.fetch };
