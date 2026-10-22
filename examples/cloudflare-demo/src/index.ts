import { type JourneyEnv, journeyWorker } from '@shware/workflow/cloudflare';
import { postgresJsStore } from '@shware/workflow/postgres-js';
import { cloudflareEmailTransport } from '@shware/workflow/transports/cloudflare-email';
import config from '../workflow.config';

/**
 * The whole host in one call: the Postgres store through the `HYPERDRIVE` binding (locally a
 * docker Postgres, `pnpm db:up`), emails through the `EMAIL` send_email binding (local dev
 * writes them to files), the demo's custom action, and the bundle each version makes live by
 * itself. Email previews: `GET /preview/<key>?props=<JSON>`.
 *
 * The email transport is chosen here, not by the runtime: swap in
 * `sesEmailTransport(...)` from `@shware/workflow/transports/ses` to send through SES.
 */
interface Env extends JourneyEnv {
  HYPERDRIVE: { connectionString: string };
  EMAIL: NonNullable<JourneyEnv['EMAIL']>;
}

const journeys = journeyWorker<Env>({
  config,
  store: (env, database) => postgresJsStore(env.HYPERDRIVE.connectionString, database),
  email: (env) => cloudflareEmailTransport({ binding: env.EMAIL }),
});

export const DemoJourneyRunner = journeys.Runner;

export default { fetch: journeys.fetch, scheduled: journeys.scheduled };
