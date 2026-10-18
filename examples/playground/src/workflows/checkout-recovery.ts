import { flow, trigger, workflow } from '@shware/workflow';
import { email } from '../email';
import { push } from '../push';
import { issueCoupon } from './actions';
import { e, u } from './schema';
import { activeSubscriber, purchaser } from './segments';

/**
 * U1 (abandoned-upgrade recovery): a single email, no discount, personalized
 * with the user's current plan, with a push landing alongside it — two
 * channels, one moment. Original canvas: U1: Upgrade recovery → Exit.
 */
const upgradeFlow = flow((w) =>
  w.push(push.checkoutReminder).email(email.upgradeRecovery, { plan: u.subscription_plan })
);

/**
 * N1/N2 (abandoned first purchase): a discount-free reminder → 23h → a
 * time-limited offer. The discount is held back to the second email so we do
 * not train people to abandon checkout for a coupon.
 * Original canvas: N1 → Time Delay 23h → branch → N2.
 */
const firstTimeFlow = flow((w) =>
  w
    .email(email.firstTimeRecovery)
    .delay('23 hours')
    // Provision the coupon in billing right before the offer lands; args may reference u.xxx like message props
    .run(issueCoupon, { code: '15OFF', email: u.email })
    .email(email.limitedTimeOffer, { coupon: '15OFF', expiresIn: '48 hours' })
);

/**
 * Checkout recovery — a faithful port of the original customer.io canvas:
 *
 *   Trigger: begin_checkout
 *   ├─ Wait 1 hour
 *   ├─ purchased? ── True → Exit          ┐
 *   ├─ subscriber?                         │ all three True→Exit arms are
 *   │   ├─ True  → U1 upgrade recovery     │ absorbed by goal (a purchase is
 *   │   └─ False → N1 first-time recovery  │ the conversion: exits by default
 *   │                                      │ and lands in reporting)
 *   │              ├─ Wait 23 hours        │
 *   │              ├─ purchased? True → Exit ┘
 *   │              └─ N2 limited-time offer → Exit
 *
 * The original's 12 nodes (5 Exits, 3 conditional branches) become 3 steps.
 */
export const checkoutRecovery = workflow({
  id: 'checkout_recovery',
  name: 'Checkout Recovery',
  trigger: trigger.event(e.begin_checkout),
  goal: purchaser,
  // The metadata below is excluded from contentHash: rewording it affects neither in-flight users nor plan
  description:
    'One hour after abandonment, split by subscription status: sell value to subscribers, discount to first-timers',
})
  .delay('1 hour')
  .branch(
    'subscriber_split', // label: the node's UI name and observability handle, not a jump target
    [activeSubscriber, upgradeFlow],
    firstTimeFlow // bare tail argument = the default arm
  );
