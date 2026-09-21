import postgres from 'postgres';
import type { StoreLease } from './store/index';
import {
  PostgresJourneyStore,
  type PostgresJourneyStoreOptions,
  type SqlClientLike,
} from './store/postgres';

/**
 * `@shware/workflow/postgres-js` — the Postgres store over postgres.js
 * (`postgres` is an optional peer dependency; import this subpath only when
 * you use it). On Cloudflare the connection string is Hyperdrive's.
 */

/** postgres.js → the store's minimal client. Inside `begin` every statement runs on the transaction client; the store never nests, so an inner `transaction` continues on the same one. */
export function postgresJsClient(
  sql: postgres.Sql | postgres.TransactionSql,
  inTransaction = false
): SqlClientLike {
  return {
    query: <T>(text: string, params: readonly unknown[] = []) =>
      sql.unsafe(text, params as never) as unknown as Promise<T[]>,
    transaction: <T>(fn: (tx: SqlClientLike) => Promise<T>) =>
      inTransaction
        ? fn(postgresJsClient(sql, true))
        : ((sql as postgres.Sql).begin((tx) => fn(postgresJsClient(tx, true))) as Promise<T>),
  };
}

export interface PostgresJsStoreOptions extends PostgresJourneyStoreOptions {
  /**
   * postgres.js options. Defaults suit a Worker with Hyperdrive: one
   * connection per request/run, no type fetch on connect, prepared statements
   * (Hyperdrive caches them).
   */
  connection?: postgres.Options<Record<string, never>>;
}

/**
 * Open a Postgres-backed store for one request or workflow run. The lease's
 * `close` ends the client — a Worker cannot share a socket across requests,
 * and Hyperdrive keeps the real pool next to the database.
 */
export function postgresJsStore(
  connectionString: string,
  options: PostgresJsStoreOptions = {}
): Required<StoreLease> {
  const { connection, ...storeOptions } = options;
  const sql = postgres(connectionString, {
    max: 1,
    fetch_types: false,
    prepare: true,
    ...connection,
  });
  return {
    store: new PostgresJourneyStore(postgresJsClient(sql), storeOptions),
    close: () => sql.end({ timeout: 5 }),
  };
}
