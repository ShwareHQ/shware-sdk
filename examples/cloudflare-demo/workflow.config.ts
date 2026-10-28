import { defineConfig } from '@shware/workflow';
import { contract } from './src/contract';
import { demoRecovery, demoWaiter, grantCoupon, purchased } from './src/journeys';
import { templates } from './src/templates';

/** The demo's one config: what `POST /bundle/deploy` deploys and what the Worker sends with. */
export default defineConfig({
  title: 'Workflow Studio · Cloudflare demo',
  contract,
  workflows: [demoRecovery, demoWaiter],
  segments: [purchased],
  actions: [grantCoupon],
  templates,
});
