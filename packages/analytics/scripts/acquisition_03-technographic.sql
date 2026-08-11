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
left join application.event e on v.id = e.visitor_id
where v.created_at between $__timeFrom() and $__timeTo()
  and v.tags ->> 'environment' = '$environment'
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
group by ver
  order by visitor_count desc
limit 20;
