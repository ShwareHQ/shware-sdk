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
      and v.properties ->> 'environment' = '$environment'
      and v.properties ->> 'platform' in (${platform:sqlstring})
  )
group by event_name
order by event_count desc;

-- User page views (Bar chart)
select 
  e.properties ->> 'pathname' as pathname,
  count(e.id) as event_count
from application.event e
where
  e.name = 'page_view'
  and e.properties ->> 'pathname' not like '/blogs/%'
  and e.visitor_id in (
    select v.id from application.visitor v
    where
      v.created_at between $__timeFrom() and $__timeTo()
      and v.properties ->> 'environment' = '$environment'
      and v.properties ->> 'platform' in (${platform:sqlstring})
  )
group by pathname
order by event_count desc
limit 10;

-- User blog views (Bar chart)
select
  substring(e.properties ->> 'pathname' from 8) as slug,
  count(e.id) as event_count
from application.event e
where
  e.name = 'page_view'
  and e.properties ->> 'pathname' like '/blogs/%'
  and e.visitor_id in (
    select v.id from application.visitor v
    where
      v.created_at between $__timeFrom() and $__timeTo()
      and v.properties ->> 'environment' = '$environment'
      and v.properties ->> 'platform' in (${platform:sqlstring})
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
      and v.properties ->> 'environment' = '$environment'
      and v.properties ->> 'platform' in (${platform:sqlstring})
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
      and v.properties ->> 'environment' = '$environment'
      and v.properties ->> 'platform' in (${platform:sqlstring})
      and nullif(v.properties ->> 'utm_source', '') is null
      and nullif(v.properties ->> 'gad_source', '') is null
  )
group by event_name
order by event_count desc;
