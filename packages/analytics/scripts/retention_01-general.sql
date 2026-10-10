-- D30 Retention (XY chart)
with v as (
  select id
  from application.visitor
  where
    created_at between date_trunc('month', CURRENT_DATE - INTERVAL '2 months') and $__timeTo()
    and environment = '$environment'
    and platform in (${platform:sqlstring})
    -- A bot never comes back; in the cohort it reads as churn.
    and is_bot = false
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


-- 用户留存分析（按 signup 日期构建 cohort，分析后续 30 天是否有 page_view 行为）

WITH cohort AS (
  -- 1. 获取每个用户的注册日（cohort_day）
  SELECT
    visitor_id,
    MIN(date_trunc('day', created_at)) AS cohort_day
  FROM application.event
  WHERE name = 'login' AND created_at BETWEEN date_trunc('month', CURRENT_DATE - INTERVAL '2 months') AND CURRENT_DATE
    AND environment = '$environment'
  GROUP BY visitor_id
),
events AS (
  -- 2. 获取所有 page_view 行为
  SELECT
    visitor_id,
    date_trunc('day', created_at) AS activity_day
  FROM application.event
  WHERE name = 'page_view' AND environment = '$environment'
),

joined AS (
  -- 3. Join 注册用户 + 他们的 page_view 行为（保留注册日之后）
  SELECT
    c.cohort_day,
    e.activity_day,
    c.visitor_id
  FROM cohort c
  JOIN events e ON c.visitor_id = e.visitor_id
  WHERE e.activity_day >= c.cohort_day
),

retention_raw AS (
  -- 4. 计算每个 cohort 在第 N 天的留存数量
  SELECT
    cohort_day,
    DATE_PART('day', activity_day - cohort_day) AS day_diff,
    COUNT(DISTINCT visitor_id) AS retained_users
  FROM joined
  GROUP BY cohort_day, day_diff
  HAVING DATE_PART('day', activity_day - cohort_day) < 30
),

cohort_size AS (
  -- 5. 每个 cohort 的注册用户数量
  SELECT
    cohort_day,
    COUNT(*) AS total_users
  FROM cohort
  GROUP BY cohort_day
)

-- 6. 输出每个 cohort 第 N 天的留存率
SELECT
  r.cohort_day,
  r.day_diff,
  ROUND(r.retained_users::numeric / c.total_users, 4) AS retention_rate
  -- , r.retained_users, c.total_users
FROM retention_raw r
JOIN cohort_size c ON r.cohort_day = c.cohort_day
ORDER BY r.cohort_day, r.day_diff;


-- Weekly retention by first channel (Heatmap / Table): cohort = people by the week of their first
-- session (application.user_attribution.first_seen_at), retained in week N = any session that week
-- (application.touchpoint.started_at), one row per cohort week and week N. Per person across
-- devices, so a user who switches phones is not a churn. One panel per channel: change the 'meta'
-- literal, or drop that condition for all users. Cohorts younger than N weeks have no week N yet,
-- so the lower-right of the triangle is empty rather than zero.
with cohort as (
  select ua.distinct_id, date_trunc('week', ua.first_seen_at) as cohort_week
  from application.user_attribution ua
  where
    ua.environment = '$environment'
    and ua.first_channel = 'meta' and ua.first_channel_group = 'paid_social'
    and ua.first_seen_at between date_trunc('week', $__timeFrom()::timestamptz) and $__timeTo()
),
retained as (
  select
    c.cohort_week,
    (date_trunc('week', t.started_at)::date - c.cohort_week::date) / 7 as week_n,
    count(distinct c.distinct_id) as people
  from cohort c
         join application.touchpoint t
              on t.distinct_id = c.distinct_id
                and t.environment = '$environment'
                and t.started_at >= c.cohort_week
  group by c.cohort_week, week_n
),
size as (
  select cohort_week, count(*) as people from cohort group by cohort_week
)
select
  r.cohort_week,
  r.week_n,
  s.people as cohort_size,
  r.people as retained,
  round(r.people::numeric / s.people, 4) as retention
from retained r
       join size s using (cohort_week)
where r.week_n between 0 and 12
order by r.cohort_week, r.week_n;
