-- Average engagement time (Stat)
with sessions as (
  select session_id from application.event
  where 
    name = 'session_start'
    and created_at between $__timeFrom() and $__timeTo()
    and environment = '$environment'
    and platform in (${platform:sqlstring})
    -- A bot's session lasts no time and would pull the average down.
    and not exists (select 1 from application.visitor b where b.id = event.visitor_id and b.is_bot)
),
durations as (
  select sum(coalesce((properties ->> 'engagement_time_msec')::float8, 0)) / 1000 as duration
  from application.event e
  inner join sessions s on e.session_id = s.session_id
  where e.name in ('scroll', 'page_view', 'user_engagement')
  group by e.session_id
)
select avg(duration) from durations;

-- Time to value (Time series, format Time series). New people by the week of their first visit,
-- one per person across devices, and how fast they reached value: the median minutes to the value
-- event for those who got there within 7 days, and the share that got there within 7 days. Read
-- the two together: the minutes say how fast the people who get there are, the share how many get
-- there — a flat median over a falling share is more people giving up before value, not a faster
-- product. Panel: unit m (minutes); the "reached value in 7 days" series unit percent on the right
-- axis, dashed; the "newcomers" series hidden from the graph and the legend, kept in the tooltip.
--
-- Replaces the per-visitor version, which took the first session in the 7 weeks as the start (a
-- returning user's later value event read as a newcomer's), counted devices rather than people,
-- only saw the people who reached value, and split each week into quartiles whose medians read as
-- the 12.5th / 37.5th / 62.5th / 87.5th percentiles.
with newcomers as (
  -- A person is new in the window when none of their visitors existed before it. Whole weeks
  -- only, and only weeks whose last newcomer has had 7 days, so the newest week is not read low.
  -- Keeping only the people with a visitor on $platform is a cheap cut before the lateral below.
  select v.distinct_id
  from application.visitor v
  where v.environment = '$environment'
  group by 1
  having min(v.created_at) between $__timeFrom()
      and least($__timeTo()::timestamptz, date_trunc('week', now() - interval '7 days'))
    and bool_or(v.platform in (${platform:sqlstring}))
    -- A bot is nobody's first visit (visitor.is_bot, judged by @shware/analytics botOf).
    and bool_and(v.is_bot = false)
), people as (
  -- The person's first session across devices, and what brought them. $platform keeps the people
  -- who started there: on web, the ones whose very first session was on web.
  select n.distinct_id, fs.started_at as first_seen
  from newcomers n
  cross join lateral (
    select s.started_at, s.platform, s.channel, s.medium, s.channel_group
    from application.visitor v
    join application.analytics_session s on s.visitor_id = v.id
    where v.distinct_id = n.distinct_id
    order by s.started_at
    limit 1
  ) fs
  where fs.platform in (${platform:sqlstring})
    and fs.started_at < date_trunc('week', now() - interval '7 days')
), ttv as (
  select date_trunc('week', p.first_seen) as week,
    extract(epoch from fv.at - p.first_seen) / 60 as minutes,
    fv.at is not null and fv.at < p.first_seen + interval '7 days' as reached
  from people p
  cross join lateral (
    -- The value event: the first time the person does what the product is for. Change 'ping' to
    -- yours (a first completed render, a first export, a first sent message, ...). On $platform
    -- too: web alone is the web experience, a web newcomer who gets there in the app is not counted;
    -- all platforms together is the cross-device TTV, web -> app included.
    select min(e.created_at) as at
    from application.visitor v
    join application.event e on e.visitor_id = v.id
      and e.name = 'ping' and e.environment = '$environment'
      and e.platform in (${platform:sqlstring})
    where v.distinct_id = p.distinct_id
  ) fv
)
select week as time,
  percentile_cont(0.5) within group (order by minutes) filter (where reached) as "median minutes",
  round(100.0 * avg(reached::int), 1) as "reached value in 7 days",
  count(*) as "newcomers"
from ttv
group by 1
order by 1;

-- User funnel (Bar chart): people whose first session started in the window — newcomers, one
-- per person across devices (application.touchpoint's distinct_id) — and how many of them did each
-- step within 30 days of that first session. The previous version counted visitors, one per
-- device, and every later event forever; the 30 days make periods comparable and bound the scan.
-- Unordered on purpose: the steps are not one forced path, so read each bar against the first
-- one, not against the bar before it. Finding each person's first session reads every session
-- of the environment; fine at dashboard scale, a person-level view would replace it later.
with first_session as (
  select distinct on (t.distinct_id) t.distinct_id, t.started_at, t.platform
  from application.touchpoint t
  where t.environment = '$environment'
  order by t.distinct_id, t.started_at
),
newcomers as (
  select distinct_id, started_at
  from first_session
  where started_at between $__timeFrom() and $__timeTo()
    and platform in (${platform:sqlstring})
)
select
  e.name as event_name,
  count(distinct n.distinct_id) as event_count
from newcomers n
       join application.touchpoint t
            on t.distinct_id = n.distinct_id
              and t.environment = '$environment'
              and t.started_at between n.started_at and n.started_at + interval '30 days'
       join application.event e on e.session_id = t.session_id
where e.name in (
  'page_view',
  'cta_button_clicked',
  'login',
  'begin_checkout',
  'purchase'
)
group by event_name
order by event_count desc;

-- User referrer
select
    case
        when e.properties ->> 'page_referrer' is null then 'unknown'
        when e.properties ->> 'page_referrer' not similar to 'https?://%' then 'unknown'
        else regexp_replace(e.properties ->> 'page_referrer', '^https?://([^/]+).*', '\1')
        end as host,
    count(e.id) as event_count
from application.event e
where
    e.created_at between $__timeFrom() and $__timeTo()
  and e.environment = '$environment'
  and e.platform in (${platform:sqlstring})
  and e.name = 'page_view'
  and not exists (select 1 from application.visitor b where b.id = e.visitor_id and b.is_bot)
group by host
order by event_count desc
limit 10;

-- User page views (Bar chart)
select
  e.properties ->> 'page_path' as page_path,
  count(e.id) as event_count
from application.event e
where
  e.name = 'page_view'
  and e.properties ->> 'page_path' not like '/blog/%'
  -- A visitor's events come after it was created (a day of slack for client clocks): bounds the scan.
  and e.created_at >= $__timeFrom()::timestamptz - interval '1 day'
  and e.visitor_id in (
    select v.id from application.visitor v
    where
      v.created_at between $__timeFrom() and $__timeTo()
      and v.environment = '$environment'
      and v.platform in (${platform:sqlstring})
      and v.is_bot = false
  )
group by page_path
order by event_count desc
limit 10;

-- User blog views (Bar chart)
select
  substring(e.properties ->> 'page_path' from 7) as slug,
  count(e.id) as event_count
from application.event e
where
  e.name = 'page_view'
  and e.properties ->> 'page_path' like '/blog/%'
  -- A visitor's events come after it was created (a day of slack for client clocks): bounds the scan.
  and e.created_at >= $__timeFrom()::timestamptz - interval '1 day'
  and e.visitor_id in (
    select v.id from application.visitor v
    where
      v.created_at between $__timeFrom() and $__timeTo()
      and v.environment = '$environment'
      and v.platform in (${platform:sqlstring})
      and v.is_bot = false
  )
group by slug
order by event_count desc
limit 10;

-- User funnel by (utm_source=x) (Bar chart)
select
  e.name as event_name,
  count(distinct e.visitor_id) as event_count
from application.event e
where
  e.name in (
    'page_view',
    'cta_button_clicked',
    'login',
    'begin_checkout',
    'purchase'
  )
  -- A visitor's events come after it was created (a day of slack for client clocks): bounds the scan.
  and e.created_at >= $__timeFrom()::timestamptz - interval '1 day'
  and e.visitor_id in (
    select v.id from application.visitor v
    where
      v.created_at between $__timeFrom() and $__timeTo()
      and v.environment = '$environment'
      and v.platform in (${platform:sqlstring})
      and v.is_bot = false
      and v.tags ->> 'utm_source' = 'x'
  )
group by event_name
order by event_count desc;

-- User funnel by (unknown) (Bar chart)
select
  e.name as event_name,
  count(distinct e.visitor_id) as event_count
from application.event e
where
  e.name in (
    'page_view',
    'cta_button_clicked',
    'login',
    'begin_checkout',
    'purchase'
  )
  -- A visitor's events come after it was created (a day of slack for client clocks): bounds the scan.
  and e.created_at >= $__timeFrom()::timestamptz - interval '1 day'
  and e.visitor_id in (
    select v.id from application.visitor v
    where
      v.created_at between $__timeFrom() and $__timeTo()
      and v.environment = '$environment'
      and v.platform in (${platform:sqlstring})
      and v.is_bot = false
      and nullif(v.tags ->> 'utm_source', '') is null
      and nullif(v.tags ->> 'gad_source', '') is null
  )
group by event_name
order by event_count desc;
