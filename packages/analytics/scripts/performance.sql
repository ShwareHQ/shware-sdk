-- CLS (Bar chart)
select 
  count(distinct e.properties ->> 'id') as total,
  e.properties ->> 'rating' as rating
from application.event e
where
  e.created_at between $__timeFrom() and $__timeTo()
  and e.tags ->> 'environment' = '$environment'
  and e.tags ->> 'platform' in (${platform:sqlstring})
  and e.name = 'CLS'
group by rating
limit 10;

-- FCP (Bar chart)
select 
  count(distinct e.properties ->> 'id') as total,
  e.properties ->> 'rating' as rating
from application.event e
where
  e.created_at between $__timeFrom() and $__timeTo()
  and e.tags ->> 'environment' = '$environment'
  and e.tags ->> 'platform' in (${platform:sqlstring})
  and e.name = 'FCP'
group by rating
limit 10;

-- LCP (Bar chart)
select 
  count(distinct e.properties ->> 'id') as total,
  e.properties ->> 'rating' as rating
from application.event e
where
  e.created_at between $__timeFrom() and $__timeTo()
  and e.tags ->> 'environment' = '$environment'
  and e.tags ->> 'platform' in (${platform:sqlstring})
  and e.name = 'LCP'
group by rating
limit 10;

-- TTFB (Bar chart)
select 
  count(distinct e.properties ->> 'id') as total,
  e.properties ->> 'rating' as rating
from application.event e
where
  e.created_at between $__timeFrom() and $__timeTo()
  and e.tags ->> 'environment' = '$environment'
  and e.tags ->> 'platform' in (${platform:sqlstring})
  and e.name = 'TTFB'
group by rating
limit 10;

-- FID (Bar chart)
select 
  count(distinct e.properties ->> 'id') as total,
  e.properties ->> 'rating' as rating
from application.event e
where
  e.created_at between $__timeFrom() and $__timeTo()
  and e.tags ->> 'environment' = '$environment'
  and e.tags ->> 'platform' in (${platform:sqlstring})
  and e.name = 'FID'
group by rating
limit 10;

-- INP (Bar chart)
select 
  count(distinct e.properties ->> 'id') as total,
  e.properties ->> 'rating' as rating
from application.event e
where
  e.created_at between $__timeFrom() and $__timeTo()
  and e.tags ->> 'environment' = '$environment'
  and e.tags ->> 'platform' in (${platform:sqlstring})
  and e.name = 'INP'
group by rating
limit 10;

-- Event QPS (Time series)
with time_series as (
  select
    generate_series(
      date_trunc('second', to_timestamp($__unixEpochFrom())),
      date_trunc('second', to_timestamp($__unixEpochTo())),
      '1 second'::interval
    ) as time_point
),
event_counts as (
  select
    date_trunc('second', created_at) as time_point,
    count(*) as event_count
  from application.event
  where created_at between $__timeFrom() and $__timeTo()
  group by date_trunc('second', created_at)
)
select
  t.time_point,
  coalesce(e.event_count, 0) as qps
from time_series t
left join event_counts e
on t.time_point = e.time_point
order by t.time_point;
