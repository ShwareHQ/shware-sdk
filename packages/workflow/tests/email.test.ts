import { createElement } from 'react';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { journeyWorker } from '../src/cloudflare/worker';
import { useEmailContext } from '../src/email-context';
import {
  ConfigCompileError,
  type EmailTemplate,
  compileConfig,
  defineConfig,
  emailTemplate,
  event,
  resolveEmail,
  trigger,
  workflow,
} from '../src/index';
import { registryRenderer } from '../src/react-email';
import { D1JourneyStore } from '../src/store/d1';
import { FakeD1, FakeJourney, FakeKV } from './fake-cloudflare';

/**
 * Email metadata: each template's own `from` / `replyTo`, and the unsubscribe link resolved
 * template first, then the config's `email.unsubscribeUrl` — the same rule for the renderer
 * (and its context), the Worker's preview and the compile checks.
 */

const named = z.strictObject({ name: z.string() });

/** A shared layout: renders the resolved unsubscribe link, when there is one. */
function Layout({ name }: { name: string }) {
  const { unsubscribeUrl } = useEmailContext();
  return createElement(
    'div',
    null,
    createElement('p', null, `Hi ${name}`),
    unsubscribeUrl === undefined
      ? null
      : createElement('a', { href: unsubscribeUrl }, 'Unsubscribe')
  );
}

const welcome = emailTemplate({
  id: 'welcome',
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
    expect(resolveEmail(ok)).toEqual({ from: 'a@b.c' });
    expect(() => emailTemplate({ ...base, from: 'a@b.c', replyTo: '' })).toThrow(/replyTo/);
    for (const url of ['', null, false, 'ftp://acme.test/u', '/unsubscribe']) {
      expect(() => emailTemplate({ ...base, from: 'a@b.c', unsubscribeUrl: url } as never)).toThrow(
        /unsubscribeUrl must be an http\(s\) URL/
      );
    }
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
      unsubscribeUrl: 'https://acme.test/newsletter/unsubscribe',
    });
    expect(resolveEmail(welcome, global)).toEqual({
      from: { email: 'noreply@acme.test', name: 'Acme' },
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

  test('outside a render that provides it, useEmailContext() says so', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    expect(() => renderToStaticMarkup(createElement(Layout, { name: 'Ada' }))).toThrow(
      /useEmailContext\(\) is called outside an email render/
    );
  });
});

describe('the config', () => {
  const e = event<{ login: { method: string } }>();
  const flow = workflow({ id: 'welcome', trigger: trigger.event(e.login) }).email(welcome, {
    name: 'friend',
  });

  test('`emails` is refused with how to migrate, not silently dropped', () => {
    const stale = { ...defineConfig({ workflows: [flow], templates: { email: { welcome } } }) };
    Object.assign(stale, { emails: { from: 'noreply@acme.test' } });
    expect(() => compileConfig(stale)).toThrow(ConfigCompileError);
    expect(() => compileConfig(stale)).toThrow(/declared on each emailTemplate/);
    expect(() => journeyWorker({ config: stale })).toThrow(/`emails` is gone/);
  });

  test('email.unsubscribeUrl and quickClickMs are checked', () => {
    const config = (email: object) =>
      defineConfig({ workflows: [flow], templates: { email: { welcome } }, email });
    expect(() => compileConfig(config({ unsubscribeUrl: 'https://acme.test/u' }))).not.toThrow();
    expect(() => compileConfig(config({ unsubscribeUrl: '' }))).toThrow(/email.unsubscribeUrl/);
    expect(() => compileConfig(config({ tracking: { quickClickMs: -1 } }))).toThrow(/quickClickMs/);
  });

  test('every registered template is checked, used or not, naming its id', () => {
    const forged = { ...newsletter, from: '' } as unknown as EmailTemplate;
    expect(() =>
      compileConfig(
        defineConfig({ workflows: [flow], templates: { email: { welcome, unused: forged } } })
      )
    ).toThrow(/email template 'weekly_newsletter': from must be/);
  });
});

describe("the Worker's preview", () => {
  test('finds a template by id, with the resolved unsubscribe link', async () => {
    const config = defineConfig({
      workflows: [],
      templates: { email: { welcomeAlias: welcome } },
      email: { unsubscribeUrl: 'https://acme.test/unsubscribe' },
    });
    const env = { JOURNEY: new FakeJourney() };
    const worker = journeyWorker<typeof env>({
      store: () => new D1JourneyStore(new FakeD1(), new FakeKV()),
      config,
    });
    const props = encodeURIComponent('{"name":"Ada"}');
    const found = await worker.fetch(new Request(`http://w/preview/welcome?props=${props}`), env);
    expect(found.status).toBe(200);
    expect(await found.text()).toContain('href="https://acme.test/unsubscribe"');
    const alias = await worker.fetch(
      new Request(`http://w/preview/welcomeAlias?props=${props}`),
      env
    );
    expect(alias.status).toBe(404);
  });
});
