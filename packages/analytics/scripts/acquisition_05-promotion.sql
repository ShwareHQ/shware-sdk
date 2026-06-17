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
