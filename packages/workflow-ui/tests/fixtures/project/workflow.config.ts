import { defineConfig } from '@shware/workflow';
import { onboarding } from './src/flows';
import { registry } from './src/templates';

export default defineConfig({
  title: 'Fixture project',
  workflows: [onboarding],
  templates: registry,
  emails: {
    from: { email: 'hello@acme.test', name: 'Acme' },
    replyTo: 'support@acme.test',
  },
  /* Runtime settings live in the same object; none of it reaches the studio's browser. */
  runtime: { development: { timeScale: 60 } },
});
