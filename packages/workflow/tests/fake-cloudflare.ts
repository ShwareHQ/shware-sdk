import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1RunResultLike,
  JourneyEnv,
  KVNamespaceLike,
  WorkflowBindingLike,
  WorkflowInstanceLike,
} from '../src/cloudflare/bindings';

/**
 * In-memory fakes for the Cloudflare bindings, so the ingest router is tested
 * through the same structural interfaces the real bindings satisfy. The fake
 * D1 dispatches on the exact SQL strings the router and fact source use —
 * editing a query means updating the dispatch here, which is deliberate: the
 * suite then reviews every statement change.
 */

interface EventRow {
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

export class FakeD1 implements D1DatabaseLike {
  readonly events: EventRow[] = [];
  readonly profiles = new Map<string, string>();
  readonly segments = new Map<string, { condition: string; hash: string }>();
  triggers: TriggerRow[] = [];
  segmentTriggers: SegmentTriggerRow[] = [];
  readonly segmentMembers = new Map<string, number>(); // `${segment}\n${user}` → ts
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
    const exec = (): { rows: Record<string, unknown>[]; changes: number } => this.exec(sql, params);
    return {
      bind: (...values: unknown[]) => this.statement(sql, values),
      first: async <T>() => (exec().rows[0] ?? null) as T | null,
      all: async <T>() => ({ results: exec().rows as T[] }),
      run: async (): Promise<D1RunResultLike> => ({ meta: { changes: exec().changes } }),
    };
  }

  // oxlint-disable-next-line eslint/max-lines-per-function -- one arm per SQL statement is the point
  private exec(sql: string, p: unknown[]): { rows: Record<string, unknown>[]; changes: number } {
    switch (sql) {
      case 'INSERT INTO events (user_id, name, ts, payload) VALUES (?, ?, ?, ?)': {
        this.events.push({
          user_id: p[0] as string,
          name: p[1] as string,
          ts: p[2] as number,
          payload: p[3] as string,
        });
        return { rows: [], changes: 1 };
      }
      case 'SELECT COUNT(*) AS c FROM events WHERE user_id = ? AND name = ?': {
        const c = this.events.filter((e) => e.user_id === p[0] && e.name === p[1]).length;
        return { rows: [{ c }], changes: 0 };
      }
      case 'SELECT COUNT(*) AS c FROM events WHERE user_id = ? AND name = ? AND ts >= ?': {
        const c = this.events.filter(
          (e) => e.user_id === p[0] && e.name === p[1] && e.ts >= (p[2] as number)
        ).length;
        return { rows: [{ c }], changes: 0 };
      }
      case 'SELECT payload FROM events WHERE user_id = ? AND name = ?': {
        const rows = this.events
          .filter((e) => e.user_id === p[0] && e.name === p[1])
          .map((e) => ({ payload: e.payload }));
        return { rows, changes: 0 };
      }
      case 'SELECT payload FROM events WHERE user_id = ? AND name = ? AND ts >= ?': {
        const rows = this.events
          .filter((e) => e.user_id === p[0] && e.name === p[1] && e.ts >= (p[2] as number))
          .map((e) => ({ payload: e.payload }));
        return { rows, changes: 0 };
      }

      case 'SELECT props FROM profiles WHERE user_id = ?': {
        const props = this.profiles.get(p[0] as string);
        return { rows: props === undefined ? [] : [{ props }], changes: 0 };
      }
      case 'INSERT INTO profiles (user_id, props) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET props = excluded.props': {
        this.profiles.set(p[0] as string, p[1] as string);
        return { rows: [], changes: 1 };
      }

      case 'SELECT condition FROM segments WHERE name = ?': {
        const segment = this.segments.get(p[0] as string);
        return {
          rows: segment === undefined ? [] : [{ condition: segment.condition }],
          changes: 0,
        };
      }
      case 'DELETE FROM segments': {
        const changes = this.segments.size;
        this.segments.clear();
        return { rows: [], changes };
      }
      case 'INSERT INTO segments (name, condition, hash) VALUES (?, ?, ?)': {
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
      case 'DELETE FROM segment_members WHERE segment = ? AND user_id = ?': {
        const key = `${p[0] as string}\n${p[1] as string}`;
        const changes = this.segmentMembers.delete(key) ? 1 : 0;
        return { rows: [], changes };
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

      case 'SELECT DISTINCT wake_handle AS handle FROM subscriptions WHERE user_id = ? AND event = ?': {
        const handles = new Set(
          this.subscriptions
            .filter((s) => s.user_id === p[0] && s.event === p[1])
            .map((s) => s.wake_handle)
        );
        return { rows: [...handles].map((handle) => ({ handle })), changes: 0 };
      }
      case 'DELETE FROM subscriptions WHERE wake_handle = ?': {
        const before = this.subscriptions.length;
        this.subscriptions = this.subscriptions.filter((s) => s.wake_handle !== p[0]);
        return { rows: [], changes: before - this.subscriptions.length };
      }

      default:
        throw new Error(`FakeD1: unsupported SQL: ${sql}`);
    }
  }
}

export class FakeKV implements KVNamespaceLike {
  readonly store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
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
  kv: FakeKV;
  journey: FakeJourney;
} {
  const db = new FakeD1();
  const kv = new FakeKV();
  const journey = new FakeJourney();
  const env: JourneyEnv = { WORKFLOW_KV: kv, DB: db, JOURNEY: journey, ...overrides };
  return { env, db, kv, journey };
}
