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
  e.created_at between $__timeFrom() and $__timeTo()
  and e.tags ->> 'environment' = '$environment'
  and e.tags ->> 'platform' in (${platform:sqlstring})
  and e.name = 'page_view'
group by pathname
order by event_count desc
limit 10;
