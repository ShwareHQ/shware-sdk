import { createElement } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { cloudflareJourneyBinding } from '../src/cloudflare/bindings';
import { journeyWorker } from '../src/cloudflare/worker';
import { InstanceNotFoundError } from '../src/host/platform';
import {
  defineConfig,
  emailTemplate,
  event,
  not,
  performed,
  segment,
  trigger,
  workflow,
} from '../src/index';
import { FakeJourney } from './fake-cloudflare';
import { type PgliteDatabase, pgliteDatabase, truncateAll } from './pglite';

/** An email transport that accepts every email: these hosts are not about delivery. */
const quietTransport = { send: async () => ({}) };

/**
 * journeyWorker: the fetch handler around the ingest router (deploying the
 * config's compiled bundle, template preview, auth) and the store lease
 * lifecycle, on a Postgres store (PGlite). The runner class itself needs
 * the Workflows runtime; its wiring is covered by the options being applied to
 * the fetch side, which shares the same lease.
 */

let database: PgliteDatabase;
beforeAll(async () => {
  database = await pgliteDatabase();
}, 30_000);
afterAll(async () => {
  await database.close();
});
// Every test starts from an empty engine: the tables are emptied, the database kept
beforeEach(async () => {
  await truncateAll(database.pg);
});

const e = event<{ login: { method: string } }>();
const emails = {
  welcome: emailTemplate({
    id: 'welcome',
    transactional: true,
    from: 'noreply@acme.test',
    title: 'Welcome',
    props: z.strictObject({ name: z.string() }),
    subject: 'Welcome aboard',
    preview: { name: 'A' },
    component: ({ name }) => createElement('p', null, `Hi ${name}`),
  }),
};
const flow = workflow({ id: 'welcome', trigger: trigger.event(e.login) }).email(emails.welcome, {
  name: 'friend',
});
const config = defineConfig({ workflows: [flow], templates: { email: emails } });

/** The workflows the login event is routed to. */
const routed = async () =>
  (await database.store.findTriggers('login')).map((route) => route.workflow);

function setup(token?: string) {
  const journey = new FakeJourney();
  const closes: number[] = [];
  // Development mode: these hosts are about routing and leases, not the production token gate
  const env = {
    JOURNEY: journey,
    ENVIRONMENT: 'development',
    ...(token === undefined ? {} : { API_TOKEN: token }),
  };
  const worker = journeyWorker<typeof env>({
    email: () => quietTransport,
    store: () => ({
      store: database.store,
      close: async () => {
        closes.push(1);
      },
    }),
    config,
  });
  const call = (path: string, init?: RequestInit) =>
    worker.fetch(new Request(`http://worker${path}`, init), env);
  return { worker, env, journey, closes, call };
}

describe('journeyWorker fetch', () => {
  test('deploys its own bundle, then routes events through it', async () => {
    const { call, journey, closes } = setup();

    const deploy = await call('/bundle/deploy', { method: 'POST' });
    expect(await deploy.json()).toMatchObject({ workflows: [expect.stringMatching(/^welcome@/)] });
    expect(await routed()).toEqual(['welcome']);

    const shown = await call('/bundle');
    expect((await shown.json()) as { workflows: unknown[] }).toMatchObject({
      workflows: [expect.objectContaining({ id: 'welcome' })],
    });

    const ingest = await call('/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'u1', event: 'login', payload: { method: 'email' } }),
    });
    expect(await ingest.json()).toMatchObject({ stored: true, started: [expect.any(String)] });
    expect(journey.created).toHaveLength(1);

    // Every request released its lease (no execution context: closed inline)
    expect(closes).toHaveLength(3);
  });

  test('renders previews and guards everything with the bearer when a token is set', async () => {
    const { call } = setup('secret');

    const denied = await call(`/preview/welcome?props=${encodeURIComponent('{"name":"Ada"}')}`);
    expect(denied.status).toBe(401);
    expect((await call('/bundle')).status).toBe(401);

    const preview = await call(`/preview/welcome?props=${encodeURIComponent('{"name":"Ada"}')}`, {
      headers: { authorization: 'Bearer secret' },
    });
    expect(preview.headers.get('x-subject')).toBe(encodeURIComponent('Welcome aboard'));
    expect(await preview.text()).toMatch(/<p>Hi Ada<\/p>$/);

    expect((await call('/health')).status).toBe(200);
    const wrongMethod = await call('/bundle', {
      method: 'POST',
      headers: { authorization: 'Bearer secret' },
    });
    expect(wrongMethod.status).toBe(405);
  });

  test('leaves the SDK routes to the router', async () => {
    const { call } = setup();
    expect(await (await call('/health')).json()).toEqual({ ok: true });
    expect((await call('/nope')).status).toBe(404);
  });
});

describe('the Workflow binding as the host port', () => {
  test("an unknown id is the port's InstanceNotFoundError; any other failure passes through", async () => {
    const journey = new FakeJourney();
    const port = cloudflareJourneyBinding(journey);
    await expect(port.get('gone')).rejects.toBeInstanceOf(InstanceNotFoundError);
    await expect(port.get('gone')).rejects.toMatchObject({ instanceId: 'gone' });
    // Created instances are reachable: the wrapper forwards, it does not copy
    await port.create({ id: 'inst-1', params: {} });
    expect((await port.get('inst-1')).id).toBe('inst-1');
    journey.get = async () => {
      throw new Error('connection reset by peer');
    };
    await expect(port.get('inst-1')).rejects.toThrow('connection reset by peer');
  });
});

describe('sweep', () => {
  const te = event<{ login: { method: string } }>();
  const dormant = segment({
    id: 'dormant',
    condition: not(performed(te.login, { within: '7 days' })),
  });
  const comeBack = workflow({ id: 'come_back', trigger: trigger.segment(dormant) }).email(
    emails.welcome,
    { name: 'friend' }
  );
  const sweeping = defineConfig({
    workflows: [comeBack],
    segments: [dormant],
    templates: { email: emails },
  });

  test('starts the journeys of a segment a user entered by the clock alone, once', async () => {
    const journey = new FakeJourney();
    const env = { JOURNEY: journey, ENVIRONMENT: 'development' };
    const worker = journeyWorker<typeof env>({
      email: () => quietTransport,
      store: () => database.store,
      config: sweeping,
    });
    // Known users, written straight to the store: identify would already evaluate the trigger
    await database.store.mergeProfile('u1', { plan: 'free' });
    await database.store.mergeProfile('u2', { plan: 'free' });
    await worker.fetch(new Request('http://worker/bundle/deploy', { method: 'POST' }), env);

    const first = await worker.sweep(env);
    expect(first).toMatchObject({ users: 2, sizes: [{ segment: 'dormant', size: 2 }] });
    expect(first.started).toHaveLength(2);
    expect(journey.created).toHaveLength(2);
    // Already members: a second sweep starts nothing
    expect((await worker.sweep(env)).started).toEqual([]);
  });

  test('the cron handler awaits the sweep: it is done when the handler returns, and a failure surfaces', async () => {
    const journey = new FakeJourney();
    const env = { JOURNEY: journey, ENVIRONMENT: 'development' };
    const worker = journeyWorker<typeof env>({
      email: () => quietTransport,
      store: () => database.store,
      config: sweeping,
    });
    await database.store.mergeProfile('u1', { plan: 'free' });
    await worker.fetch(new Request('http://worker/bundle/deploy', { method: 'POST' }), env);

    // Nothing is parked in waitUntil: a runtime that cut the handler off there would lose the sweep
    const parked: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void parked.push(p) };
    await worker.scheduled(undefined, env, ctx);
    expect(journey.created).toHaveLength(1);
    expect(parked).toEqual([]);

    // A sweep that fails fails the handler, where the runtime logs it — not a swallowed promise
    const broken = journeyWorker<typeof env>({
      email: () => quietTransport,
      store: () => {
        throw new Error('store is down');
      },
      config: sweeping,
    });
    await expect(broken.scheduled(undefined, env, ctx)).rejects.toThrow('store is down');
  });
});

describe('a version applies its own bundle', () => {
  const other = workflow({ id: 'other', trigger: trigger.event(e.login) }).email(emails.welcome, {
    name: 'friend',
  });
  const versioned = (workflows: (typeof flow)[], id: string, timestamp: string) => {
    const env = {
      JOURNEY: new FakeJourney(),
      ENVIRONMENT: 'development',
      CF_VERSION_METADATA: { id, timestamp },
    };
    const worker = journeyWorker<typeof env>({
      email: () => quietTransport,
      store: () => database.store,
      config: defineConfig({ workflows, templates: { email: emails } }),
    });
    return (path = '/health', init?: RequestInit) =>
      worker.fetch(new Request(`http://worker${path}`, init), env);
  };

  test('the first request makes a new version live; an older one serving beside it cannot undo it', async () => {
    await versioned([flow], 'v1', '2026-10-01T00:00:00.000Z')();
    expect(await routed()).toEqual(['welcome']);

    const v2 = versioned([other], 'v2', '2026-10-02T00:00:00.000Z');
    await v2();
    expect(await routed()).toEqual(['other']);

    // A fresh isolate of v1, still serving during the rollout
    await versioned([flow], 'v1', '2026-10-01T00:00:00.000Z')();
    expect(await routed()).toEqual(['other']);
    // Once per isolate: v2 does not deploy again
    await v2();
    expect(await routed()).toEqual(['other']);
  });

  test('a forced POST /bundle/deploy on an older isolate records that version, so the newer one re-applies', async () => {
    await versioned([flow], 'v1', '2026-10-01T00:00:00.000Z')();
    await versioned([other], 'v2', '2026-10-02T00:00:00.000Z')();
    expect(await routed()).toEqual(['other']);

    // The operator's forced deploy lands on a v1 isolate still serving during the rollout
    const deployed = await versioned(
      [flow],
      'v1',
      '2026-10-01T00:00:00.000Z'
    )('/bundle/deploy', {
      method: 'POST',
    });
    expect(deployed.status).toBe(200);
    expect(await routed()).toEqual(['welcome']);
    // The row names the code the routes came from — not v2, which would then never re-apply
    expect((await database.store.liveBundleVersion())?.id).toBe('v1');

    // A fresh v2 isolate sees an older live version and puts its own routes back
    await versioned([other], 'v2', '2026-10-02T00:00:00.000Z')();
    expect(await routed()).toEqual(['other']);
    expect((await database.store.liveBundleVersion())?.id).toBe('v2');
  });

  test('a failed apply is logged and never fails the request', async () => {
    // Keep the deployment table missing without another PGlite cold start in the test budget.
    await database.pg.exec('CREATE SCHEMA IF NOT EXISTS unmigrated');
    const env = {
      JOURNEY: new FakeJourney(),
      ENVIRONMENT: 'development',
      CF_VERSION_METADATA: { id: 'v1', timestamp: '2026-10-01T00:00:00.000Z' },
    };
    const worker = journeyWorker<typeof env>({
      email: () => quietTransport,
      store: () => database.storeIn('unmigrated'),
      config,
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await worker.fetch(new Request('http://worker/health'), env);
      expect(response.status).toBe(200);
      expect(logged).toHaveBeenCalledWith(
        '[workflow] could not make version v1 live',
        expect.objectContaining({ code: '42P01' })
      );
    } finally {
      logged.mockRestore();
    }
  });

  test('without version metadata, deploying is left to POST /bundle/deploy', async () => {
    const env = { JOURNEY: new FakeJourney(), ENVIRONMENT: 'development' };
    const worker = journeyWorker<typeof env>({
      email: () => quietTransport,
      store: () => database.store,
      config,
    });
    await worker.fetch(new Request('http://worker/health'), env);
    expect(await routed()).toEqual([]);
    expect(await database.store.liveBundleVersion()).toBeUndefined();
  });
});
