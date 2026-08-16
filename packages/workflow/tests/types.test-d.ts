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
  type TemplateRef,
  type UserPropertyRef,
  between,
  contains,
  emailSubject,
  eq,
  exists,
  flow,
  gt,
  gte,
  inArray,
  lte,
  notBetween,
  performed,
  templates,
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
workflow('bad', { trigger: 'sign_up' });

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

/* ------------------------------ subject templates ------------------------------ */

// {{ user.prop }} placeholders resolve against the user-property table
emailSubject(u, 'Finish upgrading to {{ user.subscription_plan }}');
emailSubject(u, '{{ user.email }}: {{ user.docs_count }} docs on {{ user.subscription_plan }}');
emailSubject(u, 'no placeholders is fine too');

// @ts-expect-error a typo inside the braces does not compile
emailSubject(u, 'Finish upgrading to {{ user.subscription_plann }}');

// @ts-expect-error every placeholder is checked, not just the first
emailSubject(u, '{{ user.email }} and {{ user.not_a_property }}');

/* ------------------------------ template registries ---------------------------- */

type Registry = {
  welcome: { default: (props: { name: string }) => unknown };
  bare: { default: () => unknown };
};
const t = templates<Registry>();

// props are inferred from the registered component's signature
expectTypeOf(t.email('welcome')).toEqualTypeOf<TemplateRef<'email', { name: string }>>();

// @ts-expect-error unregistered keys do not compile
t.email('welcom');

// a registered template's props flow through to the send site
flow((w) => w.email(t.email('welcome'), { name: 'Ada' }));
// @ts-expect-error ...and are checked there
flow((w) => w.email(t.email('welcome'), { name: 1 }));

/* -------------------------------- misc positives ------------------------------- */

// branch tuples contextually type both the condition and the sub-flow
workflow('ok', { trigger: trigger.event(e.login) }).branch(
  [exists(u.email), (w) => w.email(limitedTimeOffer, { coupon: 'X', expiresIn: '1 day' })],
  (w) => w.exit()
);
