import { type BundleIR, ConditionIR, WorkflowIR } from '../ir';
import type {
  EntryInput,
  EventInput,
  JourneyStore,
  ProfileProps,
  SegmentTriggerRoute,
  TriggerRoute,
} from './index';

/**
 * The smallest SQL client this store needs: parameterized queries (`$1`, `$2`,
 * …) and a transaction scope. It is deliberately not postgres.js, pg or
 * drizzle — the app wraps whichever it already uses in a few lines:
 *
 *   const client: SqlClientLike = {
 *     query: (text, params) => sql.unsafe(text, params),          // postgres.js
 *     transaction: (fn) => sql.begin((tx) => fn(wrap(tx))),
 *   };
 *
 * jsonb columns may come back parsed (postgres.js, pg) or as strings (some
 * drivers); both are accepted.
 */
export interface SqlClientLike {
  query<T = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: SqlClientLike) => Promise<T>): Promise<T>;
}

export interface PostgresJourneyStoreOptions {
  /** Schema the tables live in (e.g. `application`); unqualified names otherwise. */
  schema?: string;
  /** Table name prefix, `workflow_` by default: workflow_event, workflow_profile, … */
  tablePrefix?: string;
}

const TABLES = {
  event: 'event',
  profile: 'profile',
  segment: 'segment',
  trigger: 'trigger',
  segmentTrigger: 'segment_trigger',
  segmentMember: 'segment_member',
  entry: 'entry',
  subscription: 'subscription',
  ir: 'ir',
} as const;

type TableKey = keyof typeof TABLES;

/** Epoch milliseconds → timestamptz, so the tables keep the database's native type. */
const TS = (param: string) => `to_timestamp(${param}::double precision / 1000)`;

function asJson<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

/**
 * UUID v7 (time-ordered) for event rows, generated here so the store has no
 * dependency: 48-bit ms timestamp, version 7, RFC 4122 variant, 74 random bits.
 */
export function uuidv7(now = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[0] = (now / 2 ** 40) & 0xff;
  bytes[1] = (now / 2 ** 32) & 0xff;
  bytes[2] = (now / 2 ** 24) & 0xff;
  bytes[3] = (now / 2 ** 16) & 0xff;
  bytes[4] = (now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Journey data plane on Postgres. Same contract as D1JourneyStore, native
 * types where Postgres has them (jsonb, timestamptz), and the concurrency
 * guarantees come from the database: ON CONFLICT for the once policy and
 * idempotent subscriptions, a transaction for the route swap, a jsonb merge
 * for /identify. See postgres-schema.sql for the tables.
 */
export class PostgresJourneyStore implements JourneyStore {
  private readonly t: Record<TableKey, string>;

  constructor(
    private readonly sql: SqlClientLike,
    options: PostgresJourneyStoreOptions = {}
  ) {
    const prefix = options.tablePrefix ?? 'workflow_';
    const qualify = (name: string) =>
      options.schema === undefined
        ? `"${prefix}${name}"`
        : `"${options.schema}"."${prefix}${name}"`;
    this.t = Object.fromEntries(
      (Object.keys(TABLES) as TableKey[]).map((key) => [key, qualify(TABLES[key])])
    ) as Record<TableKey, string>;
  }

  async insertEvent(input: EventInput): Promise<void> {
    await this.sql.query(
      `INSERT INTO ${this.t.event} (id, user_id, name, ts, payload) VALUES ($1, $2, $3, ${TS('$4')}, $5::text::jsonb)`,
      [uuidv7(input.ts), input.userId, input.event, input.ts, JSON.stringify(input.payload)]
    );
  }

  async countEvents(userId: string, event: string, opts?: { sinceMs?: number }): Promise<number> {
    const rows =
      opts?.sinceMs === undefined
        ? await this.sql.query<{ c: number | string }>(
            `SELECT count(*)::int AS c FROM ${this.t.event} WHERE user_id = $1 AND name = $2`,
            [userId, event]
          )
        : await this.sql.query<{ c: number | string }>(
            `SELECT count(*)::int AS c FROM ${this.t.event} WHERE user_id = $1 AND name = $2 AND ts >= ${TS('$3')}`,
            [userId, event, opts.sinceMs]
          );
    return Number(rows.at(0)?.c ?? 0);
  }

  async listEventPayloads(
    userId: string,
    event: string,
    opts?: { sinceMs?: number }
  ): Promise<Record<string, unknown>[]> {
    const rows =
      opts?.sinceMs === undefined
        ? await this.sql.query<{ payload: unknown }>(
            `SELECT payload FROM ${this.t.event} WHERE user_id = $1 AND name = $2`,
            [userId, event]
          )
        : await this.sql.query<{ payload: unknown }>(
            `SELECT payload FROM ${this.t.event} WHERE user_id = $1 AND name = $2 AND ts >= ${TS('$3')}`,
            [userId, event, opts.sinceMs]
          );
    return rows.map((row) => asJson<Record<string, unknown>>(row.payload));
  }

  async getProfile(userId: string): Promise<ProfileProps | undefined> {
    const rows = await this.sql.query<{ props: unknown }>(
      `SELECT props FROM ${this.t.profile} WHERE user_id = $1`,
      [userId]
    );
    const row = rows.at(0);
    return row === undefined ? undefined : asJson<ProfileProps>(row.props);
  }

  async mergeProfile(userId: string, props: ProfileProps): Promise<ProfileProps> {
    // jsonb `||` is the same last-write-wins merge as the object spread, done
    // atomically in the database — two concurrent identifies cannot lose keys.
    const rows = await this.sql.query<{ props: unknown }>(
      `INSERT INTO ${this.t.profile} (user_id, props) VALUES ($1, $2::text::jsonb)
       ON CONFLICT (user_id) DO UPDATE SET props = ${this.t.profile}.props || EXCLUDED.props
       RETURNING props`,
      [userId, JSON.stringify(props)]
    );
    return asJson<ProfileProps>(rows.at(0)?.props ?? {});
  }

  async getSegmentCondition(name: string): Promise<ConditionIR | undefined> {
    const rows = await this.sql.query<{ condition: unknown }>(
      `SELECT condition FROM ${this.t.segment} WHERE name = $1`,
      [name]
    );
    const row = rows.at(0);
    return row === undefined ? undefined : ConditionIR.parse(asJson(row.condition));
  }

  async findTriggers(event: string): Promise<TriggerRoute[]> {
    const rows = await this.sql.query<{
      workflow: string;
      hash: string;
      where_clause: unknown;
      filter: unknown;
    }>(
      `SELECT workflow, hash, "where" AS where_clause, filter FROM ${this.t.trigger} WHERE event = $1`,
      [event]
    );
    return rows.map((row) => ({
      workflow: row.workflow,
      hash: row.hash,
      where: row.where_clause === null ? null : ConditionIR.parse(asJson(row.where_clause)),
      filter: row.filter === null ? null : ConditionIR.parse(asJson(row.filter)),
    }));
  }

  listSegmentTriggers(): Promise<SegmentTriggerRoute[]> {
    return this.sql.query<SegmentTriggerRoute>(
      `SELECT workflow, hash, segment FROM ${this.t.segmentTrigger}`
    );
  }

  async putWorkflowIR(workflow: WorkflowIR): Promise<void> {
    await this.sql.query(
      `INSERT INTO ${this.t.ir} (content_hash, ir) VALUES ($1, $2::text::jsonb)
       ON CONFLICT (content_hash) DO UPDATE SET ir = EXCLUDED.ir`,
      [workflow.contentHash, JSON.stringify(workflow)]
    );
  }

  async getWorkflowIR(contentHash: string): Promise<WorkflowIR | undefined> {
    const rows = await this.sql.query<{ ir: unknown }>(
      `SELECT ir FROM ${this.t.ir} WHERE content_hash = $1`,
      [contentHash]
    );
    const row = rows.at(0);
    return row === undefined ? undefined : WorkflowIR.parse(asJson(row.ir));
  }

  replaceRoutes(bundle: BundleIR): Promise<void> {
    return this.sql.transaction(async (tx) => {
      await tx.query(`DELETE FROM ${this.t.trigger}`);
      await tx.query(`DELETE FROM ${this.t.segmentTrigger}`);
      await tx.query(`DELETE FROM ${this.t.segment}`);
      for (const segment of bundle.segments) {
        await tx.query(
          `INSERT INTO ${this.t.segment} (name, condition, hash) VALUES ($1, $2::text::jsonb, $3)`,
          [segment.name, JSON.stringify(segment.condition), segment.contentHash]
        );
      }
      for (const workflow of bundle.workflows) {
        if (workflow.trigger.type === 'event') {
          await tx.query(
            `INSERT INTO ${this.t.trigger} (workflow, hash, event, "where", filter) VALUES ($1, $2, $3, $4::text::jsonb, $5::text::jsonb)`,
            [
              workflow.name,
              workflow.contentHash,
              workflow.trigger.event,
              workflow.trigger.where === undefined ? null : JSON.stringify(workflow.trigger.where),
              workflow.trigger.filter === undefined
                ? null
                : JSON.stringify(workflow.trigger.filter),
            ]
          );
        } else if (workflow.trigger.type === 'segment') {
          await tx.query(
            `INSERT INTO ${this.t.segmentTrigger} (workflow, hash, segment) VALUES ($1, $2, $3)`,
            [workflow.name, workflow.contentHash, workflow.trigger.segment]
          );
        }
      }
    });
  }

  async isSegmentMember(segment: string, userId: string): Promise<boolean> {
    const rows = await this.sql.query(
      `SELECT 1 AS x FROM ${this.t.segmentMember} WHERE segment = $1 AND user_id = $2`,
      [segment, userId]
    );
    return rows.length > 0;
  }

  async addSegmentMember(segment: string, userId: string, ts: number): Promise<void> {
    await this.sql.query(
      `INSERT INTO ${this.t.segmentMember} (segment, user_id, ts) VALUES ($1, $2, ${TS('$3')}) ON CONFLICT DO NOTHING`,
      [segment, userId, ts]
    );
  }

  async removeSegmentMember(segment: string, userId: string): Promise<void> {
    await this.sql.query(
      `DELETE FROM ${this.t.segmentMember} WHERE segment = $1 AND user_id = $2`,
      [segment, userId]
    );
  }

  async enterJourney(entry: EntryInput): Promise<boolean> {
    // The (workflow, user_id) primary key makes the once policy atomic:
    // concurrent ingests race on the insert and exactly one wins.
    const rows = await this.sql.query(
      `INSERT INTO ${this.t.entry} (workflow, user_id, instance_id, hash, status, ts)
       VALUES ($1, $2, $3, $4, 'running', ${TS('$5')})
       ON CONFLICT (workflow, user_id) DO NOTHING RETURNING instance_id`,
      [entry.workflow, entry.userId, entry.instanceId, entry.hash, entry.ts]
    );
    return rows.length > 0;
  }

  async removeEntry(instanceId: string): Promise<void> {
    await this.sql.query(`DELETE FROM ${this.t.entry} WHERE instance_id = $1`, [instanceId]);
  }

  async setEntryStatus(instanceId: string, status: string): Promise<void> {
    await this.sql.query(`UPDATE ${this.t.entry} SET status = $1 WHERE instance_id = $2`, [
      status,
      instanceId,
    ]);
  }

  async findWakeHandles(userId: string, event: string): Promise<string[]> {
    const rows = await this.sql.query<{ handle: string }>(
      `SELECT DISTINCT wake_handle AS handle FROM ${this.t.subscription} WHERE user_id = $1 AND event = $2`,
      [userId, event]
    );
    return rows.map((row) => row.handle);
  }

  async subscribe(
    handle: string,
    userId: string,
    events: readonly string[],
    ts: number
  ): Promise<void> {
    for (const event of events) {
      await this.sql.query(
        `INSERT INTO ${this.t.subscription} (user_id, event, wake_handle, ts) VALUES ($1, $2, $3, ${TS('$4')}) ON CONFLICT DO NOTHING`,
        [userId, event, handle, ts]
      );
    }
  }

  async unsubscribe(handle: string): Promise<void> {
    await this.sql.query(`DELETE FROM ${this.t.subscription} WHERE wake_handle = $1`, [handle]);
  }
}
