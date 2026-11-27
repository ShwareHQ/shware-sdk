import type { JourneyParams } from '../host/platform';
import type { SqlClientLike } from '../store/sql';
import { DEFAULT_SCHEMA, TABLES } from '../store/tables';
import { beginReadCommitted } from '../store/user-lock';

/**
 * The self-hosted runtime's own tables, `run` and `run_step`: every statement the runtime issues
 * is here, so the rules that make it safe are in one place.
 *
 * Two of them carry everything:
 *
 * - **The claim** picks one due run with `FOR UPDATE SKIP LOCKED` and increments its
 *   `lease_gen`. Any number of workers, in any number of processes, can run it at once and no
 *   run is handed to two of them.
 * - **The fence**: every write a turn makes names the `lease_gen` it claimed with and requires
 *   the run to be `running` still. A worker whose lease expired and was taken over, or whose run
 *   was terminated under it, finds its write refused (`false`) and drops the turn — it was only
 *   slow, and its successor's state is the one that counts.
 *
 * Time is always the caller's clock, passed in: the runtime is driven by an injected clock in
 * tests, and one clock for the claim, the wake instants and the leases keeps them comparable.
 */

const TS = (param: string) => `to_timestamp(${param}::double precision / 1000)`;
const MS = (column: string) => `(extract(epoch FROM ${column}) * 1000)::double precision`;

/** The states a run is in while it can still be picked up. */
const LIVE = `('queued', 'running', 'sleeping', 'waiting')`;

export type RunStatus =
  | 'queued'
  | 'running'
  | 'sleeping'
  | 'waiting'
  | 'complete'
  | 'errored'
  | 'terminated';

/** A run a worker holds for one turn. */
export interface ClaimedRun {
  instanceId: string;
  params: JourneyParams;
  enteredAtMs: number;
  /** The fencing token: what every write of this turn is checked against. */
  gen: number;
}

/** One checkpoint, as a turn reads it back. */
export interface StepRecord {
  kind: 'do' | 'sleep' | 'wait';
  /** False while a step that threw waits for its retry. */
  done: boolean;
  result: unknown;
  attempts: number;
}

/** How a turn that did not end the run leaves it. */
export interface Suspension {
  status: 'sleeping' | 'waiting' | 'queued';
  wakeAt: number;
  /**
   * A wait parks only while no wake has arrived since it subscribed: the `signals` value it saw.
   * When the counter has moved, the run is queued again at once instead of parked.
   */
  ifSignals?: number | undefined;
}

export class RunStore {
  private readonly run: string;
  private readonly step: string;

  constructor(
    private readonly sql: SqlClientLike,
    schema: string = DEFAULT_SCHEMA
  ) {
    this.run = `"${schema}"."${TABLES.run.name}"`;
    this.step = `"${schema}"."${TABLES.runStep.name}"`;
  }

  /**
   * One statement that may meet another worker's write to the same row. Each is a transaction
   * of its own, so under READ COMMITTED (the server's default) it simply sees the row as the
   * other left it. A pool that defaults to REPEATABLE READ or SERIALIZABLE gets a serialization
   * failure there instead (40001), with nothing written: the statement is then run again in a
   * transaction pinned to READ COMMITTED, where it cannot fail that way. The default pays
   * nothing for it.
   */
  private async write<T = Record<string, unknown>>(
    text: string,
    params: readonly unknown[]
  ): Promise<T[]> {
    try {
      return await this.sql.query<T>(text, params);
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code !== '40001') throw error;
      return this.sql.transaction(async (tx) => {
        await beginReadCommitted(tx);
        return tx.query<T>(text, params);
      });
    }
  }

  /** A new run, due at once. False when the id is taken: an instance id names one run for good. */
  async create(
    id: string,
    params: JourneyParams,
    enteredAt: number,
    now: number
  ): Promise<boolean> {
    const rows = await this.sql.query(
      `INSERT INTO ${this.run}
         (instance_id, params, entered_at, status, wake_at, signals, lease_gen, created_at)
       VALUES ($1, $2::text::jsonb, ${TS('$3')}, 'queued', ${TS('$4')}, 0, 0, ${TS('$4')})
       ON CONFLICT DO NOTHING RETURNING instance_id`,
      [id, JSON.stringify(params), enteredAt, now]
    );
    return rows.length > 0;
  }

  async status(id: string): Promise<RunStatus | undefined> {
    // In a transaction, so a pooler that caches reads answers from the database
    const rows = await this.sql.transaction((tx) =>
      tx.query<{ status: RunStatus }>(`SELECT status FROM ${this.run} WHERE instance_id = $1`, [id])
    );
    return rows.at(0)?.status;
  }

  /**
   * A wake: the counter moves, and a run that is parked or asleep becomes due now. A run in the
   * middle of a turn only gets the counter — its park is conditional on it (`Suspension`).
   * False when the run is unknown or over.
   */
  async signal(id: string, now: number): Promise<boolean> {
    const rows = await this.write(
      `UPDATE ${this.run} SET signals = signals + 1,
         wake_at = CASE WHEN status = 'running' THEN wake_at ELSE LEAST(wake_at, ${TS('$2')}) END
       WHERE instance_id = $1 AND status IN ${LIVE} RETURNING instance_id`,
      [id, now]
    );
    return rows.length > 0;
  }

  /** Stop a run for good. False when it is unknown or had already ended. */
  async terminate(id: string, now: number): Promise<boolean> {
    const rows = await this.write(
      `UPDATE ${this.run} SET status = 'terminated', wake_at = NULL, finished_at = ${TS('$2')},
         lease_owner = NULL, lease_until = NULL
       WHERE instance_id = $1 AND status IN ${LIVE} RETURNING instance_id`,
      [id, now]
    );
    return rows.length > 0;
  }

  /**
   * The earliest due run nobody holds — one whose lease ran out included, which is how a run
   * outlives the worker that died with it.
   */
  async claim(owner: string, now: number, leaseMs: number): Promise<ClaimedRun | undefined> {
    const rows = await this.write<{
      instance_id: string;
      params: unknown;
      entered_at: number | string;
      lease_gen: number;
    }>(
      `UPDATE ${this.run} SET status = 'running', lease_owner = $1,
         lease_until = ${TS('$3')}, lease_gen = lease_gen + 1
       WHERE instance_id = (
         SELECT instance_id FROM ${this.run}
         WHERE status IN ${LIVE} AND wake_at <= ${TS('$2')}
           AND (lease_until IS NULL OR lease_until < ${TS('$2')})
         ORDER BY wake_at LIMIT 1 FOR UPDATE SKIP LOCKED
       )
       RETURNING instance_id, params, ${MS('entered_at')} AS entered_at, lease_gen`,
      [owner, now, now + leaseMs]
    );
    const row = rows.at(0);
    if (row === undefined) return undefined;
    return {
      instanceId: row.instance_id,
      params: (typeof row.params === 'string'
        ? JSON.parse(row.params)
        : row.params) as JourneyParams,
      enteredAtMs: Number(row.entered_at),
      gen: row.lease_gen,
    };
  }

  /** A turn still running holds on to its run. False when it no longer does. */
  async extend(run: ClaimedRun, until: number): Promise<boolean> {
    const rows = await this.write(
      `UPDATE ${this.run} SET lease_until = ${TS('$3')}
       WHERE instance_id = $1 AND lease_gen = $2 AND status = 'running' RETURNING instance_id`,
      [run.instanceId, run.gen, until]
    );
    return rows.length > 0;
  }

  /** The counter a wait compares against, read fresh. */
  async signals(id: string): Promise<number> {
    const rows = await this.sql.transaction((tx) =>
      tx.query<{ signals: number }>(`SELECT signals FROM ${this.run} WHERE instance_id = $1`, [id])
    );
    return rows.at(0)?.signals ?? 0;
  }

  async steps(id: string): Promise<Map<string, StepRecord>> {
    const rows = await this.sql.transaction((tx) =>
      tx.query<{
        key: string;
        kind: StepRecord['kind'];
        done: boolean;
        result: unknown;
        attempts: number;
      }>(`SELECT key, kind, done, result, attempts FROM ${this.step} WHERE instance_id = $1`, [id])
    );
    return new Map(
      rows.map((row) => [
        row.key,
        {
          kind: row.kind,
          done: row.done,
          // A driver that hands jsonb back as text is read the same way
          result: typeof row.result === 'string' ? (JSON.parse(row.result) as unknown) : row.result,
          attempts: row.attempts,
        },
      ])
    );
  }

  /** Write a checkpoint, behind the fence. False when the turn no longer holds the run. */
  async checkpoint(
    run: ClaimedRun,
    key: string,
    record: StepRecord,
    now: number
  ): Promise<boolean> {
    const rows = await this.write(
      `INSERT INTO ${this.step} (instance_id, key, kind, done, result, attempts, created_at)
       SELECT $1, $3, $4, $5, $6::text::jsonb, $7, ${TS('$8')}
       WHERE EXISTS (SELECT 1 FROM ${this.run}
                     WHERE instance_id = $1 AND lease_gen = $2 AND status = 'running')
       ON CONFLICT (instance_id, key) DO UPDATE
         SET done = EXCLUDED.done, result = EXCLUDED.result, attempts = EXCLUDED.attempts
       RETURNING key`,
      [
        run.instanceId,
        run.gen,
        key,
        record.kind,
        record.done,
        // undefined has no JSON: a step that returns nothing is stored as null
        JSON.stringify(record.result ?? null),
        record.attempts,
        now,
      ]
    );
    return rows.length > 0;
  }

  /**
   * End a turn that did not end the run, releasing it. A wait's park is conditional on no wake
   * having arrived since it subscribed; when one has, the run is queued again at once.
   */
  async suspend(run: ClaimedRun, suspension: Suspension, now: number): Promise<void> {
    const { status, wakeAt, ifSignals } = suspension;
    await this.write(
      `UPDATE ${this.run} SET
         status = CASE WHEN $5::int IS NULL OR signals = $5::int THEN $3 ELSE 'queued' END,
         wake_at = CASE WHEN $5::int IS NULL OR signals = $5::int THEN ${TS('$4')} ELSE ${TS('$6')} END,
         lease_owner = NULL, lease_until = NULL
       WHERE instance_id = $1 AND lease_gen = $2 AND status = 'running'`,
      [run.instanceId, run.gen, status, wakeAt, ifSignals ?? null, now]
    );
  }

  /** The run is over: it returned, or it threw. */
  async finish(
    run: ClaimedRun,
    status: 'complete' | 'errored',
    now: number,
    error?: string
  ): Promise<void> {
    await this.write(
      `UPDATE ${this.run} SET status = $3, wake_at = NULL, finished_at = ${TS('$4')}, error = $5,
         lease_owner = NULL, lease_until = NULL
       WHERE instance_id = $1 AND lease_gen = $2 AND status = 'running'`,
      [run.instanceId, run.gen, status, now, error ?? null]
    );
  }

  /** Whether anything is due at `now`: what an idle worker asks before it sleeps. */
  async nextWake(): Promise<number | undefined> {
    const rows = await this.sql.query<{ at: number | string | null }>(
      `SELECT ${MS('min(wake_at)')} AS at FROM ${this.run} WHERE status IN ${LIVE}`
    );
    const at = rows.at(0)?.at;
    return at === null || at === undefined ? undefined : Number(at);
  }

  /** Runs that ended before `before`, and their checkpoints: how many were removed. */
  async prune(before: number): Promise<number> {
    return this.sql.transaction(async (tx) => {
      const old = `SELECT instance_id FROM ${this.run} WHERE finished_at < ${TS('$1')}`;
      await tx.query(`DELETE FROM ${this.step} WHERE instance_id IN (${old})`, [before]);
      const rows = await tx.query(
        `DELETE FROM ${this.run} WHERE finished_at < ${TS('$1')} RETURNING instance_id`,
        [before]
      );
      return rows.length;
    });
  }
}
