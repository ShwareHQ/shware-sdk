-- Google Ads
with target_visitors as (
  select id
  from application.visitor
  where initial_tags ->> 'utm_source' = 'google'
    and initial_tags ->> 'utm_medium' = 'cpc'
    and created_at between $__timeFrom() and $__timeTo()
),
unique_purchases as (
  select distinct on (properties ->> 'transaction_id')
    (properties ->> 'value')::numeric as revenue_value
  from application.event
  where name = 'purchase'
    and visitor_id in (select id from target_visitors)
  order by properties ->> 'transaction_id', created_at desc
)
select sum(revenue_value) as "Total Revenue" from unique_purchases;

-- Google Ads Average Customer Value
with target_visitors as (
  select id
  from application.visitor
  where initial_tags ->> 'utm_source' = 'google'
    and initial_tags ->> 'utm_medium' = 'cpc'
    and created_at between $__timeFrom() and $__timeTo()
),
     unique_purchases as (
       select distinct on (properties ->> 'transaction_id')
  (properties ->> 'value')::numeric as revenue_value,
  visitor_id
from application.event
where name = 'purchase'
  and visitor_id in (select id from target_visitors)
order by properties ->> 'transaction_id', created_at desc
  )
select
  round(sum(revenue_value) / nullif(count(distinct visitor_id), 0), 2) as "Average Customer Value"
from unique_purchases;

-- Google Ads new Orders
with target_visitors as (
  select id
  from application.visitor
  where initial_tags ->> 'utm_source' = 'google'
    and initial_tags ->> 'utm_medium' = 'cpc'
    and created_at between $__timeFrom() and $__timeTo()
),
     unique_purchases as (
       select distinct on (properties ->> 'transaction_id')
  properties ->> 'transaction_id' as tx_id
from application.event
where name = 'purchase'
  and visitor_id in (select id from target_visitors)
order by properties ->> 'transaction_id', created_at desc
  )
select count(tx_id) as "Total Orders" from unique_purchases;

-- Google Ads new Customers
select count(distinct visitor_id) from application.event
where name = 'purchase' and visitor_id in (
  select id from application.visitor
  where initial_tags ->> 'utm_source' = 'google'
    and initial_tags ->> 'utm_medium' = 'cpc'
    and created_at between $__timeFrom() and $__timeTo()
)
