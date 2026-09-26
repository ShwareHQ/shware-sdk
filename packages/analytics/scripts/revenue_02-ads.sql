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
