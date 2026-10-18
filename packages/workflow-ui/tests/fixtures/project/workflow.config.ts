import { defineConfig } from '@shware/workflow';
import { onboarding } from './src/flows';
import { templates } from './src/templates';

export default defineConfig({
  title: 'Fixture project',
  workflows: [onboarding],
  templates,
  email: { unsubscribeUrl: 'https://acme.test/unsubscribe' },
  /* Runtime settings live in the same object; none of it reaches the studio's browser. */
  runtime: { development: { timeScale: 60 } },
});
