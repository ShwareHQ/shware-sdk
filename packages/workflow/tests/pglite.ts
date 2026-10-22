import { PGlite } from '@electric-sql/pglite';
import { PostgresJourneyStore, type SqlClientLike } from '../src/store/index';
import { TABLES, renderPostgresDdl } from '../src/store/tables';

/**
 * The one store the suite runs on: Postgres, embedded (PGlite). A file creates one database in
 * `beforeAll` (a cold start takes a second or two — the 30 s timeout is for that), builds stores
 * over it as it likes, and closes it in `afterAll`. Transactions nest the way the stores expect:
 * `transaction` on the top-level client opens a real one; a client built over an open
 * transaction runs the callback on it.
 */

type Queryable = Pick<PGlite, 'query'> & Partial<Pick<PGlite, 'transaction'>>;

/** A `SqlClientLike` over a PGlite database (or an open PGlite transaction). */
export function pgliteClient(db: Queryable): SqlClientLike {
  return {
    query: async <T>(text: string, params: readonly unknown[] = []) =>
      (await db.query<T>(text, [...params])).rows,
    transaction: (fn) =>
      db.transaction === undefined
        ? fn(pgliteClient(db))
        : db.transaction((tx) => fn(pgliteClient({ query: tx.query.bind(tx) }))),
  };
}

export interface PgliteDatabase {
  pg: PGlite;
  client: SqlClientLike;
  /** The store over the whole engine schema (`workflow`), migrated. */
  store: PostgresJourneyStore;
  /** Another store over the same database (another connection, in the stores' terms). */
  storeIn(schema?: string): PostgresJourneyStore;
  close(): Promise<void>;
}

/** A fresh, migrated PGlite database; `schema` other than `workflow` is created too. */
export async function pgliteDatabase(options: { schema?: string } = {}): Promise<PgliteDatabase> {
  const pg = await PGlite.create();
  const schema = options.schema ?? 'workflow';
  await pg.exec(renderPostgresDdl(schema));
  const client = pgliteClient(pg);
  const storeIn = (name = schema) =>
    new PostgresJourneyStore(client, name === 'workflow' ? undefined : { schema: name });
  return { pg, client, store: storeIn(), storeIn, close: () => pg.close() };
}

/** Empty every engine table in `schema` (one statement, so foreign keys are no concern): a clean slate between tests without another cold start. */
export async function truncateAll(pg: Pick<PGlite, 'exec'>, schema = 'workflow'): Promise<void> {
  const tables = Object.values(TABLES).map((table) => `"${schema}"."${table.name}"`);
  await pg.exec(`TRUNCATE ${tables.join(', ')}`);
}
