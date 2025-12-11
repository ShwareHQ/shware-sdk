-- Average session duration (Stat)
select avg((properties ->> 'duration')::float8) from application.event
where
  created_at between $__timeFrom() and $__timeTo()
  and name = 'session_end'
  and environment = '$environment'
  and platform in (${platform:sqlstring})

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
