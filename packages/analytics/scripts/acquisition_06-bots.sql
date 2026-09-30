-- Bots: visitors judged automated by @shware/analytics botOf when they were created, from the
-- request's user agent and navigator.webdriver (visitor.is_bot / bot_name / bot_category). Web
-- only: a native visitor is never a bot. They stay in the tables; the touchpoint view, and so
-- attribution and user_attribution, leaves them out. To keep them out of a panel that reads
-- visitor, add `and v.is_bot = false`; one that reads only event or analytics_session:
--   and not exists (select 1 from application.visitor b where b.id = e.visitor_id and b.is_bot)
-- Only bots that run JavaScript create a visitor; crawlers that do not are in the server logs.

-- Bot share of new visitors (Stat, percent)
select round(100.0 * count(*) filter (where is_bot) / nullif(count(*), 0), 1) as bot_pct
from application.visitor
where environment = '$environment' and platform = 'web'
  and created_at between $__timeFrom() and $__timeTo();

-- New bot visitors (Stat)
select count(*) as bot_visitors
from application.visitor
where environment = '$environment' and platform = 'web' and is_bot
  and created_at between $__timeFrom() and $__timeTo();

-- Bot visitors by category over time (Time series, format: time series, bars stacked)
select $__timeGroupAlias(created_at, '1d'), bot_category as metric, count(*) as visitors
from application.visitor
where environment = '$environment' and platform = 'web' and is_bot
  and created_at between $__timeFrom() and $__timeTo()
group by 1, 2 order by 1;

-- Bot visitors by category (Bar chart)
select bot_category, count(*) as visitors
from application.visitor
where environment = '$environment' and platform = 'web' and is_bot
  and created_at between $__timeFrom() and $__timeTo()
group by 1 order by 2 desc;

-- Bot sessions by channel group (Table): what the touchpoint view leaves out, and their share of
-- each group's sessions. Crawlers without a referrer land in direct; ad review bots follow ad
-- links into the paid groups.
select s.channel_group, count(*) as bot_sessions,
  round(100.0 * count(*) / nullif((select count(*) from application.analytics_session a
    where a.environment = '$environment' and a.platform = 'web' and a.channel_group = s.channel_group
      and a.started_at between $__timeFrom() and $__timeTo()), 0), 1) as pct_of_group
from application.analytics_session s
join application.visitor v on v.id = s.visitor_id and v.is_bot
where s.environment = '$environment' and s.platform = 'web'
  and s.started_at between $__timeFrom() and $__timeTo()
group by 1 order by 2 desc;

-- Unnamed bots (Table): filed as other or no_user_agent, automated by the generic pattern but not
-- in the named table. Candidates for a named entry in @shware/analytics, or a person misread.
select bot_name, count(*) as visitors, max(created_at) as last_seen
from application.visitor
where environment = '$environment' and platform = 'web' and is_bot and bot_category in ('other', 'no_user_agent')
  and created_at between $__timeFrom() and $__timeTo()
group by 1 order by 2 desc limit 30;

-- Top bots (Table): name, category, visitors, and the page views they loaded. Page views are
-- aggregated before the join; a correlated count per visitor is ten times slower.
with v as (
  select id, bot_name, bot_category, created_at
  from application.visitor
  where environment = '$environment' and platform = 'web' and is_bot
    and created_at between $__timeFrom() and $__timeTo()
), pv as (
  select e.visitor_id, count(*) as page_views
  from application.event e
  where e.name = 'page_view' and e.environment = '$environment' and e.platform = 'web'
    and e.created_at >= $__timeFrom() and e.visitor_id in (select id from v)
  group by 1
)
select v.bot_name, v.bot_category, count(*) as visitors, coalesce(sum(pv.page_views), 0) as page_views, max(v.created_at) as last_seen
from v left join pv on pv.visitor_id = v.id
group by 1, 2 order by 3 desc limit 30;

-- Pages AI bots loaded (Table): what training crawlers, AI search indexes and assistants read.
-- Paths only, without host, query string or fragment.
select regexp_replace(split_part(split_part(e.tags ->> 'page_location', '?', 1), '#', 1), '^https?://[^/]+', '') as page,
  v.bot_category, count(*) as page_views, count(distinct v.bot_name) as bots,
  string_agg(distinct v.bot_name, ', ') as bot_names
from application.event e
join application.visitor v on v.id = e.visitor_id
where e.environment = '$environment' and e.platform = 'web' and e.name = 'page_view'
  and e.created_at between $__timeFrom() and $__timeTo()
  and v.bot_category in ('ai_crawler', 'ai_search', 'ai_assistant')
group by 1, 2 order by 3 desc limit 30;
