import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1RunResultLike,
  JourneyEnv,
  WorkflowBindingLike,
  WorkflowInstanceLike,
} from '../src/cloudflare/bindings';

/**
 * In-memory fakes for the Cloudflare bindings, so the ingest router is tested
 * through the same structural interfaces the real bindings satisfy. The fake
 * D1 dispatches on the SQL the D1 store issues — exact statements, plus a few
 * patterns for the ones the store assembles (event windows, user pages, the
 * profile merge) — and throws on anything else. Editing a query means updating
 * the dispatch here, which is deliberate: the suite then reviews every
 * statement change, and no statement reaches production having never run.
 */

interface EventRow {
  id: string;
  user_id: string;
  name: string;
  ts: number;
  payload: string;
}
interface TriggerRow {
  workflow: string;
  hash: string;
  event: string;
  where: string | null;
  filter: string | null;
}
interface SegmentTriggerRow {
  workflow: string;
  hash: string;
  segment: string;
}
interface EntryRow {
  workflow: string;
  user_id: string;
  instance_id: string;
  hash: string;
  status: string;
  ts: number;
}
interface SubscriptionRow {
  user_id: string;
  event: string;
  wake_handle: string;
  ts: number;
}
interface DeviceRow {
  user_id: string | null;
  platform: string;
  ts: number;
}

/**
 * SQLite's json_patch, which is RFC 7386 merge-patch: objects merge key by key,
 * a null removes its key, and anything else replaces wholesale. Reimplemented
 * here because the fake has to agree with the real merge — a fake that merely
 * spread the objects would hide exactly the null-removal behaviour the router
 * now depends on.
 */
function jsonPatch(target: unknown, patch: unknown): unknown {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return patch;
  const base: Record<string, unknown> =
    typeof target === 'object' && target !== null && !Array.isArray(target)
      ? { ...(target as Record<string, unknown>) }
      : {};
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === null) delete base[key];
    else base[key] = jsonPatch(base[key], value);
  }
  return base;
}

/** The key a top-level SQLite JSON path (`$."key"`) names. */
function pathKey(path: string): string {
  const match = /^\$\."(.*)"$/.exec(path);
  if (match === null) throw new Error(`FakeD1: unsupported JSON path: ${path}`);
  return match[1];
}

/** The tables `forgetUser` erases by user id. */
const USER_TABLES = new Set([
  'entries',
  'subscriptions',
  'segment_starts',
  'segment_members',
  'devices',
  'events',
  'profiles',
  'erasures',
]);

const EVENT_QUERY =
  /^SELECT (COUNT\(\*\) AS c|payload) FROM events WHERE user_id = \? AND name = \?( AND ts >= \?)?( AND ts <= \?)?$/;
const USER_PAGE =
  /^SELECT user_id FROM \(SELECT user_id FROM profiles UNION SELECT user_id FROM events\)( WHERE user_id > \?)? ORDER BY user_id( LIMIT \?)?$/;
const PROFILE_MERGE =
  /^INSERT INTO profiles \(user_id, props\) VALUES \(\?, json_patch\('\{\}', \?\)\) ON CONFLICT\(user_id\) DO UPDATE SET props = json_patch\((?:profiles\.props|json_remove\(profiles\.props, ((?:\?, )*\?)\)), \?\) RETURNING props$/;
const USER_DELETE = /^DELETE FROM (\w+) WHERE user_id = \?$/;

type Result = { rows: Record<string, unknown>[]; changes: number };

export class FakeD1 implements D1DatabaseLike {
  readonly events: EventRow[] = [];
  readonly profiles = new Map<string, string>();
  readonly segments = new Map<string, { condition: string; hash: string }>();
  triggers: TriggerRow[] = [];
  segmentTriggers: SegmentTriggerRow[] = [];
  readonly segmentMembers = new Map<string, number>(); // `${segment}\n${user}` → ts
  readonly segmentStarts = new Set<string>(); // `${segment}\n${workflow}\n${user}`
  readonly erasures = new Map<string, number>(); // user → ts
  readonly devices = new Map<string, DeviceRow>(); // token →
  /** workflow_ir: content hash → WorkflowIR JSON. */
  readonly ir = new Map<string, string>();
  entries: EntryRow[] = [];
  subscriptions: SubscriptionRow[] = [];

  prepare(sql: string): D1PreparedStatementLike {
    return this.statement(sql, []);
  }

  async batch(statements: D1PreparedStatementLike[]): Promise<unknown> {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }

  private statement(sql: string, params: unknown[]): D1PreparedStatementLike {
    const exec = (): Result => this.exec(sql, params);
    return {
      bind: (...values: unknown[]) => this.statement(sql, values),
      first: async <T>() => (exec().rows[0] ?? null) as T | null,
      all: async <T>() => ({ results: exec().rows as T[] }),
      run: async (): Promise<D1RunResultLike> => ({ meta: { changes: exec().changes } }),
    };
  }

  /** The statements the store assembles from optional parts. */
  private pattern(sql: string, p: unknown[]): Result | undefined {
    const eventQuery = EVENT_QUERY.exec(sql);
    if (eventQuery !== null) {
      let rows = this.events.filter((e) => e.user_id === p[0] && e.name === p[1]);
      let next = 2;
      if (eventQuery[2]) {
        const since = p[next++] as number;
        rows = rows.filter((e) => e.ts >= since);
      }
      if (eventQuery[3]) {
        const until = p[next++] as number;
        rows = rows.filter((e) => e.ts <= until);
      }
      return eventQuery[1] === 'payload'
        ? { rows: rows.map((e) => ({ payload: e.payload })), changes: 0 }
        : { rows: [{ c: rows.length }], changes: 0 };
    }
    const userPage = USER_PAGE.exec(sql);
    if (userPage !== null) {
      let ids = [
        ...new Set([...this.profiles.keys(), ...this.events.map((e) => e.user_id)]),
      ].sort();
      let next = 0;
      if (userPage[1]) {
        const after = p[next++] as string;
        ids = ids.filter((id) => id > after);
      }
      if (userPage[2]) ids = ids.slice(0, p[next++] as number);
      return { rows: ids.map((user_id) => ({ user_id })), changes: 0 };
    }
    const merge = PROFILE_MERGE.exec(sql);
    if (merge !== null) {
      const userId = p[0] as string;
      const patch = JSON.parse(p[1] as string) as Record<string, unknown>;
      const existing = this.profiles.get(userId);
      let base: Record<string, unknown> = {};
      if (existing !== undefined) {
        base = JSON.parse(existing) as Record<string, unknown>;
        const removed = merge[1] ? merge[1].split(', ').length : 0;
        for (const path of p.slice(2, 2 + removed)) delete base[pathKey(path as string)];
      }
      const props = JSON.stringify(jsonPatch(base, patch));
      this.profiles.set(userId, props);
      return { rows: [{ props }], changes: 1 };
    }
    const userDelete = USER_DELETE.exec(sql);
    if (userDelete !== null && USER_TABLES.has(userDelete[1])) {
      return { rows: [], changes: this.deleteUser(userDelete[1], p[0] as string) };
    }
    return undefined;
  }

  private deleteUser(table: string, userId: string): number {
    const drop = <T>(rows: T[], owner: (row: T) => string | null): T[] =>
      rows.filter((row) => owner(row) !== userId);
    switch (table) {
      case 'entries': {
        const before = this.entries.length;
        this.entries = drop(this.entries, (e) => e.user_id);
        return before - this.entries.length;
      }
      case 'subscriptions': {
        const before = this.subscriptions.length;
        this.subscriptions = drop(this.subscriptions, (s) => s.user_id);
        return before - this.subscriptions.length;
      }
      case 'segment_starts': {
        let changes = 0;
        for (const key of this.segmentStarts) {
          if (key.split('\n')[2] === userId && this.segmentStarts.delete(key)) changes++;
        }
        return changes;
      }
      case 'segment_members': {
        let changes = 0;
        for (const key of this.segmentMembers.keys()) {
          if (key.split('\n')[1] === userId && this.segmentMembers.delete(key)) changes++;
        }
        return changes;
      }
      case 'devices': {
        let changes = 0;
        for (const [token, device] of this.devices) {
          if (device.user_id === userId && this.devices.delete(token)) changes++;
        }
        return changes;
      }
      case 'events': {
        const before = this.events.length;
        const kept = drop(this.events, (e) => e.user_id);
        this.events.splice(0, this.events.length, ...kept);
        return before - this.events.length;
      }
      case 'profiles':
        return this.profiles.delete(userId) ? 1 : 0;
      case 'erasures':
        return this.erasures.delete(userId) ? 1 : 0;
      default:
        throw new Error(`FakeD1: no user rows in ${table}`);
    }
  }

  // oxlint-disable-next-line eslint/max-lines-per-function -- one arm per SQL statement is the point
  private exec(sql: string, p: unknown[]): Result {
    switch (sql) {
      case 'INSERT OR IGNORE INTO events (id, user_id, name, ts, payload) VALUES (?, ?, ?, ?, ?)': {
        const id = p[0] as string;
        const userId = p[1] as string;
        // The key is (user_id, id)
        if (this.events.some((e) => e.id === id && e.user_id === userId))
          return { rows: [], changes: 0 };
        this.events.push({
          id,
          user_id: userId,
          name: p[2] as string,
          ts: p[3] as number,
          payload: p[4] as string,
        });
        return { rows: [], changes: 1 };
      }

      case 'SELECT props FROM profiles WHERE user_id = ?': {
        const props = this.profiles.get(p[0] as string);
        return { rows: props === undefined ? [] : [{ props }], changes: 0 };
      }

      case 'SELECT condition FROM segments WHERE id = ?': {
        const segment = this.segments.get(p[0] as string);
        return {
          rows: segment === undefined ? [] : [{ condition: segment.condition }],
          changes: 0,
        };
      }
      case 'SELECT id, condition FROM segments ORDER BY id': {
        const rows = [...this.segments]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([id, segment]) => ({ id, condition: segment.condition }));
        return { rows, changes: 0 };
      }
      case 'SELECT token, platform FROM devices WHERE user_id = ? ORDER BY ts DESC': {
        const rows = [...this.devices]
          .filter(([, d]) => d.user_id === p[0])
          .sort(([, a], [, b]) => b.ts - a.ts)
          .map(([token, d]) => ({ token, platform: d.platform }));
        return { rows, changes: 0 };
      }
      case 'INSERT INTO devices (token, user_id, platform, ts) VALUES (?, ?, ?, ?) ON CONFLICT (token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, ts = excluded.ts': {
        this.devices.set(p[0] as string, {
          user_id: p[1] as string,
          platform: p[2] as string,
          ts: p[3] as number,
        });
        return { rows: [], changes: 1 };
      }
      case 'DELETE FROM devices WHERE token = ? RETURNING user_id': {
        const device = this.devices.get(p[0] as string);
        this.devices.delete(p[0] as string);
        return {
          rows: device === undefined ? [] : [{ user_id: device.user_id }],
          changes: device === undefined ? 0 : 1,
        };
      }
      case 'SELECT user_id FROM devices WHERE token = ?': {
        const device = this.devices.get(p[0] as string);
        return { rows: device === undefined ? [] : [{ user_id: device.user_id }], changes: 0 };
      }
      case 'UPDATE devices SET user_id = NULL WHERE token = ?': {
        const device = this.devices.get(p[0] as string);
        if (device === undefined) return { rows: [], changes: 0 };
        device.user_id = null;
        return { rows: [], changes: 1 };
      }
      case 'DELETE FROM segments': {
        const changes = this.segments.size;
        this.segments.clear();
        return { rows: [], changes };
      }
      case 'INSERT INTO segments (id, condition, hash) VALUES (?, ?, ?)': {
        this.segments.set(p[0] as string, { condition: p[1] as string, hash: p[2] as string });
        return { rows: [], changes: 1 };
      }

      case 'SELECT workflow, hash, "where" AS whereClause, filter FROM triggers WHERE event = ?': {
        const rows = this.triggers
          .filter((t) => t.event === p[0])
          .map((t) => ({
            workflow: t.workflow,
            hash: t.hash,
            whereClause: t.where,
            filter: t.filter,
          }));
        return { rows, changes: 0 };
      }
      case 'DELETE FROM triggers': {
        const changes = this.triggers.length;
        this.triggers = [];
        return { rows: [], changes };
      }
      case 'INSERT INTO triggers (workflow, hash, event, "where", filter) VALUES (?, ?, ?, ?, ?)': {
        this.triggers.push({
          workflow: p[0] as string,
          hash: p[1] as string,
          event: p[2] as string,
          where: p[3] as string | null,
          filter: p[4] as string | null,
        });
        return { rows: [], changes: 1 };
      }

      case 'SELECT workflow, hash, segment FROM segment_triggers': {
        return { rows: this.segmentTriggers.map((t) => ({ ...t })), changes: 0 };
      }
      case 'DELETE FROM segment_triggers': {
        const changes = this.segmentTriggers.length;
        this.segmentTriggers = [];
        return { rows: [], changes };
      }
      case 'INSERT INTO segment_triggers (workflow, hash, segment) VALUES (?, ?, ?)': {
        this.segmentTriggers.push({
          workflow: p[0] as string,
          hash: p[1] as string,
          segment: p[2] as string,
        });
        return { rows: [], changes: 1 };
      }

      case 'INSERT OR REPLACE INTO workflow_ir (content_hash, ir) VALUES (?, ?)': {
        this.ir.set(p[0] as string, p[1] as string);
        return { rows: [], changes: 1 };
      }
      case 'SELECT ir FROM workflow_ir WHERE content_hash = ?': {
        const ir = this.ir.get(p[0] as string);
        return { rows: ir === undefined ? [] : [{ ir }], changes: 0 };
      }

      case 'SELECT 1 AS x FROM segment_members WHERE segment = ? AND user_id = ?': {
        const key = `${p[0] as string}\n${p[1] as string}`;
        return { rows: this.segmentMembers.has(key) ? [{ x: 1 }] : [], changes: 0 };
      }
      case 'INSERT OR IGNORE INTO segment_members (segment, user_id, ts) VALUES (?, ?, ?)': {
        const key = `${p[0] as string}\n${p[1] as string}`;
        if (this.segmentMembers.has(key)) return { rows: [], changes: 0 };
        this.segmentMembers.set(key, p[2] as number);
        return { rows: [], changes: 1 };
      }
      case 'INSERT OR IGNORE INTO segment_starts (segment, workflow, user_id, ts) VALUES (?, ?, ?, ?)': {
        const key = `${p[0] as string}\n${p[1] as string}\n${p[2] as string}`;
        if (this.segmentStarts.has(key)) return { rows: [], changes: 0 };
        this.segmentStarts.add(key);
        return { rows: [], changes: 1 };
      }
      case 'SELECT workflow FROM segment_starts WHERE segment = ? AND user_id = ?': {
        const rows = [...this.segmentStarts]
          .map((key) => key.split('\n'))
          .filter(([segment, , user]) => segment === p[0] && user === p[1])
          .map(([, workflow]) => ({ workflow }));
        return { rows, changes: 0 };
      }
      case 'DELETE FROM segment_starts WHERE segment = ? AND user_id = ? AND workflow = ?': {
        const key = `${p[0] as string}\n${p[2] as string}\n${p[1] as string}`;
        return { rows: [], changes: this.segmentStarts.delete(key) ? 1 : 0 };
      }
      case 'DELETE FROM segment_starts WHERE segment = ? AND user_id = ?': {
        let changes = 0;
        for (const key of this.segmentStarts) {
          const [segment, , user] = key.split('\n');
          if (segment === p[0] && user === p[1] && this.segmentStarts.delete(key)) changes++;
        }
        return { rows: [], changes };
      }
      case 'DELETE FROM segment_members WHERE segment = ? AND user_id = ?': {
        const key = `${p[0] as string}\n${p[1] as string}`;
        const changes = this.segmentMembers.delete(key) ? 1 : 0;
        return { rows: [], changes };
      }

      case 'INSERT OR IGNORE INTO erasures (user_id, ts) VALUES (?, ?)': {
        const userId = p[0] as string;
        if (this.erasures.has(userId)) return { rows: [], changes: 0 };
        this.erasures.set(userId, p[1] as number);
        return { rows: [], changes: 1 };
      }
      case 'SELECT user_id FROM erasures ORDER BY ts': {
        const rows = [...this.erasures]
          .sort(([, a], [, b]) => a - b)
          .map(([user_id]) => ({ user_id }));
        return { rows, changes: 0 };
      }
      case 'SELECT 1 AS x FROM erasures WHERE user_id = ?': {
        return { rows: this.erasures.has(p[0] as string) ? [{ x: 1 }] : [], changes: 0 };
      }

      case 'INSERT OR IGNORE INTO entries (workflow, user_id, instance_id, hash, status, ts) VALUES (?, ?, ?, ?, ?, ?)': {
        const exists = this.entries.some((e) => e.workflow === p[0] && e.user_id === p[1]);
        if (exists) return { rows: [], changes: 0 };
        this.entries.push({
          workflow: p[0] as string,
          user_id: p[1] as string,
          instance_id: p[2] as string,
          hash: p[3] as string,
          status: p[4] as string,
          ts: p[5] as number,
        });
        return { rows: [], changes: 1 };
      }
      case "UPDATE entries SET instance_id = ?, hash = ?, status = 'running', ts = ? WHERE workflow = ? AND user_id = ? AND status = 'failed'": {
        const target = this.entries.find(
          (e) => e.workflow === p[3] && e.user_id === p[4] && e.status === 'failed'
        );
        if (target === undefined) return { rows: [], changes: 0 };
        target.instance_id = p[0] as string;
        target.hash = p[1] as string;
        target.status = 'running';
        target.ts = p[2] as number;
        return { rows: [], changes: 1 };
      }
      case 'DELETE FROM entries WHERE instance_id = ?': {
        const before = this.entries.length;
        this.entries = this.entries.filter((e) => e.instance_id !== p[0]);
        return { rows: [], changes: before - this.entries.length };
      }
      case 'UPDATE entries SET status = ? WHERE instance_id = ?': {
        let changes = 0;
        for (const entry of this.entries) {
          if (entry.instance_id === p[1]) {
            entry.status = p[0] as string;
            changes++;
          }
        }
        return { rows: [], changes };
      }
      case "SELECT instance_id FROM entries WHERE user_id = ? AND status = 'running'": {
        const rows = this.entries
          .filter((e) => e.user_id === p[0] && e.status === 'running')
          .map((e) => ({ instance_id: e.instance_id }));
        return { rows, changes: 0 };
      }

      case 'SELECT DISTINCT wake_handle AS handle FROM subscriptions WHERE user_id = ? AND event = ?': {
        const handles = new Set(
          this.subscriptions
            .filter((s) => s.user_id === p[0] && s.event === p[1])
            .map((s) => s.wake_handle)
        );
        return { rows: [...handles].map((handle) => ({ handle })), changes: 0 };
      }
      case 'INSERT OR IGNORE INTO subscriptions (user_id, event, wake_handle, ts) VALUES (?, ?, ?, ?)': {
        // The (wake_handle, event) primary key
        if (this.subscriptions.some((s) => s.wake_handle === p[2] && s.event === p[1]))
          return { rows: [], changes: 0 };
        this.subscriptions.push({
          user_id: p[0] as string,
          event: p[1] as string,
          wake_handle: p[2] as string,
          ts: p[3] as number,
        });
        return { rows: [], changes: 1 };
      }
      case 'DELETE FROM subscriptions WHERE wake_handle = ?': {
        const before = this.subscriptions.length;
        this.subscriptions = this.subscriptions.filter((s) => s.wake_handle !== p[0]);
        return { rows: [], changes: before - this.subscriptions.length };
      }

      default: {
        const result = this.pattern(sql, p);
        if (result === undefined) throw new Error(`FakeD1: unsupported SQL: ${sql}`);
        return result;
      }
    }
  }
}

export class FakeJourney implements WorkflowBindingLike {
  readonly created: { id: string; params: unknown }[] = [];
  readonly wakes: { id: string; type: string }[] = [];
  /** Handles that .get() resolves for (a created instance, or one registered by a test). */
  readonly known = new Set<string>();
  /** Handles whose sendEvent fails (simulating a transient delivery failure). */
  readonly failingSends = new Set<string>();

  async create(options: { id: string; params: unknown }): Promise<WorkflowInstanceLike> {
    this.created.push(options);
    this.known.add(options.id);
    return this.instance(options.id);
  }

  async get(id: string): Promise<WorkflowInstanceLike> {
    if (!this.known.has(id)) throw new Error(`no such instance: ${id}`);
    return this.instance(id);
  }

  private instance(id: string): WorkflowInstanceLike {
    return {
      id,
      sendEvent: async (event: { type: string }) => {
        if (this.failingSends.has(id)) throw new Error('send failed');
        this.wakes.push({ id, type: event.type });
      },
    };
  }
}

export function makeEnv(overrides?: Partial<JourneyEnv>): {
  env: JourneyEnv;
  db: FakeD1;
  journey: FakeJourney;
} {
  const db = new FakeD1();
  const journey = new FakeJourney();
  const env: JourneyEnv = { DB: db, JOURNEY: journey, ...overrides };
  return { env, db, journey };
}
