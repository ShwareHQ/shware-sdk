-- Ads revenue reads application.attribution (see activation_03-ads.sql for the cohort and the
-- started_at bound). Revenue here is the `purchase` event's value: first purchases only — a
-- renewal is written by the payment webhook and has no event. A purchase is one row per
-- transaction_id (event_purchase_transaction_unique), so nothing needs deduplicating.
-- One panel per channel: copy the query and change the 'meta' literal. Dashboard variables:
-- $environment, $platform (the platform the ad was clicked on).

-- Total Revenue (Stat)
select coalesce(sum((e.properties ->> 'value')::numeric), 0) as "Total Revenue"
from application.event e
       join application.attribution a on a.session_id = e.session_id
where e.name = 'purchase'
  and a.channel = 'meta'
  and a.touched_at between $__timeFrom() and $__timeTo()
  and a.started_at between $__timeFrom() and $__timeTo() + interval '30 days'
  and a.touch_platform in (${platform:sqlstring})
  and e.environment = '$environment';

-- Average Customer Value (Stat): revenue per buying person, not per device.
select round(sum((e.properties ->> 'value')::numeric) / nullif(count(distinct a.distinct_id), 0), 2)
         as "Average Customer Value"
from application.event e
       join application.attribution a on a.session_id = e.session_id
where e.name = 'purchase'
  and a.channel = 'meta'
  and a.touched_at between $__timeFrom() and $__timeTo()
  and a.started_at between $__timeFrom() and $__timeTo() + interval '30 days'
  and a.touch_platform in (${platform:sqlstring})
  and e.environment = '$environment';

-- Total Orders (Stat)
select count(*) as "Total Orders"
from application.event e
       join application.attribution a on a.session_id = e.session_id
where e.name = 'purchase'
  and a.channel = 'meta'
  and a.touched_at between $__timeFrom() and $__timeTo()
  and a.started_at between $__timeFrom() and $__timeTo() + interval '30 days'
  and a.touch_platform in (${platform:sqlstring})
  and e.environment = '$environment';

-- New Customers (Stat)
select count(distinct a.distinct_id) as "New Customers"
from application.event e
       join application.attribution a on a.session_id = e.session_id
where e.name = 'purchase'
  and a.channel = 'meta'
  and a.touched_at between $__timeFrom() and $__timeTo()
  and a.started_at between $__timeFrom() and $__timeTo() + interval '30 days'
  and a.touch_platform in (${platform:sqlstring})
  and e.environment = '$environment';

-- LTV by acquisition month (Table, one line per cohort): people acquired through 'meta'
-- (application.user_attribution.first_channel), grouped by the month of their first session, and
-- their cumulative revenue per person in the months since. Revenue comes from application.payment
-- joined by user_id, so subscription renewals count — no event carries them, the ads revenue
-- stats above are first purchases only. Gross of refunds: subtract application.refund rows with
-- status SUCCEEDED for net. One currency at a time; amounts are in major units. Young cohorts have
-- few months yet, so compare cohorts at the same month_n, not their latest value.
with cohort as (
  select ua.user_id, date_trunc('month', ua.first_seen_at) as cohort_month
  from application.user_attribution ua
  where
    ua.environment = '$environment'
    and ua.user_id is not null
    and ua.first_channel = 'meta'
    and ua.first_seen_at between date_trunc('month', $__timeFrom()::timestamptz) and $__timeTo()
),
revenue as (
  select
    c.cohort_month,
    (extract(year from age(date_trunc('month', p.created_at), c.cohort_month)) * 12
      + extract(month from age(date_trunc('month', p.created_at), c.cohort_month)))::int as month_n,
    sum(p.amount) as amount
  from cohort c
         join application.payment p on p.user_id = c.user_id and p.created_at >= c.cohort_month
  where p.currency = 'USD'
  group by c.cohort_month, month_n
),
size as (
  select cohort_month, count(*) as people from cohort group by cohort_month
)
select
  r.cohort_month,
  r.month_n,
  s.people as cohort_size,
  round(sum(r.amount) over (partition by r.cohort_month order by r.month_n) / s.people, 2)
    as ltv_per_person,
  round(sum(r.amount) over (partition by r.cohort_month order by r.month_n), 2) as cumulative_revenue
from revenue r
       join size s using (cohort_month)
order by r.cohort_month, r.month_n;
