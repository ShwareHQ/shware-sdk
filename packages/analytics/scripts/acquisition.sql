-- Unique visitors (Stat)
select 
  count(distinct visitor_id) as uv
from application.event
where 
  created_at between $__timeFrom() and $__timeTo()
  and name = 'page_view'
  and tags ->> 'environment' = '$environment'
  and tags ->> 'platform' in (${platform:sqlstring})

-- Page views (Stat)
select 
  count(visitor_id) as pv
from application.event
where 
  created_at between $__timeFrom() and $__timeTo()
  and name = 'page_view'
  and tags ->> 'environment' = '$environment'
  and tags ->> 'platform' in (${platform:sqlstring})

-- Feedbacks (Stat)
select count(id)
from application.feedback
where created_at between $__timeFrom() and $__timeTo()

-- PV/UV (Time series)
select 
  date_trunc('hour', created_at) as time,
  count(id) as pv,
  count(distinct visitor_id) as uv
from application.event
where
  created_at between $__timeFrom() and $__timeTo()
  and name = 'page_view'
  and tags ->> 'environment' = '$environment'
  and tags ->> 'platform' in (${platform:sqlstring})
group by time

-- Visitor by device type (Pie chart)
select 
  count(v.id) as visitor_count,
  coalesce(v.properties ->> 'device_type', 'unknown') as device_type
from application.visitor v
where 
  v.created_at between $__timeFrom() and $__timeTo()
  and v.properties ->> 'environment' = '$environment'
  and v.properties ->> 'platform' in (${platform:sqlstring})
group by device_type
order by visitor_count desc
limit 20;

-- Referral sources (Bar chart)
select 
  case
    when e.properties ->> 'referrer' is null then 'unknown'
    when e.properties ->> 'referrer' not similar to 'https?://%' then 'unknown'
    else regexp_replace(e.properties ->> 'referrer', '^https?://([^/]+).*', '\1')
  end as host,
  count(e.id) as event_count
from application.event e
where
  e.created_at between $__timeFrom() and $__timeTo()
  and e.tags ->> 'environment' = '$environment'
  and e.tags ->> 'platform' in (${platform:sqlstring})
  and e.name = 'page_view'
group by host
order by event_count desc
limit 10;

-- Visitor by country (Bar chart)
select 
  c.name as country,
  count(v.id) as visitor_count
from application.visitor v
left join application.iso_3166_country_codes c
on v.properties ->> 'country' = c.alpha2
where
  v.created_at between $__timeFrom() and $__timeTo()
group by country
order by visitor_count desc
limit 20;

-- Sources (utm_source, gad_source) (Bar chart)
select
  case
    when nullif(e.properties ->> 'utm_source', '') is not null 
      then e.properties ->> 'utm_source' || ' (utm)'
    when nullif(e.properties ->> 'gad_source', '') is not null 
      then e.properties ->> 'gad_source' || ' (gad)'
    else 'unknown'
  end as source,
  count(distinct e.visitor_id) as event_count
from application.event e
where
  e.created_at between $__timeFrom() and $__timeTo()
  and e.tags ->> 'environment' = '$environment'
  and e.tags ->> 'platform' in (${platform:sqlstring})
  and e.name = 'page_view'
group by source
order by event_count desc
limit 10;
