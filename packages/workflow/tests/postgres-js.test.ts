import { describe, expect, test, vi } from 'vitest';
import { pgArrayLiteral, postgresJsClient } from '../src/postgres-js';

/**
 * The postgres.js wrapper's one piece of logic: array parameters leave as Postgres array
 * literals. `sql.unsafe` would send `String(array)` — `a,b`, and `''` for an empty array —
 * which `= ANY($1::text[])` rejects on a real server (PGlite, the suite's store, serializes
 * arrays itself, so this is what the suite could not see). The round trip against a real
 * Postgres is in `integration/postgres-js-arrays.test.ts`.
 */
describe('pgArrayLiteral', () => {
  test('writes the literal form, empty arrays included', () => {
    expect(pgArrayLiteral([])).toBe('{}');
    expect(pgArrayLiteral(['a'])).toBe('{"a"}');
    expect(pgArrayLiteral(['a', 'b'])).toBe('{"a","b"}');
    expect(pgArrayLiteral([1, 2])).toBe('{"1","2"}');
  });

  test('escapes quotes and backslashes, and keeps nulls', () => {
    expect(pgArrayLiteral(['x"y', 'p,q', 'back\\slash', null])).toBe(
      '{"x\\"y","p,q","back\\\\slash",NULL}'
    );
  });
});

describe('postgresJsClient', () => {
  test('passes scalars through and arrays as literals', async () => {
    const unsafe = vi.fn<(text: string, params: unknown[]) => Promise<unknown[]>>();
    unsafe.mockResolvedValue([]);
    const client = postgresJsClient({ unsafe } as never);
    await client.query('SELECT $1, $2::text[], $3', ['u1', ['a', 'b'], 7]);
    expect(unsafe).toHaveBeenCalledWith('SELECT $1, $2::text[], $3', ['u1', '{"a","b"}', 7]);
  });
});
