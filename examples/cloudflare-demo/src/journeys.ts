import { action, defineContract, performed, segment, trigger, workflow } from '@shware/workflow';
import * as z from 'zod/mini';
import { email } from './email';

/**
 * Demo flows on a seconds-long timescale, so the whole pipeline is visible by
 * eye under a local wrangler dev: event → trigger → sleep → branch/wait →
 * render and send → goal exit.
 */

/**
 * The demo's contract: its events and profile, and the one topic its offer emails belong to
 * (the welcome is transactional). The Worker validates ingest against it, and
 * `JourneyClient.setSubscriptions` is typed by it.
 */
export const contract = defineContract({
  events: {
    demo_signup: z.looseObject({}),
    demo_click: z.looseObject({}),
    demo_purchase: z.looseObject({ value: z.number() }),
  },
  profile: z.strictObject({ email: z.string(), plan: z.string() }),
  subscriptions: { topics: ['offers'] },
});

const e = contract.events;
export const u = contract.user;

// email.typo ← fails to compile: there is no such template

export const purchased = segment({ id: 'demo_purchased', condition: performed(e.demo_purchase) });

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
export const demoRecovery = workflow({
  id: 'demo_recovery',
  trigger: trigger.event(e.demo_signup),
  goal: purchased,
})
  .email(email.welcome, { plan: u.plan })
  .delay('5 seconds')
  .branch(
    [
      performed(e.demo_click),
      (w) =>
        w
          .run(grantCoupon, { coupon: 'CLICKED10' })
          .email(email.offer, { coupon: 'CLICKED10', expiresIn: '24 hours' }),
    ],
    (w) => w.email(email.offer, { coupon: 'COMEBACK20', expiresIn: '48 hours' })
  );

/** wait_until demo: wait to be woken by demo_click, or continue after a 20s timeout. */
export const demoWaiter = workflow({ id: 'demo_waiter', trigger: trigger.event(e.demo_signup) })
  .waitUntil(performed(e.demo_click), { timeout: '20 seconds', onTimeout: 'continue' })
  .email(email.welcome, { plan: u.plan });
