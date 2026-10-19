import type { PushDevice } from '../engine/ports';
import { type BundleIR, ConditionIR, WorkflowIR } from '../ir';
import type {
  BundleVersion,
  DeviceInput,
  EntryInput,
  EntryOutcome,
  EventInput,
  EventWindow,
  ExecutionRecord,
  ExecutionRegistry,
  ExecutionStart,
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
  readonly executions: ExecutionRegistry;

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
    this.executions = new PostgresExecutions(sql, this.t.execution, this.t.entry);
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
        this.t.execution,
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
    return this.sql.transaction((tx) => this.swapRoutes(tx, bundle));
  }

  async liveBundleVersion(): Promise<BundleVersion | undefined> {
    // In a transaction, so Hyperdrive answers from the database, not from its read cache
    const rows = await this.sql.transaction((tx) =>
      tx.query<{ version_id: string; created_at: number | string }>(
        `SELECT version_id, (extract(epoch FROM version_created_at) * 1000)::double precision AS created_at
         FROM ${this.t.deployment} WHERE scope = 'routes'`
      )
    );
    const row = rows.at(0);
    return row === undefined
      ? undefined
      : { id: row.version_id, createdAt: Number(row.created_at) };
  }

  replaceRoutesIfNewer(bundle: BundleIR, version: BundleVersion): Promise<boolean> {
    return this.sql.transaction(async (tx) => {
      // The row lock decides between versions applying at once: the loser's WHERE re-reads the
      // winner's committed row and updates nothing
      const claimed = await tx.query(
        `INSERT INTO ${this.t.deployment} AS live (scope, version_id, version_created_at, applied_at)
         VALUES ('routes', $1, ${TS('$2')}, ${TS('$3')})
         ON CONFLICT (scope) DO UPDATE SET version_id = EXCLUDED.version_id,
           version_created_at = EXCLUDED.version_created_at, applied_at = EXCLUDED.applied_at
         WHERE live.version_created_at < EXCLUDED.version_created_at
         RETURNING scope`,
        [version.id, version.createdAt, Date.now()]
      );
      if (claimed.length === 0) return false;
      await this.swapRoutes(tx, bundle);
      return true;
    });
  }

  private async swapRoutes(tx: SqlClientLike, bundle: BundleIR): Promise<void> {
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
            workflow.trigger.filter === undefined ? null : JSON.stringify(workflow.trigger.filter),
          ]
        );
      } else if (workflow.trigger.type === 'segment') {
        await tx.query(
          `INSERT INTO ${this.t.segmentTrigger} (workflow, hash, segment) VALUES ($1, $2, $3)`,
          [workflow.id, workflow.contentHash, workflow.trigger.segment]
        );
      }
    }
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
    const { execution } = entry;
    if (execution === undefined) return this.claimEntry(this.sql, entry);
    // The entry and the start it owes commit together: a crash between them would leave a
    // running entry no retry could ever start
    return this.sql.transaction(async (tx) => {
      const outcome = await this.claimEntry(tx, entry);
      if (outcome !== null) await this.recordStart(tx, entry, execution);
      return outcome;
    });
  }

  private async claimEntry(sql: SqlClientLike, entry: EntryInput): Promise<EntryOutcome> {
    // The (workflow, user_id) primary key makes the once policy atomic:
    // concurrent ingests race on the insert and exactly one wins.
    const inserted = await sql.query(
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
    const claimed = await sql.query(
      `UPDATE ${this.t.entry} SET instance_id = $1, hash = $2, status = 'running', ts = ${TS('$3')}
       WHERE workflow = $4 AND user_id = $5 AND status = 'failed' RETURNING instance_id`,
      [entry.instanceId, entry.hash, entry.ts, entry.workflow, entry.userId]
    );
    return claimed.length > 0 ? 'reclaimed' : null;
  }

  private async recordStart(
    tx: SqlClientLike,
    entry: EntryInput,
    execution: ExecutionStart
  ): Promise<void> {
    await tx.query(
      `INSERT INTO ${this.t.execution} (instance_id, workflow, user_id, name, target, input, created_at, generation)
       VALUES ($1, $2, $3, $4, $5, $6, ${TS('$7')}, 0) ON CONFLICT (instance_id) DO NOTHING`,
      [
        entry.instanceId,
        entry.workflow,
        entry.userId,
        execution.name,
        execution.target,
        execution.input,
        // The start's own age (the retry budget), not the event's ts, which the producer chose
        Date.now(),
      ]
    );
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

interface ExecutionRow {
  instance_id: string;
  workflow: string;
  user_id: string;
  name: string;
  target: string;
  input: string;
  // float8 comes back as a number from most drivers, as a string from some
  created_at: number | string;
  submitted_at: number | string | null;
  arn: string | null;
  unresolved_at: number | string | null;
  callback_id: string | null;
  generation: number | string;
  deadline_at: number | string | null;
  checked_at: number | string | null;
}

const PLAIN_COLUMNS = ['instance_id', 'workflow', 'user_id', 'name', 'target', 'input', 'arn'];
const MORE_PLAIN = ['callback_id', 'generation'];
const TIME_COLUMNS = ['created_at', 'submitted_at', 'unresolved_at', 'deadline_at', 'checked_at'];

/** The execution columns, timestamps as epoch ms; `alias` qualifies them in a join. */
function executionColumns(alias = ''): string {
  const q = alias === '' ? '' : `${alias}.`;
  return [
    ...[...PLAIN_COLUMNS, ...MORE_PLAIN].map((column) => `${q}${column}`),
    ...TIME_COLUMNS.map(
      (column) => `(extract(epoch from ${q}${column}) * 1000)::double precision AS ${column}`
    ),
  ].join(', ');
}

const optional = <T>(value: T | null): T | undefined => value ?? undefined;
const ms = (value: number | string | null): number | undefined =>
  value === null ? undefined : Number(value);

function toRecord(row: ExecutionRow): ExecutionRecord {
  return {
    instanceId: row.instance_id,
    workflow: row.workflow,
    userId: row.user_id,
    name: row.name,
    target: row.target,
    input: row.input,
    createdAt: Number(row.created_at),
    submittedAt: ms(row.submitted_at),
    arn: optional(row.arn),
    unresolvedAt: ms(row.unresolved_at),
    callbackId: optional(row.callback_id),
    generation: Number(row.generation),
    deadlineAt: ms(row.deadline_at),
    checkedAt: ms(row.checked_at),
  };
}

/** The execution table (tables.ts): starts to confirm, and the callback each wait parks on. */
class PostgresExecutions implements ExecutionRegistry {
  constructor(
    private readonly sql: SqlClientLike,
    private readonly table: string,
    private readonly entry: string
  ) {}

  async get(instanceId: string): Promise<ExecutionRecord | undefined> {
    const rows = await this.sql.query<ExecutionRow>(
      `SELECT ${executionColumns()} FROM ${this.table} WHERE instance_id = $1`,
      [instanceId]
    );
    return rows.length === 0 ? undefined : toRecord(rows[0]);
  }

  async pendingStarts(filter: {
    workflow?: string;
    userId?: string;
    createdBefore?: number;
    limit: number;
  }): Promise<ExecutionRecord[]> {
    const where = ['x.submitted_at IS NULL', 'x.unresolved_at IS NULL', "e.status = 'running'"];
    const params: unknown[] = [];
    if (filter.workflow !== undefined) {
      params.push(filter.workflow);
      where.push(`x.workflow = $${params.length}`);
    }
    if (filter.userId !== undefined) {
      params.push(filter.userId);
      where.push(`x.user_id = $${params.length}`);
    }
    if (filter.createdBefore !== undefined) {
      params.push(filter.createdBefore);
      where.push(`x.created_at < ${TS(`$${params.length}`)}`);
    }
    params.push(filter.limit);
    // Only the start the entry still names: a reclaimed entry's old start is history
    const rows = await this.sql.query<ExecutionRow>(
      `SELECT ${executionColumns('x')}
       FROM ${this.table} x JOIN ${this.entry} e ON e.instance_id = x.instance_id
       WHERE ${where.join(' AND ')} ORDER BY x.created_at LIMIT $${params.length}`,
      params
    );
    return rows.map(toRecord);
  }

  async markSubmitted(instanceId: string, arn: string | undefined, at: number): Promise<void> {
    await this.sql.query(
      `UPDATE ${this.table} SET submitted_at = COALESCE(submitted_at, ${TS('$2')}), arn = COALESCE($3, arn) WHERE instance_id = $1`,
      [instanceId, at, arn ?? null]
    );
  }

  async markUnresolved(instanceId: string, at: number): Promise<void> {
    await this.sql.query(
      `UPDATE ${this.table} SET unresolved_at = ${TS('$2')} WHERE instance_id = $1 AND submitted_at IS NULL`,
      [instanceId, at]
    );
  }

  async setArn(instanceId: string, arn: string): Promise<void> {
    await this.sql.query(`UPDATE ${this.table} SET arn = $2 WHERE instance_id = $1`, [
      instanceId,
      arn,
    ]);
  }

  async armCallback(
    instanceId: string,
    callback: { id: string; generation: number; deadlineAt?: number | undefined }
  ): Promise<boolean> {
    // The generation test is inside the UPDATE: a retried arm of an older wait cannot overwrite
    // the callback a newer one parks on
    const rows = await this.sql.query(
      `UPDATE ${this.table} SET callback_id = $2, generation = $3,
         deadline_at = CASE WHEN $4::double precision IS NULL THEN NULL ELSE ${TS('$4')} END
       WHERE instance_id = $1 AND generation <= $3 RETURNING instance_id`,
      [instanceId, callback.id, callback.generation, callback.deadlineAt ?? null]
    );
    return rows.length > 0;
  }

  async clearCallback(instanceId: string, generation: number): Promise<void> {
    await this.sql.query(
      `UPDATE ${this.table} SET callback_id = NULL, deadline_at = NULL WHERE instance_id = $1 AND generation = $2`,
      [instanceId, generation]
    );
  }

  async toReconcile(limit: number, checkedBefore: number): Promise<ExecutionRecord[]> {
    const rows = await this.sql.query<ExecutionRow>(
      `SELECT ${executionColumns('x')}
       FROM ${this.table} x JOIN ${this.entry} e ON e.instance_id = x.instance_id
       WHERE e.status = 'running' AND x.submitted_at IS NOT NULL
         AND (x.checked_at IS NULL OR x.checked_at < ${TS('$1')})
       ORDER BY x.checked_at NULLS FIRST LIMIT $2`,
      [checkedBefore, limit]
    );
    return rows.map(toRecord);
  }

  async markChecked(instanceId: string, at: number): Promise<void> {
    await this.sql.query(
      `UPDATE ${this.table} SET checked_at = ${TS('$2')} WHERE instance_id = $1`,
      [instanceId, at]
    );
  }
}
