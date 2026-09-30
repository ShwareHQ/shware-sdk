-- Login Rate by method
-- 1. Add field override
-- 2. Fields with name -> total_request_visitors
-- 3. Add override property -> Hide in area
-- 4. Select Viz and Legend
select
  coalesce(nullif(e.properties ->> 'method', ''), 'Unknown') as login_method,
  coalesce(
    round(
      count(distinct case when e.name = 'login' and v.id in (
        select visitor_id from application.event where name = 'login_request'
      ) then v.id end) * 100.0 /
      nullif(count(distinct case when e.name = 'login_request' then v.id end), 0),
      2
    ),
    0
  ) as success_rate_pct,
  count(distinct case when e.name = 'login_request' then v.id end) as total_request_visitors
from application.visitor v
-- Only the events counted, from the window: a visitor's events all come after it was created.
left join (
  select visitor_id, name, properties from application.event
  where name in ('login', 'login_request') and environment = '$environment' and created_at >= $__timeFrom()
) e on e.visitor_id = v.id
where v.created_at between $__timeFrom() and $__timeTo()
  and v.environment = '$environment'
  and v.platform in (${platform:sqlstring})
  and v.is_bot is not true
group by 1
order by success_rate_pct desc;

-- Visitor by version
select
  round(100.0 * count(v.id) / sum(count(v.id)) over (), 2) as percentage,
  count(v.id) as visitor_count,
  coalesce(v.tags ->> 'release', 'Unknown') as ver
from application.visitor v
where
  v.created_at between $__timeFrom() and $__timeTo()
  and v.environment = '$environment'
  and v.platform in (${platform:sqlstring})
  and v.is_bot is not true
group by ver
  order by visitor_count desc
limit 20;
