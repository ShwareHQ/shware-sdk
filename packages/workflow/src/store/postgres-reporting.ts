import { UserErasedError } from './erasure';
import type { ClickContext, Engagement, JourneyReporting, MessageRecord } from './index';
import { type SqlClientLike, uuidv7 } from './sql';
import type { TableKey } from './tables';
import { beginReadCommitted, lockUser, lockUserTransaction } from './user-lock';

/**
 * Epoch milliseconds → timestamptz, and back: numbers in and out, whatever the driver maps (a
 * driver may hand a double or a bigint count back as a string).
 */
const TS = (param: string) => `to_timestamp(${param}::double precision / 1000)`;
const MS = (column: string) => `(extract(epoch from ${column}) * 1000)::double precision`;

/**
 * Journey reporting on the engine's Postgres schema (tables.ts: instance, message,
 * message_link, message_open, message_click, segment_member, segment_snapshot). Every timestamp
 * is written here, never defaulted, and every write is idempotent: the engine reports again when
 * a step is retried.
 *
 * The instance and message rows are written like the store's rows about a user (postgres.ts,
 * user-lock.ts): in a transaction holding the user's advisory lock, conditional on the user's
 * erasure tombstone (`INSERT ... SELECT ... WHERE NOT EXISTS`). A notification arriving after
 * the user was erased — a late start, node or finish — is a no-op, never an upsert that puts
 * the instance back; a copy to be recorded for them is refused (`UserErasedError`, not
 * retryable) so it is never sent.
 *
 * Links, opens, clicks and device deliveries know only the copy's id. Their transaction is
 * pinned to READ COMMITTED first, looks the copy's owner up without a row lock, takes the
 * owner's user lock, then re-checks that the copy still exists and the owner has no tombstone
 * — a copy deleted while waiting is a no-op, nothing is recorded under a stale owner — and only
 * then locks the copy's row (where the path locks it) and writes. User lock before row lock,
 * always: the erasure deletes under the user lock, so the two never wait on each other in
 * opposite orders. The unsubscribe is the compliance exception: its suppression is written
 * whatever the user's state, under the same lock order for consistency.
 */
export class PostgresReporting implements JourneyReporting {
  constructor(
    private readonly sql: SqlClientLike,
    private readonly t: Record<TableKey, string>,
    private readonly schema: string
  ) {}

  /** The condition every row about a user carries: no erasure tombstone for `$user`. */
  private notErased(user: string): string {
    return `WHERE NOT EXISTS (SELECT 1 FROM ${this.t.erasure} WHERE user_id = ${user})`;
  }

  /**
   * The message-id paths' opening: READ COMMITTED, the copy's owner without a row lock, the
   * owner's user lock, then the copy re-read under it — present and its owner without a
   * tombstone, or `undefined` (the copy went, or its owner is being erased: nothing to record).
   * `forUpdate` locks the copy's row on that re-read, after the user lock.
   */
  private async lockMessage(
    tx: SqlClientLike,
    messageId: string,
    forUpdate = false
  ): Promise<{ userId: string; deliveredAt: number } | undefined> {
    await beginReadCommitted(tx);
    const owners = await tx.query<{ user_id: string }>(
      `SELECT user_id FROM ${this.t.message} WHERE id = $1`,
      [messageId]
    );
    const owner = owners.at(0);
    if (owner === undefined) return undefined;
    await lockUser(tx, this.schema, owner.user_id);
    const rows = await tx.query<{ user_id: string; delivered_at: number | string }>(
      `SELECT user_id, ${MS('coalesce(delivered_at, sent_at)')} AS delivered_at
       FROM ${this.t.message} WHERE id = $1
         AND NOT EXISTS (SELECT 1 FROM ${this.t.erasure} WHERE user_id = ${this.t.message}.user_id)
       ${forUpdate ? 'FOR UPDATE' : ''}`,
      [messageId]
    );
    const row = rows.at(0);
    if (row === undefined) return undefined;
    return { userId: row.user_id, deliveredAt: Number(row.delivered_at) };
  }

  async instanceStarted(input: {
    workflow: string;
    instanceId: string;
    userId: string;
    at: number;
  }): Promise<void> {
    await this.sql.transaction(async (tx) => {
      await lockUserTransaction(tx, this.schema, input.userId);
      await tx.query(
        `INSERT INTO ${this.t.instance} (instance_id, workflow, user_id, entered_at, status)
         SELECT $1, $2, $3, ${TS('$4')}, 'running' ${this.notErased('$3')}
         ON CONFLICT (instance_id) DO NOTHING`,
        [input.instanceId, input.workflow, input.userId, input.at]
      );
    });
  }

  async nodeReached(input: {
    workflow: string;
    instanceId: string;
    userId: string;
    nodeId: string;
    at: number;
  }): Promise<void> {
    await this.sql.transaction(async (tx) => {
      await lockUserTransaction(tx, this.schema, input.userId);
      await tx.query(
        `INSERT INTO ${this.t.instance} (instance_id, workflow, user_id, entered_at, node_id, node_at, status)
         SELECT $1, $2, $3, ${TS('$4')}, $5, ${TS('$4')}, 'running' ${this.notErased('$3')}
         ON CONFLICT (instance_id) DO UPDATE SET node_id = EXCLUDED.node_id, node_at = EXCLUDED.node_at`,
        [input.instanceId, input.workflow, input.userId, input.at, input.nodeId]
      );
    });
  }

  async instanceFinished(input: {
    workflow: string;
    instanceId: string;
    userId: string;
    status: string;
    at: number;
    convertedAt?: number;
  }): Promise<void> {
    // An upsert: an instance that started before its start was reported still gets its row —
    // unless the user is erased, where a late finish must not put one back
    await this.sql.transaction(async (tx) => {
      await lockUserTransaction(tx, this.schema, input.userId);
      await tx.query(
        `INSERT INTO ${this.t.instance}
           (instance_id, workflow, user_id, entered_at, status, finished_at, converted_at)
         SELECT $1, $2, $3, ${TS('$5')}, $4, ${TS('$5')}, ${TS('$6')} ${this.notErased('$3')}
         ON CONFLICT (instance_id) DO UPDATE SET status = EXCLUDED.status,
           finished_at = EXCLUDED.finished_at, converted_at = EXCLUDED.converted_at`,
        [
          input.instanceId,
          input.workflow,
          input.userId,
          input.status,
          input.at,
          input.convertedAt ?? null,
        ]
      );
    });
  }

  async recordMessage(message: MessageRecord): Promise<string> {
    // A retried step records the same copy again: the row it already wrote is the one. With a
    // tombstone the statement yields nothing, a retry's row included: the copy is not sent
    return this.sql.transaction(async (tx) => {
      await lockUserTransaction(tx, this.schema, message.userId);
      const rows = await tx.query<{ id: string }>(
        `INSERT INTO ${this.t.message}
           (id, idempotency_key, workflow, instance_id, node_id, template, channel, user_id, sent_at)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, ${TS('$9')} ${this.notErased('$8')}
         ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
         RETURNING id`,
        [
          uuidv7(message.sentAt),
          message.idempotencyKey,
          message.workflow,
          message.instanceId,
          message.nodeId,
          message.template,
          message.channel,
          message.userId,
          message.sentAt,
        ]
      );
      const id = rows.at(0)?.id;
      if (id !== undefined) return id;
      // Nothing recorded: the tombstone refused it, and the sender must stop here
      const erased = await tx.query(`SELECT 1 AS x FROM ${this.t.erasure} WHERE user_id = $1`, [
        message.userId,
      ]);
      if (erased.length > 0) throw new UserErasedError(message.userId);
      throw new Error(`message ${message.idempotencyKey} was not recorded`);
    });
  }

  async settleMessage(
    idempotencyKey: string,
    result: { delivered: true } | { delivered: false; reason: string },
    at: number
  ): Promise<void> {
    if (result.delivered) {
      await this.sql.query(
        `UPDATE ${this.t.message} SET delivered_at = coalesce(delivered_at, ${TS('$2')}) WHERE idempotency_key = $1`,
        [idempotencyKey, at]
      );
    } else {
      await this.sql.query(
        `UPDATE ${this.t.message} SET undelivered_reason = $2 WHERE idempotency_key = $1`,
        [idempotencyKey, result.reason]
      );
    }
  }

  async recordLinks(messageId: string, urls: readonly string[]): Promise<void> {
    if (urls.length === 0) return;
    const values = urls.map((_, i) => `($1, ${i}, $${i + 2})`).join(', ');
    await this.sql.transaction(async (tx) => {
      // No copy (or one being erased): nothing to record the links under
      if ((await this.lockMessage(tx, messageId)) === undefined) return;
      await tx.query(
        `INSERT INTO ${this.t.messageLink} (message_id, position, url) VALUES ${values} ON CONFLICT DO NOTHING`,
        [messageId, ...urls]
      );
    });
  }

  async recordOpen(
    messageId: string,
    judge: (message: { userId: string; deliveredAt: number }) => Engagement | undefined
  ): Promise<boolean> {
    // In a transaction: read through Hyperdrive, a bare read may come from its cache, from before
    // the copy existed
    return this.sql.transaction(async (tx) => {
      const message = await this.lockMessage(tx, messageId);
      if (message === undefined) return false;
      const open = judge(message);
      if (open === undefined) return true;
      await tx.query(
        `INSERT INTO ${this.t.messageOpen}
           (id, message_id, opened_at, machine, reason, user_agent, asn, as_organization, country)
         VALUES ($1, $2, ${TS('$3')}, $4, $5, $6, $7, $8, $9)`,
        [
          uuidv7(open.at),
          messageId,
          open.at,
          open.machine,
          open.reason,
          open.userAgent,
          open.asn,
          open.organization,
          open.country,
        ]
      );
      await tx.query(
        `UPDATE ${this.t.message} SET
           opened_at = coalesce(opened_at, ${TS('$2')}),
           human_opened_at = CASE WHEN $3 THEN human_opened_at ELSE coalesce(human_opened_at, ${TS('$2')}) END
         WHERE id = $1`,
        [messageId, open.at, open.machine]
      );
      return true;
    });
  }

  async recordClick(
    messageId: string,
    position: number,
    at: number,
    windowMs: number,
    judge: (link: ClickContext) => { engagement: Engagement; backdate: boolean }
  ): Promise<{ url: string; engagement: Engagement } | undefined> {
    return this.sql.transaction(async (tx) => {
      // The copy's row is the lock (taken after the user lock): concurrent clicks on it are
      // judged one at a time
      const message = await this.lockMessage(tx, messageId, true);
      if (message === undefined) return undefined;
      const links = await tx.query<{ url: string; link_count: number | string }>(
        `SELECT l.url,
           (SELECT count(*) FROM ${this.t.messageLink} a WHERE a.message_id = l.message_id) AS link_count
         FROM ${this.t.messageLink} l WHERE l.message_id = $1 AND l.position = $2`,
        [messageId, position]
      );
      const link = links.at(0);
      if (link === undefined) return undefined;
      const since = at - windowMs;
      const recent = await tx.query<{ position: number; at: number | string }>(
        `SELECT position, ${MS('clicked_at')} AS at FROM ${this.t.messageClick}
         WHERE message_id = $1 AND clicked_at >= ${TS('$2')} ORDER BY clicked_at`,
        [messageId, since]
      );
      const { engagement: click, backdate } = judge({
        url: link.url,
        deliveredAt: message.deliveredAt,
        linkCount: Number(link.link_count),
        recent: recent.map((row) => ({ position: row.position, at: Number(row.at) })),
      });
      await tx.query(
        `INSERT INTO ${this.t.messageClick}
           (id, message_id, position, url, clicked_at, machine, reason, user_agent, asn, as_organization, country)
         VALUES ($1, $2, $3, $4, ${TS('$5')}, $6, $7, $8, $9, $10, $11)`,
        [
          uuidv7(click.at),
          messageId,
          position,
          link.url,
          click.at,
          click.machine,
          click.reason,
          click.userAgent,
          click.asn,
          click.organization,
          click.country,
        ]
      );
      if (backdate) {
        // A walk across the copy is found on its later clicks: the earlier ones were part of it
        await tx.query(
          `UPDATE ${this.t.messageClick} SET machine = true, reason = $4
           WHERE message_id = $1 AND NOT machine
             AND clicked_at BETWEEN ${TS('$2')} AND ${TS('$3')}`,
          [messageId, since, at, click.reason]
        );
      }
      // First opens and clicks, from the classified rows (a click implies an open)
      await tx.query(
        `UPDATE ${this.t.message} m SET
           clicked_at = coalesce(m.clicked_at, ${TS('$2')}),
           opened_at = coalesce(m.opened_at, ${TS('$2')}),
           human_clicked_at = (SELECT min(c.clicked_at) FROM ${this.t.messageClick} c
             WHERE c.message_id = m.id AND NOT c.machine),
           human_opened_at = (SELECT min(t) FROM (
             SELECT o.opened_at AS t FROM ${this.t.messageOpen} o WHERE o.message_id = m.id AND NOT o.machine
             UNION ALL
             SELECT c.clicked_at FROM ${this.t.messageClick} c WHERE c.message_id = m.id AND NOT c.machine
           ) human)
         WHERE m.id = $1`,
        [messageId, at]
      );
      return { url: link.url, engagement: click };
    });
  }

  async recordDeviceDelivered(messageId: string, at: number): Promise<boolean> {
    return this.sql.transaction(async (tx) => {
      if ((await this.lockMessage(tx, messageId)) === undefined) return false;
      const rows = await tx.query<{ id: string }>(
        `UPDATE ${this.t.message} SET device_delivered_at = coalesce(device_delivered_at, ${TS('$2')})
         WHERE id = $1 RETURNING id`,
        [messageId, at]
      );
      return rows.length > 0;
    });
  }

  async recordUnsubscribe(messageId: string, at: number): Promise<{ userId: string } | undefined> {
    return this.sql.transaction(async (tx) => {
      // The lock order of the other message-id paths (user lock, then the copy's row), so an
      // unsubscribe and an erasure never wait on each other crosswise. Not the tombstone check:
      // an opt-out is recorded whatever the user's state, on the copy as long as it is there
      await beginReadCommitted(tx);
      const owners = await tx.query<{ user_id: string }>(
        `SELECT user_id FROM ${this.t.message} WHERE id = $1 AND channel = 'email'`,
        [messageId]
      );
      const owner = owners.at(0);
      if (owner === undefined) return undefined;
      await lockUser(tx, this.schema, owner.user_id);
      // The first unsubscribe sets the time; a later one keeps it and still names the recipient
      const rows = await tx.query<{ user_id: string }>(
        `UPDATE ${this.t.message} SET unsubscribed_at = coalesce(unsubscribed_at, ${TS('$2')})
         WHERE id = $1 AND channel = 'email' RETURNING user_id`,
        [messageId, at]
      );
      const userId = rows.at(0)?.user_id;
      if (userId === undefined) return undefined;
      // The opt-out itself: the engine sends this user no more email
      await tx.query(
        `INSERT INTO ${this.t.suppression} (user_id, channel, ts) VALUES ($1, 'email', ${TS('$2')})
         ON CONFLICT DO NOTHING`,
        [userId, at]
      );
      return { userId };
    });
  }

  async snapshotSegments(at: number): Promise<{ segment: string; size: number }[]> {
    return this.sql.transaction(async (tx) => {
      // Segments no longer deployed take their members with them
      await tx.query(
        `DELETE FROM ${this.t.segmentMember} m
         WHERE NOT EXISTS (SELECT 1 FROM ${this.t.segment} s WHERE s.id = m.segment)`
      );
      const rows = await tx.query<{ segment: string; size: number | string }>(
        `INSERT INTO ${this.t.segmentSnapshot} (segment, taken_at, size)
         SELECT s.id, ${TS('$1')}, (SELECT count(*) FROM ${this.t.segmentMember} m WHERE m.segment = s.id)
         FROM ${this.t.segment} s
         ON CONFLICT DO NOTHING
         RETURNING segment, size`,
        [at]
      );
      return rows
        .map((row) => ({ segment: row.segment, size: Number(row.size) }))
        .sort((a, b) => a.segment.localeCompare(b.segment));
    });
  }
}
