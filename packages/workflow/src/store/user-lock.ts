import type { SqlClientLike } from './sql';

/**
 * The Postgres store's per-user mutual exclusion, shared by the store and its reporting (not
 * part of the package's API). Every write about a user runs in a transaction that holds the
 * user's transaction-scoped advisory lock, so the writes and the erasure of one user run one
 * after another: a write either commits before the tombstone, where the erasure finds and
 * deletes it, or waits for the lock, reads the tombstone and is refused — never astride.
 *
 * The protocol is three separate statements, in this order, on the one transaction:
 *
 *   1. `beginReadCommitted` — the transaction is pinned to READ COMMITTED first. A connection
 *      defaulting to REPEATABLE READ would wait for the lock on a snapshot taken before it, and
 *      read a state the lock holder has since changed.
 *   2. `lockUser` — the lock, as its own statement, before any read about the user: a snapshot
 *      taken after the wait is current. Two int4 keys, the schema's and the user id's
 *      `hashtext` (a collision only serialises two more users).
 *   3. The tombstone check and the writes (`WHERE NOT EXISTS (erasure)`), on the same `tx`.
 *
 * The two steps are split so a path that knows only a message id can run the SET first, look
 * the owner up, and then take the lock (`postgres-reporting.ts`). Nothing outside the database
 * — a sender, a platform call, a durable wait — runs inside the locked transaction: the lock
 * covers short database work only.
 */

/** Step 1: the transaction's first statement. */
export async function beginReadCommitted(tx: SqlClientLike): Promise<void> {
  await tx.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
}

/** Step 2: the user's transaction-scoped advisory lock, held until commit or rollback. */
export async function lockUser(tx: SqlClientLike, schema: string, userId: string): Promise<void> {
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [schema, userId]);
}

/** Steps 1 and 2 for a transaction that knows the user from the start. */
export async function lockUserTransaction(
  tx: SqlClientLike,
  schema: string,
  userId: string
): Promise<void> {
  await beginReadCommitted(tx);
  await lockUser(tx, schema, userId);
}
