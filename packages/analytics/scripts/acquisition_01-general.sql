-- Bots (visitor.is_bot, from @shware/analytics botOf) are left out of every visitor and page view
-- count here; see acquisition_06-bots.sql for them.

-- Unique visitors (Stat)
select
  count(distinct visitor_id) as uv
from application.event
where
  created_at between $__timeFrom() and $__timeTo()
  and name = 'page_view'
  and environment = '$environment'
  and platform in (${platform:sqlstring})
  and not exists (select 1 from application.visitor b where b.id = event.visitor_id and b.is_bot);

-- Page views (Stat)
select
  count(visitor_id) as pv
from application.event
where
  created_at between $__timeFrom() and $__timeTo()
  and name = 'page_view'
  and environment = '$environment'
  and platform in (${platform:sqlstring})
  and not exists (select 1 from application.visitor b where b.id = event.visitor_id and b.is_bot);

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
    and is_bot is not true
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

-- PV/UV (Time series): page views and unique visitors per day, per hour when the dashboard
-- window is a day or less. UV is not additive — a visitor active in five hours counts in five
-- hourly buckets — so hourly UV is for a day's shape, not a daily figure. Days are UTC days; pass
-- a time zone as date_trunc's third argument to cut them at local midnight.
select
  date_trunc(
    case when $__timeTo()::timestamptz - $__timeFrom()::timestamptz <= interval '1 day' then 'hour' else 'day' end,
    created_at
  ) as time,
  count(id) as pv,
  count(distinct visitor_id) as uv
from application.event
where
  $__timeFilter(created_at)
  and name = 'page_view'
  and environment = '$environment'
  and platform in (${platform:sqlstring})
  and not exists (select 1 from application.visitor b where b.id = event.visitor_id and b.is_bot)
group by 1
order by 1;

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
  and not exists (select 1 from application.visitor b where b.id = e.visitor_id and b.is_bot)
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
  and v.is_bot is not true
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
  and v.is_bot is not true
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
  and v.is_bot is not true
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
  and v.is_bot is not true
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
  and v.is_bot is not true
group by language
order by visitor_count desc
limit 20;

-- Channels (Bar chart): sessions that started in the window, by GA4 channel group and the channel
-- inside it — google / cpc and google / organic are two rows.
-- application.touchpoint reads each session's own landing tags (utm_source, click ids, ad landing
-- page), so a channel here is what that session actually came in on — visitor.tags would give the
-- visitor's latest touch merged over every visit.
select t.channel_group, t.channel, count(*) as sessions, count(distinct t.distinct_id) as people
from application.touchpoint t
where
  t.started_at between $__timeFrom() and $__timeTo()
  and t.environment = '$environment'
  and t.platform in (${platform:sqlstring})
group by t.channel_group, t.channel
order by sessions desc;


-- New users by first channel (Bar chart): people whose first session started in the window, by
-- the channel they were first acquired through. application.user_attribution is one row per
-- person (distinct_id, across devices); first_channel is the earliest session that arrived
-- through something, so a person whose first session was direct and who came back through an
-- ad later still counts for that channel; (direct) is a person who never did. This is the
-- user-level view GA4 calls "user acquisition"; the Channels chart above counts sessions.
-- No platform filter: a person is not on one platform.
select ua.first_channel_group, ua.first_channel, count(*) as people
from application.user_attribution ua
where
  ua.first_seen_at between $__timeFrom() and $__timeTo()
  and ua.environment = '$environment'
group by ua.first_channel_group, ua.first_channel
order by people desc;
