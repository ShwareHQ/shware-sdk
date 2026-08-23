import {
  action,
  compileBundle,
  event,
  performed,
  segment,
  templates,
  trigger,
  user,
  workflow,
} from '../../../packages/workflow/src/dsl';
/**
 * Demo flows on a seconds-long timescale, so the whole pipeline is visible by
 * eye under a local wrangler dev: event → trigger → sleep → branch/wait →
 * render and send → goal exit.
 * These import workspace source directly to avoid a build step; a real project
 * would import '@shware/workflow'.
 */
import type { Emails } from '../emails';

type Empty = Record<never, never>;

interface DemoEvent {
  demo_signup: Empty;
  demo_click: Empty;
  demo_purchase: { value: number };
}

interface DemoUser {
  userId: string;
  email: string;
  plan: string;
}

const e = event<DemoEvent>();
export const u = user<DemoUser>();

/** The emails registry types the key; props are inferred from the component signature (a type-only import, no runtime dependency). */
const t = templates<Emails>();
const welcome = t.email('demo_welcome');
const offer = t.email('demo_offer');
// t.email('typo') ← fails to compile: the key is not in the registry

const purchased = segment('demo_purchased', performed(e.demo_purchase));

/**
 * Custom action demo: plain code that ships with this Worker — the IR records
 * only its name, args and code hash, and DemoJourneyRunner registers the
 * implementation (see index.ts). Runs inside a durable step, so a throw would
 * be retried; a real one would call a billing API and de-duplicate on the
 * idempotency key.
 */
export const grantCoupon = action<{ coupon: string }>(
  'demo_grant_coupon',
  async ({ coupon }, { userId }) => {
    console.log(`[action] granted coupon ${coupon} to ${userId}`);
  }
);

/** Branch demo: sign up → 5s → clicked goes down A, everyone else down B; an order (the goal) exits at any point. */
export const demoRecovery = workflow('demo_recovery', {
  trigger: trigger.event(e.demo_signup),
  goal: purchased,
})
  .email(welcome, { plan: u.plan })
  .delay('5 seconds')
  .branch(
    [
      performed(e.demo_click),
      (w) =>
        w
          .run(grantCoupon, { coupon: 'CLICKED10' })
          .email(offer, { coupon: 'CLICKED10', expiresIn: '24 hours' }),
    ],
    (w) => w.email(offer, { coupon: 'COMEBACK20', expiresIn: '48 hours' })
  );

/** wait_until demo: wait to be woken by demo_click, or continue after a 20s timeout. */
export const demoWaiter = workflow('demo_waiter', {
  trigger: trigger.event(e.demo_signup),
})
  .waitUntil(performed(e.demo_click), { timeout: '20 seconds', onTimeout: 'continue' })
  .email(welcome, { plan: u.plan });

export function demoBundle() {
  return compileBundle({
    workflows: [demoRecovery, demoWaiter],
    segments: [purchased],
    templates: [welcome, offer],
    actions: [grantCoupon],
  });
}
