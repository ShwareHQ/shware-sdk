import { describe, expect, test } from 'vitest';
import { journeyWorker } from '../src/cloudflare/worker';
import { compileBundle, event, template, trigger, workflow } from '../src/index';
import { D1JourneyStore } from '../src/store/d1';
import { FakeD1, FakeJourney, FakeKV } from './fake-cloudflare';

/**
 * journeyWorker: the fetch handler around the ingest router (bundle deploy,
 * preview, auth) and the store lease lifecycle. The runner class itself needs
 * the Workflows runtime; its wiring is covered by the options being applied to
 * the fetch side, which shares the same lease.
 */

const e = event<{ login: { method: string } }>();
const welcome = template.email('welcome');
const flow = workflow('welcome', { trigger: trigger.event(e.login) }).email(welcome);
const bundle = () => compileBundle({ workflows: [flow], templates: [welcome] });

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
    bundle,
    preview: async (key, props) => ({ subject: `Hi ${String(props.name)}`, html: `<p>${key}</p>` }),
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
      workflows: [expect.objectContaining({ name: 'welcome' })],
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

    const denied = await call('/preview/welcome?name=Ada');
    expect(denied.status).toBe(401);
    expect((await call('/bundle')).status).toBe(401);

    const preview = await call('/preview/welcome?name=Ada', {
      headers: { authorization: 'Bearer secret' },
    });
    expect(preview.headers.get('x-subject')).toBe('Hi Ada');
    expect(await preview.text()).toBe('<p>welcome</p>');

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
