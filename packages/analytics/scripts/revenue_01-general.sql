-- Revenue (Stripe)
select 
  coalesce(sum((e.data_object ->> 'amount')::float / (100 * 1)), 0) as total_income
from application.stripe_event e
where
  e.type in ('charge.succeeded')
  and e.created between extract(epoch from $__timeFrom()::TIMESTAMP)
  and extract(epoch from $__timeTo()::TIMESTAMP)

-- Purchase by country (Bar chart)
select
  e.tags ->> 'country' as country,
  count(distinct e.visitor_id) as event_count
from application.event e
where
  e.created_at between $__timeFrom() and $__timeTo()
  and e.environment = '$environment'
  and e.platform in (${platform:sqlstring})
  and e.name = 'purchase'
group by country
order by event_count desc;

-- Total subscriptions
select count(id) from application.subscription

-- Total purchases
select count(id) from application.product_purchase
