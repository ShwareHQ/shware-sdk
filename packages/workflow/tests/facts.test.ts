import { describe, expect, test } from 'vitest';
import { D1FactSource } from '../src/cloudflare/facts';
import { evaluateCondition } from '../src/engine/condition';
import { fillSubject } from '../src/engine/subject';
import type { ConditionIR } from '../src/ir';
import { FakeD1 } from './fake-cloudflare';

/**
 * The profile read is the last boundary between stored JSON and every
 * ScalarIR-typed consumer — branch evaluation, subject placeholders, resolved
 * message props. /identify checks only that `props` is an object, so anything
 * json_patch accepts can be sitting in that column.
 */
describe('D1FactSource.getProperty: the scalar boundary', () => {
  function factsFor(props: Record<string, unknown>) {
    const db = new FakeD1();
    db.profiles.set('u_1', JSON.stringify(props));
    return new D1FactSource(db, 'u_1');
  }

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

  test('an object value cannot reach a recipient or a subject as [object Object]', async () => {
    const facts = factsFor({ email: { work: 'a@b.c' }, first_name: { given: 'Ada' } });

    await expect(facts.getProperty('email')).resolves.toBeUndefined();
    await expect(
      fillSubject('Hi {{ user.first_name }}', (path) => facts.getProperty(path))
    ).resolves.toBe('Hi ');
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
    const facts = new D1FactSource(new FakeD1(), 'u_missing');

    await expect(facts.getProperty('tier')).resolves.toBeUndefined();
    await expect(evaluateCondition(prop('toString', 'exists'), facts, 0)).resolves.toBe(false);
  });
});
