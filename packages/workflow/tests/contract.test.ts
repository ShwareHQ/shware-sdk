import { describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { JourneyClient, JourneyValidationError } from '../src/client';
import { handleRequest } from '../src/host/http';
import { deployBundle } from '../src/host/ingest';
import { compileBundle, defineContract, performed, trigger, workflow } from '../src/index';
import { D1JourneyStore } from '../src/store/d1';
import { makeEnv } from './fake-cloudflare';

const contract = defineContract({
  events: {
    login: z.looseObject({ method: z.string() }),
    purchase: z.looseObject({
      transaction_id: z.string(),
      value: z.number(),
      items: z.array(z.strictObject({ sku: z.string() })).optional(),
    }),
  },
  profile: z.strictObject({ email: z.email().optional(), name: z.string() }),
});

describe('defineContract', () => {
  test('declared event names and refs the DSL compiles against', () => {
    expect(contract.eventNames).toEqual(['login', 'purchase']);
    const ir = workflow({ id: 'w', trigger: trigger.event(contract.events.login) })
      .branch([performed(contract.events.purchase, { count: 2 }), (b) => b.exit()])
      .toIR();
    expect(ir.trigger).toMatchObject({ type: 'event', event: 'login' });
    expect(contract.user.name).toMatchObject({ type: 'user_property', path: 'name' });
  });

  test('event payloads: loose objects keep extra fields, declared fields are checked', () => {
    expect(contract.parseEvent('login', { method: 'email', session: 's1' })).toEqual({
      ok: true,
      data: { method: 'email', session: 's1' },
    });
    expect(contract.parseEvent('purchase', { transaction_id: 't', value: '9' })).toMatchObject({
      ok: false,
      issues: [{ path: 'value' }],
    });
    expect(
      contract.parseEvent('purchase', { transaction_id: 't', value: 1, items: [{ sku: 1 }] })
    ).toMatchObject({
      ok: false,
      issues: [{ path: 'items.0.sku' }],
    });
  });

  test('profile patches: omit keeps, null removes, provided values checked, unknown refused', () => {
    expect(contract.parseProfilePatch({ name: 'Ada' })).toEqual({
      ok: true,
      data: { name: 'Ada' },
    });
    expect(contract.parseProfilePatch({ email: null })).toEqual({
      ok: true,
      data: { email: null },
    });
    expect(contract.parseProfilePatch({ email: 'nope' })).toMatchObject({
      ok: false,
      issues: [{ path: 'email' }],
    });
    expect(contract.parseProfilePatch({ plan: 'pro' })).toMatchObject({
      ok: false,
      issues: [{ path: 'plan' }],
    });
    expect(contract.parseProfilePatch({ userId: 'u' })).toMatchObject({
      ok: false,
      issues: [{ path: 'userId' }],
    });
    // no defaults are filled in for fields the caller did not send
    expect(contract.parseProfilePatch({})).toEqual({ ok: true, data: {} });
  });

  test.each([
    ['a transform', { events: { e: z.looseObject({ a: z.string().transform((s) => s.length) }) } }],
    ['a default', { events: { e: z.looseObject({ a: z.string().default('x') }) } }],
    ['a coercion', { events: { e: z.looseObject({ a: z.coerce.number() }) } }],
    ['a custom refinement', { events: { e: z.looseObject({ a: z.string().refine(() => true) }) } }],
    ['a non-object payload', { events: { e: z.string() } }],
    ['a reserved event name', { events: { $x: z.looseObject({}) } }],
    [
      'a nested profile field',
      { profile: z.strictObject({ address: z.strictObject({ city: z.string() }) }) },
    ],
  ])('refuses %s when defined', (_label, override) => {
    expect(() =>
      defineContract({
        events: { ok: z.looseObject({}) },
        profile: z.strictObject({ name: z.string() }),
        ...(override as object),
      })
    ).toThrow(TypeError);
  });
});

test('tuples, intersections, records and catchalls of supported types are accepted', () => {
  expect(() =>
    defineContract({
      events: {
        rich: z.looseObject({
          pair: z.tuple([z.string(), z.number()]),
          both: z.intersection(z.looseObject({ a: z.string() }), z.looseObject({ b: z.number() })),
          tally: z.record(z.string(), z.number()),
          tags: z.array(z.enum(['a', 'b'])).optional(),
        }),
        extra: z.object({}).catchall(z.string()),
      },
      profile: z.strictObject({ name: z.string() }),
    })
  ).not.toThrow();
});

describe('JourneyClient with a contract', () => {
  test('refuses a bad payload before any request, with field paths', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = new JourneyClient({ origin: 'https://w.test', contract, fetch });
    const error = await client
      .track('u1', 'purchase', { transaction_id: 't', value: 'x' as never })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JourneyValidationError);
    expect((error as JourneyValidationError).issues).toEqual([
      { path: 'value', message: expect.any(String) },
    ]);
    await expect(client.identify('u1', { name: 3 as never })).rejects.toBeInstanceOf(
      JourneyValidationError
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  test('sends a valid event with its id and timestamp', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ stored: true }));
    const client = new JourneyClient({ origin: 'https://w.test', contract, fetch });
    await client.track('u1', 'login', { method: 'email' }, { id: 'row-1', ts: 5 });
    const body = JSON.parse(fetch.mock.calls[0]?.[1]?.body as string);
    expect(body).toEqual({
      userId: 'u1',
      event: 'login',
      payload: { method: 'email' },
      id: 'row-1',
      ts: 5,
    });
  });
});

describe('ingest validation in the Worker', () => {
  async function setup() {
    const { env, db, journey } = makeEnv();
    const store = new D1JourneyStore(db);
    const welcome = workflow({
      id: 'welcome',
      trigger: trigger.event(contract.events.login),
    }).exit();
    await deployBundle(env, compileBundle({ workflows: [welcome] }), store);
    const post = (path: string, body: unknown, mode?: 'enforce' | 'report') =>
      handleRequest(
        new Request(`https://w.test${path}`, { method: 'POST', body: JSON.stringify(body) }),
        env,
        store,
        { contract, mode }
      );
    return { db, journey, post };
  }

  test('a bad payload, an undeclared event and a bad patch are refused with no side effects', async () => {
    const { db, journey, post } = await setup();
    const bad = await post('/events', {
      id: 'e1',
      userId: 'u1',
      event: 'login',
      payload: { method: 1 },
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ issues: [{ path: 'method' }] });
    expect((await post('/events', { userId: 'u1', event: 'signup', payload: {} })).status).toBe(
      400
    );
    expect((await post('/identify', { userId: 'u1', props: { name: 3 } })).status).toBe(400);
    expect(db.events).toEqual([]);
    expect(db.profiles.size).toBe(0);
    expect(journey.created).toEqual([]);
  });

  test('a valid event is stored with its parsed payload and starts the journey', async () => {
    const { db, journey, post } = await setup();
    const ok = await post('/events', {
      id: 'e2',
      userId: 'u1',
      event: 'login',
      payload: { method: 'email', extra: 1 },
    });
    expect(ok.status).toBe(200);
    expect(db.events).toHaveLength(1);
    expect(journey.created).toHaveLength(1);
  });

  test('report mode logs and accepts, so real producers can be checked first', async () => {
    const { db, post } = await setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await post(
      '/events',
      { id: 'e3', userId: 'u1', event: 'login', payload: { method: 1 } },
      'report'
    );
    expect(res.status).toBe(200);
    expect(db.events).toHaveLength(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/event 'login' \(e3\).*method/);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('"method":1');
    warn.mockRestore();
  });
});
