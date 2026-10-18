/** Public DSL argument contracts, checked by tsc; this file never executes. */
import { expectTypeOf } from 'vitest';
import * as z from 'zod/mini';
import {
  type ActionRef,
  type PropInput,
  type TemplateRef,
  type UserPropertyRef,
  action,
  contains,
  defineContract,
  event,
  exists,
  flow,
  performed,
  template,
} from '../src/index';

const emptySms = template.sms('empty_sms');
const emptyInApp = template.inApp('empty_in_app');
const emptySurvey = template.survey('empty_survey');
const emptyAction = action('empty_action', () => {});

flow((w) => w.sms(emptySms).sms(emptySms, {}));
flow((w) => w.inApp(emptyInApp).inApp(emptyInApp, {}));
flow((w) => w.survey(emptySurvey).survey(emptySurvey, {}));
flow((w) => w.run(emptyAction).run(emptyAction, {}));

// A reference cannot supply a value for a field whose declared value is impossible.
const neverRef: UserPropertyRef<never> = { type: 'user_property', path: 'undeclared' };
expectTypeOf<PropInput<never>>().toEqualTypeOf<never>();
// @ts-expect-error an empty template cannot acquire props through an impossible reference
flow((w) => w.sms(emptySms, { surprise: neverRef }));
// @ts-expect-error an empty action cannot acquire args through an impossible reference
flow((w) => w.run(emptyAction, { surprise: neverRef }));

// @ts-expect-error an empty template does not accept scalar props
flow((w) => w.sms(emptySms, 42));
// @ts-expect-error an empty template does not accept undeclared props
flow((w) => w.sms(emptySms, { surprise: true }));
// @ts-expect-error an empty template does not accept null
flow((w) => w.inApp(emptyInApp, null));
// @ts-expect-error an empty template does not accept arrays
flow((w) => w.survey(emptySurvey, []));
// @ts-expect-error an empty action does not accept scalar args
flow((w) => w.run(emptyAction, 42));
// @ts-expect-error an empty action does not accept undeclared args
flow((w) => w.run(emptyAction, { surprise: true }));

const optionalSms = template.sms<{ label?: string }>('optional_sms');
const requiredSms = template.sms<{ code: string }>('required_sms');
const optionalAction = action<{ label?: string }>('optional_action', () => {});
const requiredAction = action<{ code: string }>('required_action', () => {});
flow((w) => w.sms(optionalSms).sms(optionalSms, {}).sms(optionalSms, { label: 'ok' }));
flow((w) => w.run(optionalAction).run(optionalAction, {}).run(optionalAction, { label: 'ok' }));
flow((w) => w.sms(requiredSms, { code: 'ok' }).run(requiredAction, { code: 'ok' }));
// @ts-expect-error optional props still retain their declared value type
flow((w) => w.sms(optionalSms, { label: 42 }));
// @ts-expect-error required template props cannot be omitted
flow((w) => w.sms(requiredSms));
// @ts-expect-error required action args cannot be omitted
flow((w) => w.run(requiredAction));

// A bare reference type erases the shape for registries, not for factory defaults.
const templates: TemplateRef[] = [emptySms, requiredSms, optionalSms, emptyInApp];
const actions: ActionRef[] = [emptyAction, requiredAction, optionalAction];
void templates;
void actions;

const events = event<{
  empty: Record<string, never>;
  optional: { label?: string };
  required: { code: string };
  indexed: Record<string, string>;
  union: { code: string } | { score?: number };
}>();
flow((w) => w.sendEvent(events.empty).sendEvent(events.empty, {}));
flow((w) => w.sendEvent(events.optional).sendEvent(events.optional, { label: 'ok' }));
flow((w) => w.sendEvent(events.required, { code: 'ok' }));
flow((w) => w.sendEvent(events.indexed).sendEvent(events.indexed, { arbitrary: 'ok' }));
flow((w) => w.sendEvent(events.union).sendEvent(events.union, { score: 1 }));
// @ts-expect-error an empty event cannot acquire payload fields through an impossible reference
flow((w) => w.sendEvent(events.empty, { surprise: neverRef }));
// @ts-expect-error an empty event does not accept undeclared fields
flow((w) => w.sendEvent(events.empty, { surprise: true }));
// @ts-expect-error an event with required fields needs a payload
flow((w) => w.sendEvent(events.required));

// Empty dictionaries describe no fields, while a real string index still exposes its values.
// @ts-expect-error an empty event has no payload field to test for existence
performed(events.empty, (p) => exists(p.surprise));
// @ts-expect-error an empty event has no string payload field to search
performed(events.empty, (p) => contains(p.surprise, 'x'));
performed(events.indexed, (p) => contains(p.arbitrary, 'x'));
performed(events.optional, (p) => exists(p.label));
performed(events.required, (p) => contains(p.code, 'x'));

const nested = event<{
  nested: {
    empty: Record<string, never>;
    indexed: Record<string, string>;
    optional?: { label: string };
    impossible: never;
    union: { shared: string; left: number } | { shared: string; right: boolean };
  };
}>();
performed(nested.nested, (p) => exists(p.empty));
performed(nested.nested, (p) => contains(p.indexed.arbitrary, 'x'));
performed(nested.nested, (p) => contains(p.optional.label, 'x'));
performed(nested.nested, (p) => contains(p.union.shared, 'x'));
// @ts-expect-error an empty nested dictionary exposes no child fields
performed(nested.nested, (p) => exists(p.empty.surprise));
// @ts-expect-error a never-valued field is absent from payload refs
performed(nested.nested, (p) => exists(p.impossible));
// @ts-expect-error union refs expose only fields shared by every variant
performed(nested.nested, (p) => exists(p.union.left));

const contract = defineContract({
  events: { note: z.looseObject({ text: z.string(), score: z.optional(z.number()) }) },
  profile: z.strictObject({ name: z.string() }),
});
// DeclaredOutput must remove a loose schema's index signature without erasing fields.
expectTypeOf<keyof typeof contract.events>().toEqualTypeOf<'note'>();
flow((w) => w.sendEvent(contract.events.note, { text: 'ok' }));
flow((w) => w.sendEvent(contract.events.note, { text: 'ok', score: 1 }));
// @ts-expect-error a loose schema's undeclared keys are not exposed by the DSL
flow((w) => w.sendEvent(contract.events.note, { text: 'ok', extra: true }));
// @ts-expect-error a declared required field remains required
flow((w) => w.sendEvent(contract.events.note));
