import { PGlite } from '@electric-sql/pglite';
import { createElement } from 'react';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { journeyWorker } from '../src/cloudflare/worker';
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
import { D1JourneyStore } from '../src/store/d1';
import { PostgresJourneyStore, type SqlClientLike } from '../src/store/postgres';
import { renderPostgresDdl } from '../src/store/tables';
import { FakeD1, FakeJourney, FakeKV } from './fake-cloudflare';

/**
 * journeyWorker: the fetch handler around the ingest router (deploying the
 * config's compiled bundle, template preview, auth) and the store lease
 * lifecycle. The runner class itself needs
 * the Workflows runtime; its wiring is covered by the options being applied to
 * the fetch side, which shares the same lease.
 */

const e = event<{ login: { method: string } }>();
const emails = {
  welcome: emailTemplate({
    id: 'welcome',
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

function setup(token?: string) {
  const db = new FakeD1();
  const kv = new FakeKV();
  const journey = new FakeJourney();
  const closes: number[] = [];
  const env = { JOURNEY: journey, ...(token === undefined ? {} : { API_TOKEN: token }) };
  const worker = journeyWorker<typeof env>({
    store: () => ({
      store: new D1JourneyStore(db, kv),
      close: async () => {
        closes.push(1);
      },
    }),
    config,
  });
  const call = (path: string, init?: RequestInit) =>
    worker.fetch(new Request(`http://worker${path}`, init), env);
  return { worker, env, db, kv, journey, closes, call };
}

describe('journeyWorker fetch', () => {
  test('deploys its own bundle, then routes events through it', async () => {
    const { call, db, journey, closes } = setup();

    const deploy = await call('/bundle/deploy', { method: 'POST' });
    expect(await deploy.json()).toMatchObject({ workflows: [expect.stringMatching(/^welcome@/)] });
    expect(db.triggers).toHaveLength(1);

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
    expect(preview.headers.get('x-subject')).toBe('Welcome aboard');
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

describe('sweep', () => {
  test('starts the journeys of a segment a user entered by the clock alone, once', async () => {
    const te = event<{ login: { method: string } }>();
    const dormant = segment({
      id: 'dormant',
      condition: not(performed(te.login, { within: '7 days' })),
    });
    const comeBack = workflow({ id: 'come_back', trigger: trigger.segment(dormant) }).email(
      emails.welcome,
      { name: 'friend' }
    );
    const db = new FakeD1();
    const kv = new FakeKV();
    const journey = new FakeJourney();
    const env = { JOURNEY: journey };
    const worker = journeyWorker<typeof env>({
      store: () => new D1JourneyStore(db, kv),
      config: defineConfig({
        workflows: [comeBack],
        segments: [dormant],
        templates: { email: emails },
      }),
    });
    // Known users, written straight to the store: identify would already evaluate the trigger
    const store = new D1JourneyStore(db, kv);
    await store.mergeProfile('u1', { plan: 'free' });
    await store.mergeProfile('u2', { plan: 'free' });
    await worker.fetch(new Request('http://worker/bundle/deploy', { method: 'POST' }), env);

    const first = await worker.sweep(env);
    expect(first).toMatchObject({ users: 2, sizes: [] });
    expect(first.started).toHaveLength(2);
    expect(journey.created).toHaveLength(2);
    // Already members: a second sweep starts nothing
    expect((await worker.sweep(env)).started).toEqual([]);
  });
});

describe('a version applies its own bundle', () => {
  let pg: PGlite;
  const client = (
    db: Pick<PGlite, 'query'> & Partial<Pick<PGlite, 'transaction'>>
  ): SqlClientLike => ({
    query: async <T>(text: string, params: readonly unknown[] = []) =>
      (await db.query<T>(text, [...params])).rows,
    transaction: (fn) =>
      db.transaction === undefined
        ? fn(client(db))
        : db.transaction((tx) => fn(client({ query: tx.query.bind(tx) }))),
  });

  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(renderPostgresDdl());
  });
  afterAll(async () => {
    await pg.close();
  });

  const other = workflow({ id: 'other', trigger: trigger.event(e.login) }).email(emails.welcome, {
    name: 'friend',
  });
  const versioned = (workflows: (typeof flow)[], id: string, timestamp: string) => {
    const env = {
      JOURNEY: new FakeJourney(),
      CF_VERSION_METADATA: { id, timestamp },
    };
    const worker = journeyWorker<typeof env>({
      store: () => new PostgresJourneyStore(client(pg)),
      config: defineConfig({ workflows, templates: { email: emails } }),
    });
    return () => worker.fetch(new Request('http://worker/health'), env);
  };
  const routed = async () =>
    (await new PostgresJourneyStore(client(pg)).findTriggers('login')).map((r) => r.workflow);

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

  test('a failed apply is logged and never fails the request', async () => {
    const empty = new PGlite(); // no migrations: the deployment table is missing
    const env = {
      JOURNEY: new FakeJourney(),
      CF_VERSION_METADATA: { id: 'v1', timestamp: '2026-10-01T00:00:00.000Z' },
    };
    const worker = journeyWorker<typeof env>({
      store: () => new PostgresJourneyStore(client(empty)),
      config,
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await worker.fetch(new Request('http://worker/health'), env);
      expect(response.status).toBe(200);
      expect(logged).toHaveBeenCalledWith(
        '[workflow] could not make version v1 live',
        expect.any(Error)
      );
    } finally {
      logged.mockRestore();
      await empty.close();
    }
  });

  test('a store that records no version (D1) leaves deploying to POST /bundle/deploy', async () => {
    const env = {
      JOURNEY: new FakeJourney(),
      CF_VERSION_METADATA: { id: 'v1', timestamp: '2026-10-01T00:00:00.000Z' },
    };
    const db = new FakeD1();
    const worker = journeyWorker<typeof env>({
      store: () => new D1JourneyStore(db, new FakeKV()),
      config,
    });
    await worker.fetch(new Request('http://worker/health'), env);
    expect(db.triggers).toHaveLength(0);
  });
});
