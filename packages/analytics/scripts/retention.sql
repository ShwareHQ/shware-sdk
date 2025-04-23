-- D30 Retention (XY chart)
with v as (
  select id
  from application.visitor
  where
    created_at between date_trunc('month', CURRENT_DATE - INTERVAL '2 months') and $__timeTo()
    and properties ->> 'environment' = '$environment'
    and properties ->> 'platform' in (${platform:sqlstring})
),
r as (
  select
    e.visitor_id as visitor_id,
    date_trunc('day', e.created_at) as activity_day
  from application.event e
  join v on e.visitor_id = v.id
  where
    e.name = 'page_view'
  group by visitor_id, activity_day
  order by visitor_id desc, activity_day asc
),
f as (
  select 
    r.visitor_id as visitor_id,
    min(r.activity_day) as start_day
  from r
  group by visitor_id
),
l as (
  select
    count(r.visitor_id) as total,
    date(r.activity_day) - date(f.start_day) + 1 as days
  from r
  join f on r.visitor_id = f.visitor_id
  group by days
  order by days asc
),
t as (
  select count(distinct r.visitor_id) as total from r
)
select 
  l.total::float / t.total as rate,
  l.days as days
from l, t
where l.days < 30
order by days asc;
