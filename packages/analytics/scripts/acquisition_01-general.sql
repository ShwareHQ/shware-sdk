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
  coalesce(v.tags ->> 'device_type', 'unknown') as device_type
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
on v.tags ->> 'country' = c.alpha2
where
  v.created_at between $__timeFrom() and $__timeTo()
group by country
order by visitor_count desc
limit 20;

-- Visitor by OS (Bar chart)
select
  count(v.id) as visitor_count,
  coalesce(v.tags ->> 'os_name', 'Unknown') as os_name
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
  coalesce(v.tags ->> 'browser_name', 'Unknown') as browser_name
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
  coalesce(v.tags ->> 'language', 'Unknown') as language
from application.visitor v
where
  v.created_at between $__timeFrom() and $__timeTo()
  and v.environment = '$environment'
  and v.platform in (${platform:sqlstring})
group by language
order by visitor_count desc
limit 20;

-- Channels (Bar chart): sessions that started in the window, by the channel they arrived through.
-- application.touchpoint reads each session's own landing tags (utm_source, click ids, ad landing
-- page), so a channel here is what that session actually came in on — visitor.tags would give the
-- visitor's latest touch merged over every visit.
select t.channel, count(*) as sessions, count(distinct t.person_id) as people
from application.touchpoint t
where
  t.started_at between $__timeFrom() and $__timeTo()
  and t.environment = '$environment'
  and t.platform in (${platform:sqlstring})
group by t.channel
order by sessions desc;

