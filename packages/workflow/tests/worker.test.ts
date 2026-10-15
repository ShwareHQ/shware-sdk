import { createElement } from 'react';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { journeyWorker } from '../src/cloudflare/worker';
import {
  defineConfig,
  emailTemplate,
  event,
  not,
  performed,
  segment,
  templates,
  trigger,
  workflow,
} from '../src/index';
import { D1JourneyStore } from '../src/store/d1';
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
    title: 'Welcome',
    props: z.strictObject({ name: z.string() }),
    subject: 'Welcome aboard',
    preview: { name: 'A' },
    component: ({ name }) => createElement('p', null, `Hi ${name}`),
  }),
};
const t = templates({ email: emails });
const flow = workflow({ id: 'welcome', trigger: trigger.event(e.login) }).email(t.email.welcome, {
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
      t.email.welcome,
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
