-- Average engagement time (Stat)
with sessions as (
  select session_id from application.event
  where 
    name = 'session_start'
    and created_at between $__timeFrom() and $__timeTo()
    and environment = '$environment'
    and platform in (${platform:sqlstring})
),
durations as (
  select sum(coalesce((properties ->> 'engagement_time_msec')::float8, 0)) / 1000 as duration
  from application.event e
  inner join sessions s on e.session_id = s.session_id
  where e.name in ('scroll', 'page_view', 'user_engagement')
  group by e.session_id
)
select avg(duration) from durations;

-- time to value (bar chart with group by weeks), event_name=ping
with session_events as (
  select
    visitor_id,
    min(case when name = 'session_start' then created_at end) as session_start_time,
    min(case when name = 'ping' then created_at end) as value_event_time
  from application.event
  where
    name in ('session_start', 'ping')
    and created_at >= now() - interval '7 weeks'
  group by visitor_id
  having
    min(case when name = 'session_start' then created_at end) is not null 
    and min(case when name = 'ping' then created_at end) is not null
),
time_to_value as (
  select
    extract(epoch from (value_event_time - session_start_time)) as ttv_seconds,
    date_trunc('week', session_start_time) as week_start
  from session_events
  where value_event_time > session_start_time
),
ttv_buckets as (
  select 
    week_start,
    ttv_seconds,
    ntile(4) over (partition by week_start order by ttv_seconds) as quartile
  from time_to_value
)
-- pivot: transform metric to column
select
  week_start as time,
  -- avg
  -- avg(case when quartile = 1 then ttv_seconds end) as "0-25%",
  -- avg(case when quartile = 2 then ttv_seconds end) as "25-50%",
  -- avg(case when quartile = 3 then ttv_seconds end) as "50-75%",
  -- avg(case when quartile = 4 then ttv_seconds end) as "75-100%"

  -- count
  -- count(case when quartile = 1 then ttv_seconds end) as "0-25%",
  -- count(case when quartile = 2 then ttv_seconds end) as "25-50%",
  -- count(case when quartile = 3 then ttv_seconds end) as "50-75%",
  -- count(case when quartile = 4 then ttv_seconds end) as "75-100%"

  -- median
  percentile_cont(0.5) within group (order by case when quartile = 1 then ttv_seconds end) as "0-25%",
  percentile_cont(0.5) within group (order by case when quartile = 2 then ttv_seconds end) as "25-50%",
  percentile_cont(0.5) within group (order by case when quartile = 3 then ttv_seconds end) as "50-75%",
  percentile_cont(0.5) within group (order by case when quartile = 4 then ttv_seconds end) as "75-100%"
from ttv_buckets
group by week_start
order by week_start;

-- User funnel (Bar chart)
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
  and e.visitor_id in (
    select v.id from application.visitor v
    where
      v.created_at between $__timeFrom() and $__timeTo()
      and v.environment = '$environment'
      and v.platform in (${platform:sqlstring})
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
  and e.properties ->> 'page_path' not like '/blogs/%'
  and e.visitor_id in (
    select v.id from application.visitor v
    where
      v.created_at between $__timeFrom() and $__timeTo()
      and v.environment = '$environment'
      and v.platform in (${platform:sqlstring})
  )
group by page_path
order by event_count desc
limit 10;

-- User blog views (Bar chart)
select
  substring(e.properties ->> 'page_path' from 8) as slug,
  count(e.id) as event_count
from application.event e
where
  e.name = 'page_view'
  and e.properties ->> 'page_path' like '/blog/%'
  and e.visitor_id in (
    select v.id from application.visitor v
    where
      v.created_at between $__timeFrom() and $__timeTo()
      and v.environment = '$environment'
      and v.platform in (${platform:sqlstring})
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
  and e.visitor_id in (
    select v.id from application.visitor v
    where
      v.created_at between $__timeFrom() and $__timeTo()
      and v.environment = '$environment'
      and v.platform in (${platform:sqlstring})
      and v.properties ->> 'utm_source' = 'x'
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
  and e.visitor_id in (
    select v.id from application.visitor v
    where
      v.created_at between $__timeFrom() and $__timeTo()
      and v.environment = '$environment'
      and v.platform in (${platform:sqlstring})
      and nullif(v.properties ->> 'utm_source', '') is null
      and nullif(v.properties ->> 'gad_source', '') is null
  )
group by event_name
order by event_count desc;
