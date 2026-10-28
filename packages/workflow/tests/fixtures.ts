/**
 * Self-contained test fixtures.
 *
 * Two rules keep these honest:
 * 1. Everything is imported from the public entry (`../src/index`) — the
 *    fixtures double as a consumer-perspective smoke test of the surface.
 * 2. Nothing here ships: the package exports no demo content (showcase flows
 *    live in examples/playground). The flows below mirror those showcases so
 *    the suite keeps exercising realistic shapes.
 */
import * as z from 'zod/mini';
import {
  and,
  emailTemplate,
  eq,
  event,
  not,
  performed,
  pushTemplate,
  segment,
  slackTemplate,
  trigger,
  user,
  workflow,
} from '../src/index';

type Empty = Record<string, never>;

export interface TestEvent {
  login: Empty;
  sign_up: { method: 'google' | 'email' };
  begin_checkout: { value: number };
  purchase: { value: number; currency: string };
  subscription_cancelled: { reason: string };
  nudge_due: Empty;
}

export interface TestUser {
  userId: string;
  email: string;
  subscription_status: 'active' | 'none';
  subscription_plan: 'free' | 'pro' | 'business';
  auto_renew_enabled: boolean;
  docs_count: number;
}

export const e = event<TestEvent>();
export const u = user<TestUser>();

/* --------------------------------- Segments --------------------------------- */

export const purchaser = segment({
  id: 'purchaser',
  condition: performed(e.purchase, { within: '30 days' }),
});

export const activeSubscriber = segment({
  id: 'active_subscriber',
  condition: and(eq(u.subscription_status, 'active'), eq(u.auto_renew_enabled, true)),
});

export const inactive30d = segment({
  id: 'inactive_30d',
  condition: not(performed(e.login, { within: '30 days' })),
});

export const allSegments = [purchaser, activeSubscriber, inactive30d];

/* --------------------------------- Templates -------------------------------- */

const plan = z.strictObject({ plan: z.enum(['free', 'pro', 'business']) });
const named = z.strictObject({ name: z.string() });
const empty = z.strictObject({});

/** Templates whose content does not matter to the test: no props, or one `name`. */
export const plainEmail = (id: string) =>
  emailTemplate({
    id,
    transactional: true,
    from: 'noreply@acme.test',
    title: id,
    props: empty,
    subject: id,
    preview: {},
    component: () => null,
  });
export const namedEmail = (id: string) =>
  emailTemplate({
    id,
    transactional: true,
    from: 'noreply@acme.test',
    title: id,
    props: named,
    subject: id,
    preview: { name: 'A' },
    component: () => null,
  });
export const plainPush = (id: string) =>
  pushTemplate({
    id,
    title: id,
    props: empty,
    preview: {},
    content: () => ({ title: id, body: id }),
  });
export const namedPush = (id: string) =>
  pushTemplate({
    id,
    title: id,
    props: named,
    preview: { name: 'A' },
    content: ({ name }) => ({ title: id, body: name }),
  });

export const upgradeRecovery = emailTemplate({
  id: 'u1_upgrade_recovery',
  transactional: true,
  from: 'noreply@acme.test',
  title: 'Upgrade recovery',
  props: plan,
  subject: 'Upgrade',
  preview: { plan: 'pro' },
  component: () => null,
});
export const firstTimeRecovery = plainEmail('n1_first_time_recovery');
export const limitedTimeOffer = emailTemplate({
  id: 'n2_limited_time_offer',
  transactional: true,
  from: 'noreply@acme.test',
  title: 'Limited time offer',
  props: z.strictObject({ coupon: z.string(), expiresIn: z.string() }),
  subject: 'Offer',
  preview: { coupon: 'SAVE', expiresIn: '24h' },
  component: () => null,
});
export const gettingStarted = plainEmail('getting_started');
export const proTips = plainEmail('pro_tips');
export const csAlert = slackTemplate({
  id: 'cs_churn_alert',
  title: 'CS churn alert',
  props: plan,
  preview: { plan: 'pro' },
  webhook: () => 'https://hooks.slack.com/services/T/B/x',
  content: ({ plan }) => ({ text: `churn risk on ${plan}` }),
});

/* --------------------------------- Workflows -------------------------------- */

/** Two-arm branch, personalization, goal absorbing the exit paths. */
export const checkoutRecovery = workflow({
  id: 'checkout_recovery',
  trigger: trigger.event(e.begin_checkout),
  goal: purchaser,
})
  .delay('1 hour')
  .branch(
    'subscriber_split',
    [activeSubscriber, (w) => w.email(upgradeRecovery, { plan: u.subscription_plan })],
    (w) =>
      w
        .email(firstTimeRecovery)
        .delay('23 hours')
        .email(limitedTimeOffer, { coupon: '15OFF', expiresIn: '48 hours' })
  );

/** Multi-arm branch, in-arm exit (no rejoin), shared rejoin tail. */
export const winback = workflow({
  id: 'winback',
  trigger: trigger.event(e.subscription_cancelled),
  goal: purchaser,
})
  .delay('1 day')
  .branch(
    'plan_split',
    [
      eq(u.subscription_plan, 'business'),
      (w) => w.slack(csAlert, { plan: u.subscription_plan }).exit('handed_to_cs'),
    ],
    [eq(u.subscription_plan, 'pro'), (w) => w.email(proTips)],
    (w) => w.email(gettingStarted)
  )
  .delay('7 days')
  .email(limitedTimeOffer, { coupon: 'COMEBACK20', expiresIn: '72 hours' });

const cameBack = performed(e.login, { within: '7 days' });

/** Segment trigger, wait_until, in-arm exit, trailing single-arm branch with a cohort. */
export const reengagement = workflow({ id: 'reengagement', trigger: trigger.segment(inactive30d) })
  .email(firstTimeRecovery)
  .waitUntil(cameBack, { timeout: '7 days', onTimeout: 'continue' })
  .branch([cameBack, (w) => w.exit('reengaged')])
  .email(proTips)
  .delay('7 days')
  .branch([
    not(cameBack),
    (w) =>
      w.cohort({
        control: { weight: 50 },
        coupon: {
          weight: 50,
          flow: (x) => x.email(limitedTimeOffer, { coupon: 'BACK15', expiresIn: '48 hours' }),
        },
      }),
  ]);

/** send_event coverage: emits an event at the end of the flow. */
export const nudge = workflow({ id: 'nudge', trigger: trigger.event(e.sign_up) })
  .email(gettingStarted)
  .sendEvent(e.nudge_due);

export const allWorkflows = [checkoutRecovery, winback, reengagement, nudge];
