import { describe, expect, test } from 'vitest';
import { evaluateCondition } from '../src/engine/condition';
import { event, trigger, workflow } from '../src/index';
import type { ConditionIR } from '../src/ir';
import { D1JourneyStore, JourneyFactSource } from '../src/store/index';
import { FakeD1 } from './fake-cloudflare';
import { plainEmail } from './fixtures';

/**
 * The profile read is the last boundary between stored JSON and every
 * ScalarIR-typed consumer — branch evaluation, resolved
 * message props. /identify checks only that `props` is an object, so anything
 * json_patch accepts can be sitting in that column.
 */
describe('JourneyFactSource.getProperty: the scalar boundary', () => {
  function factsFor(props: Record<string, unknown>) {
    const db = new FakeD1();
    db.profiles.set('u_1', JSON.stringify(props));
    return new JourneyFactSource(new D1JourneyStore(db), 'u_1');
  }

  test("u.userId reads the user's own id, which no profile stores", async () => {
    await expect(factsFor({}).getProperty('userId')).resolves.toBe('u_1');
    // a stored field of that name cannot impersonate another user
    await expect(factsFor({ userId: 'someone-else' }).getProperty('userId')).resolves.toBe('u_1');
    await expect(
      evaluateCondition({ type: 'property', path: 'userId', op: 'exists' }, factsFor({}), 0)
    ).resolves.toBe(true);
  });

  const prop = (path: string, op: 'gt' | 'eq' | 'exists', value?: number): ConditionIR =>
    op === 'exists'
      ? { type: 'property', path, op }
      : { type: 'property', path, op, value: value as number };

  test('scalars pass through unchanged', async () => {
    const facts = factsFor({ score: 5, tier: 'gold', active: true });

    await expect(facts.getProperty('score')).resolves.toBe(5);
    await expect(facts.getProperty('tier')).resolves.toBe('gold');
    await expect(facts.getProperty('active')).resolves.toBe(true);
  });

  test('a nested or array value reads as absent rather than coercing', async () => {
    const facts = factsFor({ score: ['5'], tier: { name: 'gold' } });

    await expect(facts.getProperty('score')).resolves.toBeUndefined();
    await expect(facts.getProperty('tier')).resolves.toBeUndefined();
  });

  test('an array value no longer makes gt and eq disagree about the same branch', async () => {
    const facts = factsFor({ score: ['5'] });

    // ['5'] > 3 used to coerce to 5 > 3 and send the user down the wrong arm
    await expect(evaluateCondition(prop('score', 'gt', 3), facts, 0)).resolves.toBe(false);
    await expect(evaluateCondition(prop('score', 'eq', 5), facts, 0)).resolves.toBe(false);
  });

  test('an object value cannot reach a recipient as [object Object]', async () => {
    const facts = factsFor({ email: { work: 'a@b.c' } });

    await expect(facts.getProperty('email')).resolves.toBeUndefined();
  });

  test('inherited keys are not properties: exists stays false for Object.prototype members', async () => {
    const facts = factsFor({ tier: 'gold' });

    await expect(facts.getProperty('toString')).resolves.toBeUndefined();
    await expect(facts.getProperty('constructor')).resolves.toBeUndefined();
    await expect(evaluateCondition(prop('toString', 'exists'), facts, 0)).resolves.toBe(false);
  });

  test('an explicit null still behaves as unset', async () => {
    const facts = factsFor({ tier: null });

    await expect(facts.getProperty('tier')).resolves.toBeUndefined();
    await expect(evaluateCondition(prop('tier', 'exists'), facts, 0)).resolves.toBe(false);
  });

  test('a user with no profile row at all has no properties', async () => {
    const facts = new JourneyFactSource(new D1JourneyStore(new FakeD1()), 'u_missing');

    await expect(facts.getProperty('tier')).resolves.toBeUndefined();
    await expect(evaluateCondition(prop('toString', 'exists'), facts, 0)).resolves.toBe(false);
  });
});

/**
 * The D1 store's statements, every one served by FakeD1 — the paths the router
 * suite does not reach (erasure, sign-out, wake subscriptions, user pages, the
 * event window's upper bound) included, so none of them runs for the first
 * time in production.
 */
describe('D1JourneyStore on FakeD1', () => {
  const ir = (id: string) =>
    workflow({ id, trigger: trigger.event(event<{ signed_up: never }>().signed_up) })
      .email(plainEmail('welcome'))
      .toIR();

  test('event ids are per user: the same id from two users is two events', async () => {
    const store = new D1JourneyStore(new FakeD1());
    const row = (userId: string) => ({
      id: 'evt-1',
      userId,
      event: 'purchase',
      ts: 1,
      payload: {},
    });
    expect(await store.insertEvent(row('u1'))).toBe(true);
    expect(await store.insertEvent(row('u2'))).toBe(true);
    expect(await store.insertEvent(row('u1'))).toBe(false);
    expect(await store.countEvents('u1', 'purchase')).toBe(1);
    expect(await store.countEvents('u2', 'purchase')).toBe(1);
  });

  test('counts and payloads honour both window bounds', async () => {
    const store = new D1JourneyStore(new FakeD1());
    for (const [id, ts] of [
      ['e1', 1_000],
      ['e2', 5_000],
      ['e3', 9_000],
    ] as const) {
      await store.insertEvent({ id, userId: 'u1', event: 'purchase', ts, payload: { ts } });
    }
    expect(await store.countEvents('u1', 'purchase', { untilMs: 5_000 })).toBe(2);
    expect(await store.countEvents('u1', 'purchase', { sinceMs: 2_000, untilMs: 8_000 })).toBe(1);
    expect(
      await store.listEventPayloads('u1', 'purchase', { sinceMs: 5_000, untilMs: 9_000 })
    ).toEqual([{ ts: 5_000 }, { ts: 9_000 }]);
  });

  test('the profile merge is top-level: a null unsets, an object replaces whole', async () => {
    const store = new D1JourneyStore(new FakeD1());
    await store.mergeProfile('u1', { plan: 'pro', email: 'a@b.c' });
    expect(await store.mergeProfile('u1', { plan: null, name: 'Ann' })).toEqual({
      email: 'a@b.c',
      name: 'Ann',
    });
    // Postgres's `||` replaces a key's value whole; so does this, instead of json_patch's deep merge
    const nested = { address: { city: 'Oslo', zip: '0150' } } as never;
    await store.mergeProfile('u1', nested);
    expect(await store.mergeProfile('u1', { address: { city: 'Bergen' } } as never)).toEqual({
      email: 'a@b.c',
      name: 'Ann',
      address: { city: 'Bergen' },
    });
  });

  test('workflow bodies are stored in D1, content-addressed', async () => {
    const db = new FakeD1();
    const store = new D1JourneyStore(db);
    const welcome = ir('welcome');
    await store.putWorkflowIR(welcome);
    await store.putWorkflowIR(welcome);
    expect(db.ir.size).toBe(1);
    expect((await store.getWorkflowIR(welcome.contentHash))?.id).toBe('welcome');
    expect(await store.getWorkflowIR('nope')).toBeUndefined();
  });

  test('user ids page in ascending order past the last id seen', async () => {
    const store = new D1JourneyStore(new FakeD1());
    await store.mergeProfile('u3', { a: 1 });
    await store.insertEvent({ id: 'e', userId: 'u1', event: 'x', ts: 1, payload: {} });
    await store.insertEvent({ id: 'e', userId: 'u2', event: 'x', ts: 1, payload: {} });
    await store.mergeProfile('u2', { a: 1 });
    expect(await store.listUserIds()).toEqual(['u1', 'u2', 'u3']);
    expect(await store.listUserIds({ limit: 2 })).toEqual(['u1', 'u2']);
    expect(await store.listUserIds({ after: 'u2', limit: 2 })).toEqual(['u3']);
    expect(await store.listUserIds({ after: 'u3' })).toEqual([]);
  });

  test('signing out unbinds a device and reports its owner once', async () => {
    const store = new D1JourneyStore(new FakeD1());
    await store.upsertDevice({ userId: 'u1', token: 't', platform: 'ios', ts: 1 });
    expect(await store.unbindDevice('t')).toBe('u1');
    expect(await store.unbindDevice('t')).toBeUndefined();
    expect(await store.listDevices('u1')).toEqual([]);
    await store.upsertDevice({ userId: 'u2', token: 't', platform: 'ios', ts: 2 });
    expect(await store.listDevices('u2')).toEqual([{ token: 't', platform: 'ios' }]);
  });

  test('subscribe is idempotent per (handle, event)', async () => {
    const store = new D1JourneyStore(new FakeD1());
    await store.subscribe('i1', 'u1', ['a', 'b'], 1);
    await store.subscribe('i1', 'u1', ['a'], 2);
    await store.subscribe('i2', 'u1', ['a'], 3);
    expect((await store.findWakeHandles('u1', 'a')).sort()).toEqual(['i1', 'i2']);
    expect(await store.findWakeHandles('u1', 'b')).toEqual(['i1']);
    await store.unsubscribe('i1');
    expect(await store.findWakeHandles('u1', 'a')).toEqual(['i2']);
  });

  test('an erasure is pending from the request until forgetUser, which takes everything', async () => {
    const db = new FakeD1();
    const store = new D1JourneyStore(db);
    await store.mergeProfile('u1', { a: 1 });
    await store.insertEvent({ id: 'e', userId: 'u1', event: 'x', ts: 1, payload: {} });
    await store.upsertDevice({ userId: 'u1', token: 't', platform: 'ios', ts: 1 });
    await store.subscribe('i1', 'u1', ['x'], 1);
    await store.addSegmentMember('s', 'u1', 1, ['w']);
    await store.enterJourney({ workflow: 'w', userId: 'u1', instanceId: 'i1', hash: 'h', ts: 1 });
    await store.mergeProfile('u2', { a: 1 });

    expect(await store.erasurePending('u1')).toBe(false);
    await store.requestErasure('u1', 5);
    await store.requestErasure('u1', 6);
    expect(await store.erasurePending('u1')).toBe(true);
    expect(await store.pendingErasures()).toEqual(['u1']);
    expect(await store.runningInstances('u1')).toEqual(['i1']);

    await store.forgetUser('u1');
    expect(await store.erasurePending('u1')).toBe(false);
    expect(await store.getProfile('u1')).toBeUndefined();
    expect(await store.countEvents('u1', 'x')).toBe(0);
    expect(await store.listDevices('u1')).toEqual([]);
    expect(await store.findWakeHandles('u1', 'x')).toEqual([]);
    expect(await store.isSegmentMember('s', 'u1')).toBe(false);
    expect(await store.pendingSegmentStarts('s', 'u1')).toEqual([]);
    expect(await store.runningInstances('u1')).toEqual([]);
    expect(await store.listUserIds()).toEqual(['u2']);
  });
});
