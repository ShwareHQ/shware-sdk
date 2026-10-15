import { Suspense, createContext, createElement, use, useContext } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { registryPushRenderer } from '../src/push';
import { registryRenderer } from '../src/react-email';
import {
  TemplateValidationError,
  emailTemplate,
  pushTemplate,
  registryValidator,
} from '../src/templates';

const named = z.strictObject({ name: z.string() });

describe('emailTemplate / pushTemplate declarations', () => {
  test('accept a strict scalar schema and a matching preview', () => {
    const t = emailTemplate({
      title: 'Welcome',
      props: z.strictObject({
        name: z.string().min(1),
        plan: z.enum(['free', 'pro']).optional(),
        credits: z.number(),
        trial: z.boolean(),
        tier: z.literal('gold').optional(),
        email: z.email(),
      }),
      subject: 'Hi',
      preview: { name: 'Ada', credits: 3, trial: true, email: 'ada@acme.test' },
      component: ({ name }) => createElement('p', null, name),
    });
    expect(t.kind).toBe('email-template');
  });

  test.each([
    ['a non-strict object', z.object({ name: z.string() })],
    ['a looseObject', z.looseObject({ name: z.string() })],
    ['a nested object', z.strictObject({ user: z.strictObject({ name: z.string() }) })],
    ['an array', z.strictObject({ tags: z.array(z.string()) })],
    ['a nullable field', z.strictObject({ name: z.string().nullable() })],
    ['a default', z.strictObject({ name: z.string().default('x') })],
    ['a transform', z.strictObject({ name: z.string().transform((s) => s.length) })],
    ['a coercion', z.strictObject({ n: z.coerce.number() })],
    ['a custom refinement', z.strictObject({ name: z.string().refine((s) => s !== 'x') })],
    [
      'a value-changing check (.overwrite)',
      z.strictObject({ n: z.number().overwrite((n) => n + 1) }),
    ],
    ['a value-changing check (.trim)', z.strictObject({ name: z.string().trim() })],
    [
      'a value-changing check on an optional field',
      z.strictObject({ name: z.string().toLowerCase().optional() }),
    ],
    [
      'a value-changing check on the optional wrapper itself',
      z.strictObject({
        n: z
          .number()
          .optional()
          .overwrite((n) => n),
      }),
    ],
    [
      'a custom refinement on the optional wrapper itself',
      z.strictObject({
        n: z
          .number()
          .optional()
          .refine(() => true),
      }),
    ],
  ])('reject %s at declaration', (_label, schema) => {
    expect(() =>
      pushTemplate({
        title: 'Bad',
        props: schema as never,
        preview: {} as never,
        content: () => ({ title: 't', body: 'b' }),
      })
    ).toThrow(/unsupported props schema/);
  });

  test('a preview that does not parse fails the declaration, naming the field', () => {
    expect(() =>
      emailTemplate({
        title: 'Welcome',
        props: named,
        subject: 'Hi',
        preview: { name: 3 } as never,
        component: () => null,
      })
    ).toThrow(/name preview:/);
  });

  test('declaring never runs the component or the content', () => {
    const component = vi.fn(() => null);
    const content = vi.fn(() => ({ title: 't', body: 'b' }));
    emailTemplate({ title: 'E', props: named, subject: 's', preview: { name: 'A' }, component });
    pushTemplate({ title: 'P', props: named, preview: { name: 'A' }, content });
    expect(component).not.toHaveBeenCalled();
    expect(content).not.toHaveBeenCalled();
  });
});

describe('email rendering', () => {
  const component = vi.fn(({ name }: { name: string }) => createElement('p', null, `Hi ${name}`));
  const emails = {
    welcome: emailTemplate({
      title: 'Welcome',
      props: named,
      subject: 'Welcome {{ user.name }}',
      preview: { name: 'A' },
      component,
    }),
  };

  test('renders the parsed props as an element after the doctype; the subject goes out as written', async () => {
    const { subject, html } = await registryRenderer(emails)('welcome', { name: 'Ada' });
    expect(html.startsWith('<!DOCTYPE html PUBLIC')).toBe(true);
    expect(html.endsWith('<p>Hi Ada</p>')).toBe(true);
    expect(subject).toBe('Welcome {{ user.name }}');
    await expect(registryRenderer(emails)('nope', {})).rejects.toThrow(
      'unknown email template: nope'
    );
  });

  test.each([
    ['a missing field', {}],
    ['a wrong type', { name: 3 }],
    ['an unknown field', { name: 'Ada', extra: 1 }],
    ['an unresolved reference', { name: undefined }],
  ])('refuses %s without calling the component', async (_label, props) => {
    component.mockClear();
    await expect(registryRenderer(emails)('welcome', props as never)).rejects.toBeInstanceOf(
      TemplateValidationError
    );
    expect(component).not.toHaveBeenCalled();
  });

  test('hooks and context work, because components render as elements', async () => {
    const Brand = createContext('Acme');
    const withContext = {
      ctx: emailTemplate({
        title: 'Ctx',
        props: named,
        subject: 's',
        preview: { name: 'A' },
        component: function Ctx({ name }) {
          return createElement('p', null, `${useContext(Brand)} ${name}`);
        },
      }),
    };
    const { html } = await registryRenderer(withContext)('ctx', { name: 'Ada' });
    expect(html).toContain('Acme Ada');
  });
});

describe('push rendering', () => {
  test('content gets the parsed props; braces in its result are never expanded', async () => {
    const pushes = {
      tip: pushTemplate({
        title: 'Tip (studio name)',
        props: named,
        preview: { name: 'A' },
        content: ({ name }) => ({ title: `Hi ${name}`, body: 'Use {name} or {{ user.x }} freely' }),
      }),
    };
    expect(await registryPushRenderer(pushes)('tip', { name: '{evil}' })).toEqual({
      title: 'Hi {evil}',
      body: 'Use {name} or {{ user.x }} freely',
    });
  });

  test('a push may name where a tap leads', async () => {
    const pushes = {
      offer: pushTemplate({
        title: 'Offer',
        props: named,
        preview: { name: 'A' },
        content: ({ name }) => ({ title: `Hi ${name}`, body: 'b', url: '/pricing' }),
      }),
    };
    expect(await registryPushRenderer(pushes)('offer', { name: 'Ada' })).toEqual({
      title: 'Hi Ada',
      body: 'b',
      url: '/pricing',
    });
  });

  test('an input failure never calls content; a bad result was called but is refused', async () => {
    const content = vi.fn(() => ({ title: 't', body: 'b' }));
    const pushes = {
      tip: pushTemplate({ title: 'Tip', props: named, preview: { name: 'A' }, content }),
    };
    const error = await registryPushRenderer(pushes)('tip', {}).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'TemplateValidationError', phase: 'props' });
    expect(content).not.toHaveBeenCalled();

    const broken = {
      tip: pushTemplate({
        title: 'Tip',
        props: named,
        preview: { name: 'A' },
        // A Promise smuggled past the types
        content: (() => Promise.resolve({ title: 't', body: 'b' })) as never,
      }),
    };
    await expect(registryPushRenderer(broken)('tip', { name: 'Ada' })).rejects.toMatchObject({
      phase: 'content',
    });
  });
});

describe('registryValidator', () => {
  const content = vi.fn(({ name }: { name: string }) => ({ title: name, body: 'b' }));
  const validator = registryValidator({
    email: {
      welcome: emailTemplate({
        title: 'W',
        props: named,
        subject: 's',
        preview: { name: 'A' },
        component: () => null,
      }),
    },
    push: {
      tip: pushTemplate({ title: 'T', props: named, preview: { name: 'A' }, content }),
    },
  });

  test('returns the parsed props for template definitions', () => {
    expect(
      validator.validate({ channel: 'email', template: 'welcome', props: { name: 'Ada' } })
    ).toEqual({ name: 'Ada' });
  });

  test('throws TemplateValidationError for bad props, before any content runs', () => {
    content.mockClear();
    expect(() =>
      validator.validate({ channel: 'push', template: 'tip', props: { name: 1 } })
    ).toThrow(TemplateValidationError);
    expect(content).not.toHaveBeenCalled();
  });

  test('an unregistered email or push refuses; channels without a registry pass through', () => {
    const props = { anything: 'goes' };
    expect(() => validator.validate({ channel: 'push', template: 'gone', props })).toThrow(
      "push template 'gone' is not registered"
    );
    expect(validator.validate({ channel: 'sms', template: 'x', props })).toBe(props);
  });
});

describe('email rendering waits for Suspense', () => {
  test("a component that suspends (react-email's <Tailwind> does) renders once resolved", async () => {
    const pending = new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
    function Slow() {
      use(pending);
      return createElement('b', null, 'ready');
    }
    const emails = {
      slow: emailTemplate({
        title: 'Slow',
        props: named,
        subject: 's',
        preview: { name: 'A' },
        component: () => createElement(Suspense, { fallback: 'loading' }, createElement(Slow)),
      }),
    };
    const { html } = await registryRenderer(emails)('slow', { name: 'Ada' });
    expect(html).toContain('<b>ready</b>');
    expect(html).not.toContain('loading');
  });

  test('a full document keeps one (XHTML) doctype and no image preload hints', async () => {
    const emails = {
      doc: emailTemplate({
        title: 'Doc',
        props: named,
        subject: 's',
        preview: { name: 'A' },
        component: () =>
          createElement(
            'html',
            null,
            createElement('head'),
            createElement(
              'body',
              null,
              createElement('img', { src: 'https://x/logo.png', alt: '' })
            )
          ),
      }),
    };
    const { html } = await registryRenderer(emails)('doc', { name: 'Ada' });
    expect(html.match(/<!DOCTYPE/gi)).toHaveLength(1);
    expect(html.startsWith('<!DOCTYPE html PUBLIC')).toBe(true);
    expect(html).not.toContain('rel="preload"');
  });

  test('a component that throws rejects the render', async () => {
    const emails = {
      broken: emailTemplate({
        title: 'Broken',
        props: named,
        subject: 's',
        preview: { name: 'A' },
        component: () => {
          throw new Error('boom');
        },
      }),
    };
    await expect(registryRenderer(emails)('broken', { name: 'Ada' })).rejects.toThrow('boom');
  });
});
