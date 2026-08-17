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
    // react.email's public test-send service — the same endpoint the
    // react-email preview app uses, keyless and rate-limited. A production
    // project would point this at its own transport (Resend, SES, an API
    // route) instead.
    sendTest: async ({ key, to, subject, html }) => {
      const res = await fetch('https://react.email/api/send/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to, subject: subject ?? `[test] ${key}`, html }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => undefined)) as { error?: string } | undefined;
        throw new Error(payload?.error ?? `${res.status} ${res.statusText}`);
      }
    },
  },
  stats: demoStats,
});
