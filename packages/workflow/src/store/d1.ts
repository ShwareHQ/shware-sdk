import type { D1DatabaseLike, KVNamespaceLike } from '../cloudflare/bindings';
import type { PushDevice } from '../engine/ports';
import { type BundleIR, ConditionIR, WorkflowIR } from '../ir';
import type {
  DeviceInput,
  EntryInput,
  EntryOutcome,
  EventInput,
  EventWindow,
  JourneyStore,
  ProfileProps,
  SegmentTriggerRoute,
  TriggerRoute,
} from './index';

/**
 * The original data plane: D1 for the tables (see ../cloudflare/schema.sql)
 * and KV for the content-addressed workflow bodies (`wf:${contentHash}`).
 * The SQL below is exactly what the router and fact source used to inline —
 * the in-memory FakeD1 in the tests dispatches on these strings verbatim.
 */
export class D1JourneyStore implements JourneyStore {
  constructor(
    private readonly db: D1DatabaseLike,
    private readonly kv: KVNamespaceLike
  ) {}

  async insertEvent(input: EventInput): Promise<boolean> {
    const written = await this.db
      .prepare(
        'INSERT OR IGNORE INTO events (id, user_id, name, ts, payload) VALUES (?, ?, ?, ?, ?)'
      )
      .bind(input.id, input.userId, input.event, input.ts, JSON.stringify(input.payload))
      .run();
    return (written.meta?.changes ?? 1) > 0;
  }

  /** The event rows of one user and name, within the window's bounds (both inclusive). */
  private eventWindow(userId: string, event: string, window?: EventWindow) {
    const params: unknown[] = [userId, event];
    let where = 'user_id = ? AND name = ?';
    if (window?.sinceMs !== undefined) {
      where += ' AND ts >= ?';
      params.push(window.sinceMs);
    }
    if (window?.untilMs !== undefined) {
      where += ' AND ts <= ?';
      params.push(window.untilMs);
    }
    return { where, params };
  }

  async countEvents(userId: string, event: string, window?: EventWindow): Promise<number> {
    const { where, params } = this.eventWindow(userId, event, window);
    const row = await this.db
      .prepare(`SELECT COUNT(*) AS c FROM events WHERE ${where}`)
      .bind(...params)
      .first<{ c: number }>();
    return row?.c ?? 0;
  }

  async listEventPayloads(
    userId: string,
    event: string,
    window?: EventWindow
  ): Promise<Record<string, unknown>[]> {
    const { where, params } = this.eventWindow(userId, event, window);
    const { results } = await this.db
      .prepare(`SELECT payload FROM events WHERE ${where}`)
      .bind(...params)
      .all<{ payload: string }>();
    return results.map((row) => JSON.parse(row.payload) as Record<string, unknown>);
  }

  async getProfile(userId: string): Promise<ProfileProps | undefined> {
    const row = await this.db
      .prepare('SELECT props FROM profiles WHERE user_id = ?')
      .bind(userId)
      .first<{ props: string }>();
    return row ? (JSON.parse(row.props) as ProfileProps) : undefined;
  }

  async mergeProfile(userId: string, props: ProfileProps): Promise<ProfileProps> {
    // SQLite's json_patch is RFC 7386 merge-patch: a null removes its key. The
    // merge happens in the statement, so two concurrent identifies cannot lose
    // each other's fields the way a read-modify-write did.
    const patch = JSON.stringify(props);
    const row = await this.db
      .prepare(
        "INSERT INTO profiles (user_id, props) VALUES (?, json_patch('{}', ?)) ON CONFLICT(user_id) DO UPDATE SET props = json_patch(profiles.props, ?) RETURNING props"
      )
      .bind(userId, patch, patch)
      .first<{ props: string }>();
    // RETURNING always yields the row it just wrote; the fallback only covers a
    // driver that declines to return one, and reports what was asked for.
    return row === null ? stripNulls(props) : (JSON.parse(row.props) as ProfileProps);
  }

  async listUserIds(): Promise<string[]> {
    const { results } = await this.db
      .prepare('SELECT user_id FROM profiles UNION SELECT DISTINCT user_id FROM events')
      .bind()
      .all<{ user_id: string }>();
    return results.map((row) => row.user_id);
  }

  async listDevices(userId: string): Promise<PushDevice[]> {
    const { results } = await this.db
      .prepare('SELECT token, platform FROM devices WHERE user_id = ? ORDER BY ts DESC')
      .bind(userId)
      .all<PushDevice>();
    return results;
  }

  async upsertDevice(device: DeviceInput): Promise<void> {
    await this.db
      .prepare(
        'INSERT INTO devices (token, user_id, platform, ts) VALUES (?, ?, ?, ?) ON CONFLICT (token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, ts = excluded.ts'
      )
      .bind(device.token, device.userId, device.platform, device.ts)
      .run();
  }

  async requestErasure(userId: string, at: number): Promise<void> {
    await this.db
      .prepare('INSERT OR IGNORE INTO erasures (user_id, ts) VALUES (?, ?)')
      .bind(userId, at)
      .run();
  }

  async pendingErasures(): Promise<string[]> {
    const { results } = await this.db
      .prepare('SELECT user_id FROM erasures ORDER BY ts')
      .bind()
      .all<{ user_id: string }>();
    return results.map((row) => row.user_id);
  }

  async runningInstances(userId: string): Promise<string[]> {
    const { results } = await this.db
      .prepare("SELECT instance_id FROM entries WHERE user_id = ? AND status = 'running'")
      .bind(userId)
      .all<{ instance_id: string }>();
    return results.map((row) => row.instance_id);
  }

  async forgetUser(userId: string): Promise<void> {
    // One batch: D1 runs it as a transaction; the request goes last, with the data it erases
    await this.db.batch(
      [
        'entries',
        'subscriptions',
        'segment_starts',
        'segment_members',
        'devices',
        'events',
        'profiles',
        'erasures',
      ].map((table) => this.db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(userId))
    );
  }

  async removeDevice(token: string): Promise<string | undefined> {
    const row = await this.db
      .prepare('DELETE FROM devices WHERE token = ? RETURNING user_id')
      .bind(token)
      .first<{ user_id: string | null }>();
    return row?.user_id ?? undefined;
  }

  async unbindDevice(token: string): Promise<string | undefined> {
    const row = await this.db
      .prepare('SELECT user_id FROM devices WHERE token = ?')
      .bind(token)
      .first<{ user_id: string | null }>();
    await this.db.prepare('UPDATE devices SET user_id = NULL WHERE token = ?').bind(token).run();
    return row?.user_id ?? undefined;
  }

  async listSegments(): Promise<{ id: string; condition: ConditionIR }[]> {
    const { results } = await this.db
      .prepare('SELECT id, condition FROM segments ORDER BY id')
      .bind()
      .all<{ id: string; condition: string }>();
    return results.map((row) => ({
      id: row.id,
      condition: ConditionIR.parse(JSON.parse(row.condition)),
    }));
  }

  async getSegmentCondition(id: string): Promise<ConditionIR | undefined> {
    const row = await this.db
      .prepare('SELECT condition FROM segments WHERE id = ?')
      .bind(id)
      .first<{ condition: string }>();
    return row ? ConditionIR.parse(JSON.parse(row.condition)) : undefined;
  }

  async findTriggers(event: string): Promise<TriggerRoute[]> {
    const { results } = await this.db
      .prepare(
        'SELECT workflow, hash, "where" AS whereClause, filter FROM triggers WHERE event = ?'
      )
      .bind(event)
      .all<{ workflow: string; hash: string; whereClause: string | null; filter: string | null }>();
    return results.map((row) => ({
      workflow: row.workflow,
      hash: row.hash,
      where: row.whereClause === null ? null : ConditionIR.parse(JSON.parse(row.whereClause)),
      filter: row.filter === null ? null : ConditionIR.parse(JSON.parse(row.filter)),
    }));
  }

  async listSegmentTriggers(): Promise<SegmentTriggerRoute[]> {
    const { results } = await this.db
      .prepare('SELECT workflow, hash, segment FROM segment_triggers')
      .all<SegmentTriggerRoute>();
    return results;
  }

  async putWorkflowIR(workflow: WorkflowIR): Promise<void> {
    await this.kv.put(`wf:${workflow.contentHash}`, JSON.stringify(workflow));
  }

  async getWorkflowIR(contentHash: string): Promise<WorkflowIR | undefined> {
    const raw = await this.kv.get(`wf:${contentHash}`);
    return raw === null ? undefined : WorkflowIR.parse(JSON.parse(raw));
  }

  async replaceRoutes(bundle: BundleIR): Promise<void> {
    // One atomic batch: all-or-nothing, and a concurrent ingest never observes
    // the half-empty routing table a delete-then-insert loop would expose.
    await this.db.batch([
      this.db.prepare('DELETE FROM triggers'),
      this.db.prepare('DELETE FROM segment_triggers'),
      this.db.prepare('DELETE FROM segments'),
      ...bundle.segments.map((segment) =>
        this.db
          .prepare('INSERT INTO segments (id, condition, hash) VALUES (?, ?, ?)')
          .bind(segment.id, JSON.stringify(segment.condition), segment.contentHash)
      ),
      ...bundle.workflows.flatMap((workflow) => {
        if (workflow.trigger.type === 'event') {
          return [
            this.db
              .prepare(
                'INSERT INTO triggers (workflow, hash, event, "where", filter) VALUES (?, ?, ?, ?, ?)'
              )
              .bind(
                workflow.id,
                workflow.contentHash,
                workflow.trigger.event,
                workflow.trigger.where !== undefined
                  ? JSON.stringify(workflow.trigger.where)
                  : null,
                workflow.trigger.filter !== undefined
                  ? JSON.stringify(workflow.trigger.filter)
                  : null
              ),
          ];
        }
        if (workflow.trigger.type === 'segment') {
          return [
            this.db
              .prepare('INSERT INTO segment_triggers (workflow, hash, segment) VALUES (?, ?, ?)')
              .bind(workflow.id, workflow.contentHash, workflow.trigger.segment),
          ];
        }
        return [];
      }),
    ]);
  }

  async isSegmentMember(segment: string, userId: string): Promise<boolean> {
    const row = await this.db
      .prepare('SELECT 1 AS x FROM segment_members WHERE segment = ? AND user_id = ?')
      .bind(segment, userId)
      .first<{ x: number }>();
    return row !== null;
  }

  async addSegmentMember(
    segment: string,
    userId: string,
    ts: number,
    workflows: readonly string[]
  ): Promise<void> {
    await this.db.batch([
      this.db
        .prepare('INSERT OR IGNORE INTO segment_members (segment, user_id, ts) VALUES (?, ?, ?)')
        .bind(segment, userId, ts),
      ...workflows.map((workflow) =>
        this.db
          .prepare(
            'INSERT OR IGNORE INTO segment_starts (segment, workflow, user_id, ts) VALUES (?, ?, ?, ?)'
          )
          .bind(segment, workflow, userId, ts)
      ),
    ]);
  }

  async pendingSegmentStarts(segment: string, userId: string): Promise<string[]> {
    const { results } = await this.db
      .prepare('SELECT workflow FROM segment_starts WHERE segment = ? AND user_id = ?')
      .bind(segment, userId)
      .all<{ workflow: string }>();
    return results.map((row) => row.workflow);
  }

  async completeSegmentStart(segment: string, userId: string, workflow: string): Promise<void> {
    await this.db
      .prepare('DELETE FROM segment_starts WHERE segment = ? AND user_id = ? AND workflow = ?')
      .bind(segment, userId, workflow)
      .run();
  }

  async removeSegmentMember(segment: string, userId: string): Promise<void> {
    await this.db.batch([
      this.db
        .prepare('DELETE FROM segment_starts WHERE segment = ? AND user_id = ?')
        .bind(segment, userId),
      this.db
        .prepare('DELETE FROM segment_members WHERE segment = ? AND user_id = ?')
        .bind(segment, userId),
    ]);
  }

  async enterJourney(entry: EntryInput): Promise<EntryOutcome> {
    const inserted = await this.db
      .prepare(
        'INSERT OR IGNORE INTO entries (workflow, user_id, instance_id, hash, status, ts) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind(entry.workflow, entry.userId, entry.instanceId, entry.hash, 'running', entry.ts)
      .run();
    if ((inserted.meta?.changes ?? 1) !== 0) return 'entered';

    // A row already there blocks the entry, unless it records an instance that
    // died: 'failed' is reclaimed rather than barring the user forever over one
    // outage. The status test lives inside the UPDATE, so of two concurrent
    // retries exactly one sees a change.
    const claimed = await this.db
      .prepare(
        "UPDATE entries SET instance_id = ?, hash = ?, status = 'running', ts = ? WHERE workflow = ? AND user_id = ? AND status = 'failed'"
      )
      .bind(entry.instanceId, entry.hash, entry.ts, entry.workflow, entry.userId)
      .run();
    return (claimed.meta?.changes ?? 0) > 0 ? 'reclaimed' : null;
  }

  async removeEntry(instanceId: string): Promise<void> {
    await this.db.prepare('DELETE FROM entries WHERE instance_id = ?').bind(instanceId).run();
  }

  async setEntryStatus(instanceId: string, status: string): Promise<void> {
    await this.db
      .prepare('UPDATE entries SET status = ? WHERE instance_id = ?')
      .bind(status, instanceId)
      .run();
  }

  async findWakeHandles(userId: string, event: string): Promise<string[]> {
    const { results } = await this.db
      .prepare(
        'SELECT DISTINCT wake_handle AS handle FROM subscriptions WHERE user_id = ? AND event = ?'
      )
      .bind(userId, event)
      .all<{ handle: string }>();
    return results.map((row) => row.handle);
  }

  async subscribe(
    handle: string,
    userId: string,
    events: readonly string[],
    ts: number
  ): Promise<void> {
    for (const event of events) {
      // OR IGNORE on the (wake_handle, event) PK: the interpreter re-subscribes on
      // every wait attempt (one-shot-callback contract) and rows persist here.
      await this.db
        .prepare(
          'INSERT OR IGNORE INTO subscriptions (user_id, event, wake_handle, ts) VALUES (?, ?, ?, ?)'
        )
        .bind(userId, event, handle, ts)
        .run();
    }
  }

  async unsubscribe(handle: string): Promise<void> {
    await this.db.prepare('DELETE FROM subscriptions WHERE wake_handle = ?').bind(handle).run();
  }
}

/** What a merge-patch of `props` into an empty profile yields: the patch minus its nulls. */
function stripNulls(props: ProfileProps): ProfileProps {
  return Object.fromEntries(Object.entries(props).filter(([, value]) => value !== null));
}
