import * as z from 'zod/mini';
import type { MessageSender } from '../../src/engine/ports';
import { PermanentError } from '../../src/engine/retry';
import {
  action,
  and,
  defineConfig,
  defineContract,
  discordTemplate,
  eq,
  flow,
  gte,
  not,
  performed,
  reachable,
  segment,
  slackTemplate,
  template,
  templatesFor,
  trigger,
  workflow,
} from '../../src/index';

/**
 * The journeys every host runs, and what they are seen to do.
 *
 * One config: each scenario starts the workflow it is about with that workflow's own event, so
 * the hosts all deploy the same bundle. The outlets are the same on every host too — the
 * actions below and one message sender — and both write to `probe`, which is what a scenario
 * reads back. Nothing here knows which host it runs on.
 */

/* ---------------------------------- probe ----------------------------------- */

export interface ActionCall {
  action: string;
  args: Record<string, unknown>;
  userId: string;
  /** The idempotency key, with the instance id replaced by what it stands for (see `stableKey`). */
  key: string;
}

export interface SentCopy {
  channel: string;
  template: string;
  props: Record<string, unknown>;
  userId: string;
  recipient: string | undefined;
  /** A push: the platform of the device this copy went to. */
  platform: string | undefined;
  topic: string | null | undefined;
  key: string;
}

/** What the journeys did, in order, and how the outlets are told to misbehave. */
export const probe = {
  actions: [] as ActionCall[],
  sent: [] as SentCopy[],
  /** How many more calls of an action throw a failure a retry gets past. */
  failing: new Map<string, number>(),
  /** Templates the sender refuses for good, by the reason it gives. */
  refusing: new Map<string, string>(),
  /** How many more sends of a template (or of `template→recipient`) fail in a way a retry gets past. */
  unavailable: new Map<string, number>(),
  /** Instance ids in the order they were first seen, per workflow and user. */
  seen: new Map<string, string[]>(),
  reset() {
    this.actions.length = 0;
    this.sent.length = 0;
    this.failing.clear();
    this.refusing.clear();
    this.unavailable.clear();
    this.seen.clear();
  },
};

/**
 * An idempotency key without the instance id's host-dependent parts (the entry's time, the
 * occurrence): `<workflow>/<user>#<n>:<node...>`, where `n` counts that user's instances of the
 * workflow in the order they first acted. The workflow and user ids here hold no '-', so the id
 * splits cleanly (`buildInstanceId`: name-hash-user-fingerprint-ts-occurrence).
 */
export function stableKey(key: string): string {
  const cut = key.indexOf(':');
  const instanceId = cut === -1 ? key : key.slice(0, cut);
  const [workflowId, , userId] = instanceId.split('-');
  const group = `${workflowId}/${userId}`;
  const known = probe.seen.get(group) ?? [];
  if (!known.includes(instanceId)) known.push(instanceId);
  probe.seen.set(group, known);
  return `${group}#${known.indexOf(instanceId) + 1}${cut === -1 ? '' : key.slice(cut)}`;
}

/** The one sender every host hands its copies to. */
export const sender: MessageSender = {
  async send(message) {
    probe.sent.push({
      channel: message.channel,
      template: message.template,
      props: message.props,
      userId: message.userId,
      recipient: message.recipient,
      platform: message.device?.platform,
      topic: message.topic,
      key: stableKey(message.idempotencyKey),
    });
    for (const what of [message.template, `${message.template}→${message.recipient}`]) {
      const left = probe.unavailable.get(what) ?? 0;
      if (left > 0) {
        probe.unavailable.set(what, left - 1);
        throw new Error(`'${what}': provider unavailable`);
      }
    }
    const reason = probe.refusing.get(message.template);
    if (reason !== undefined) {
      throw new PermanentError(`the provider refused '${message.template}'`, { reason });
    }
  },
};

/* --------------------------------- contract --------------------------------- */

const nothing = z.looseObject({});

export const contract = defineContract({
  events: {
    order: z.looseObject({ total: z.number(), coupon: z.optional(z.string()) }),
    login: nothing,
    purchase: nothing,
    // Ends a hold (see `hold` below)
    release: nothing,
    nudge_due: z.looseObject({ level: z.number(), plan: z.optional(z.string()) }),
    // One start event per workflow below
    start_nap: nothing,
    start_random_nap: nothing,
    start_window: nothing,
    start_channels: nothing,
    start_push_all: nothing,
    start_push_latest: nothing,
    start_prefer: nothing,
    start_filter: nothing,
    start_cohort: nothing,
    start_emitter: nothing,
    start_wait: nothing,
    start_wait_exit: nothing,
    start_wait_continue: nothing,
    start_wait_profile: nothing,
    start_wait_device: nothing,
    start_brief: nothing,
    start_brief_exit: nothing,
    start_brief_continue: nothing,
    start_goal: nothing,
    start_goal_stays: nothing,
    start_exit_when: nothing,
    start_exit: nothing,
    start_never: nothing,
    start_after_exit: nothing,
    start_concurrent: nothing,
    start_after_exit_cooldown: nothing,
    start_concurrent_cooldown: nothing,
    start_flaky: nothing,
    start_broken: nothing,
    start_refused: nothing,
    start_strict: nothing,
    start_tips: nothing,
    start_visitor: nothing,
  },
  profile: z.looseObject({
    email: z.optional(z.string()),
    phone: z.optional(z.string()),
    // Declared required, yet absent until someone writes it: what `strict` runs into
    name: z.string(),
    plan: z.optional(z.string()),
  }),
  subscriptions: { topics: ['tips'] },
});

const e = contract.events;
const u = contract.user;
const { emailTemplate, pushTemplate } = templatesFor(contract);

/* --------------------------------- actions ---------------------------------- */

type Args = Record<string, string | number | boolean | undefined>;

/** An action that only says it ran — unless the probe tells it to fail first. */
const note = (name: string) =>
  action<Args>(name, async (args, ctx) => {
    probe.actions.push({
      action: name,
      args,
      userId: ctx.userId,
      key: stableKey(ctx.idempotencyKey),
    });
    const left = probe.failing.get(name) ?? 0;
    if (left > 0) {
      probe.failing.set(name, left - 1);
      throw new Error(`${name}: provider unavailable`);
    }
  });

const first = note('first');
const second = note('second');
const after = note('after');
const big = note('big');
const small = note('small');
const armA = note('arm_a');
const armB = note('arm_b');
const heard = note('heard');
const woke = note('woke');
const timedOut = note('timed_out');
const mark = note('mark');
const flaky = note('flaky');
const broken = action('broken', async (_args, ctx) => {
  probe.actions.push({
    action: 'broken',
    args: {},
    userId: ctx.userId,
    key: stableKey(ctx.idempotencyKey),
  });
  throw new PermanentError('a retry would only repeat this');
});

export const actions = [
  first,
  second,
  after,
  big,
  small,
  armA,
  armB,
  heard,
  woke,
  timedOut,
  mark,
  flaky,
  broken,
];

/* -------------------------------- templates --------------------------------- */

const named = z.strictObject({ name: z.string() });
const empty = z.strictObject({});

const emails = {
  welcome: emailTemplate({
    id: 'welcome',
    transactional: true,
    from: 'noreply@acme.test',
    title: 'Welcome',
    props: named,
    subject: 'Welcome',
    preview: { name: 'A' },
    component: () => null,
  }),
  receipt: emailTemplate({
    id: 'receipt',
    transactional: true,
    from: 'noreply@acme.test',
    title: 'Receipt',
    props: empty,
    subject: 'Receipt',
    preview: {},
    component: () => null,
  }),
  tips: emailTemplate({
    id: 'tips',
    topic: 'tips',
    from: 'noreply@acme.test',
    title: 'Tips',
    props: empty,
    subject: 'Tips',
    preview: {},
    component: () => null,
  }),
};

const pushes = {
  ping: pushTemplate({
    id: 'ping',
    transactional: true,
    title: 'Ping',
    props: empty,
    preview: {},
    content: () => ({ title: 'Ping', body: 'Ping' }),
  }),
  tips: pushTemplate({
    id: 'tips',
    topic: 'tips',
    title: 'Tips',
    props: empty,
    preview: {},
    content: () => ({ title: 'Tips', body: 'Tips' }),
  }),
};

const slacks = {
  alert: slackTemplate({
    id: 'alert',
    title: 'Alert',
    props: empty,
    preview: {},
    webhook: () => 'https://hooks.slack.com/services/T/B/x',
    content: () => ({ text: 'alert' }),
  }),
};

const discords = {
  alert: discordTemplate({
    id: 'alert',
    title: 'Alert',
    props: empty,
    preview: {},
    webhook: () => 'https://discord.com/api/webhooks/1/x',
    content: () => ({ content: 'alert' }),
  }),
};

const otp = template.sms<{ code: string }>('otp');
const banner = template.inApp('banner');
const nps = template.survey('nps');

/* --------------------------------- segments --------------------------------- */

/** Entered by something the user does. */
const pro = segment({ id: 'pro', condition: eq(u.plan, 'pro') });
/** Entered by the clock alone, a week after a trial user's last login: only the sweep sees it. */
const dormant = segment({
  id: 'dormant',
  condition: and(eq(u.plan, 'trial'), not(performed(e.login, { within: '7 days' }))),
});

/* --------------------------------- workflows -------------------------------- */

/** When the date trigger fires: a day after every scenario starts. */
export const DATE_AT = '2026-12-02 09:00:00';

const order = trigger.event(e.order);
const nudge = trigger.event(e.nudge_due);
const again = { mode: 'concurrent' } as const;
const once = { mode: 'never' } as const;

/**
 * Keeps an instance where it is until the user's `release` event: a wait rather than a delay,
 * because every host can hold an instance on a wait and be told when to let it go. The timeout
 * is longer than any scenario lasts — and under 2^31 ms (24.8 days), past which the timer the
 * local durable runner keeps a callback's timeout on fires at once.
 */
const hold = flow((w) => w.waitUntil(performed(e.release), { timeout: '14 days' }));

const workflows = [
  // An action, its args from the trigger payload and the profile
  workflow({ id: 'order', reentry: again, trigger: order }).run(first, {
    total: order.payload.total,
    plan: u.plan,
  }),
  // Both gates of an event trigger: the payload and the profile
  workflow({
    id: 'gated',
    reentry: again,
    trigger: trigger.event(e.order, (p) => gte(p.total, 1_000), { filter: eq(u.plan, 'pro') }),
  }).run(big),
  // A branch on the trigger payload, both arms rejoining
  workflow({ id: 'branch', reentry: again, trigger: order })
    .branch([gte(order.payload.total, 100), (w) => w.run(big)], (w) => w.run(small))
    .run(after),

  workflow({ id: 'nap', reentry: again, trigger: trigger.event(e.start_nap) })
    .run(first)
    .delay('1 hour')
    .run(second),
  workflow({ id: 'random_nap', reentry: again, trigger: trigger.event(e.start_random_nap) })
    .delay({ min: '1 hour', max: '2 hours' })
    .run(second),
  // Every scenario starts on a Tuesday at 09:00 UTC: the window opens two hours later
  workflow({ id: 'window', reentry: again, trigger: trigger.event(e.start_window) })
    .timeWindow({ days: ['tue'], between: ['11:00', '12:00'], tz: 'UTC' })
    .run(second),

  workflow({ id: 'channels', reentry: again, trigger: trigger.event(e.start_channels) })
    .email(emails.welcome, { name: u.name })
    .sms(otp, { code: '4711' })
    .inApp(banner)
    .survey(nps)
    .slack(slacks.alert, {})
    .discord(discords.alert, {}),
  workflow({ id: 'push_all', reentry: again, trigger: trigger.event(e.start_push_all) })
    .push(pushes.ping, {})
    .run(after),
  workflow({ id: 'push_latest', reentry: again, trigger: trigger.event(e.start_push_latest) })
    .push(pushes.ping, {}, { devices: 'latest' })
    .run(after),
  workflow({ id: 'prefer', reentry: again, trigger: trigger.event(e.start_prefer) }).prefer(
    [pushes.ping, emails.receipt],
    {}
  ),

  workflow({ id: 'filter', reentry: again, trigger: trigger.event(e.start_filter) })
    .filter(eq(u.plan, 'pro'), { reason: 'pro only' })
    .run(after),
  workflow({ id: 'cohort', reentry: again, trigger: trigger.event(e.start_cohort) })
    .cohort(
      { a: { weight: 50, flow: (w) => w.run(armA) }, b: { weight: 50, flow: (w) => w.run(armB) } },
      { key: 'conformance' }
    )
    .run(after),

  // One journey starts another through an event it emits
  workflow({ id: 'emitter', reentry: again, trigger: trigger.event(e.start_emitter) })
    .sendEvent(e.nudge_due, { level: 3, plan: u.plan })
    .run(after),
  workflow({ id: 'listener', reentry: again, trigger: nudge }).run(heard, {
    level: nudge.payload.level,
    plan: nudge.payload.plan,
  }),

  workflow({ id: 'wait', reentry: again, trigger: trigger.event(e.start_wait) })
    .waitUntil(performed(e.login), { timeout: '1 hour', onTimeout: (w) => w.run(timedOut) })
    .run(woke),
  workflow({ id: 'wait_exit', reentry: again, trigger: trigger.event(e.start_wait_exit) })
    .waitUntil(performed(e.login), { timeout: '1 hour', onTimeout: 'exit' })
    .run(woke),
  workflow({ id: 'wait_continue', reentry: again, trigger: trigger.event(e.start_wait_continue) })
    .waitUntil(performed(e.login), { timeout: '1 hour' })
    .run(woke),

  // Waits answered by something other than an event: the profile, the device directory
  workflow({ id: 'wait_profile', reentry: again, trigger: trigger.event(e.start_wait_profile) })
    .waitUntil(eq(u.plan, 'pro'), { timeout: '14 days' })
    .run(woke),
  workflow({ id: 'wait_device', reentry: again, trigger: trigger.event(e.start_wait_device) })
    .waitUntil(reachable('push'), { timeout: '14 days' })
    .run(woke),
  // The same three ways out of a wait nobody answers, a second long: short enough to wait out
  // on a host whose waits end by the real clock
  workflow({ id: 'brief', reentry: again, trigger: trigger.event(e.start_brief) })
    .waitUntil(performed(e.login), { timeout: '1 second', onTimeout: (w) => w.run(timedOut) })
    .run(woke),
  workflow({ id: 'brief_exit', reentry: again, trigger: trigger.event(e.start_brief_exit) })
    .waitUntil(performed(e.login), { timeout: '1 second', onTimeout: 'exit' })
    .run(woke),
  workflow({ id: 'brief_continue', reentry: again, trigger: trigger.event(e.start_brief_continue) })
    .waitUntil(performed(e.login), { timeout: '1 second' })
    .run(woke),

  workflow({
    id: 'goal',
    reentry: again,
    trigger: trigger.event(e.start_goal),
    goal: performed(e.purchase),
  })
    .run(first)
    .use(hold)
    .run(second),
  // A goal that only records the conversion
  workflow({
    id: 'goal_stays',
    reentry: again,
    trigger: trigger.event(e.start_goal_stays),
    goal: { condition: performed(e.purchase), exitOnMatch: false },
  })
    .run(first)
    .use(hold)
    .run(second),
  workflow({
    id: 'exit_when',
    reentry: again,
    trigger: trigger.event(e.start_exit_when),
    exitWhen: eq(u.plan, 'churned'),
  })
    .run(first)
    .use(hold)
    .run(second),
  workflow({ id: 'exit', reentry: again, trigger: trigger.event(e.start_exit) })
    .run(first)
    .branch([eq(u.plan, 'free'), (w) => w.exit('free plan')])
    .run(second),

  // Entered by a segment, by a date, and never (a webhook has no route yet)
  workflow({ id: 'became_pro', reentry: again, trigger: trigger.enters(pro) }).run(mark, {
    via: 'pro',
  }),
  workflow({ id: 'went_dormant', reentry: once, trigger: trigger.enters(dormant) }).run(mark, {
    via: 'dormant',
  }),
  workflow({
    id: 'dated',
    reentry: once,
    trigger: trigger.date(DATE_AT, { filter: eq(u.plan, 'pro') }),
  }).run(mark, { via: 'date' }),
  workflow({ id: 'hooked', reentry: once, trigger: trigger.webhook() }).run(mark, {
    via: 'webhook',
  }),

  // Every re-entry policy, over the same body
  workflow({ id: 'never', reentry: once, trigger: trigger.event(e.start_never) })
    .run(mark)
    .use(hold),
  workflow({
    id: 'after_exit',
    reentry: { mode: 'after_exit' },
    trigger: trigger.event(e.start_after_exit),
  })
    .run(mark)
    .use(hold),
  workflow({ id: 'concurrent', reentry: again, trigger: trigger.event(e.start_concurrent) })
    .run(mark)
    .use(hold),
  workflow({
    id: 'after_exit_cooldown',
    reentry: { mode: 'after_exit', cooldown: '1 day' },
    trigger: trigger.event(e.start_after_exit_cooldown),
  })
    .run(mark)
    .use(hold),
  workflow({
    id: 'concurrent_cooldown',
    reentry: { mode: 'concurrent', cooldown: '1 day' },
    trigger: trigger.event(e.start_concurrent_cooldown),
  })
    .run(mark)
    .use(hold),

  // Failure paths
  workflow({ id: 'flaky', reentry: again, trigger: trigger.event(e.start_flaky) })
    .run(first)
    .run(flaky)
    .run(second),
  workflow({ id: 'broken', reentry: again, trigger: trigger.event(e.start_broken) })
    .run(first)
    .run(broken)
    .run(second),
  workflow({ id: 'refused', reentry: again, trigger: trigger.event(e.start_refused) })
    .email(emails.receipt, {})
    .run(after),
  // The template wants a name; a user without one has nothing to give it
  workflow({ id: 'strict', reentry: again, trigger: trigger.event(e.start_strict) })
    .run(first)
    .email(emails.welcome, { name: u.name })
    .run(second),

  // Lifecycle
  workflow({ id: 'tips', reentry: again, trigger: trigger.event(e.start_tips) })
    .email(emails.tips, {})
    .push(pushes.tips, {})
    .email(emails.receipt, {})
    .run(after),
  workflow({
    id: 'visitor',
    reentry: again,
    trigger: trigger.event(e.start_visitor, { visitors: true }),
  })
    .run(first)
    .use(hold)
    .run(second)
    .email(emails.receipt, {}),
];

export const config = defineConfig({
  contract,
  workflows,
  segments: [pro, dormant],
  actions,
  templates: { email: emails, push: pushes, slack: slacks, discord: discords },
  email: { unsubscribeUrl: 'https://acme.test/unsubscribe' },
});
