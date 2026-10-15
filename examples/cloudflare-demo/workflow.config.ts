import { defineConfig } from '@shware/workflow';
import { demoRecovery, demoWaiter, grantCoupon, purchased } from './src/journeys';
import { registry } from './src/templates';

/** The demo's one config: what `POST /bundle/deploy` deploys and what the Worker sends with. */
export default defineConfig({
  title: 'Workflow Studio · Cloudflare demo',
  workflows: [demoRecovery, demoWaiter],
  segments: [purchased],
  actions: [grantCoupon],
  templates: registry,
  emails: { from: { email: 'noreply@demo.example', name: 'Demo' } },
});
