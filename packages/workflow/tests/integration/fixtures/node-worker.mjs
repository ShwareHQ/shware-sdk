// One process of the self-hosted runtime, for tests/integration/node-host.test.ts: the built
// package, started the way an application starts it. The journey is the test's own (same ids,
// same action names); the actions here are slow, so a kill lands inside them.
import postgres from 'postgres';
import { action, defineConfig, event, performed, trigger, workflow } from '../../../dist/index.mjs';
import { journeyNode } from '../../../dist/node/index.mjs';
import { postgresJsClient } from '../../../dist/postgres-js.mjs';

const env = process.env;
const schema = env.WORKER_SCHEMA;
const sql = postgres(env.WORKER_DATABASE_URL, { max: 8, onnotice: () => {} });
const client = postgresJsClient(sql);
const stepMs = Number(env.WORKER_STEP_MS ?? 0);

const effect = (name) =>
  action(name, async (_args, ctx) => {
    await client.query(`INSERT INTO "${schema}".effect (key, pid) VALUES ($1, $2)`, [
      ctx.idempotencyKey,
      process.pid,
    ]);
    await new Promise((resolve) => {
      setTimeout(resolve, stepMs);
    });
  });
const before = effect('before');
const after = effect('after');
const e = event();

const journeys = journeyNode({
  config: defineConfig({
    database: { schema },
    workflows: [
      workflow({ id: 'welcome', reentry: { mode: 'never' }, trigger: trigger.event(e.sign_up) })
        .run(before)
        .waitUntil(performed(e.login), { timeout: '1 hour' })
        .run(after),
    ],
    actions: [before, after],
    templates: {},
  }),
  sql: client,
  vars: { ENVIRONMENT: 'development' },
  concurrency: Number(env.WORKER_CONCURRENCY ?? 4),
  leaseMs: Number(env.WORKER_LEASE_MS ?? 60_000),
  pollMs: 100,
});
await journeys.start({ port: Number(env.WORKER_PORT), hostname: '127.0.0.1' });
console.log('ready');
