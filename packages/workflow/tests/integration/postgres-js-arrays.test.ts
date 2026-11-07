import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { postgresJsClient } from '../../src/postgres-js';
import { PostgresJourneyStore } from '../../src/store/postgres';
import { renderPostgresDdl } from '../../src/store/tables';

/**
 * Array parameters through postgres.js, against a real Postgres: with `fetch_types: false`
 * (the Worker default) `sql.unsafe` sends a JS array as `String(array)`, so every
 * `= ANY($1::text[])` in the store — the visitor merge at sign-in, the erasure's cleanup —
 * failed with "malformed array literal" while the PGlite suite passed. Same switch as the
 * lock tests:
 *
 *   WORKFLOW_TEST_DATABASE_URL=postgres://user:pass@localhost:5432/postgres pnpm exec vitest run tests/integration
 */

const url = process.env.WORKFLOW_TEST_DATABASE_URL;
if (url === undefined || url === '') {
  process.stderr.write(
    '[integration] WORKFLOW_TEST_DATABASE_URL unset: the postgres.js array tests did not run\n'
  );
}

describe.skipIf(url === undefined || url === '')('postgres.js array parameters', () => {
  const schema = `workflow_t${Math.random().toString(16).slice(2, 10)}`;
  let sql: postgres.Sql;
  let store: PostgresJourneyStore;

  beforeAll(async () => {
    sql = postgres(url as string, {
      max: 1,
      fetch_types: false,
      prepare: true,
      onnotice: () => {},
    });
    await sql.unsafe(renderPostgresDdl(schema));
    store = new PostgresJourneyStore(postgresJsClient(sql), { schema });
  }, 30_000);

  afterAll(async () => {
    await sql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await sql.end({ timeout: 5 });
  });

  test('round-trips text arrays, empty and quoted', async () => {
    const client = postgresJsClient(sql);
    // Read back through jsonb: without a type fetch postgres.js leaves array columns as text
    for (const items of [[], ['a'], ['a', 'b'], ['x"y', 'p,q', 'back\\slash']]) {
      const rows = await client.query<{ v: string }>('SELECT to_jsonb($1::text[])::text AS v', [
        items,
      ]);
      expect(JSON.parse(rows[0]?.v ?? 'null')).toEqual(items);
    }
    const hits = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM (VALUES ('u1'), ('u2'), ('u3')) AS t(id) WHERE id = ANY($1::text[])`,
      [['u1', 'u3']]
    );
    expect(hits[0]?.n).toBe(2);
  });

  test('links a visitor to a user: the profile merge reads both subjects at once', async () => {
    await store.mergeProfile('visitor:visitor-1', { plan: 'free', source: 'ad' }, 500);
    await store.mergeProfile('user-1', { plan: 'pro' }, 900);
    const merge = await store.linkVisitor('visitor-1', 'user-1', 1_000);
    expect(merge).toEqual({ dropped: [], events: [], props: ['source'] });
    expect(await store.getProfile('user-1')).toMatchObject({ plan: 'pro', source: 'ad' });
  });
});
