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
