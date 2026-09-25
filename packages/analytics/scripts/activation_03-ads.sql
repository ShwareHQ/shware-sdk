-- Ads funnels read application.attribution (see "Sessions and attribution" in the README):
-- one row per session, credited to its own touch or to the same person's latest touch within
-- ATTRIBUTION_WINDOW_DAYS (30), across devices. The cohort is people whose credited touch
-- happened in the dashboard window; their events count whenever and on whatever platform they
-- happened. Dashboard variables: $channel (single value, e.g. `select distinct channel from
-- application.touchpoint`), $environment, $platform (multi, the platform the ad was clicked on).

-- Cohort size (Stat): the denominator for every rate below.
select count(distinct a.person_id) as "People"
from application.attribution a
where a.channel = '$channel'
  and a.touched_at between $__timeFrom() and $__timeTo()
  -- Redundant in results, required for the plan: touched_at comes from a lateral and cannot be
  -- pushed down; started_at can. The days added must equal ATTRIBUTION_WINDOW_DAYS.
  and a.started_at between $__timeFrom() and $__timeTo() + interval '30 days'
  and a.touch_platform in (${platform:sqlstring})
  and a.environment = '$environment';

-- Funnel (Bar chart): how many people of the cohort ever did each step. Unordered on purpose —
-- the steps are not one forced path (an app user logs in without a page_view) — so read each bar
-- against the cohort size, not against the bar before it.
select e.name as event_name, count(distinct a.person_id) as event_count
from application.event e
       join application.attribution a on a.session_id = e.session_id
where a.channel = '$channel'
  and a.touched_at between $__timeFrom() and $__timeTo()
  and a.started_at between $__timeFrom() and $__timeTo() + interval '30 days'
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
       count(distinct a.person_id) filter (where a.touch_kind = 'own') as own,
       count(distinct a.person_id) as with_inherited
from application.event e
       join application.attribution a on a.session_id = e.session_id
where a.channel = '$channel'
  and a.touched_at between $__timeFrom() and $__timeTo()
  and a.started_at between $__timeFrom() and $__timeTo() + interval '30 days'
  and a.touch_platform in (${platform:sqlstring})
  and e.environment = '$environment'
  and e.name in ('page_view', 'login', 'begin_checkout', 'purchase')
group by event_name
order by with_inherited desc;

-- Where the cohort converts (Table): touch platform × conversion platform.
select a.touch_platform, a.platform as converted_on, count(distinct a.person_id) as buyers
from application.event e
       join application.attribution a on a.session_id = e.session_id
where a.channel = '$channel'
  and a.touched_at between $__timeFrom() and $__timeTo()
  and a.started_at between $__timeFrom() and $__timeTo() + interval '30 days'
  and e.environment = '$environment'
  and e.name = 'purchase'
group by a.touch_platform, a.platform
order by buyers desc;
