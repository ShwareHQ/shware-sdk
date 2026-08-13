import { defineConfig } from '@shware/workflow-ui/config';
import { demoStats } from './src/demo-stats';

/**
 * Project configuration — everything else is convention:
 * workflows live in src/workflows/, email content in src/emails/.
 */
export default defineConfig({
  title: 'Workflow Studio · demo',
  emails: {
    addresses: [
      'Acme <hello@acme.io>',
      'Acme Support <support@acme.io>',
      'Acme Growth <growth@acme.io>',
      'Acme Contact <contact@acme.io>',
    ],
  },
  stats: demoStats,
});
