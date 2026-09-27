-- Multi-touch views of the same purchases the ads panels credit to one touch. All three read
-- application.attribution (the credited touch), application.touchpoint (every touch) and
-- application.user_attribution (the first touch), and count purchases by when they happened —
-- conversion time, not touch time — because the question here is how channels combine, not what
-- one campaign period bought. Dashboard variables: $environment.

-- Assisted conversions (Table): per channel group, the purchases it was credited with (last
-- touch) next to the purchases it took part in without getting the credit (assisted): any touch
-- of the buyer in the 30 days before the purchase, one assist per channel group per purchase.
-- assisted_per_last above 1 is a channel that opens more than it closes — awareness, not
-- capture — which a last-touch ROAS alone would undervalue. Swap channel_group for channel to see
-- individual sources.
with purchase as (
  select e.session_id, a.distinct_id, e.created_at as converted_at, a.channel_group as credited
  from application.event e
         join application.attribution a on a.session_id = e.session_id
  where e.name = 'purchase'
    and e.created_at between $__timeFrom() and $__timeTo()
    and e.environment = '$environment'
),
touched as (
  select distinct p.session_id, p.credited, t.channel_group
  from purchase p
         join application.touchpoint t
              on t.distinct_id = p.distinct_id
                and t.environment = '$environment'
                and t.channel <> '(direct)'
                and t.started_at between p.converted_at - interval '30 days' and p.converted_at
)
select
  channel_group,
  count(*) filter (where channel_group = credited) as last_touch,
  count(*) filter (where channel_group <> credited) as assisted,
  round(
    count(*) filter (where channel_group <> credited)::numeric
      / nullif(count(*) filter (where channel_group = credited), 0),
    2
  ) as assisted_per_last
from touched
group by channel_group
order by last_touch desc, assisted desc;

-- Channel synergy (Table, or a heatmap of opened_by × closed_by): buyers by the channel group of
-- their first touch ever (user_attribution) and the channel group credited with the purchase
-- (attribution). The diagonal is a channel that both finds and converts its users; a large
-- off-diagonal cell — paid_social opened, organic_search closed — is the branded-search effect
-- of an ad, and the reason attribution ranks a campaign touch above a later referrer.
select
  ua.first_channel_group as opened_by,
  a.channel_group as closed_by,
  count(distinct a.distinct_id) as buyers
from application.event e
       join application.attribution a on a.session_id = e.session_id
       join application.user_attribution ua
            on ua.distinct_id = a.distinct_id and ua.environment = a.environment
where e.name = 'purchase'
  and e.created_at between $__timeFrom() and $__timeTo()
  and e.environment = '$environment'
group by opened_by, closed_by
order by buyers desc;

-- Time to convert (Bar chart): days from the credited touch to the purchase, for purchases that
-- had one. Day 0 is a purchase in the session that arrived through the touch; the tail is what
-- the 30-day window (ATTRIBUTION_WINDOW_DAYS) has to cover — if it is still fat at day 25, the
-- window is cutting real conversions off into (direct), and should be widened.
select
  floor(extract(epoch from e.created_at - a.touched_at) / 86400)::int as days_since_touch,
  count(*) as purchases
from application.event e
       join application.attribution a on a.session_id = e.session_id
where e.name = 'purchase'
  and a.touch_kind <> 'none'
  and e.created_at between $__timeFrom() and $__timeTo()
  and e.environment = '$environment'
group by days_since_touch
order by days_since_touch;
