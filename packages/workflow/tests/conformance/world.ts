import ms from 'ms';
import type { Duration } from '../../src/index';
import type { PgliteDatabase } from '../pglite';
import type { Host, HostName, Reply } from './driver';
import { type ActionCall, type SentCopy, probe } from './journeys';

/**
 * What a scenario does to a host and what it reads back, in the scenario's own words. Every
 * act goes through the host's HTTP API or its driver; every reading is host-independent: what
 * the outlets were handed (`probe`), and the tables every host writes the same way (`entry`,
 * `instance`, `message`, `event`). Nothing here reads a host's own state.
 */

export interface EntryRow {
  workflow: string;
  user: string;
  status: string;
}

export interface InstanceRow {
  workflow: string;
  user: string;
  status: string;
  /** The node it sits on or last passed. */
  node: string | null;
  converted: boolean;
}

export interface CopyRow {
  template: string;
  channel: string;
  user: string;
  delivered: boolean;
  undelivered: string | null;
}

export interface BatchEvent {
  event: string;
  payload?: Record<string, unknown>;
}

export class World {
  constructor(
    readonly hostName: HostName,
    readonly host: Host,
    private readonly database: PgliteDatabase
  ) {}

  /* ---------------------------------- acts ---------------------------------- */

  private async ok(reply: Promise<Reply>): Promise<unknown> {
    const { status, body } = await reply;
    if (status !== 200) throw new Error(`the host answered ${status}: ${JSON.stringify(body)}`);
    return body;
  }

  /** `POST /bundle/deploy`: the bundle compiled into the host goes live. */
  deploy(): Promise<unknown> {
    return this.ok(this.host.request('POST', '/bundle/deploy'));
  }

  /** One event, then everything it set off. */
  async ingest(userId: string, event: string, payload?: Record<string, unknown>): Promise<void> {
    await this.batch({ userId, events: [{ event, payload }] });
  }

  /** A raw `/ingest` batch, then everything it set off. */
  async batch(batch: {
    userId?: string;
    visitorId?: string;
    profile?: Record<string, unknown>;
    events?: BatchEvent[];
  }): Promise<void> {
    await this.ok(this.host.request('POST', '/ingest', batch));
    await this.host.settle();
  }

  /** Write to the user's profile. */
  identify(userId: string, profile: Record<string, unknown>): Promise<void> {
    return this.batch({ userId, profile });
  }

  async device(userId: string, token: string, platform: 'ios' | 'android'): Promise<void> {
    await this.ok(this.host.request('POST', '/devices', { userId, token, platform }));
    await this.host.settle();
  }

  /** `PUT /subscriptions/:userId`: what the user opts out of (or back into). */
  async subscriptions(userId: string, patch: Record<string, unknown>): Promise<void> {
    await this.ok(this.host.request('PUT', `/subscriptions/${userId}`, patch));
    await this.host.settle();
  }

  /** `POST /users/forget`: the user is erased; what the host answered. */
  async forget(userId: string): Promise<{ erased: boolean; pending: string[] }> {
    const body = await this.ok(this.host.request('POST', '/users/forget', { userId }));
    await this.host.settle();
    return body as { erased: boolean; pending: string[] };
  }

  /** Let time pass; what comes due on the way runs when it is due. */
  advance(duration: Duration): Promise<void> {
    return this.host.advance(ms(duration));
  }

  /** The scheduled sweep, then everything it started. */
  async sweep(): Promise<void> {
    await this.host.sweep();
    await this.host.settle();
  }

  /* -------------------------------- readings -------------------------------- */

  /** Every action call so far, in order. */
  get actions(): ActionCall[] {
    return probe.actions;
  }

  /** The calls one workflow's instances made, in order. */
  of(workflow: string): ActionCall[] {
    return probe.actions.filter((call) => call.key.startsWith(`${workflow}/`));
  }

  /** The actions' names, in order: enough for most scenarios. */
  get ran(): string[] {
    return probe.actions.map((call) => call.action);
  }

  /** Every copy handed to the sender so far, in order. */
  get sent(): SentCopy[] {
    return probe.sent;
  }

  /** The entry ledger: one row per entry, oldest first within a workflow. */
  entries(): Promise<EntryRow[]> {
    return this.database.client.query<EntryRow>(
      `SELECT workflow, user_id AS "user", status FROM workflow.entry
        ORDER BY workflow, user_id, ts, instance_id`
    );
  }

  /** The statuses of one workflow's entries, oldest first. */
  async statuses(workflow: string): Promise<string[]> {
    return (await this.entries()).filter((row) => row.workflow === workflow).map((r) => r.status);
  }

  /** The reporting rows: where each instance stands and how it ended. */
  instances(): Promise<InstanceRow[]> {
    return this.database.client.query<InstanceRow>(
      `SELECT workflow, user_id AS "user", status, node_id AS node,
              converted_at IS NOT NULL AS converted
         FROM workflow.instance ORDER BY workflow, user_id, entered_at, instance_id`
    );
  }

  /** The reporting rows of every copy: whether the transport took it, or why not. */
  copies(): Promise<CopyRow[]> {
    return this.database.client.query<CopyRow>(
      `SELECT template, channel, user_id AS "user", delivered_at IS NOT NULL AS delivered,
              undelivered_reason AS undelivered
         FROM workflow.message ORDER BY workflow, node_id, channel, idempotency_key`
    );
  }

  /** The names of the events stored for a user, sorted. */
  async events(userId: string): Promise<string[]> {
    const rows = await this.database.client.query<{ name: string }>(
      `SELECT name FROM workflow.event WHERE user_id = $1 ORDER BY name`,
      [userId]
    );
    return rows.map((row) => row.name);
  }

  /** How many rows a table holds about a user. */
  async rows(table: string, userId: string): Promise<number> {
    const rows = await this.database.client.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM workflow.${table} WHERE user_id = $1`,
      [userId]
    );
    return rows.reduce((sum, row) => sum + row.c, 0);
  }

  /** What is left of a user: the tables that still hold a row about them, with how many. */
  async left(userId: string): Promise<Record<string, number>> {
    const found: Record<string, number> = {};
    for (const table of ['entry', 'event', 'instance', 'message', 'profile', 'subscription']) {
      const count = await this.rows(table, userId);
      if (count > 0) found[table] = count;
    }
    return found;
  }
}
