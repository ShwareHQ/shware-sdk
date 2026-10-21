import type { D1DatabaseLike, D1RunResultLike } from '../cloudflare/bindings';
import type { PushDevice } from '../engine/ports';
import { type BundleIR, ConditionIR, WorkflowIR } from '../ir';
import { type ErasureState, UserErasedError } from './erasure';
import type {
  DeviceInput,
  EntryInput,
  EntryOutcome,
  EventInput,
  EventWindow,
  JourneyStore,
  ProfileProps,
  RunningInstance,
  SegmentTriggerRoute,
  TriggerRoute,
} from './index';

/**
 * The condition every write about a user carries, as the last bound parameter: no erasure
 * tombstone for the user. Inside the statement, so the check and the write share one snapshot.
 */
const NOT_ERASED = 'WHERE NOT EXISTS (SELECT 1 FROM erasures WHERE user_id = ?)';

/**
 * The D1 data plane: one database for everything (see ../cloudflare/schema.sql),
 * the content-addressed workflow bodies included — beside the routes that name
 * them, so a deploy is read-your-writes (KV's eventual consistency would let a
 * route name a body that is not readable yet). The in-memory FakeD1 in the
 * tests dispatches on these statements.
 *
 * Every write about a user is one statement conditional on their erasure tombstone not
 * existing (`INSERT ... SELECT ... WHERE NOT EXISTS`): a write that changed nothing is then
 * read back once to tell a refusal (`UserErasedError`) from a plain no-op. D1 has one writer,
 * so a statement is atomic against every other: the runner's admission is one conditional
 * UPDATE, and a tombstone either precedes it (refused) or follows it (the erasure finds the
 * instance admitted) — no lock needed.
 */
export class D1JourneyStore implements JourneyStore {
  constructor(private readonly db: D1DatabaseLike) {}

  async insertEvent(input: EventInput): Promise<boolean> {
    // The key is (user_id, id): the sender's occurrence id, per user
    const written = await this.db
      .prepare(
        `INSERT OR IGNORE INTO events (id, user_id, name, ts, payload) SELECT ?, ?, ?, ?, ? ${NOT_ERASED}`
      )
      .bind(
        input.id,
        input.userId,
        input.event,
        input.ts,
        JSON.stringify(input.payload),
        input.userId
      )
      .run();
    if ((written.meta?.changes ?? 1) > 0) return true;
    // Nothing written: a duplicate, unless the tombstone refused it
    await this.refuseIfErased(input.userId);
    return false;
  }

  /**
   * A conditional write changed nothing: on that path only, read why. Throws when the tombstone
   * refused it; returns when the statement had another reason (a duplicate, an entry taken).
   */
  private async refuseIfErased(userId: string): Promise<void> {
    if ((await this.erasureState(userId)) !== 'none') throw new UserErasedError(userId);
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
    //
    // The merge is top-level only, as Postgres's `||` is: a key whose value is
    // an object replaces the stored value whole instead of being deep-merged
    // into it (json_patch's own behaviour), so the two stores agree. Those keys
    // are removed first, in the same statement; a patch of scalars — all the
    // API admits — needs no removal and is the plain json_patch.
    const patch = JSON.stringify(props);
    // Typed as scalars, but a caller outside the API may still hand an object: replace it whole
    const replaced = Object.entries(props as Record<string, unknown>)
      .filter(([, value]) => typeof value === 'object' && value !== null)
      .map(([key]) => key);
    const stored =
      replaced.length === 0
        ? 'profiles.props'
        : `json_remove(profiles.props, ${replaced.map(() => '?').join(', ')})`;
    // The SELECT keeps a WHERE clause, which is also what disambiguates the upsert for SQLite
    const row = await this.db
      .prepare(
        `INSERT INTO profiles (user_id, props) SELECT ?, json_patch('{}', ?) ${NOT_ERASED} ON CONFLICT(user_id) DO UPDATE SET props = json_patch(${stored}, ?) RETURNING props`
      )
      .bind(userId, patch, userId, ...replaced.map(jsonPath), patch)
      .first<{ props: string }>();
    if (row !== null) return JSON.parse(row.props) as ProfileProps;
    // No row: the tombstone refused the write — or a driver declined to return one, in which
    // case the merge went through and the answer is what was asked for
    await this.refuseIfErased(userId);
    return stripNulls(props);
  }

  async listUserIds(page?: {
    after?: string | undefined;
    limit?: number | undefined;
  }): Promise<string[]> {
    // Ascending user_id with a keyset bound, so a sweep can resume past the last id it saw
    const params: unknown[] = [];
    let where = '';
    if (page?.after !== undefined) {
      where = ' WHERE user_id > ?';
      params.push(page.after);
    }
    let limit = '';
    if (page?.limit !== undefined) {
      limit = ' LIMIT ?';
      params.push(page.limit);
    }
    const { results } = await this.db
      .prepare(
        `SELECT user_id FROM (SELECT user_id FROM profiles UNION SELECT user_id FROM events)${where} ORDER BY user_id${limit}`
      )
      .bind(...params)
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
    const written = await this.db
      .prepare(
        `INSERT INTO devices (token, user_id, platform, ts) SELECT ?, ?, ?, ? ${NOT_ERASED} ON CONFLICT (token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, ts = excluded.ts`
      )
      .bind(device.token, device.userId, device.platform, device.ts, device.userId)
      .run();
    // The upsert always changes its row — unless the tombstone refused it
    if ((written.meta?.changes ?? 1) === 0) throw new UserErasedError(device.userId);
  }

  async requestErasure(userId: string, at: number): Promise<void> {
    await this.db
      .prepare('INSERT OR IGNORE INTO erasures (user_id, ts) VALUES (?, ?)')
      .bind(userId, at)
      .run();
  }

  async pendingErasures(): Promise<string[]> {
    const { results } = await this.db
      .prepare('SELECT user_id FROM erasures WHERE erased_at IS NULL ORDER BY ts')
      .bind()
      .all<{ user_id: string }>();
    return results.map((row) => row.user_id);
  }

  async erasureState(userId: string): Promise<ErasureState> {
    const row = await this.db
      .prepare('SELECT erased_at FROM erasures WHERE user_id = ?')
      .bind(userId)
      .first<{ erased_at: number | null }>();
    if (row === null) return 'none';
    return row.erased_at === null ? 'erasing' : 'erased';
  }

  async erasedSince(since: number): Promise<string[]> {
    const { results } = await this.db
      .prepare('SELECT user_id FROM erasures WHERE erased_at >= ? ORDER BY erased_at')
      .bind(since)
      .all<{ user_id: string }>();
    return results.map((row) => row.user_id);
  }

  async runningInstances(userId: string): Promise<RunningInstance[]> {
    const { results } = await this.db
      .prepare(
        "SELECT instance_id, admitted_at IS NOT NULL AS admitted FROM entries WHERE user_id = ? AND status = 'running'"
      )
      .bind(userId)
      .all<{ instance_id: string; admitted: number | boolean }>();
    return results.map((row) => ({ instanceId: row.instance_id, admitted: Boolean(row.admitted) }));
  }

  async admitInstance(instanceId: string, userId: string): Promise<boolean> {
    // One statement: the first admission's time is kept on replay, the tombstone refuses it
    const row = await this.db
      .prepare(
        "UPDATE entries SET admitted_at = COALESCE(admitted_at, ?) WHERE instance_id = ? AND user_id = ? AND status = 'running' AND NOT EXISTS (SELECT 1 FROM erasures WHERE user_id = ?) RETURNING instance_id"
      )
      .bind(Date.now(), instanceId, userId, userId)
      .first<{ instance_id: string }>();
    return row !== null;
  }

  async forgetUser(userId: string, at: number): Promise<void> {
    // One batch: D1 runs it as a transaction. The tombstone stays, marked erased last; a repeat
    // keeps the first erase's time
    await this.db.batch([
      ...[
        'entries',
        'subscriptions',
        'segment_starts',
        'segment_members',
        'devices',
        'events',
        'profiles',
      ].map((table) => this.db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(userId)),
      this.db
        .prepare('UPDATE erasures SET erased_at = COALESCE(erased_at, ?) WHERE user_id = ?')
        .bind(at, userId),
    ]);
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
    // Content-addressed: a hash already there names the same body, so replacing is harmless
    await this.db
      .prepare('INSERT OR REPLACE INTO workflow_ir (content_hash, ir) VALUES (?, ?)')
      .bind(workflow.contentHash, JSON.stringify(workflow))
      .run();
  }

  async getWorkflowIR(contentHash: string): Promise<WorkflowIR | undefined> {
    const row = await this.db
      .prepare('SELECT ir FROM workflow_ir WHERE content_hash = ?')
      .bind(contentHash)
      .first<{ ir: string }>();
    return row === null ? undefined : WorkflowIR.parse(JSON.parse(row.ir));
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
    const [member] = (await this.db.batch([
      this.db
        .prepare(
          `INSERT OR IGNORE INTO segment_members (segment, user_id, ts) SELECT ?, ?, ? ${NOT_ERASED}`
        )
        .bind(segment, userId, ts, userId),
      ...workflows.map((workflow) =>
        this.db
          .prepare(
            `INSERT OR IGNORE INTO segment_starts (segment, workflow, user_id, ts) SELECT ?, ?, ?, ? ${NOT_ERASED}`
          )
          .bind(segment, workflow, userId, ts, userId)
      ),
    ])) as D1RunResultLike[];
    // Already a member, or refused: either way the starts wrote nothing new
    if ((member.meta?.changes ?? 1) === 0) await this.refuseIfErased(userId);
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
    if (entry.execution !== undefined) {
      throw new Error('D1JourneyStore keeps no execution starts: this runtime needs Postgres');
    }
    const inserted = await this.db
      .prepare(
        `INSERT OR IGNORE INTO entries (workflow, user_id, instance_id, hash, status, ts) SELECT ?, ?, ?, ?, ?, ? ${NOT_ERASED}`
      )
      .bind(
        entry.workflow,
        entry.userId,
        entry.instanceId,
        entry.hash,
        'running',
        entry.ts,
        entry.userId
      )
      .run();
    if ((inserted.meta?.changes ?? 1) !== 0) return 'entered';

    // A row already there blocks the entry, unless it records an instance that
    // died: 'failed' is reclaimed rather than barring the user forever over one
    // outage. The status test lives inside the UPDATE, so of two concurrent
    // retries exactly one sees a change.
    const claimed = await this.db
      .prepare(
        "UPDATE entries SET instance_id = ?, hash = ?, status = 'running', ts = ? WHERE workflow = ? AND user_id = ? AND status = 'failed' AND NOT EXISTS (SELECT 1 FROM erasures WHERE user_id = ?)"
      )
      .bind(entry.instanceId, entry.hash, entry.ts, entry.workflow, entry.userId, entry.userId)
      .run();
    if ((claimed.meta?.changes ?? 0) > 0) return 'reclaimed';
    // Taken by a live instance, or refused by the tombstone: tell them apart
    await this.refuseIfErased(entry.userId);
    return null;
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
    let skipped = false;
    for (const event of events) {
      // OR IGNORE on the (wake_handle, event) PK: the interpreter re-subscribes on
      // every wait attempt (one-shot-callback contract) and rows persist here.
      const written = await this.db
        .prepare(
          `INSERT OR IGNORE INTO subscriptions (user_id, event, wake_handle, ts) SELECT ?, ?, ?, ? ${NOT_ERASED}`
        )
        .bind(userId, event, handle, ts, userId)
        .run();
      if ((written.meta?.changes ?? 1) === 0) skipped = true;
    }
    // A registration already there, or refused: one read tells which
    if (skipped) await this.refuseIfErased(userId);
  }

  async unsubscribe(handle: string): Promise<void> {
    await this.db.prepare('DELETE FROM subscriptions WHERE wake_handle = ?').bind(handle).run();
  }
}

/** What a merge-patch of `props` into an empty profile yields: the patch minus its nulls. */
function stripNulls(props: ProfileProps): ProfileProps {
  return Object.fromEntries(Object.entries(props).filter(([, value]) => value !== null));
}

/**
 * The SQLite JSON path of a top-level key. Quoted, so dots and brackets in the key are literal;
 * a double quote has no escape in SQLite's path syntax, so such a key cannot be addressed.
 */
function jsonPath(key: string): string {
  if (key.includes('"')) {
    throw new Error(`profile property "${key}" cannot hold an object: its name contains a quote`);
  }
  return `$."${key}"`;
}
