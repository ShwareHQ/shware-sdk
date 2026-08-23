import { action, contains, eq, exists, flow, gt, trigger, workflow } from '@shware/workflow';
import { e, u } from './schema';
import { activated, activeSubscriber, purchaser } from './segments';
import {
  firstTimeRecovery,
  gettingStarted,
  limitedTimeOffer,
  proTips,
  upgradeRecovery,
} from './templates';

/* --------------------------- Triggers and conditions -------------------------- */

/** Trigger assets, reusable across workflows; event names come from e.xxx, and payload filtering will hang here. */
const checkoutStarted = trigger.event(e.begin_checkout);
/** The entry gate lives on the trigger (customer.io's trigger Filters): signed up *and* has an email. */
const signedUp = trigger.event(e.sign_up, { filter: exists(u.email) });
const christmasMorning = trigger.date('2026-12-25 09:00:00');

/** An anonymous reusable condition is just a const: reused in code, but absent from the segment sidebar. */
const powerUser = gt(u.docs_count, 100);

/* --------------------------------- Actions --------------------------------- */

/**
 * A custom action: plain code for what the built-in nodes do not cover. The
 * chain records only its identity (name + args + codeHash); this function
 * ships with the deployed Worker and runs inside a durable step — retried on
 * throw, so keep it idempotent. Custom *conditions* stay unsupported by
 * design: an action writes data, and branching reads it declaratively.
 */
const issueCoupon = action<{ code: string; email: string }>(
  'issue_coupon',
  async ({ code, email }, { userId }) => {
    await fetch('https://billing.acme.io/coupons', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, email, userId }),
    });
  }
);

/* ----------------------------- Reusable flow fragments ---------------------------- */

/**
 * U1 (abandoned-upgrade recovery): a single email, no discount, personalized
 * with the user's current plan. Original canvas: U1: Upgrade recovery → Exit.
 */
const upgradeFlow = flow((w) => w.email(upgradeRecovery, { plan: u.subscription_plan }));

/**
 * N1/N2 (abandoned first purchase): a discount-free reminder → 23h → a
 * time-limited offer. The discount is held back to the second email so we do
 * not train people to abandon checkout for a coupon.
 * Original canvas: N1 → Time Delay 23h → branch → N2.
 */
const firstTimeFlow = flow((w) =>
  w
    .email(firstTimeRecovery)
    .delay('23 hours')
    // Provision the coupon in billing right before the offer lands; args may reference u.xxx like message props
    .run(issueCoupon, { code: '15OFF', email: u.email })
    .email(limitedTimeOffer, { coupon: '15OFF', expiresIn: '48 hours' })
);

/**
 * Nested branches: an arm is a full FlowBuilder, so it can .branch() again.
 * Convention: anything deeper than one level is pulled out into a named
 * fragment like this one, keeping every expression shallow.
 */
const subscriberSplit = flow((w) =>
  w.branch([powerUser, (w) => w.email(proTips)], (w) => w.email(gettingStarted))
);

/* -------------------------------- workflows -------------------------------- */

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
export const checkoutRecovery = workflow('checkout_recovery', {
  name: 'Checkout Recovery',
  trigger: checkoutStarted,
  goal: purchaser,
  // The metadata below is excluded from contentHash: rewording it affects neither in-flight users nor plan
  description:
    'One hour after abandonment, split by subscription status: sell value to subscribers, discount to first-timers',
  tags: ['revenue', 'lifecycle'],
  owner: 'growth@example.com',
})
  .delay('1 hour')
  .branch(
    'subscriber_split', // label: the node's UI name and observability handle, not a jump target
    [activeSubscriber, upgradeFlow],
    firstTimeFlow // bare tail argument = the default arm
  );

/**
 * Onboarding: a tour of the remaining primitives — waitUntil / timeWindow /
 * multi-arm branch / cohort — plus inline conditions (no need to name a
 * segment first; write the expression at the use site).
 */
export const onboarding = workflow('onboarding', { name: 'Onboarding · Core', trigger: signedUp })
  .waitUntil(activated, { timeout: '3 days', onTimeout: 'continue' })
  .timeWindow({
    days: ['mon', 'tue', 'wed', 'thu', 'fri'],
    between: ['09:00', '17:00'],
    tz: 'user',
  })
  .branch(
    [activeSubscriber, subscriberSplit], // nested branch inside an arm, kept shallow as a fragment
    (w) => w.email(gettingStarted)
  )
  .cohort({
    control: { weight: 50 },
    variant: { weight: 50, flow: (w) => w.delay('3 days').email(proTips) },
  });

/** Scheduled trigger: a holiday promo for active subscribers only. Segment and webhook triggers work the same way. */
export const christmasPromo = workflow('christmas_promo', {
  name: 'Christmas Promo',
  trigger: christmasMorning,
})
  .filter(activeSubscriber)
  .email(limitedTimeOffer, { coupon: 'XMAS25', expiresIn: '72 hours' });

/**
 * A recurring nudge. There is no loop inside the tree — a trailing,
 * self-triggering sendEvent is the correct shape (an event edge between
 * workflows). The goal guarantees termination and counts the conversion, with
 * a trigger rate limit as the backstop.
 * The goal is written in full form here — a 30-day attribution window and
 * exit-on-match — even though both are the defaults, to show the shape.
 */
export const activationNudge = workflow('activation_nudge', {
  name: 'Activation Nudge',
  trigger: trigger.event(e.activation_nudge_due),
  goal: { condition: activated, within: '30 days', exitOnMatch: true },
})
  .email(gettingStarted)
  .delay('8 days')
  .sendEvent(e.activation_nudge_due);

/* ----------------- Type-safety tour (each line must fail to compile) ---------------- */
/* tsc verifies every directive below suppresses a real error — if one stops
 * erroring, the @ts-expect-error itself becomes the error. Wrapped in a
 * never-called function because these are type-level assertions and some of
 * them would genuinely throw at runtime. */

const _typeChecks = () => {
  // @ts-expect-error trigger must be a trigger.xxx() asset (the string shorthand went away with the E generic)
  workflow('bad_trigger', { trigger: 'sign_up' });

  // @ts-expect-error trigger.event only accepts events present in the reference table (property-access check)
  trigger.event(e.no_such_event);

  // @ts-expect-error contains takes string references only (docs_count is a number) — narrowing lives in the signature
  contains(u.docs_count, '1');

  // @ts-expect-error a predicate's value type flows in from the reference ('archived' is not a subscription_status)
  eq(u.subscription_status, 'archived');

  // @ts-expect-error the reference table only carries properties declared in the schema
  exists(u.no_such_property);

  // @ts-expect-error prop value outside the template's declared type (plan is free/pro/business)
  flow((w) => w.email(upgradeRecovery, { plan: 'enterprise' }));

  // @ts-expect-error the template declares required props, so omitting them fails
  flow((w) => w.email(upgradeRecovery));

  // @ts-expect-error referenced property type does not match the prop (email: string ≠ the plan enum)
  flow((w) => w.email(upgradeRecovery, { plan: u.email }));

  // @ts-expect-error misspelled duration
  flow((w) => w.delay('1 huor'));

  // @ts-expect-error sendEvent only accepts events present in the reference table
  flow((w) => w.sendEvent(e.no_such_event));

  // @ts-expect-error sendEvent payload is type-checked (value must be a number)
  flow((w) => w.sendEvent(e.purchase, { value: 'high', currency: 'USD' }));

  // @ts-expect-error action args are typed by the ActionRef (code must be a string)
  flow((w) => w.run(issueCoupon, { code: 42, email: u.email }));

  // @ts-expect-error the action declares required args, so omitting them fails
  flow((w) => w.run(issueCoupon));
};
void _typeChecks;
