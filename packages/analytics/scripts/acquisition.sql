-- Unique visitors (Stat)
select
  count(distinct visitor_id) as uv
from application.event
where
  created_at between $__timeFrom() and $__timeTo()
  and name = 'page_view'
  and environment = '$environment'
  and platform in (${platform:sqlstring});

-- Page views (Stat)
select
  count(visitor_id) as pv
from application.event
where
  created_at between $__timeFrom() and $__timeTo()
  and name = 'page_view'
  and environment = '$environment'
  and platform in (${platform:sqlstring});

-- New Users
select count(id) as total
from application.user
where created_at between $__timeFrom() and $__timeTo();

-- Registration Conversion Rate
with
u as (
  select count(id) as total
  from application.user
  where created_at between $__timeFrom() and $__timeTo()
),
v as (
  select count(id) as total
  from application.visitor
  where
    created_at between $__timeFrom() and $__timeTo()
    and environment = '$environment'
    and platform in (${platform:sqlstring})
)
select u.total::float / nullif(v.total, 0) as rate from u, v;

-- Total Revenue (Stripe)
select
  coalesce(sum((e.data_object ->> 'amount')::float / (100 * 1)), 0) as total_income
from application.stripe_event e
where
  e.type in ('charge.succeeded');

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
  and environment = '$environment'
  and platform in (${platform:sqlstring})
group by time;

-- Referral sources (Bar chart)
select
  case
    when e.properties ->> 'referrer' is null then 'unknown'
    when e.properties ->> 'referrer' not similar to 'https?://%' then 'unknown'
    else regexp_replace(e.properties ->> 'referrer', '^https?://([^/]+).*', '\1')
  end as host,
  count(distinct e.visitor_id) as event_count
from application.event e
where
  e.created_at between $__timeFrom() and $__timeTo()
  and e.environment = '$environment'
  and e.platform in (${platform:sqlstring})
  and e.name = 'page_view'
group by host
order by event_count desc
limit 10;

-- Visitor by device type (Pie chart)
select
  count(v.id) as visitor_count,
  coalesce(v.properties ->> 'device_type', 'unknown') as device_type
from application.visitor v
where
  v.created_at between $__timeFrom() and $__timeTo()
  and v.environment = '$environment'
  and v.platform in (${platform:sqlstring})
group by device_type
order by visitor_count desc
limit 20;

-- Login methods (Pie chart)
select provider, count(provider) as total
from application.user_identity
group by provider
order by total desc;

-- Visitor by country (Bar chart)
select
  c.name as country,
  count(v.id) as visitor_count
from application.visitor v
left join application.iso_3166_1 c
on v.properties ->> 'country' = c.alpha2
where
  v.created_at between $__timeFrom() and $__timeTo()
group by country
order by visitor_count desc
limit 20;

-- Visitor by OS (Bar chart)
select
  count(v.id) as visitor_count,
  coalesce(v.properties ->> 'os_name', 'Unknown') as os_name
from application.visitor v
where
  v.created_at between $__timeFrom() and $__timeTo()
  and v.environment = '$environment'
  and v.platform in (${platform:sqlstring})
group by os_name
order by visitor_count desc
limit 20;

-- Visitor by browser (Bar chart)
select
  count(v.id) as visitor_count,
  coalesce(v.properties ->> 'browser_name', 'Unknown') as browser_name
from application.visitor v
where
  v.created_at between $__timeFrom() and $__timeTo()
  and v.environment = '$environment'
  and v.platform in (${platform:sqlstring})
group by browser_name
order by visitor_count desc
limit 20;

-- Visitor by language (Bar chart)
select
  count(v.id) as visitor_count,
  coalesce(v.properties ->> 'language', 'Unknown') as language
from application.visitor v
where
  v.created_at between $__timeFrom() and $__timeTo()
  and v.environment = '$environment'
  and v.platform in (${platform:sqlstring})
group by language
order by visitor_count desc
limit 20;

-- Sources (utm_source, gad_source) (Bar chart)
select
  case
    when nullif(v.properties ->> 'utm_source', '') is not null then v.properties ->> 'utm_source' || ' (utm)'
    when nullif(v.properties ->> 'gad_source', '') is not null then v.properties ->> 'gad_source' || ' (gad)'
    else 'unknown'
  end as source,
  count(*) as event_count
from application.visitor v
where
  v.created_at between $__timeFrom() and $__timeTo()
  and v.environment = '$environment'
  and v.platform in (${platform:sqlstring})
group by source
order by event_count desc;

-- Promotions (Promotion CTR)
select 
  properties ->> 'promotion_id' as promotion_id,
  count(case when name = 'view_promotion' then 1 end) as impressions,
  count(case when name = 'select_promotion' then 1 end) as clicks,
  case 
    when count(case when name = 'view_promotion' then 1 end) = 0 then 0.00
    else round(
      count(case when name = 'select_promotion' then 1 end)::numeric / 
      count(case when name = 'view_promotion' then 1 end) * 100, 
      2
    )
  end as ctr_percentage
from 
  application.event
where 
  name in ('view_promotion', 'select_promotion')
  and created_at between $__timeFrom() and $__timeTo()
group by
  properties ->> 'promotion_id'
order by
  impressions desc;

-- Promotion Checkout Attribution (Checkouts) Bar chart
with prepared_events as (
  select
    visitor_id,
    name,
    created_at,
    properties ->> 'promotion_id' as promotion_id,
    max(case when name = 'select_promotion' then properties ->> 'promotion_id' end) over(
      partition by visitor_id 
      order by created_at 
      rows between unbounded preceding and current row
    ) as last_promotion_id
  from
    application.event
  where
    name in ('select_promotion', 'begin_checkout')
    and created_at between $__timeFrom() and $__timeTo()
)
select
  last_promotion_id as promotion_id,
  count(1) as begin_checkout_count
from
  prepared_events
where
  name = 'begin_checkout'
  and last_promotion_id is not null
group by
  last_promotion_id
order by
  begin_checkout_count desc;

-- Promotion Purchase Attribution (Purchases) Bar chart
with prepared_events as (
  select
    visitor_id,
    name,
    created_at,
    properties ->> 'promotion_id' as promotion_id,
    max(case when name = 'select_promotion' then properties ->> 'promotion_id' end) over(
      partition by visitor_id 
      order by created_at 
      rows between unbounded preceding and current row
    ) as last_promotion_id
  from
    application.event
  where
    name in ('select_promotion', 'purchase')
    and created_at between $__timeFrom() and $__timeTo()
)
select
  last_promotion_id as promotion_id,
  count(1) as purchase_count
from
  prepared_events
where
  name = 'purchase'
  and last_promotion_id is not null
group by
  last_promotion_id
order by
  purchase_count desc;

