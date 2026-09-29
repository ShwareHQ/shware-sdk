-- Ads funnels read application.attribution (see "Sessions and attribution" in the README):
-- one row per session, credited to its own touch or to the same person's latest touch within
-- ATTRIBUTION_WINDOW_DAYS (30), across devices. The cohort is people whose credited touch
-- happened in the dashboard window; their events count whenever and on whatever platform they
-- happened. One panel per channel, side by side: copy the query and change the 'meta' / 'paid_social' literals ('google' / 'paid_search', …); a Facebook referral is also channel meta, channel_group tells the ads apart
-- (the values are application.touchpoint's channel column). Dashboard variables: $environment,
-- $platform (multi, the platform the ad was clicked on).

-- Cohort size (Stat): the denominator for every rate below.
select count(distinct a.distinct_id) as "People"
from application.attribution a
where a.channel = 'meta' and a.channel_group = 'paid_social'
  and a.touched_at between $__timeFrom() and $__timeTo()
  -- Redundant in results, required for the plan: touched_at comes from a lateral and cannot be
  -- pushed down; started_at can. The days added must equal ATTRIBUTION_WINDOW_DAYS.
  and a.started_at between $__timeFrom() and $__timeTo()::timestamptz + interval '30 days'
  and a.touch_platform in (${platform:sqlstring})
  and a.environment = '$environment';

-- Funnel (Bar chart): how many people of the cohort ever did each step. Unordered on purpose —
-- the steps are not one forced path (an app user logs in without a page_view) — so read each bar
-- against the cohort size, not against the bar before it.
select e.name as event_name, count(distinct a.distinct_id) as event_count
from application.event e
       join application.attribution a on a.session_id = e.session_id
where a.channel = 'meta' and a.channel_group = 'paid_social'
  and a.touched_at between $__timeFrom() and $__timeTo()
  and a.started_at between $__timeFrom() and $__timeTo()::timestamptz + interval '30 days'
  and a.touch_platform in (${platform:sqlstring})
  and e.environment = '$environment'
  and e.name in (
    'page_view',
    'cta_button_clicked',
    'login',
    'begin_checkout',
    'purchase'
  )
group by event_name
order by event_count desc;

-- Cross-device lift (Table): the same funnel before and after forward-filling. `own` is the
-- session's own touch only — what a per-device report would show; `with_inherited` adds the
-- sessions credited across devices. The difference is what attribution recovered.
select e.name as event_name,
       count(distinct a.distinct_id) filter (where a.touch_kind = 'own') as own,
       count(distinct a.distinct_id) as with_inherited
from application.event e
       join application.attribution a on a.session_id = e.session_id
where a.channel = 'meta' and a.channel_group = 'paid_social'
  and a.touched_at between $__timeFrom() and $__timeTo()
  and a.started_at between $__timeFrom() and $__timeTo()::timestamptz + interval '30 days'
  and a.touch_platform in (${platform:sqlstring})
  and e.environment = '$environment'
  and e.name in ('page_view', 'login', 'begin_checkout', 'purchase')
group by event_name
order by with_inherited desc;

-- Where the cohort converts (Table): touch platform × conversion platform.
select a.touch_platform, a.platform as converted_on, count(distinct a.distinct_id) as buyers
from application.event e
       join application.attribution a on a.session_id = e.session_id
where a.channel = 'meta' and a.channel_group = 'paid_social'
  and a.touched_at between $__timeFrom() and $__timeTo()
  and a.started_at between $__timeFrom() and $__timeTo()::timestamptz + interval '30 days'
  and e.environment = '$environment'
  and e.name = 'purchase'
group by a.touch_platform, a.platform
order by buyers desc;

-- Time to value by ad segment (Time series, format Time series). New people by the week of their
-- first visit, one per person across devices, and how fast they reached value: the median minutes
-- to the value event for those who got there within 7 days, and the share that got there within
-- 7 days. Read the two together: the minutes say how fast the people who get there are, the share
-- how many get there — a flat median over a falling share is more people giving up before value,
-- not a faster product. Panel: unit m (minutes); the "reached value in 7 days" series unit percent
-- on the right axis, dashed; the "newcomers" series hidden from the graph and the legend, kept in
-- the tooltip. The segment is the channel of the person's first session, the one that acquired
-- them: a person found by search who later clicks an ad is not an ad newcomer. Change the
-- literals for another channel ('meta' / 'paid_social', ...); one column pair per segment keeps
-- the colours fixed.
with newcomers as (
  -- A person is new in the window when none of their visitors existed before it. Whole weeks
  -- only, and only weeks whose last newcomer has had 7 days, so the newest week is not read low.
  -- Keeping only the people with a visitor on $platform is a cheap cut before the lateral below.
  select v.distinct_id
  from application.visitor v
  where v.environment = '$environment'
  group by 1
  having min(v.created_at) between $__timeFrom()
      and least($__timeTo()::timestamptz, date_trunc('week', now() - interval '7 days'))
    and bool_or(v.platform in (${platform:sqlstring}))
), people as (
  -- The person's first session across devices, and what brought them. $platform keeps the people
  -- who started there: on web, the ones whose very first session was on web.
  select n.distinct_id, fs.started_at as first_seen,
    case when fs.medium = 'pmax' then 'pmax' else 'cpc' end as segment
  from newcomers n
  cross join lateral (
    select s.started_at, s.platform, s.channel, s.medium, s.channel_group
    from application.visitor v
    join application.analytics_session s on s.visitor_id = v.id
    where v.distinct_id = n.distinct_id
    order by s.started_at
    limit 1
  ) fs
  where fs.platform in (${platform:sqlstring})
    and fs.started_at < date_trunc('week', now() - interval '7 days')
    and fs.channel = 'google' and fs.medium in ('cpc', 'pmax')
), ttv as (
  select date_trunc('week', p.first_seen) as week, p.segment,
    extract(epoch from fv.at - p.first_seen) / 60 as minutes,
    fv.at is not null and fv.at < p.first_seen + interval '7 days' as reached
  from people p
  cross join lateral (
    -- The value event: the first time the person does what the product is for. Change 'ping' to
    -- yours (a first completed render, a first export, a first sent message, ...). On $platform
    -- too: web alone is the web experience, a web newcomer who gets there in the app is not counted;
    -- all platforms together is the cross-device TTV, web -> app included.
    select min(e.created_at) as at
    from application.visitor v
    join application.event e on e.visitor_id = v.id
      and e.name = 'ping' and e.environment = '$environment'
      and e.platform in (${platform:sqlstring})
    where v.distinct_id = p.distinct_id
  ) fv
)
select week as time,
  percentile_cont(0.5) within group (order by minutes) filter (where reached and segment = 'cpc') as "cpc · median minutes",
  percentile_cont(0.5) within group (order by minutes) filter (where reached and segment = 'pmax') as "pmax · median minutes",
  round(100.0 * avg(reached::int) filter (where segment = 'cpc'), 1) as "cpc · reached value in 7 days",
  round(100.0 * avg(reached::int) filter (where segment = 'pmax'), 1) as "pmax · reached value in 7 days",
  count(*) filter (where segment = 'cpc') as "cpc · newcomers",
  count(*) filter (where segment = 'pmax') as "pmax · newcomers"
from ttv
group by 1
order by 1;
