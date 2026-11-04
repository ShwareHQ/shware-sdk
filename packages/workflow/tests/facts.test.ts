import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { evaluateCondition } from '../src/engine/condition';
import type { ConditionIR } from '../src/ir';
import { JourneyFactSource } from '../src/store/index';
import { type PgliteDatabase, pgliteDatabase } from './pglite';

let database: PgliteDatabase;

beforeAll(async () => {
  database = await pgliteDatabase();
}, 30_000);

afterAll(async () => {
  await database.close();
});

/**
 * The profile read is the last boundary between stored JSON and every
 * ScalarIR-typed consumer — branch evaluation, resolved
 * message props. /identify checks only that `props` is an object, so anything
 * the jsonb column accepts can be sitting in it.
 */
describe('JourneyFactSource.getProperty: the scalar boundary', () => {
  /** A fact source over u_1 with `props` written straight into the profile row, bypassing the merge. */
  async function factsFor(props: Record<string, unknown>) {
    await database.pg.query(
      'INSERT INTO workflow.profile (user_id, props) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET props = EXCLUDED.props',
      ['u_1', JSON.stringify(props)]
    );
    return new JourneyFactSource(database.store, 'u_1');
  }

  test("u.userId reads the user's own id, which no profile stores", async () => {
    await expect((await factsFor({})).getProperty('userId')).resolves.toBe('u_1');
    // a stored field of that name cannot impersonate another user
    await expect((await factsFor({ userId: 'someone-else' })).getProperty('userId')).resolves.toBe(
      'u_1'
    );
    await expect(
      evaluateCondition({ type: 'property', path: 'userId', op: 'exists' }, await factsFor({}), 0)
    ).resolves.toBe(true);
  });

  const prop = (path: string, op: 'gt' | 'eq' | 'exists', value?: number): ConditionIR =>
    op === 'exists'
      ? { type: 'property', path, op }
      : { type: 'property', path, op, value: value as number };

  test('scalars pass through unchanged', async () => {
    const facts = await factsFor({ score: 5, tier: 'gold', active: true });

    await expect(facts.getProperty('score')).resolves.toBe(5);
    await expect(facts.getProperty('tier')).resolves.toBe('gold');
    await expect(facts.getProperty('active')).resolves.toBe(true);
  });

  test('a nested or array value reads as absent rather than coercing', async () => {
    const facts = await factsFor({ score: ['5'], tier: { name: 'gold' } });

    await expect(facts.getProperty('score')).resolves.toBeUndefined();
    await expect(facts.getProperty('tier')).resolves.toBeUndefined();
  });

  test('an array value no longer makes gt and eq disagree about the same branch', async () => {
    const facts = await factsFor({ score: ['5'] });

    // ['5'] > 3 used to coerce to 5 > 3 and send the user down the wrong arm
    await expect(evaluateCondition(prop('score', 'gt', 3), facts, 0)).resolves.toBe(false);
    await expect(evaluateCondition(prop('score', 'eq', 5), facts, 0)).resolves.toBe(false);
  });

  test('an object value cannot reach a recipient as [object Object]', async () => {
    const facts = await factsFor({ email: { work: 'a@b.c' } });

    await expect(facts.getProperty('email')).resolves.toBeUndefined();
  });

  test('inherited keys are not properties: exists stays false for Object.prototype members', async () => {
    const facts = await factsFor({ tier: 'gold' });

    await expect(facts.getProperty('toString')).resolves.toBeUndefined();
    await expect(facts.getProperty('constructor')).resolves.toBeUndefined();
    await expect(evaluateCondition(prop('toString', 'exists'), facts, 0)).resolves.toBe(false);
  });

  test('an explicit null still behaves as unset', async () => {
    const facts = await factsFor({ tier: null });

    await expect(facts.getProperty('tier')).resolves.toBeUndefined();
    await expect(evaluateCondition(prop('tier', 'exists'), facts, 0)).resolves.toBe(false);
  });

  test('a user with no profile row at all has no properties', async () => {
    const facts = new JourneyFactSource(database.store, 'u_missing');

    await expect(facts.getProperty('tier')).resolves.toBeUndefined();
    await expect(evaluateCondition(prop('toString', 'exists'), facts, 0)).resolves.toBe(false);
  });
});

/**
 * A `where` filters payloads in JS, so it reads them from the store a page at a time — and stops
 * the moment the condition's count is met instead of loading the user's whole history.
 */
describe('JourneyFactSource.countEvents: where pages and stops early', () => {
  const where: ConditionIR = { type: 'payload', path: 'plan', op: 'eq', value: 'pro' };

  /** A store with `pages` canned pages of payloads, recording how many it was asked for. */
  function pagedStore(pages: Record<string, unknown>[][]) {
    const requested: number[] = [];
    const store = {
      async pageEventPayloads(
        _userId: string,
        _event: string,
        _window: unknown,
        page: { limit: number; after?: { ts: string; id: string } }
      ) {
        const index = page.after === undefined ? 0 : Number(page.after.id);
        requested.push(index);
        const payloads = pages[index] ?? [];
        return index + 1 < pages.length
          ? { payloads, next: { ts: '', id: String(index + 1) } }
          : { payloads };
      },
    };
    return {
      store: store as unknown as ConstructorParameters<typeof JourneyFactSource>[0],
      requested,
    };
  }

  const free = { plan: 'free' };
  const pro = { plan: 'pro' };

  test('a match on the first page settles the check without reading the rest', async () => {
    const { store, requested } = pagedStore([[free, pro], [pro], [pro]]);
    const facts = new JourneyFactSource(store, 'u_1');
    await expect(facts.countEvents('upgrade', { where, atLeast: 1 })).resolves.toBe(1);
    expect(requested).toEqual([0]);
  });

  test('a count spanning pages reads only as far as it needs', async () => {
    const { store, requested } = pagedStore([[pro, free], [free, pro], [pro], [pro]]);
    const facts = new JourneyFactSource(store, 'u_1');
    await expect(facts.countEvents('upgrade', { where, atLeast: 2 })).resolves.toBe(2);
    expect(requested).toEqual([0, 1]);
  });

  test('without a threshold, or with no match, every page is read and the count is exact', async () => {
    const { store, requested } = pagedStore([[pro, free], [pro], [free]]);
    await expect(
      new JourneyFactSource(store, 'u_1').countEvents('upgrade', { where })
    ).resolves.toBe(2);
    expect(requested).toEqual([0, 1, 2]);

    const none = pagedStore([[free], [free]]);
    await expect(
      new JourneyFactSource(none.store, 'u_1').countEvents('upgrade', { where, atLeast: 1 })
    ).resolves.toBe(0);
    expect(none.requested).toEqual([0, 1]);
  });
});
