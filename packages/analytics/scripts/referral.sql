-- Total referrer users
select count(distinct referrer_user_id) from application.referral_event

-- Total referred users
select count(distinct referred_user_id) from application.referral_event

-- Total redemptions
select count(id) from application.redemption

-- Total shares
select count(id) 
from application.event
where
  created_at between $__timeFrom() and $__timeTo()
  and name = 'share'
  and tags ->> 'environment' = '$environment'
  and tags ->> 'platform' in (${platform:sqlstring});

-- Total NPS (Net Promoter Score)
-- Detractors: score 0-6, Passives: 7-8, Promoters: 9-10
-- nps_score: Bad < 0, OK > 0, Good > 30, Excellent > 50
with nps_data as (
  select
    (properties ->> 'score')::int as score
  from application.event
  where
    name = 'nps_sent'
    -- and created_at between $__timeFrom() and $__timeTo()
    and tags ->> 'environment' = '$environment'
    and tags ->> 'platform' in (${platform:sqlstring})
),
nps_counts as (
  select
    count(*) as total,
    sum(case when score between 0 and 6 then 1 else 0 end) as detractors,
    sum(case when score between 7 and 8 then 1 else 0 end) as passives,
    sum(case when score between 9 and 10 then 1 else 0 end) as promoters
  from nps_data
)
select
  promoters,
  detractors,
  passives,
  total,
  round(
    (case when total > 0 
      then ((promoters::float - detractors::float) / total) * 100
      else 0 end)::numeric, 2
  ) as nps_score
from nps_counts;

-- Referral by code
select c.code as code, count(c.code) as total
from application.referral_event e
inner join application.referral_code c on e.referral_code_id = c.id
group by code
order by total desc

-- Redeem by code
select c.code as code, count(c.code) as total
from application.redemption r
inner join application.redemption_code c on r.redemption_code_id = c.id
group by code
order by total desc

