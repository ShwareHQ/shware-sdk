/**
 * Every way to get a template's kind wrong, for `template-errors.test.ts`, which runs `tsc` over
 * this file and asserts what the editor says. Not part of the package's own type check (the
 * package tsconfig excludes this folder); every line here is meant to fail.
 */
import * as z from 'zod/mini';
import { defineContract, emailTemplate, pushTemplate, templatesFor } from '../../../src/index';

const contract = defineContract({
  events: {},
  profile: z.strictObject({}),
  subscriptions: { topics: ['promotions', 'newsletter'] },
});
const bound = templatesFor(contract);

const email = {
  from: 'noreply@acme.test',
  title: 'T',
  props: z.strictObject({ name: z.string() }),
  subject: 's',
  preview: { name: 'Ada' },
  component: () => null,
};
const push = {
  title: 'P',
  props: z.strictObject({ name: z.string() }),
  preview: { name: 'Ada' },
  content: () => ({ title: 't', body: 'b' }),
};

// Each `// mistake: <name>` marks the call on the next line; the test finds the diagnostics by it.
// mistake: email_neither
emailTemplate({ id: 'email_neither', ...email });
// mistake: push_neither
pushTemplate({ id: 'push_neither', ...push });
// mistake: email_both
emailTemplate({ id: 'email_both', topic: 'promotions', transactional: true, ...email });
// mistake: push_both
pushTemplate({ id: 'push_both', topic: 'promotions', transactional: true, ...push });
// mistake: email_url (a transactional email with an unsubscribe link)
emailTemplate({
  id: 'email_url',
  transactional: true,
  unsubscribeUrl: 'https://a.test/u',
  ...email,
});
// mistake: email_bool (transactional as a boolean, not the literal)
emailTemplate({ id: 'email_bool', transactional: Boolean(1), ...email });
// mistake: email_undeclared (a topic the contract does not declare, at the template)
bound.emailTemplate({ id: 'email_undeclared', topic: 'digest', ...email });
// mistake: push_undeclared
bound.pushTemplate({ id: 'push_undeclared', topic: 'digest', ...push });
// the bound factories accept what the contract declares, and transactional templates
bound.emailTemplate({ id: 'email_ok', topic: 'promotions', ...email });
bound.pushTemplate({ id: 'push_ok', transactional: true, ...push });
