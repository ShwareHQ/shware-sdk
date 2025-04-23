-- Purchase by country (Bar chart)
select
  e.tags ->> 'country' as country,
  count(distinct e.visitor_id) as event_count
from application.event e
where
  e.created_at between $__timeFrom() and $__timeTo()
  and e.tags ->> 'environment' = '$environment'
  and e.tags ->> 'platform' in (${platform:sqlstring})
  and e.name = 'purchase'
group by country
order by event_count desc;
