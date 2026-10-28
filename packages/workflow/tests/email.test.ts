import { createElement } from 'react';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { journeyWorker } from '../src/cloudflare/worker';
import { useEmailContext } from '../src/email-context';
import {
  ConfigCompileError,
  type EmailTemplate,
  compileConfig,
  defineConfig,
  defineContract,
  emailTemplate,
  pushTemplate,
  resolveEmail,
  trigger,
  workflow,
} from '../src/index';
import { registryRenderer } from '../src/react-email';
import { FakeJourney } from './fake-cloudflare';
import { type PgliteDatabase, pgliteDatabase } from './pglite';

/**
 * Email metadata: each template's own `from` / `replyTo`, what it is (a topic, or
 * transactional), and the unsubscribe link resolved template first, then the config's
 * `email.unsubscribeUrl`, never for a transactional email — the same rule for the renderer (and
 * its context), the Worker's preview and the compile checks.
 */

const named = z.strictObject({ name: z.string() });

const contract = defineContract({
  events: { login: z.looseObject({ method: z.string() }) },
  profile: z.strictObject({}),
  subscriptions: { topics: ['tips', 'newsletter'] },
});
const e = contract.events;

/** A shared layout: renders the resolved unsubscribe and preferences links, when there are any. */
function Layout({ name }: { name: string }) {
  const { unsubscribeUrl, preferencesUrl } = useEmailContext();
  return createElement(
    'div',
    null,
    createElement('p', null, `Hi ${name}`),
    unsubscribeUrl === undefined
      ? null
      : createElement('a', { href: unsubscribeUrl }, 'Unsubscribe'),
    preferencesUrl === undefined
      ? null
      : createElement('a', { href: preferencesUrl }, 'Email preferences')
  );
}

const welcome = emailTemplate({
  id: 'welcome',
  topic: 'tips',
  from: { email: 'noreply@acme.test', name: 'Acme' },
  replyTo: 'support@acme.test',
  title: 'Welcome',
  props: named,
  subject: 'Welcome',
  preview: { name: 'A' },
  component: ({ name }) => createElement(Layout, { name }),
});
const newsletter = emailTemplate({
  id: 'weekly_newsletter',
  topic: 'newsletter',
  from: 'newsletter@acme.test',
  unsubscribeUrl: 'https://acme.test/newsletter/unsubscribe',
  title: 'Newsletter',
  props: named,
  subject: 'This week',
  preview: { name: 'A' },
  component: ({ name }) => createElement(Layout, { name }),
});

const base = {
  id: 'x',
  topic: 'tips',
  title: 'X',
  props: named,
  subject: 's',
  preview: { name: 'A' },
  component: () => null,
};

describe('emailTemplate metadata', () => {
  test('from is required and checked, naming the template', () => {
    expect(() => emailTemplate(base as never)).toThrow(/emailTemplate\('x'\): from must be/);
    for (const from of [
      '',
      'not-an-address',
      { email: 'nope' },
      { email: 'a@b.c', name: 3 },
      null,
    ]) {
      expect(() => emailTemplate({ ...base, from } as never)).toThrow(TypeError);
    }
    expect(emailTemplate({ ...base, from: 'a@b.c' }).from).toBe('a@b.c');
    expect(emailTemplate({ ...base, from: { email: 'a@b.c', name: 'A' } }).from).toEqual({
      email: 'a@b.c',
      name: 'A',
    });
  });

  test('replyTo and unsubscribeUrl are optional, but never a disguised omission', () => {
    const ok = emailTemplate({
      ...base,
      from: 'a@b.c',
      replyTo: undefined,
      unsubscribeUrl: undefined,
    });
    expect(resolveEmail(ok)).toEqual({ from: 'a@b.c', topic: 'tips' });
    expect(() => emailTemplate({ ...base, from: 'a@b.c', replyTo: '' })).toThrow(/replyTo/);
    for (const url of ['', null, false, 'ftp://acme.test/u', '/unsubscribe']) {
      expect(() => emailTemplate({ ...base, from: 'a@b.c', unsubscribeUrl: url } as never)).toThrow(
        /unsubscribeUrl must be an http\(s\) URL/
      );
    }
  });

  test('a template says what it is: a topic, or transactional — never neither, never both', () => {
    const { topic: _topic, ...untyped } = base;
    expect(() => emailTemplate({ ...untyped, from: 'a@b.c' } as never)).toThrow(
      /emailTemplate\('x'\): every email template says what it is/
    );
    expect(() =>
      emailTemplate({ ...untyped, from: 'a@b.c', topic: 'tips', transactional: true } as never)
    ).toThrow(/give either 'topic' or 'transactional: true', not both/);
    expect(() =>
      emailTemplate({ ...untyped, from: 'a@b.c', transactional: 'yes' } as never)
    ).toThrow(/'transactional' must be the literal true/);
    expect(() =>
      emailTemplate({ ...untyped, from: 'a@b.c', transactional: false } as never)
    ).toThrow(/'transactional' must be the literal true/);
    for (const topic of ['', '  ', 3, null]) {
      expect(() => emailTemplate({ ...untyped, from: 'a@b.c', topic } as never)).toThrow(TypeError);
    }
    // A transactional email never carries an unsubscribe link, so it takes no URL for one
    expect(() =>
      emailTemplate({
        ...untyped,
        from: 'a@b.c',
        transactional: true,
        unsubscribeUrl: 'https://acme.test/u',
      } as never)
    ).toThrow(/a transactional email has no unsubscribe link/);
    const receipt = emailTemplate({ ...untyped, from: 'a@b.c', transactional: true });
    expect(receipt.topic).toBeNull();
    expect(receipt).not.toHaveProperty('transactional');
    expect(emailTemplate({ ...base, from: 'a@b.c' }).topic).toBe('tips');
  });

  test('a transactional email resolves to no unsubscribe link, whatever the config says', () => {
    const { topic: _topic, ...untyped } = base;
    const receipt = emailTemplate({ ...untyped, from: 'a@b.c', transactional: true });
    const resolved = resolveEmail(receipt, { unsubscribeUrl: 'https://acme.test/unsubscribe' });
    expect(resolved).toEqual({ from: 'a@b.c', topic: null });
    expect(resolved).not.toHaveProperty('unsubscribeUrl');
  });

  test('metadata is not props: the strict schema and the component never see it', async () => {
    let seen: unknown;
    const spy = emailTemplate({
      ...base,
      from: 'a@b.c',
      unsubscribeUrl: 'https://acme.test/u',
      component: (props) => {
        seen = props;
        return null;
      },
    });
    await registryRenderer({ spy })('x', { name: 'Ada' });
    expect(seen).toEqual({ name: 'Ada' });
  });
});

describe('resolveEmail', () => {
  test("the template's URL first, then the config's, then none; replyTo never inherited", () => {
    const global = { unsubscribeUrl: 'https://acme.test/unsubscribe' };
    expect(resolveEmail(newsletter, global)).toEqual({
      from: 'newsletter@acme.test',
      topic: 'newsletter',
      unsubscribeUrl: 'https://acme.test/newsletter/unsubscribe',
    });
    expect(resolveEmail(welcome, global)).toEqual({
      from: { email: 'noreply@acme.test', name: 'Acme' },
      topic: 'tips',
      replyTo: 'support@acme.test',
      unsubscribeUrl: 'https://acme.test/unsubscribe',
    });
    // The same template under another config resolves anew; neither object is touched
    expect(resolveEmail(welcome, { unsubscribeUrl: 'https://other.test/u' }).unsubscribeUrl).toBe(
      'https://other.test/u'
    );
    expect(resolveEmail(welcome)).not.toHaveProperty('unsubscribeUrl');
    expect(welcome).not.toHaveProperty('unsubscribeUrl');
    expect(global).toEqual({ unsubscribeUrl: 'https://acme.test/unsubscribe' });
  });
});

describe('the renderer provides the resolved email to its components', () => {
  const emails = { welcome, newsletter };

  test('the layout renders the link the email resolves to, and the render returns it', async () => {
    const render = registryRenderer(emails, { unsubscribeUrl: 'https://acme.test/unsubscribe' });
    const inherited = await render('welcome', { name: 'Ada' });
    expect(inherited).toMatchObject({
      from: { email: 'noreply@acme.test', name: 'Acme' },
      replyTo: 'support@acme.test',
      unsubscribeUrl: 'https://acme.test/unsubscribe',
    });
    expect(inherited.html).toContain('href="https://acme.test/unsubscribe"');
    const own = await render('weekly_newsletter', { name: 'Ada' });
    expect(own.html).toContain('href="https://acme.test/newsletter/unsubscribe"');
    expect(own).not.toHaveProperty('replyTo');
  });

  test('without any unsubscribe URL the layout renders no link', async () => {
    const { html, ...email } = await registryRenderer(emails)('welcome', { name: 'Ada' });
    expect(html).not.toContain('Unsubscribe');
    expect(email).not.toHaveProperty('unsubscribeUrl');
  });

  test('the preferences link is the config page with the copy as `m`, for a topic email with a message id', async () => {
    const messageId = '0190a3b8-0000-7000-8000-000000000001';
    const render = registryRenderer(emails, {
      unsubscribeUrl: 'https://acme.test/unsubscribe',
      preferencesUrl: 'https://acme.test/settings/email?lang=en',
    });
    const sent = await render('welcome', { name: 'Ada' }, { messageId });
    // The page's own query is kept; `m` is set beside it
    const expected = `https://acme.test/settings/email?lang=en&m=${messageId}`;
    expect(sent.preferencesUrl).toBe(expected);
    expect(sent.html).toContain(`href="${expected.replace('&', '&amp;')}"`);
    expect(sent.html).toContain('href="https://acme.test/unsubscribe"');
    // Without a message id (reporting off, or no origin) there is no link to a copy
    const untracked = await render('welcome', { name: 'Ada' });
    expect(untracked).not.toHaveProperty('preferencesUrl');
    expect(untracked.html).not.toContain('Email preferences');
    // Without the page configured, a message id gives nothing to link to
    const { html } = await registryRenderer(emails)('welcome', { name: 'Ada' }, { messageId });
    expect(html).not.toContain('Email preferences');
  });

  test('a transactional email never links to the preference page, message id or not', async () => {
    const { topic: _topic, ...untyped } = base;
    const receipt = emailTemplate({
      ...untyped,
      from: 'a@b.c',
      transactional: true,
      component: ({ name }) => createElement(Layout, { name }),
    });
    const config = {
      unsubscribeUrl: 'https://acme.test/unsubscribe',
      preferencesUrl: 'https://acme.test/settings/email',
    };
    const messageId = '0190a3b8-0000-7000-8000-000000000001';
    expect(resolveEmail(receipt, config, { messageId })).toEqual({ from: 'a@b.c', topic: null });
    const { html, ...resolved } = await registryRenderer({ receipt }, config)(
      'x',
      { name: 'Ada' },
      { messageId }
    );
    expect(resolved).not.toHaveProperty('preferencesUrl');
    expect(html).not.toContain('preferences');
    expect(html).not.toContain('Unsubscribe');
  });

  test('outside a render that provides it, useEmailContext() says so', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    expect(() => renderToStaticMarkup(createElement(Layout, { name: 'Ada' }))).toThrow(
      /useEmailContext\(\) is called outside an email render/
    );
  });
});

describe('the config', () => {
  const flow = workflow({ id: 'welcome', trigger: trigger.event(e.login) }).email(welcome, {
    name: 'friend',
  });

  test('`emails` is refused with how to migrate, not silently dropped', () => {
    const stale = {
      ...defineConfig({ contract, workflows: [flow], templates: { email: { welcome } } }),
    };
    Object.assign(stale, { emails: { from: 'noreply@acme.test' } });
    expect(() => compileConfig(stale)).toThrow(ConfigCompileError);
    expect(() => compileConfig(stale)).toThrow(/declared on each emailTemplate/);
    const store = () => {
      throw new Error('never opened');
    };
    expect(() => journeyWorker({ config: stale, store })).toThrow(/`emails` is gone/);
  });

  test('email.unsubscribeUrl and quickClickMs are checked', () => {
    const config = (email: object) =>
      defineConfig({ contract, workflows: [flow], templates: { email: { welcome } }, email });
    expect(() => compileConfig(config({ unsubscribeUrl: 'https://acme.test/u' }))).not.toThrow();
    expect(() => compileConfig(config({ unsubscribeUrl: '' }))).toThrow(/email.unsubscribeUrl/);
    expect(() => compileConfig(config({ tracking: { quickClickMs: -1 } }))).toThrow(/quickClickMs/);
  });

  test('email.preferencesUrl is a URL, and never the unsubscribe link in disguise', () => {
    const config = (email: object, template: typeof welcome | typeof newsletter = welcome) =>
      defineConfig({
        contract,
        workflows: [flow],
        templates: { email: { welcome: template } },
        email,
      });
    const preferencesUrl = 'https://acme.test/settings/email';
    expect(() => compileConfig(config({ preferencesUrl }))).not.toThrow();
    expect(() => compileConfig(config({ preferencesUrl: '' }))).toThrow(/email.preferencesUrl/);
    expect(() => compileConfig(config({ preferencesUrl: 'acme.test/p' }))).toThrow(
      /email.preferencesUrl must be an http\(s\) URL/
    );
    // The sender tells the unsubscribe link from the rest by origin and path: the same address
    // (whatever the query) would send the preferences link into the /t/u flow
    const unsubscribeUrl = 'https://acme.test/unsubscribe';
    expect(() => compileConfig(config({ unsubscribeUrl, preferencesUrl }))).not.toThrow();
    expect(() =>
      compileConfig(config({ unsubscribeUrl, preferencesUrl: `${unsubscribeUrl}?page=1` }))
    ).toThrow(/email.preferencesUrl must not share its origin and path with email.unsubscribeUrl/);
    // A template's own unsubscribe link at that address hijacks it the same way
    expect(() =>
      compileConfig(
        config({ preferencesUrl: 'https://acme.test/newsletter/unsubscribe' }, newsletter)
      )
    ).toThrow(/email template 'weekly_newsletter': its unsubscribeUrl shares/);
  });

  test('every registered template is checked, used or not, naming its id', () => {
    const forged = { ...newsletter, from: '' } as unknown as EmailTemplate<never, 'newsletter'>;
    expect(() =>
      compileConfig(
        defineConfig({
          contract,
          workflows: [flow],
          templates: { email: { welcome, unused: forged } },
        })
      )
    ).toThrow(/email template 'weekly_newsletter': from must be/);
  });

  test("a topic the contract does not declare fails the compile, naming the template and the contract's list", () => {
    const stray = emailTemplate({ ...base, topic: 'digest', from: 'a@b.c' });
    const config = defineConfig({
      contract,
      workflows: [flow],
      // The types catch it with a contract at hand; the compile catches a JS caller
      templates: { email: { welcome, stray: stray as never } },
    });
    expect(() => compileConfig(config)).toThrow(ConfigCompileError);
    expect(() => compileConfig(config)).toThrow(
      "email template 'x': topic 'digest' is not declared — the contract declares 'tips', 'newsletter'"
    );
    // No contract, or one without subscriptions: a topic email has nothing to be declared in
    const bare = defineConfig({
      workflows: [flow],
      templates: { email: { welcome: welcome as never } },
    });
    expect(() => compileConfig(bare)).toThrow(/the contract declares no topics/);
  });

  test('a push template is checked the same way, and the error names it as a push', () => {
    const stray = pushTemplate({
      id: 'nudge',
      topic: 'digest',
      title: 'Nudge',
      props: z.strictObject({}),
      preview: {},
      content: () => ({ title: 't', body: 'b' }),
    });
    const config = defineConfig({
      contract,
      workflows: [flow],
      templates: { email: { welcome }, push: { stray: stray as never } },
    });
    expect(() => compileConfig(config)).toThrow(ConfigCompileError);
    expect(() => compileConfig(config)).toThrow(
      "push template 'nudge': topic 'digest' is not declared — the contract declares 'tips', 'newsletter'"
    );
    // A push definition that did not come through pushTemplate() is checked for its kind too
    const { topic: _topic, ...neither } = stray;
    expect(() =>
      compileConfig(
        defineConfig({
          contract,
          workflows: [],
          templates: { push: { neither: neither as never } },
        })
      )
    ).toThrow(/push template 'nudge': every push template says what it is/);
  });

  test('a template that did not come through emailTemplate() is checked for its kind too', () => {
    const { topic: _topic, ...nothing } = welcome;
    const neither = nothing as unknown as EmailTemplate<never, 'tips'>;
    expect(() =>
      compileConfig(defineConfig({ contract, workflows: [], templates: { email: { neither } } }))
    ).toThrow(/email template 'welcome': every email template says what it is/);
    const both = { ...welcome, transactional: true } as unknown as EmailTemplate<never, 'tips'>;
    expect(() =>
      compileConfig(defineConfig({ contract, workflows: [], templates: { email: { both } } }))
    ).toThrow(/give either 'topic' or 'transactional: true', not both/);
    const receipt = { ...welcome, topic: null, unsubscribeUrl: 'https://acme.test/u' };
    expect(() =>
      compileConfig(
        defineConfig({
          contract,
          workflows: [],
          templates: { email: { receipt: receipt as never } },
        })
      )
    ).toThrow(/a transactional email has no unsubscribe link/);
  });
});

describe("the Worker's preview", () => {
  let database: PgliteDatabase;
  beforeAll(async () => {
    database = await pgliteDatabase();
  }, 30_000);
  afterAll(async () => {
    await database.close();
  });

  test('finds a template by id, with the resolved unsubscribe and preferences links', async () => {
    const config = defineConfig({
      contract,
      workflows: [],
      templates: { email: { welcomeAlias: welcome } },
      email: {
        unsubscribeUrl: 'https://acme.test/unsubscribe',
        preferencesUrl: 'https://acme.test/settings/email',
      },
    });
    // Development: a production host refuses to serve without API_TOKEN
    const env = { JOURNEY: new FakeJourney(), ENVIRONMENT: 'development' };
    const worker = journeyWorker<typeof env>({
      store: () => database.store,
      config,
    });
    const props = encodeURIComponent('{"name":"Ada"}');
    const found = await worker.fetch(new Request(`http://w/preview/welcome?props=${props}`), env);
    expect(found.status).toBe(200);
    const html = await found.text();
    expect(html).toContain('href="https://acme.test/unsubscribe"');
    // No copy to name: the placeholder id, so the footer shows as a sent email's would
    expect(html).toContain(
      'href="https://acme.test/settings/email?m=00000000-0000-0000-0000-000000000000"'
    );
    const alias = await worker.fetch(
      new Request(`http://w/preview/welcomeAlias?props=${props}`),
      env
    );
    expect(alias.status).toBe(404);
  });
});
