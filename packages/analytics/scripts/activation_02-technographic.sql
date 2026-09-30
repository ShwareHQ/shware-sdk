-- Activation Rate by browser
-- 1. Add field override
-- 2. Fields with name -> total_visitors
-- 3. Add override property -> Hide in area
-- 4. Select Viz and Legend
select
  coalesce(nullif(v.tags ->> 'browser_name', ''), 'Unknown') as browser,
  round(
    count(distinct case when e.name = 'image_task_completed' then v.id end) * 100.0 /
      nullif(count(distinct v.id), 0),
      2
    ) as activation_rate_pct,
  count(distinct v.id) as total_visitors
from application.visitor v
-- Only the events counted, from the window: a visitor's events all come after it was created.
left join (
  select visitor_id, name from application.event
  where name in ('image_task_completed') and environment = '$environment' and created_at >= $__timeFrom()
) e on e.visitor_id = v.id
where v.created_at between $__timeFrom() and $__timeTo()
  and v.environment = '$environment'
  and v.platform in (${platform:sqlstring})
  and v.is_bot is not true
group by 1
order by activation_rate_pct desc limit 10;

-- Login Rate by browser
-- 1. Add field override
-- 2. Fields with name -> total_visitors
-- 3. Add override property -> Hide in area
-- 4. Select Viz and Legend
select
  coalesce(nullif(v.tags ->> 'browser_name', ''), 'Unknown') as browser,
  round(
    count(distinct case when e.name = 'login' then v.id end) * 100.0 /
    nullif(count(distinct v.id), 0),
    2
  ) as registration_rate_pct,
  count(distinct v.id) as total_visitors
from application.visitor v
-- Only the events counted, from the window: a visitor's events all come after it was created.
left join (
  select visitor_id, name from application.event
  where name in ('login') and environment = '$environment' and created_at >= $__timeFrom()
) e on e.visitor_id = v.id
where v.created_at between $__timeFrom() and $__timeTo()
  and v.environment = '$environment'
  and v.platform in (${platform:sqlstring})
  and v.is_bot is not true
group by 1
order by registration_rate_pct desc limit 10;

-- Purchase Rate by browser
-- 1. Add field override
-- 2. Fields with name -> total_login_visitors
-- 3. Add override property -> Hide in area
-- 4. Select Viz and Legend
select
  coalesce(nullif(v.tags ->> 'browser_name', ''), 'Unknown') as browser,
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
-- Only the events counted, from the window: a visitor's events all come after it was created.
left join (
  select visitor_id, name from application.event
  where name in ('purchase', 'login') and environment = '$environment' and created_at >= $__timeFrom()
) e on e.visitor_id = v.id
where v.created_at between $__timeFrom() and $__timeTo()
  and v.environment = '$environment'
  and v.platform in (${platform:sqlstring})
  and v.is_bot is not true
group by 1
order by purchase_rate_pct desc limit 10;
