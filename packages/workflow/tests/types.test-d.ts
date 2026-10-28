/**
 * Type-safety regression tests.
 *
 * Validated by `tsc --noEmit` (the tests/ directory is in tsconfig include):
 * every `@ts-expect-error` line must produce exactly the error it claims,
 * otherwise the unused directive itself fails the build. `expectTypeOf`
 * assertions are erased at runtime — this file never executes.
 */
import { expectTypeOf } from 'vitest';
import {
  type Duration,
  type EmailAddress,
  type PropsOf,
  type Topic,
  type UserPropertyRef,
  action,
  between,
  contains,
  defineConfig,
  defineContract,
  emailTemplate,
  eq,
  exists,
  flow,
  gt,
  gte,
  inArray,
  lte,
  notBetween,
  performed,
  pushTemplate,
  slackTemplate,
  templatesFor,
  trigger,
  workflow,
} from '../src/index';
import { e, gettingStarted, limitedTimeOffer, u, upgradeRecovery } from './fixtures';

/* ------------------------------ reference tables ------------------------------ */

// property refs carry the property's exact type as a phantom
expectTypeOf(u.subscription_plan).toEqualTypeOf<UserPropertyRef<'free' | 'pro' | 'business'>>();
expectTypeOf(u.docs_count).toEqualTypeOf<UserPropertyRef<number>>();

// @ts-expect-error only schema-declared properties exist on the ref table
exists(u.no_such_property);

// @ts-expect-error only schema-declared events exist on the ref table
trigger.event(e.no_such_event);

/* --------------------------------- predicates --------------------------------- */

// @ts-expect-error eq narrows the value to the property's type ('archived' is not a plan status)
eq(u.subscription_status, 'archived');

// @ts-expect-error NoInfer keeps typos out of the inferred union
eq(u.subscription_plan, 'enterprise');

// @ts-expect-error contains only accepts string-typed refs (docs_count is a number)
contains(u.docs_count, '1');

// @ts-expect-error gt/lt/between reject boolean refs
gt(u.auto_renew_enabled, true);

// @ts-expect-error gte/lte reject boolean refs too
gte(u.auto_renew_enabled, true);

// @ts-expect-error ...on both sides of the pair
lte(u.auto_renew_enabled, false);

// @ts-expect-error between bounds must match the ref type
between(u.docs_count, 1, '9');

// @ts-expect-error notBetween bounds follow the same rule
notBetween(u.docs_count, '1', 9);

// @ts-expect-error inArray element type follows the ref
inArray(u.subscription_plan, ['pro', 'vip']);

/* ------------------------------- workflow options ------------------------------ */

// @ts-expect-error trigger must be a trigger.xxx() asset, not a bare string
workflow({ id: 'bad', trigger: 'sign_up' });

/* ------------------------------ messages and props ----------------------------- */

// @ts-expect-error template props values are typed (plan is a union, not free text)
flow((w) => w.email(upgradeRecovery, { plan: 'enterprise' }));

// @ts-expect-error declared props are required
flow((w) => w.email(upgradeRecovery));

// @ts-expect-error a ref must match the prop's declared type (email: string vs. the plan union)
flow((w) => w.email(upgradeRecovery, { plan: u.email }));

// templates without declared props need no props argument
flow((w) => w.email(gettingStarted));

/* ----------------------------------- durations --------------------------------- */

// @ts-expect-error duration literals are spelled out ('1 huor' is a typo)
flow((w) => w.delay('1 huor'));
expectTypeOf<'23 hours'>().toExtend<Duration>();

/* ----------------------------------- send_event -------------------------------- */

// @ts-expect-error sendEvent takes an event ref, not a name string
flow((w) => w.sendEvent('purchase'));

// @ts-expect-error payload fields follow the event's declared shape
flow((w) => w.sendEvent(e.purchase, { value: 'high', currency: 'USD' }));

/* ------------------------------ payload where refs ----------------------------- */

// payload refs are typed from the event's declared payload
performed(e.sign_up, (p) => eq(p.method, 'google'));
trigger.event(e.purchase, (p) => gt(p.value, 100));

// @ts-expect-error payload values follow the declared field type
performed(e.sign_up, (p) => eq(p.method, 'facebook'));

// @ts-expect-error unknown payload fields do not compile
performed(e.sign_up, (p) => eq(p.platform, 'web'));

// @ts-expect-error gt rejects non-numeric payload fields (currency is a string — value must match)
trigger.event(e.purchase, (p) => gt(p.currency, 100));

/* ---------------------------------- actions ---------------------------------- */

const issueCoupon = action<{ code: string; email: string }>('issue_coupon', async () => {});
flow((w) => w.run(issueCoupon, { code: 'X', email: u.email }));
// @ts-expect-error action args are typed by the ActionRef (code must be a string)
flow((w) => w.run(issueCoupon, { code: 42, email: u.email }));
// @ts-expect-error the action declares required args, so omitting them fails
flow((w) => w.run(issueCoupon));

/* -------------------------------- misc positives ------------------------------- */

// branch tuples contextually type both the condition and the sub-flow
workflow({ id: 'ok', trigger: trigger.event(e.login) }).branch(
  [exists(u.email), (w) => w.email(limitedTimeOffer, { coupon: 'X', expiresIn: '1 day' })],
  (w) => w.exit()
);

/* ------------------------- schema-driven templates (v1) ------------------------- */

import { z } from 'zod';

const namedSchema = z.strictObject({ name: z.string(), plan: z.enum(['free', 'pro']).optional() });

const welcomeEmail = emailTemplate({
  id: 'welcome',
  transactional: true,
  from: 'noreply@acme.test',
  title: 'Welcome',
  props: namedSchema,
  subject: 'Hi',
  preview: { name: 'Ada' },
  component: ({ name, plan }) => {
    expectTypeOf(name).toEqualTypeOf<string>();
    expectTypeOf(plan).toEqualTypeOf<'free' | 'pro' | undefined>();
    return null;
  },
});

// Email metadata: from is required and an address; replyTo and unsubscribeUrl are typed when given
// @ts-expect-error an email template must name its sender
emailTemplate({
  id: 'x',
  transactional: true,
  title: 'X',
  props: namedSchema,
  subject: 's',
  preview: { name: 'A' },
  component: () => null,
});
emailTemplate({
  id: 'x',
  transactional: true,
  // @ts-expect-error from is an address, a string or { email, name? }
  from: { name: 'Acme' },
  title: 'X',
  props: namedSchema,
  subject: 's',
  preview: { name: 'A' },
  component: () => null,
});
emailTemplate({
  id: 'x',
  transactional: true,
  from: 'a@acme.test',
  // @ts-expect-error unsubscribeUrl is a URL string, not a switch
  unsubscribeUrl: false,
  title: 'X',
  props: namedSchema,
  subject: 's',
  preview: { name: 'A' },
  component: (props) => {
    // @ts-expect-error metadata never reaches the component's props
    void props.from;
    return null;
  },
});
expectTypeOf(welcomeEmail.from).toEqualTypeOf<EmailAddress>();

const creditsPush = pushTemplate({
  id: 'credits',
  transactional: true,
  title: 'Credits',
  props: z.strictObject({ credits: z.number() }),
  preview: { credits: 3 },
  content: ({ credits }) => ({ title: `${credits} left`, body: 'b' }),
});

emailTemplate({
  id: 'x',
  transactional: true,
  from: 'noreply@acme.test',
  title: 'Bad preview',
  props: namedSchema,
  subject: 'Hi',
  // @ts-expect-error the preview is missing a required field
  preview: {},
  component: () => null,
});

emailTemplate({
  id: 'x',
  transactional: true,
  from: 'noreply@acme.test',
  title: 'Bad preview',
  props: namedSchema,
  subject: 'Hi',
  // @ts-expect-error the preview has the wrong type for a field
  preview: { name: 3 },
  component: () => null,
});

emailTemplate({
  id: 'x',
  transactional: true,
  from: 'noreply@acme.test',
  title: 'Bad preview',
  props: namedSchema,
  subject: 'Hi',
  // @ts-expect-error an object literal preview cannot add fields the schema does not declare
  preview: { name: 'Ada', extra: true },
  component: () => null,
});

emailTemplate({
  id: 'x',
  transactional: true,
  from: 'noreply@acme.test',
  title: 'No widening',
  props: namedSchema,
  subject: 'Hi',
  preview: { name: 'Ada' },
  // @ts-expect-error the component cannot read a field the schema does not declare
  component: ({ missing }) => missing,
});

pushTemplate({
  id: 'x',
  transactional: true,
  title: 'Async',
  props: namedSchema,
  preview: { name: 'Ada' },
  // @ts-expect-error push content must be synchronous
  content: async () => ({ title: 't', body: 'b' }),
});

pushTemplate({
  id: 'x',
  transactional: true,
  title: 'Empty',
  props: z.strictObject({}),
  preview: {},
  content: () => ({ title: 't', body: 'b' }),
});

pushTemplate({
  id: 'x',
  transactional: true,
  title: 'Empty',
  props: z.strictObject({}),
  // @ts-expect-error an empty schema accepts only an empty preview
  preview: { name: 'Ada' },
  content: () => ({ title: 't', body: 'b' }),
});

// the definitions themselves type the calls: props from each template's schema
const emptyPush = pushTemplate({
  id: 'ping',
  transactional: true,
  title: 'Ping',
  props: z.strictObject({}),
  preview: {},
  content: () => ({ title: 't', body: 'b' }),
});
expectTypeOf<PropsOf<typeof welcomeEmail>>().toEqualTypeOf<{
  name: string;
  plan?: 'free' | 'pro' | undefined;
}>();
expectTypeOf<PropsOf<typeof creditsPush>>().toEqualTypeOf<{ credits: number }>();
expectTypeOf(welcomeEmail.id).toEqualTypeOf<string>();
// @ts-expect-error the id is read-only
welcomeEmail.id = 'renamed';
// @ts-expect-error a template has an id
pushTemplate({
  title: 'No id',
  props: z.strictObject({}),
  preview: {},
  content: () => ({ title: 't', body: 'b' }),
});
emailTemplate({
  // @ts-expect-error an id is a string
  id: 1,
  transactional: true,
  from: 'noreply@acme.test',
  title: 'x',
  props: namedSchema,
  subject: 's',
  preview: { name: 'A' },
  component: () => null,
});

workflow({ id: 'schema_empty', trigger: trigger.event(e.sign_up) })
  .push(emptyPush)
  .push(emptyPush, {})
  // @ts-expect-error an empty schema takes no props
  .push(emptyPush, { name: 'Ada' });

workflow({ id: 'schema', trigger: trigger.event(e.sign_up) })
  .email(welcomeEmail, { name: 'Ada' })
  .email(welcomeEmail, { name: 'Ada', plan: 'pro' })
  .push(creditsPush, { credits: u.docs_count })
  .push(creditsPush, { credits: 3 }, { devices: 'latest' });

workflow({ id: 'schema_bad', trigger: trigger.event(e.sign_up) })
  // @ts-expect-error required props cannot be omitted
  .push(creditsPush, {})
  // @ts-expect-error a user ref of the wrong type
  .push(creditsPush, { credits: u.subscription_plan })
  // @ts-expect-error an email template is not a push template
  .push(welcomeEmail, { name: 'Ada' })
  // @ts-expect-error a field the schema does not declare
  .email(welcomeEmail, { name: 'Ada', extra: 1 });

// webhook templates keep the host's Env and type their props the same way
const alert = slackTemplate<z.ZodObject<{ plan: z.ZodString }>, { WEBHOOK_SLACK: string }>({
  id: 'alert',
  title: 'Alert',
  props: z.strictObject({ plan: z.string() }),
  preview: { plan: 'pro' },
  webhook: (env) => env.WEBHOOK_SLACK,
  content: ({ plan }) => ({ text: plan }),
});
workflow({ id: 'webhook', trigger: trigger.event(e.sign_up) })
  .slack(alert, { plan: 'pro' })
  // @ts-expect-error a slack template is not a discord template
  .discord(alert, { plan: 'pro' });

/* ------------------------------- shared contract ------------------------------- */

import { JourneyClient } from '../src/client';

const shared = defineContract({
  events: {
    login: z.looseObject({ method: z.string() }),
    purchase: z.looseObject({ transaction_id: z.string(), value: z.number() }),
  },
  profile: z.strictObject({ email: z.email().optional(), name: z.string() }),
});

// payload refs come from the declared fields only — a loose object's extra keys are not spellable
expectTypeOf(shared.user.name).toEqualTypeOf<UserPropertyRef<string>>();
expectTypeOf(shared.user.userId).toEqualTypeOf<UserPropertyRef<string>>();
// @ts-expect-error undeclared profile field
exists(shared.user.plan);
performed(shared.events.purchase, (p) => gt(p.value, 10));
// @ts-expect-error undeclared payload field of a loose event
performed(shared.events.login, (p) => eq(p.session, 'x'));

const producer = new JourneyClient({ origin: 'https://w.test', contract: shared });
void producer.track('u1', 'purchase', { transaction_id: 't', value: 1 }, { id: 'row' });
void producer.track('u1', 'login', { method: 'email', extra: true });
// @ts-expect-error unknown event name
void producer.track('u1', 'signup', {});
// @ts-expect-error missing payload field
void producer.track('u1', 'purchase', { transaction_id: 't' });
// @ts-expect-error wrong payload type
void producer.track('u1', 'purchase', { transaction_id: 't', value: '1' });
void producer.identify('u1', { name: 'Ada', email: null });
// @ts-expect-error undeclared profile field in a patch
void producer.identify('u1', { plan: 'pro' });

// without a contract the client stays untyped
void new JourneyClient({ origin: 'https://w.test' }).track('u1', 'anything', { a: 1 });

/* ------------------------------ emitted payloads ------------------------------- */

const orders = defineContract({
  events: {
    order: z.looseObject({ id: z.string(), total: z.number(), items: z.array(z.string()) }),
    note: z.looseObject({ text: z.string(), tags: z.array(z.string()).optional() }),
  },
  profile: z.strictObject({ name: z.string() }),
});

// scalar fields (or profile refs to them) can be emitted; an optional nested field may be left out
workflow({ id: 'emit_ok', trigger: trigger.event(orders.events.note) }).sendEvent(
  orders.events.note,
  {
    text: orders.user.name,
  }
);
workflow({ id: 'emit_nested', trigger: trigger.event(orders.events.note) })
  // @ts-expect-error a required nested field cannot be emitted from a journey
  .sendEvent(orders.events.order, { id: 'o', total: 1, items: ['a'] });

/* ------------------------------ email topics ------------------------------ */

const topical = defineContract({
  events: {},
  profile: z.strictObject({}),
  subscriptions: { topics: ['promotions', 'newsletter'] },
});
expectTypeOf(topical.topics).toEqualTypeOf<readonly ('promotions' | 'newsletter')[]>();
expectTypeOf<Topic<typeof topical>>().toEqualTypeOf<'promotions' | 'newsletter'>();
expectTypeOf<Topic<typeof shared>>().toEqualTypeOf<never>();

const emailBase = {
  from: 'noreply@acme.test',
  title: 'T',
  props: namedSchema,
  subject: 's',
  preview: { name: 'Ada' },
  component: () => null,
};

// @ts-expect-error every email template says what it is: a topic, or transactional
emailTemplate({ id: 'neither', ...emailBase });

// @ts-expect-error not both
emailTemplate({ id: 'both', topic: 'promotions', transactional: true, ...emailBase });

// @ts-expect-error transactional is the literal true, never a boolean variable
emailTemplate({ id: 'maybe', transactional: Boolean(1), ...emailBase });

// @ts-expect-error a transactional email has no unsubscribe link
emailTemplate({
  id: 'receipt',
  transactional: true,
  unsubscribeUrl: 'https://a.test/u',
  ...emailBase,
});

const promo = emailTemplate({ id: 'promo', topic: 'promotions', ...emailBase });
const digest = emailTemplate({ id: 'digest', topic: 'digest', ...emailBase });
const receipt = emailTemplate({ id: 'receipt', transactional: true, ...emailBase });
expectTypeOf(promo.topic).toEqualTypeOf<'promotions' | null>();
expectTypeOf(receipt.topic).toEqualTypeOf<null>();

// A config typed by its contract accepts the topics it declares, and transactional emails
defineConfig({ contract: topical, workflows: [], templates: { email: { promo, receipt } } });

// @ts-expect-error ...but not a topic the contract does not declare
defineConfig({ contract: topical, workflows: [], templates: { email: { promo, digest } } });

// @ts-expect-error without a contract there are no topics: transactional emails only
defineConfig({ workflows: [], templates: { email: { promo } } });
defineConfig({ workflows: [], templates: { email: { receipt } } });

/* ------------------------------ templatesFor ------------------------------ */

// The bound factories: the topic is typed by the contract, at the template itself
const bound = templatesFor(topical);
const boundPromo = bound.emailTemplate({ id: 'promo', topic: 'promotions', ...emailBase });
const boundReceipt = bound.emailTemplate({ id: 'receipt', transactional: true, ...emailBase });
expectTypeOf(boundPromo.topic).toEqualTypeOf<'promotions' | null>();
expectTypeOf(boundReceipt.topic).toEqualTypeOf<null>();
// @ts-expect-error a topic the contract does not declare fails here, not at the config
bound.emailTemplate({ id: 'digest', topic: 'digest', ...emailBase });
// @ts-expect-error neither, here too
bound.emailTemplate({ id: 'neither', ...emailBase });
defineConfig({
  contract: topical,
  workflows: [],
  templates: { email: { boundPromo, boundReceipt } },
});

/* ------------------------------ push topics ------------------------------ */

const pushBase = {
  title: 'P',
  props: namedSchema,
  preview: { name: 'Ada' },
  content: () => ({ title: 't', body: 'b' }),
};

// @ts-expect-error every push template says what it is: a topic, or transactional
pushTemplate({ id: 'neither', ...pushBase });

// @ts-expect-error not both
pushTemplate({ id: 'both', topic: 'promotions', transactional: true, ...pushBase });

// @ts-expect-error transactional is the literal true, never a boolean variable
pushTemplate({ id: 'maybe', transactional: Boolean(1), ...pushBase });

const promoPush = pushTemplate({ id: 'promo_push', topic: 'promotions', ...pushBase });
const digestPush = pushTemplate({ id: 'digest_push', topic: 'digest', ...pushBase });
const codePush = pushTemplate({ id: 'code_push', transactional: true, ...pushBase });
expectTypeOf(promoPush.topic).toEqualTypeOf<'promotions' | null>();
expectTypeOf(codePush.topic).toEqualTypeOf<null>();
const boundPush = bound.pushTemplate({ id: 'promo_push', topic: 'newsletter', ...pushBase });
expectTypeOf(boundPush.topic).toEqualTypeOf<'newsletter' | null>();
// @ts-expect-error a push topic the contract does not declare fails at the template
bound.pushTemplate({ id: 'digest_push', topic: 'digest', ...pushBase });

// The same topics type both channels' registries
defineConfig({
  contract: topical,
  workflows: [],
  templates: { email: { promo, receipt }, push: { promoPush, codePush } },
});

// @ts-expect-error a push topic the contract does not declare
defineConfig({ contract: topical, workflows: [], templates: { push: { promoPush, digestPush } } });

// @ts-expect-error without a contract there are no topics: transactional pushes only
defineConfig({ workflows: [], templates: { push: { promoPush } } });
defineConfig({ workflows: [], templates: { push: { codePush } } });

/* ------------------------------ subscriptions client ------------------------------ */

const subscriptions = new JourneyClient({ contract: topical, origin: 'https://w.test' });
expectTypeOf(subscriptions.getSubscriptions('u')).resolves.toEqualTypeOf<{
  email: { all: boolean; topics: Record<'promotions' | 'newsletter', boolean> };
  push: { all: boolean; topics: Record<'promotions' | 'newsletter', boolean> };
}>();
void subscriptions.setSubscriptions('u', { email: { all: false, topics: { promotions: false } } });
void subscriptions.setSubscriptions('u', {
  push: { all: false },
  email: { topics: { newsletter: true } },
});
// @ts-expect-error only declared topics can be set
void subscriptions.setSubscriptions('u', { email: { topics: { digest: false } } });
// @ts-expect-error ...on push too
void subscriptions.setSubscriptions('u', { push: { topics: { digest: false } } });
// @ts-expect-error topics are per channel: there is no bare `topics`
void subscriptions.setSubscriptions('u', { topics: { promotions: false } });

const untyped = new JourneyClient({ origin: 'https://w.test' });
void untyped.setSubscriptions('u', { email: { topics: { anything: false } } });
