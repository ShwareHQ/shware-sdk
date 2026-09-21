import type { D1DatabaseLike, KVNamespaceLike } from '../cloudflare/bindings';
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

  async insertEvent(input: EventInput): Promise<void> {
    await this.db
      .prepare('INSERT INTO events (user_id, name, ts, payload) VALUES (?, ?, ?, ?)')
      .bind(input.userId, input.event, input.ts, JSON.stringify(input.payload))
      .run();
  }

  async countEvents(userId: string, event: string, opts?: { sinceMs?: number }): Promise<number> {
    const sinceMs = opts?.sinceMs;
    const row =
      sinceMs === undefined
        ? await this.db
            .prepare('SELECT COUNT(*) AS c FROM events WHERE user_id = ? AND name = ?')
            .bind(userId, event)
            .first<{ c: number }>()
        : await this.db
            .prepare('SELECT COUNT(*) AS c FROM events WHERE user_id = ? AND name = ? AND ts >= ?')
            .bind(userId, event, sinceMs)
            .first<{ c: number }>();
    return row?.c ?? 0;
  }

  async listEventPayloads(
    userId: string,
    event: string,
    opts?: { sinceMs?: number }
  ): Promise<Record<string, unknown>[]> {
    const sinceMs = opts?.sinceMs;
    const { results } =
      sinceMs === undefined
        ? await this.db
            .prepare('SELECT payload FROM events WHERE user_id = ? AND name = ?')
            .bind(userId, event)
            .all<{ payload: string }>()
        : await this.db
            .prepare('SELECT payload FROM events WHERE user_id = ? AND name = ? AND ts >= ?')
            .bind(userId, event, sinceMs)
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
    const merged = { ...(await this.getProfile(userId)), ...props };
    await this.db
      .prepare(
        'INSERT INTO profiles (user_id, props) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET props = excluded.props'
      )
      .bind(userId, JSON.stringify(merged))
      .run();
    return merged;
  }

  async getSegmentCondition(name: string): Promise<ConditionIR | undefined> {
    const row = await this.db
      .prepare('SELECT condition FROM segments WHERE name = ?')
      .bind(name)
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
          .prepare('INSERT INTO segments (name, condition, hash) VALUES (?, ?, ?)')
          .bind(segment.name, JSON.stringify(segment.condition), segment.contentHash)
      ),
      ...bundle.workflows.flatMap((workflow) => {
        if (workflow.trigger.type === 'event') {
          return [
            this.db
              .prepare(
                'INSERT INTO triggers (workflow, hash, event, "where", filter) VALUES (?, ?, ?, ?, ?)'
              )
              .bind(
                workflow.name,
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
              .bind(workflow.name, workflow.contentHash, workflow.trigger.segment),
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

  async addSegmentMember(segment: string, userId: string, ts: number): Promise<void> {
    await this.db
      .prepare('INSERT OR IGNORE INTO segment_members (segment, user_id, ts) VALUES (?, ?, ?)')
      .bind(segment, userId, ts)
      .run();
  }

  async removeSegmentMember(segment: string, userId: string): Promise<void> {
    await this.db
      .prepare('DELETE FROM segment_members WHERE segment = ? AND user_id = ?')
      .bind(segment, userId)
      .run();
  }

  async enterJourney(entry: EntryInput): Promise<boolean> {
    const inserted = await this.db
      .prepare(
        'INSERT OR IGNORE INTO entries (workflow, user_id, instance_id, hash, status, ts) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind(entry.workflow, entry.userId, entry.instanceId, entry.hash, 'running', entry.ts)
      .run();
    return (inserted.meta?.changes ?? 1) !== 0;
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
