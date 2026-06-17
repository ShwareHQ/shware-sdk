-- Activation Rate by browser
-- 1. Add field override
-- 2. Fields with name -> total_visitors
-- 3. Add override property -> Hide in area
-- 4. Select Viz and Legend
select
  coalesce(nullif(v.properties ->> 'browser_name', ''), 'Unknown') as browser,
  round(
    count(distinct case when e.name = 'image_task_completed' then v.id end) * 100.0 /
      nullif(count(distinct v.id), 0),
      2
    ) as activation_rate_pct,
  count(distinct v.id) as total_visitors
from application.visitor v
left join application.event e on v.id = e.visitor_id
where v.created_at between $__timeFrom() and $__timeTo()
  and v.properties ->> 'environment' = '$environment'
group by 1
order by activation_rate_pct desc limit 10;

-- Login Rate by browser
-- 1. Add field override
-- 2. Fields with name -> total_visitors
-- 3. Add override property -> Hide in area
-- 4. Select Viz and Legend
select
  coalesce(nullif(v.properties ->> 'browser_name', ''), 'Unknown') as browser,
  round(
    count(distinct case when e.name = 'login' then v.id end) * 100.0 /
    nullif(count(distinct v.id), 0),
    2
  ) as registration_rate_pct,
  count(distinct v.id) as total_visitors
from application.visitor v
left join application.event e on v.id = e.visitor_id
where v.created_at between $__timeFrom() and $__timeTo()
  and v.properties ->> 'environment' = '$environment'
group by 1
order by registration_rate_pct desc limit 10;

-- Purchase Rate by browser
-- 1. Add field override
-- 2. Fields with name -> total_login_visitors
-- 3. Add override property -> Hide in area
-- 4. Select Viz and Legend
select
  coalesce(nullif(v.properties ->> 'browser_name', ''), 'Unknown') as browser,
  coalesce(
    round(
      count(distinct case when e.name = 'purchase' then v.id end) * 100.0 /
      nullif(count(distinct case when e.name = 'login' then v.id end), 0),
      2
    ),
    0
  ) as purchase_rate_pct,
  count(distinct case when e.name = 'login' then v.id end) as total_login_visitors
from application.visitor v
left join application.event e on v.id = e.visitor_id
where v.created_at between $__timeFrom() and $__timeTo()
  and v.properties ->> 'environment' = '$environment'
group by 1
order by purchase_rate_pct desc limit 10;
