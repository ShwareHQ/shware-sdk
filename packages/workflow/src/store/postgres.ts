import type { PushDevice } from '../engine/ports';
import { type BundleIR, ConditionIR, WorkflowIR } from '../ir';
import type {
  DeviceInput,
  EntryInput,
  EntryOutcome,
  EventInput,
  EventWindow,
  JourneyReporting,
  JourneyStore,
  ProfileProps,
  SegmentTriggerRoute,
  TriggerRoute,
} from './index';
import { PostgresReporting } from './postgres-reporting';
import { type SqlClientLike, uuidv7 } from './sql';
import { type ColumnType, DEFAULT_SCHEMA, TABLES, type TableKey, columnName } from './tables';

export { DEFAULT_SCHEMA } from './tables';
export { type SqlClientLike, uuidv7 } from './sql';

export interface PostgresJourneyStoreOptions {
  /**
   * The Postgres schema the engine's tables live in — `workflow` by default, the config's
   * `database.schema` under journeyWorker. A schema of its own keeps the tables apart from the
   * app's. The host creates them with its own migrations, from the drizzle file
   * `renderDrizzleSchema` generates (or the plain `renderPostgresDdl`).
   */
  schema?: string;
}

/** information_schema's udt_name per column type. */
const UDT: Record<ColumnType, string> = {
  uuid: 'uuid',
  text: 'text',
  jsonb: 'jsonb',
  timestamptz: 'timestamptz',
  integer: 'int4',
  boolean: 'bool',
};

/** Epoch milliseconds → timestamptz, so the tables keep the database's native type. */
const TS = (param: string) => `to_timestamp(${param}::double precision / 1000)`;

function asJson<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

/**
 * Journey data plane on Postgres. Same contract as D1JourneyStore, native
 * types where Postgres has them (jsonb, timestamptz), and the concurrency
 * guarantees come from the database: ON CONFLICT for the once policy and
 * idempotent subscriptions, a transaction for the route swap, a jsonb merge
 * for /identify. The tables are declared in tables.ts.
 */
export class PostgresJourneyStore implements JourneyStore {
  private readonly t: Record<TableKey, string>;
  private readonly schema: string;
  readonly reporting: JourneyReporting;

  constructor(
    private readonly sql: SqlClientLike,
    options: PostgresJourneyStoreOptions = {}
  ) {
    this.schema = options.schema ?? DEFAULT_SCHEMA;
    const qualify = (name: string) => `"${this.schema}"."${name}"`;
    this.t = Object.fromEntries(
      (Object.keys(TABLES) as TableKey[]).map((key) => [key, qualify(TABLES[key].name)])
    ) as Record<TableKey, string>;
    this.reporting = new PostgresReporting(sql, this.t);
  }

  /**
   * What the live database lacks against tables.ts: missing tables, missing columns, a column
   * of another type or nullability. Read-only — the engine never migrates the host's database; a
   * deploy fails with these problems listed, and the fix is to regenerate the drizzle file and
   * run the host's migrations.
   */
  async checkSchema(): Promise<string[]> {
    // In a transaction, so Hyperdrive answers from the database, not from its read cache — a
    // deploy right after the migration must see the new columns
    const rows = await this.sql.transaction((tx) =>
      tx.query<{
        table_name: string;
        column_name: string;
        udt_name: string;
        is_nullable: string;
      }>(
        `SELECT table_name, column_name, udt_name, is_nullable FROM information_schema.columns WHERE table_schema = $1`,
        [this.schema]
      )
    );
    const live = new Map(rows.map((row) => [`${row.table_name}.${row.column_name}`, row]));
    const tables = new Set(rows.map((row) => row.table_name));
    const problems: string[] = [];
    for (const spec of Object.values(TABLES)) {
      const where = `"${this.schema}"."${spec.name}"`;
      if (!tables.has(spec.name)) {
        problems.push(`table ${where} is missing`);
        continue;
      }
      for (const [key, column] of Object.entries(spec.columns)) {
        const name = columnName(key);
        const row = live.get(`${spec.name}.${name}`);
        if (row === undefined) problems.push(`column ${where}."${name}" is missing`);
        else if (row.udt_name !== UDT[column.type])
          problems.push(
            `column ${where}."${name}" is ${row.udt_name}, expected ${UDT[column.type]}`
          );
        else if ((row.is_nullable === 'YES') !== (column.nullable === true))
          problems.push(
            `column ${where}."${name}" should be ${column.nullable ? 'nullable' : 'NOT NULL'}`
          );
      }
    }
    return problems;
  }

  async insertEvent(input: EventInput): Promise<boolean> {
    // The row key stays a UUID v7 (the house rule for every table); the
    // sender's occurrence id lives in event_id, whose unique index is what
    // makes a second delivery a no-op. ON CONFLICT DO NOTHING + RETURNING
    // reports which of the two happened without a second round trip.
    const rows = await this.sql.query(
      `INSERT INTO ${this.t.event} (id, event_id, user_id, name, ts, payload)
       VALUES ($1, $2, $3, $4, ${TS('$5')}, $6::text::jsonb)
       ON CONFLICT (event_id) DO NOTHING RETURNING id`,
      [
        uuidv7(input.ts),
        input.id,
        input.userId,
        input.event,
        input.ts,
        JSON.stringify(input.payload),
      ]
    );
    return rows.length > 0;
  }

  /** The event rows of one user and name, within the window's bounds (both inclusive). */
  private eventWindow(userId: string, event: string, window?: EventWindow) {
    const params: unknown[] = [userId, event];
    let where = 'user_id = $1 AND name = $2';
    if (window?.sinceMs !== undefined) {
      params.push(window.sinceMs);
      where += ` AND ts >= ${TS(`$${params.length}`)}`;
    }
    if (window?.untilMs !== undefined) {
      params.push(window.untilMs);
      where += ` AND ts <= ${TS(`$${params.length}`)}`;
    }
    return { where, params };
  }

  async countEvents(userId: string, event: string, window?: EventWindow): Promise<number> {
    const { where, params } = this.eventWindow(userId, event, window);
    const rows = await this.sql.query<{ c: number | string }>(
      `SELECT count(*)::int AS c FROM ${this.t.event} WHERE ${where}`,
      params
    );
    return Number(rows.at(0)?.c ?? 0);
  }

  async listEventPayloads(
    userId: string,
    event: string,
    window?: EventWindow
  ): Promise<Record<string, unknown>[]> {
    const { where, params } = this.eventWindow(userId, event, window);
    const rows = await this.sql.query<{ payload: unknown }>(
      `SELECT payload FROM ${this.t.event} WHERE ${where}`,
      params
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
    // RFC 7386 merge-patch in one statement: jsonb `||` overwrites key by key
    // and jsonb_strip_nulls then drops the keys the patch set to null (the
    // API's only way to unset a property). Atomic in the database, so two
    // concurrent identifies cannot lose each other's keys.
    const rows = await this.sql.query<{ props: unknown }>(
      `INSERT INTO ${this.t.profile} (user_id, props) VALUES ($1, jsonb_strip_nulls($2::text::jsonb))
       ON CONFLICT (user_id) DO UPDATE SET props = jsonb_strip_nulls(${this.t.profile}.props || $3::text::jsonb)
       RETURNING props`,
      // EXCLUDED.props would be the stripped insert value, so the update merges the raw patch again
      [userId, JSON.stringify(props), JSON.stringify(props)]
    );
    return asJson<ProfileProps>(rows.at(0)?.props ?? {});
  }

  async listUserIds(): Promise<string[]> {
    const rows = await this.sql.query<{ user_id: string }>(
      `SELECT user_id FROM ${this.t.profile} UNION SELECT DISTINCT user_id FROM ${this.t.event}`
    );
    return rows.map((row) => row.user_id);
  }

  listDevices(userId: string): Promise<PushDevice[]> {
    return this.sql.query<PushDevice>(
      `SELECT token, platform FROM ${this.t.device} WHERE user_id = $1 ORDER BY ts DESC`,
      [userId]
    );
  }

  async upsertDevice(device: DeviceInput): Promise<void> {
    await this.sql.query(
      `INSERT INTO ${this.t.device} (token, user_id, platform, ts) VALUES ($1, $2, $3, ${TS('$4')})
       ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, ts = EXCLUDED.ts`,
      [device.token, device.userId, device.platform, device.ts]
    );
  }

  async requestErasure(userId: string, at: number): Promise<void> {
    await this.sql.query(
      `INSERT INTO ${this.t.erasure} (user_id, requested_at) VALUES ($1, ${TS('$2')})
       ON CONFLICT DO NOTHING`,
      [userId, at]
    );
  }

  async pendingErasures(): Promise<string[]> {
    const rows = await this.sql.query<{ user_id: string }>(
      `SELECT user_id FROM ${this.t.erasure} ORDER BY requested_at`
    );
    return rows.map((row) => row.user_id);
  }

  async runningInstances(userId: string): Promise<string[]> {
    const rows = await this.sql.query<{ instance_id: string }>(
      `SELECT instance_id FROM ${this.t.entry} WHERE user_id = $1 AND status = 'running'`,
      [userId]
    );
    return rows.map((row) => row.instance_id);
  }

  async forgetUser(userId: string): Promise<void> {
    await this.sql.transaction(async (tx) => {
      // Children before the copies they belong to
      for (const child of [this.t.messageOpen, this.t.messageClick, this.t.messageLink]) {
        await tx.query(
          `DELETE FROM ${child} WHERE message_id IN (SELECT id FROM ${this.t.message} WHERE user_id = $1)`,
          [userId]
        );
      }
      for (const table of [
        this.t.message,
        this.t.instance,
        this.t.entry,
        this.t.subscription,
        this.t.segmentStart,
        this.t.segmentMember,
        this.t.suppression,
        this.t.device,
        this.t.event,
        this.t.profile,
        // The request goes with the data it asked to erase
        this.t.erasure,
      ]) {
        await tx.query(`DELETE FROM ${table} WHERE user_id = $1`, [userId]);
      }
    });
  }

  async isSuppressed(userId: string, channel: string): Promise<boolean> {
    const rows = await this.sql.query(
      `SELECT 1 AS x FROM ${this.t.suppression} WHERE user_id = $1 AND channel = $2`,
      [userId, channel]
    );
    return rows.length > 0;
  }

  async removeDevice(token: string): Promise<string | undefined> {
    const rows = await this.sql.query<{ user_id: string | null }>(
      `DELETE FROM ${this.t.device} WHERE token = $1 RETURNING user_id`,
      [token]
    );
    return rows[0]?.user_id ?? undefined;
  }

  async unbindDevice(token: string): Promise<string | undefined> {
    // The owner as it was before the update: RETURNING alone would only show the null
    const rows = await this.sql.query<{ user_id: string | null }>(
      `WITH old AS (SELECT token, user_id FROM ${this.t.device} WHERE token = $1 FOR UPDATE)
       UPDATE ${this.t.device} d SET user_id = NULL FROM old WHERE d.token = old.token
       RETURNING old.user_id`,
      [token]
    );
    return rows[0]?.user_id ?? undefined;
  }

  async listSegments(): Promise<{ id: string; condition: ConditionIR }[]> {
    const rows = await this.sql.query<{ id: string; condition: unknown }>(
      `SELECT id, condition FROM ${this.t.segment} ORDER BY id`
    );
    return rows.map((row) => ({
      id: row.id,
      condition: ConditionIR.parse(asJson(row.condition)),
    }));
  }

  async getSegmentCondition(id: string): Promise<ConditionIR | undefined> {
    const rows = await this.sql.query<{ condition: unknown }>(
      `SELECT condition FROM ${this.t.segment} WHERE id = $1`,
      [id]
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
          `INSERT INTO ${this.t.segment} (id, condition, hash) VALUES ($1, $2::text::jsonb, $3)`,
          [segment.id, JSON.stringify(segment.condition), segment.contentHash]
        );
      }
      for (const workflow of bundle.workflows) {
        if (workflow.trigger.type === 'event') {
          await tx.query(
            `INSERT INTO ${this.t.trigger} (workflow, hash, event, "where", filter) VALUES ($1, $2, $3, $4::text::jsonb, $5::text::jsonb)`,
            [
              workflow.id,
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
            [workflow.id, workflow.contentHash, workflow.trigger.segment]
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

  async addSegmentMember(
    segment: string,
    userId: string,
    ts: number,
    workflows: readonly string[]
  ): Promise<void> {
    await this.sql.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO ${this.t.segmentMember} (segment, user_id, ts) VALUES ($1, $2, ${TS('$3')}) ON CONFLICT DO NOTHING`,
        [segment, userId, ts]
      );
      for (const workflow of workflows) {
        await tx.query(
          `INSERT INTO ${this.t.segmentStart} (segment, workflow, user_id, ts)
           VALUES ($1, $2, $3, ${TS('$4')}) ON CONFLICT DO NOTHING`,
          [segment, workflow, userId, ts]
        );
      }
    });
  }

  async pendingSegmentStarts(segment: string, userId: string): Promise<string[]> {
    const rows = await this.sql.query<{ workflow: string }>(
      `SELECT workflow FROM ${this.t.segmentStart} WHERE segment = $1 AND user_id = $2`,
      [segment, userId]
    );
    return rows.map((row) => row.workflow);
  }

  async completeSegmentStart(segment: string, userId: string, workflow: string): Promise<void> {
    await this.sql.query(
      `DELETE FROM ${this.t.segmentStart} WHERE segment = $1 AND user_id = $2 AND workflow = $3`,
      [segment, userId, workflow]
    );
  }

  async removeSegmentMember(segment: string, userId: string): Promise<void> {
    await this.sql.transaction(async (tx) => {
      await tx.query(`DELETE FROM ${this.t.segmentStart} WHERE segment = $1 AND user_id = $2`, [
        segment,
        userId,
      ]);
      await tx.query(`DELETE FROM ${this.t.segmentMember} WHERE segment = $1 AND user_id = $2`, [
        segment,
        userId,
      ]);
    });
  }

  async enterJourney(entry: EntryInput): Promise<EntryOutcome> {
    // The (workflow, user_id) primary key makes the once policy atomic:
    // concurrent ingests race on the insert and exactly one wins.
    const inserted = await this.sql.query(
      `INSERT INTO ${this.t.entry} (workflow, user_id, instance_id, hash, status, ts)
       VALUES ($1, $2, $3, $4, 'running', ${TS('$5')})
       ON CONFLICT (workflow, user_id) DO NOTHING RETURNING instance_id`,
      [entry.workflow, entry.userId, entry.instanceId, entry.hash, entry.ts]
    );
    if (inserted.length > 0) return 'entered';

    // An existing row blocks the entry unless it records an instance that died:
    // 'failed' is reclaimed rather than barring the user forever over one
    // outage. The status test is inside the UPDATE, so of two concurrent
    // retries exactly one gets a row back.
    const claimed = await this.sql.query(
      `UPDATE ${this.t.entry} SET instance_id = $1, hash = $2, status = 'running', ts = ${TS('$3')}
       WHERE workflow = $4 AND user_id = $5 AND status = 'failed' RETURNING instance_id`,
      [entry.instanceId, entry.hash, entry.ts, entry.workflow, entry.userId]
    );
    return claimed.length > 0 ? 'reclaimed' : null;
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
