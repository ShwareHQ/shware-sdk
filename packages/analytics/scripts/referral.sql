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
