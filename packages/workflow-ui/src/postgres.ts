import { type JourneyConfig, resolveRuntime } from '@shware/workflow';
import { DEFAULT_SCHEMA } from '@shware/workflow/store';
import postgres from 'postgres';
import {
  type Granularity,
  type MetricChannel,
  type StatsRange,
  type StatsSource,
  defineStats,
} from './config';

/**
 * `@shware/workflow-ui/postgres` — the Studio's numbers read straight from the reporting a
 * journeyWorker on Postgres keeps (the engine's schema, `database.schema` in the config). The
 * Studio runs a stats source on its dev server, never in the browser, so it connects with a real
 * connection string:
 *
 *   // workflow.stats.ts
 *   export default postgresStats({ config, connectionString: process.env.STATS_DATABASE_URL });
 *
 * Time: a fast-forwarded environment (`runtime.<environment>.timeScale`) plays a journey day out
 * in minutes, so every timestamp is read on the journey's clock — `now - (anchor - t) ×
 * timeScale`, the anchor being the latest activity — and the Studio's date ranges are mapped back
 * the same way. A local run of an hour then reads as weeks of history; production (scale 1) is
 * unchanged.
 *
 * Days: the Studio's dates are the viewer's calendar days, so buckets are cut in the same time
 * zone (this machine's by default). Cut in UTC instead, "today" east of Greenwich is an empty
 * bucket on every chart.
 */

export interface PostgresStatsOptions {
  /** The project's `workflow.config.ts`: its database schema, and the runtime's time scale. */
  config: JourneyConfig;
  connectionString: string;
  /** Which `runtime` entry the data was written under; `development` by default. */
  environment?: string;
  /** The zone the Studio's days are cut in; this machine's by default. */
  timeZone?: string;
}

/** A calendar day `count` days from a `YYYY-MM-DD` one: plain date math, no zone in it. */
const addDays = (day: string, count: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10);

/**
 * One pool per database across reloads: the dev server re-evaluates the stats module on every
 * config change, and a pool per evaluation kept its connections open until Postgres ran out.
 */
const pools = ((
  globalThis as { __workflowStatsPools?: Map<string, postgres.Sql> }
).__workflowStatsPools ??= new Map());

function pool(connectionString: string): postgres.Sql {
  let sql = pools.get(connectionString);
  if (sql === undefined) {
    sql = postgres(connectionString, { max: 4, idle_timeout: 20, fetch_types: false });
    pools.set(connectionString, sql);
  }
  return sql;
}

export function postgresStats(options: PostgresStatsOptions): StatsSource {
  const sql = pool(options.connectionString);
  const schema = options.config.database?.schema ?? DEFAULT_SCHEMA;
  /** A table of the engine's schema. */
  const t = (name: string) => sql(`${schema}.${name}`);
  const scale = resolveRuntime(
    options.config.runtime,
    options.environment ?? 'development'
  ).timeScale;
  const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  /**
   * The moment the journey clock reads "now": the latest activity in the data, so a
   * fast-forwarded run keeps reading as the history up to today however long ago it ran —
   * anchored on the real now instead, a run from last night had drifted hundreds of journey days
   * out of every range by morning. Refreshed at the start of every call; with scale 1 it is now.
   */
  let anchor = Date.now();

  async function refreshAnchor(): Promise<void> {
    if (scale === 1) {
      anchor = Date.now();
      return;
    }
    const rows = await sql<{ latest: Date | null }[]>`
      select greatest(
        (select max(sent_at) from ${t('message')}),
        (select max(node_at) from ${t('instance')}),
        (select max(finished_at) from ${t('instance')}),
        (select max(taken_at) from ${t('segment_snapshot')})
      ) as latest`;
    const row = rows.at(0);
    const latest =
      row?.latest === null || row?.latest === undefined
        ? Date.now()
        : new Date(row.latest).getTime();
    anchor = Math.min(latest, Date.now());
  }

  /** An instant on the journey's clock: `now - (anchor - t) × timeScale`. */
  const onJourneyClock = (instant: postgres.PendingQuery<postgres.Row[]>) =>
    sql`(${new Date().toISOString()}::timestamptz - (${new Date(anchor).toISOString()}::timestamptz - ${instant}) * ${scale}::float)`;
  const virtual = (column: string) => onJourneyClock(sql`${sql(column)}`);

  /** A column on the journey's clock, as a wall-clock time in the viewer's zone. */
  const local = (column: string) => sql`(${virtual(column)} at time zone ${timeZone})`;

  /** `YYYY-MM-DD` of an instant in the viewer's zone. */
  const localDate = (ms: number) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(ms);

  /** The instant a local calendar day starts. */
  function startOfLocalDay(day: string): number {
    const utcMidnight = Date.parse(`${day}T00:00:00Z`);
    // The zone's offset at that moment: how far its wall clock reads from UTC
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
        .formatToParts(utcMidnight)
        .map((part) => [part.type, part.value])
    );
    const n = (type: string) => Number(parts[type] ?? 0);
    const wall = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
    return utcMidnight - (wall - utcMidnight);
  }

  /** The real instants a virtual `YYYY-MM-DD` range (both ends inclusive, local days) covers. */
  function realRange({ from, to }: StatsRange): { from: string; to: string } {
    const now = Date.now();
    const back = (ms: number) => new Date(anchor - (now - ms) / scale).toISOString();
    // The end is the start of the next local day, not 24 hours on: a DST day is 23 or 25
    return { from: back(startOfLocalDay(from)), to: back(startOfLocalDay(addDays(to, 1))) };
  }

  /**
   * When a copy reached its recipient: the transport's acceptance for email and Android, the
   * device's own report for iOS and the web — a push APNs or a push service accepted can still
   * never arrive (the app was deleted, the device stayed off). An app version without the
   * reporting extension shows its iOS pushes undelivered.
   */
  const reached = sql`(case when m.channel in ('push_ios', 'push_web') then m.device_delivered_at else m.delivered_at end)`;

  /**
   * A converted instance: `converted_at` is set whatever the status (with `exitOnMatch: false` a
   * conversion ends `completed`); rows written before the column existed only had status `goal`.
   */
  const converted = sql`(converted_at is not null or status = 'goal')`;

  const channelFilter = (channel: MetricChannel | undefined) =>
    channel === undefined ? sql`true` : sql`m.channel = ${channel}`;

  /** The last 14 journey days, oldest first, as local `YYYY-MM-DD`. */
  function lastDays(count = 14): string[] {
    const today = localDate(Date.now());
    return Array.from({ length: count }, (_, i) => addDays(today, i - (count - 1)));
  }

  return defineStats({
    async reports() {
      await refreshAnchor();
      const totals = await sql<
        { id: string; entered: number; active: number; completed: number; converted: number }[]
      >`
        select workflow as id,
          count(*)::int as entered,
          count(*) filter (where status = 'running')::int as active,
          count(*) filter (where status in ('completed', 'exited', 'exit_when', 'goal'))::int as completed,
          count(*) filter (where ${converted})::int as converted
        from ${t('instance')} group by workflow`;
      const engagement = await sql<
        { id: string; delivered: number; opened: number; clicked: number }[]
      >`
        select workflow as id,
          count(${reached})::int as delivered,
          count(opened_at) filter (where ${reached} is not null)::int as opened,
          count(clicked_at) filter (where ${reached} is not null)::int as clicked
        from ${t('message')} m group by workflow`;
      const days = lastDays();
      const series = await sql<
        { id: string; day: string; delivered: number; opened: number; clicked: number }[]
      >`
        select workflow as id, to_char(${local('delivered_at')}, 'YYYY-MM-DD') as day,
          count(${reached})::int as delivered,
          count(opened_at) filter (where ${reached} is not null)::int as opened,
          count(clicked_at) filter (where ${reached} is not null)::int as clicked
        from ${t('message')} m where delivered_at is not null
        group by 1, 2`;
      const conversions = await sql<{ id: string; day: string; converted: number }[]>`
        select workflow as id,
          to_char(${onJourneyClock(sql`coalesce(converted_at, finished_at)`)} at time zone ${timeZone}, 'YYYY-MM-DD') as day,
          count(*)::int as converted
        from ${t('instance')} where ${converted} group by 1, 2`;
      const daily = (id: string, rows: { id: string; day: string }[], key: string) =>
        days.map(
          (day) =>
            (
              rows.find((r) => r.id === id && r.day === day) as Record<string, number> | undefined
            )?.[key] ?? 0
        );
      return totals.map((total) => {
        const e = engagement.find((row) => row.id === total.id);
        return {
          id: total.id,
          entered: total.entered,
          active: total.active,
          completed: total.completed,
          converted: total.converted,
          delivered: e?.delivered ?? 0,
          opened: e?.opened ?? 0,
          clicked: e?.clicked ?? 0,
          series: {
            delivered: daily(total.id, series, 'delivered'),
            opened: daily(total.id, series, 'opened'),
            clicked: daily(total.id, series, 'clicked'),
            converted: daily(total.id, conversions, 'converted'),
          },
        };
      });
    },

    async nodeStats(workflow) {
      await refreshAnchor();
      const rows = await sql<{ node_id: string; users: number }[]>`
        select node_id, count(*)::int as users from ${t('instance')}
        where workflow = ${workflow} and status = 'running' and node_id is not null
        group by node_id`;
      return Object.fromEntries(rows.map((row) => [row.node_id, row.users]));
    },

    async metrics(workflow, query) {
      await refreshAnchor();
      const { from, to } = realRange(query);
      const unit: Granularity = query.granularity;
      const bucket = (column: string) =>
        sql`to_char(date_trunc(${unit}, ${local(column)}), 'YYYY-MM-DD')`;
      const messages = await sql<
        {
          day: string;
          sent: number;
          delivered: number;
          opened: number;
          opened_human: number;
          clicked: number;
          clicked_human: number;
        }[]
      >`
        with m as (
          select * from ${t('message')} m
          where m.workflow = ${workflow} and ${channelFilter(query.channel)}
        ),
        events as (
          select ${bucket('sent_at')} as day, 'sent' as kind, false as human from m
            where sent_at between ${from} and ${to}
          union all select ${bucket('delivered_at')}, 'delivered', false from m
            where ${reached} is not null and delivered_at between ${from} and ${to}
          -- Opens and clicks count against the bucket the message was delivered in (its cohort),
          -- not the day they happened: the rates drawn are opened / delivered, and an open
          -- counted on another day than its delivery reads as 160% on a quiet day
          union all select ${bucket('delivered_at')}, 'opened', human_opened_at is not null from m
            where opened_at is not null and ${reached} is not null and delivered_at between ${from} and ${to}
          union all select ${bucket('delivered_at')}, 'clicked', human_clicked_at is not null from m
            where clicked_at is not null and ${reached} is not null and delivered_at between ${from} and ${to}
        )
        select day,
          count(*) filter (where kind = 'sent')::int as sent,
          count(*) filter (where kind = 'delivered')::int as delivered,
          count(*) filter (where kind = 'opened')::int as opened,
          count(*) filter (where kind = 'opened' and human)::int as opened_human,
          count(*) filter (where kind = 'clicked')::int as clicked,
          count(*) filter (where kind = 'clicked' and human)::int as clicked_human
        from events group by day`;
      // Users by the bucket they entered in, and how many of each cohort reached the goal: the
      // conversion rate is a share of one group of people, so it stays within 100%
      const cohorts = await sql<{ day: string; entered: number; converted: number }[]>`
        select ${bucket('entered_at')} as day, count(*)::int as entered,
          count(*) filter (where ${converted})::int as converted
        from ${t('instance')}
        where workflow = ${workflow} and entered_at between ${from} and ${to}
        group by 1`;
      const buckets = await sql<{ day: string }[]>`
        select to_char(d, 'YYYY-MM-DD') as day
        from generate_series(date_trunc(${unit}, ${query.from}::date), ${query.to}::date, ${`1 ${unit}`}::interval) d`;
      return buckets.map(({ day }) => {
        const m = messages.find((row) => row.day === day);
        const opened = m?.opened ?? 0;
        const clicked = m?.clicked ?? 0;
        const cohort = cohorts.find((row) => row.day === day);
        return {
          date: day,
          sent: m?.sent ?? 0,
          delivered: m?.delivered ?? 0,
          opened,
          openedHuman: m?.opened_human ?? 0,
          openedMachine: opened - (m?.opened_human ?? 0),
          clicked,
          clickedHuman: m?.clicked_human ?? 0,
          clickedMachine: clicked - (m?.clicked_human ?? 0),
          entered: cohort?.entered ?? 0,
          converted: cohort?.converted ?? 0,
        };
      });
    },

    async links(workflow, query) {
      await refreshAnchor();
      const { from, to } = realRange(query);
      return sql<{ url: string; clicks: number }[]>`
        select c.url, count(*)::int as clicks
        from ${t('message_click')} c
        join ${t('message')} m on m.id = c.message_id
        where m.workflow = ${workflow} and ${channelFilter(query.channel)}
          and c.clicked_at between ${from} and ${to}
          -- People's clicks only: a scanner follows every link, the footer's included
          and not c.machine
        group by c.url order by clicks desc limit 50`;
    },

    async messages(workflow, query) {
      await refreshAnchor();
      const { from, to } = realRange(query);
      return sql<
        {
          nodeId: string;
          template: string;
          channel: MetricChannel;
          sent: number;
          delivered: number;
          opened: number;
          clicked: number;
          unsubscribed: number;
        }[]
      >`
        select node_id as "nodeId", template, channel,
          count(*)::int as sent,
          count(${reached})::int as delivered,
          count(opened_at) filter (where ${reached} is not null)::int as opened,
          count(clicked_at) filter (where ${reached} is not null)::int as clicked,
          count(unsubscribed_at)::int as unsubscribed
        from ${t('message')} m
        where m.workflow = ${workflow} and ${channelFilter(query.channel)}
          and m.sent_at between ${from} and ${to}
        group by node_id, template, channel order by node_id, channel`;
    },

    async segments() {
      await refreshAnchor();
      const sizes = await sql<{ id: string; size: number }[]>`
        select s.id, count(m.user_id)::int as size
        from ${t('segment')} s
        left join ${t('segment_member')} m on m.segment = s.id
        group by s.id`;
      const days = lastDays();
      // The last snapshot of each journey day
      const snapshots = await sql<{ id: string; day: string; size: number }[]>`
        select distinct on (segment, day) segment as id, day, size from (
          select segment, size, taken_at, to_char(${local('taken_at')}, 'YYYY-MM-DD') as day
          from ${t('segment_snapshot')}
        ) s order by segment, day, taken_at desc`;
      return sizes.map(({ id, size }) => {
        let last = 0;
        const series = days.map((day) => {
          last = snapshots.find((s) => s.id === id && s.day === day)?.size ?? last;
          return last;
        });
        return { id, size, series };
      });
    },

    async profiles(segment, { limit, offset }) {
      await refreshAnchor();
      const counts = await sql<{ total: number }[]>`
        select count(*)::int as total from ${t('segment_member')} where segment = ${segment}`;
      const count = counts.at(0);
      // "Created" is the user's first event: the engine knows nothing older about them
      const rows = await sql<
        { id: string; props: Record<string, unknown> | null; created_at: Date | null }[]
      >`
        select m.user_id as id, p.props,
          ${onJourneyClock(sql`first_event.ts`)} as created_at
        from ${t('segment_member')} m
        left join ${t('profile')} p on p.user_id = m.user_id
        left join lateral (
          select min(ts) as ts from ${t('event')} e where e.user_id = m.user_id
        ) first_event on true
        where m.segment = ${segment}
        order by m.ts desc, m.user_id
        limit ${limit} offset ${offset}`;
      return {
        total: count?.total ?? 0,
        profiles: rows.map(({ id, props, created_at }) => {
          const { email, ...properties } = props ?? {};
          const profile: { id: string; email?: string; createdAt?: string } & {
            properties: Record<string, unknown>;
          } = { id, properties };
          if (typeof email === 'string') profile.email = email;
          if (created_at !== null) profile.createdAt = new Date(created_at).toISOString();
          return profile;
        }),
      };
    },
  });
}
