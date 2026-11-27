import { expect, test } from 'vitest';
import { optional, strictObject, string } from 'zod/mini';
import { defineContract, emailTemplate, trigger, workflow } from '../src/index';

/**
 * What the README promises about an optional profile field: its reference may be absent, so a
 * template that requires the prop does not take it, and one that makes it optional does.
 */
const contract = defineContract({
  events: { login: strictObject({}) },
  profile: strictObject({ name: optional(string()), plan: string() }),
});
const { events: e, user: u } = contract;

const required = emailTemplate({
  id: 'required',
  transactional: true,
  from: 'noreply@acme.test',
  title: 'required',
  props: strictObject({ name: string() }),
  subject: 'required',
  preview: { name: 'Ada' },
  component: () => null,
});
const lenient = emailTemplate({
  id: 'lenient',
  transactional: true,
  from: 'noreply@acme.test',
  title: 'lenient',
  props: strictObject({ name: optional(string()) }),
  subject: 'lenient',
  preview: {},
  component: () => null,
});

test('an optional profile field does not satisfy a required template prop', () => {
  const start = () =>
    workflow({ id: 'w', reentry: { mode: 'never' }, trigger: trigger.event(e.login) });
  // @ts-expect-error -- u.name may be absent; the template requires it
  start().email(required, { name: u.name });
  // A field declared required is taken at its word
  start().email(required, { name: u.plan });
  expect(start().email(lenient, { name: u.name }).toIR().flow).toHaveLength(1);
});
