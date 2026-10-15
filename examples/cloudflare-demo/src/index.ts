import { journeyWorker } from '@shware/workflow/cloudflare';
import config from '../workflow.config';

/**
 * The whole host in one call: D1 + KV store from the bindings (the default),
 * emails through the `EMAIL` send_email binding (local dev writes them to
 * files), the demo's custom action, and the bundle deployed with
 * `POST /bundle/deploy`. Email previews: `GET /preview/<key>?props=<JSON>`.
 */
const journeys = journeyWorker({ config });

export const DemoJourneyRunner = journeys.Runner;

export default { fetch: journeys.fetch };
