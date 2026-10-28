/**
 * prefer() type-safety regression tests, on the public API with templates
 * built by the real emailTemplate / pushTemplate factories.
 * Validated by `tsc --noEmit` like types.test-d.ts: every `@ts-expect-error`
 * must hit an error; this file never executes.
 */
import { z } from 'zod';
import {
  type PreferOptions,
  emailTemplate,
  exists,
  flow,
  pushTemplate,
  template,
  trigger,
  user,
  workflow,
} from '../src/index';
import { e } from './fixtures';

const pu = user<{ userId: string; name: string; nick?: string; age: number }>();

const email = <S extends z.ZodObject>(props: S, preview: z.input<S>) =>
  emailTemplate({
    id: 'e',
    transactional: true,
    from: 'noreply@acme.test',
    title: 'E',
    props,
    subject: 's',
    preview,
    component: () => null,
  });
const push = <S extends z.ZodObject>(props: S, preview: z.input<S>) =>
  pushTemplate({ id: 'p', title: 'P', props, preview, content: () => ({ title: 't', body: 'b' }) });

const templates = {
  email: {
    tip: email(z.strictObject({ name: z.string() }), { name: 'Ada' }),
    tipMin: email(z.strictObject({ name: z.string().min(3) }), { name: 'Ada' }),
    tipCoupon: email(z.strictObject({ name: z.string(), coupon: z.string() }), {
      name: 'Ada',
      coupon: 'X',
    }),
    tipOptCoupon: email(z.strictObject({ name: z.string(), coupon: z.string().optional() }), {
      name: 'Ada',
    }),
    plan: email(z.strictObject({ plan: z.enum(['free', 'pro']).optional() }), {}),
    nick: email(z.strictObject({ nick: z.string().optional() }), {}),
    empty: email(z.strictObject({}), {}),
  },
  push: {
    tip: push(z.strictObject({ name: z.string() }), { name: 'Ada' }),
    tipNumber: push(z.strictObject({ name: z.number() }), { name: 1 }),
    tipOptional: push(z.strictObject({ name: z.string().optional() }), {}),
    tipLiteral: push(z.strictObject({ name: z.enum(['Ada', 'Alex']) }), { name: 'Ada' }),
    plan: push(z.strictObject({ plan: z.enum(['free', 'pro']).optional() }), {}),
    nick: push(z.strictObject({ nick: z.string().optional() }), {}),
    empty: push(z.strictObject({}), {}),
  },
};

const w = workflow({ id: 'prefer_types', trigger: trigger.event(e.login) });

/* ---------------------------------- accepted ---------------------------------- */

// either order; literal or matching reference props; with or without a label
w.prefer([templates.push.tip, templates.email.tip], { name: 'Ada' });
w.prefer([templates.email.tip, templates.push.tip], { name: pu.name }, { label: 'tip by channel' });
// static types match even though the email adds `.min(3)` — that is the compiler's to check
w.prefer([templates.push.tip, templates.email.tipMin], { name: pu.name });
// optional props: {} or a compatible reference; enums take their literals
w.prefer([templates.push.nick, templates.email.nick], {});
w.prefer([templates.push.nick, templates.email.nick], { nick: pu.nick });
w.prefer([templates.email.plan, templates.push.plan], { plan: 'pro' });
// templates without props still pass {} explicitly
w.prefer([templates.push.empty, templates.email.empty], {});
// candidates kept in a readonly tuple
const tipChannels = [templates.push.tip, templates.email.tip] as const;
w.prefer(tipChannels, { name: pu.name });
// a props variable of exactly the declared shape
const tipProps = { name: pu.name };
w.prefer(tipChannels, tipProps);
// chains on, and works in fragments and sub-flows without hand-written generics
w.prefer(tipChannels, { name: 'Ada' }).delay('1 day').exit();
flow((f) => f.prefer([templates.push.tip, templates.email.tip], { name: pu.name }).delay('1 hour'));
w.branch([
  exists(pu.nick),
  (b) => b.prefer([templates.push.tip, templates.email.tip], { name: 'Ada' }),
]);
w.use((f) => f.prefer([templates.email.tip, templates.push.tip], { name: 'Ada' }));
const label: PreferOptions = { label: 'x' };
w.prefer(tipChannels, { name: 'Ada' }, label);

/* ---------------------------- rejected: props types ---------------------------- */

// @ts-expect-error string vs number props
w.prefer([templates.push.tipNumber, templates.email.tip], { name: 1 });
// @ts-expect-error the email declares one more field
w.prefer([templates.push.tip, templates.email.tipCoupon], { name: 'Ada' });
// @ts-expect-error the email declares one more field, even an optional one
w.prefer([templates.push.tip, templates.email.tipOptCoupon], { name: 'Ada' });
// @ts-expect-error required vs optional
w.prefer([templates.push.tipOptional, templates.email.tip], { name: 'Ada' });
// @ts-expect-error string vs a narrower literal union
w.prefer([templates.push.tipLiteral, templates.email.tip], { name: 'Ada' });
// @ts-expect-error required vs empty props
w.prefer([templates.push.tip, templates.email.empty], { name: 'Ada' });
// @ts-expect-error empty vs required props
w.prefer([templates.push.empty, templates.email.tip], {});

/* ------------------------------- rejected: props ------------------------------- */

// @ts-expect-error a required field is missing
w.prefer(tipChannels, {});
// @ts-expect-error wrong literal type
w.prefer(tipChannels, { name: 1 });
// @ts-expect-error a reference of the wrong type
w.prefer(tipChannels, { name: pu.age });
// @ts-expect-error an optional reference cannot fill a required field
w.prefer(tipChannels, { name: pu.nick });
// @ts-expect-error props are never omitted
w.prefer(tipChannels);
// @ts-expect-error props are never omitted, even when the templates declare none
w.prefer([templates.push.empty, templates.email.empty]);
// @ts-expect-error nor when every field is optional
w.prefer([templates.push.nick, templates.email.nick]);
// @ts-expect-error undefined is not props
w.prefer([templates.push.empty, templates.email.empty], undefined);
// @ts-expect-error an extra field in an object literal
w.prefer(tipChannels, { name: 'Ada', extra: true });
const extraProps = { name: 'Ada', extra: true };
// @ts-expect-error an extra field in a variable
w.prefer(tipChannels, extraProps);
declare const unionProps: { name: string } | { name: string; extra: boolean };
// @ts-expect-error an extra field on one member of a union variable
w.prefer(tipChannels, unionProps);
// @ts-expect-error an empty schema takes no field at all
w.prefer([templates.push.empty, templates.email.empty], { extra: true });

/* ----------------------------- rejected: candidates ---------------------------- */

// @ts-expect-error no candidates
w.prefer([], {});
// @ts-expect-error a single candidate
w.prefer([templates.push.tip], { name: 'Ada' });
// @ts-expect-error three candidates
w.prefer([templates.push.tip, templates.email.tip, templates.email.tip], { name: 'Ada' });
// @ts-expect-error two pushes
w.prefer([templates.push.tip, templates.push.tip], { name: 'Ada' });
// @ts-expect-error two emails
w.prefer([templates.email.tip, templates.email.tip], { name: 'Ada' });
// @ts-expect-error other channels are not candidates
w.prefer([template.sms<{ name: string }>('sms_tip'), templates.email.tip], { name: 'Ada' });
const loose = [templates.push.tip, templates.email.tip];
// @ts-expect-error a plain array has lost which candidate comes first
w.prefer(loose, { name: 'Ada' });

/* ------------------------------- rejected: options ----------------------------- */

// @ts-expect-error props do not go in the third argument
w.prefer(tipChannels, {}, { name: 'Ada' });
// @ts-expect-error options take only a label
w.prefer(tipChannels, { name: 'Ada' }, { label: 'x', devices: 'latest' });
