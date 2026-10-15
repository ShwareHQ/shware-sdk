import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { journeyWorker } from '../src/cloudflare/worker';
import {
  ConfigCompileError,
  compileConfig,
  defineConfig,
  defineContract,
  emailTemplate,
  pushTemplate,
  template,
  templates,
  trigger,
  workflow,
} from '../src/index';
import { makeEnv } from './fake-cloudflare';

const contract = defineContract({
  events: { login: z.looseObject({ method: z.string() }) },
  profile: z.strictObject({ name: z.string(), email: z.email().optional() }),
});
const { events: e, user: u } = contract;

const named = z.strictObject({ name: z.string(), tone: z.enum(['warm', 'brief']).optional() });
const emails = {
  welcome: emailTemplate({
    title: 'Welcome',
    props: named,
    subject: 'Hi',
    preview: { name: 'A' },
    component: () => null,
  }),
  nudge: emailTemplate({
    title: 'Nudge',
    props: named,
    subject: 'Hey',
    preview: { name: 'A' },
    component: () => null,
  }),
};
const pushes = {
  nudge: pushTemplate({
    title: 'Nudge',
    props: named,
    preview: { name: 'A' },
    content: ({ name }) => ({ title: name, body: 'b' }),
  }),
};
const registry = { email: emails, push: pushes };
const t = templates(registry);

const onboarding = workflow({ id: 'onboarding', trigger: trigger.event(e.login) })
  .email(t.email.welcome, { name: u.name })
  .push(t.push.nudge, { name: u.name, tone: 'warm' });

const config = (flows = [onboarding]) =>
  defineConfig({
    title: 'Acme',
    contract,
    workflows: flows,
    templates: registry,
    emails: { from: { email: 'noreply@acme.test', name: 'Acme' } },
  });

describe('templates(registry)', () => {
  test('one plain { channel, key } per registered key, without rendering or touching the registry', () => {
    let rendered = 0;
    const welcome = emailTemplate({
      title: 'W',
      props: named,
      subject: 'Hi',
      preview: { name: 'A' },
      component: () => {
        rendered += 1;
        return null;
      },
    });
    const nudge = pushTemplate({
      title: 'N',
      props: named,
      preview: { name: 'A' },
      content: ({ name }) => {
        rendered += 1;
        return { title: name, body: 'b' };
      },
    });
    const email = Object.freeze({ welcome });
    const push = Object.freeze({ nudge_push: nudge });
    const refs = templates({ email, push });
    expect({ ...refs.email }).toEqual({ welcome: { channel: 'email', key: 'welcome' } });
    expect({ ...refs.push }).toEqual({ nudge_push: { channel: 'push', key: 'nudge_push' } });
    expect(rendered).toBe(0);
    expect(Object.keys(email)).toEqual(['welcome']);
    expect(email.welcome).toBe(welcome);
    expect(Object.getPrototypeOf(refs.email)).toBeNull();
    expect({ ...templates({ email }).push }).toEqual({});
  });

  test('a template registered under the wrong channel fails by key', () => {
    expect(() => templates({ email: { nudge: pushes.nudge } } as never)).toThrow(
      new TypeError("templates(): 'nudge' in the email registry is not an email template")
    );
    expect(() => templates({ push: { welcome: emails.welcome } } as never)).toThrow(
      /'welcome' in the push registry is not a push template/
    );
  });
});

describe('compileConfig', () => {
  test('the template manifest is every registered template, per channel — one key may live in both', () => {
    const bundle = compileConfig(config());
    expect(bundle.templates.map((x) => `${x.channel}:${x.key}`)).toEqual([
      'email:welcome',
      'email:nudge',
      'push:nudge',
    ]);
    expect(bundle.workflows.map((w) => w.id)).toEqual(['onboarding']);
  });

  test('an unregistered or cross-channel reference names the workflow, node and channel', () => {
    const missing = workflow({ id: 'w', trigger: trigger.event(e.login) }).email(
      template.email('gone'),
      {}
    );
    expect(() => compileConfig(config([missing]))).toThrow(
      new ConfigCompileError("workflow 'w' node 0: email template 'gone' is not registered")
    );
    const crossed = workflow({ id: 'x', trigger: trigger.event(e.login) }).push(
      template.push('welcome'),
      {}
    );
    expect(() => compileConfig(config([crossed]))).toThrow(
      /push template 'welcome' is not registered \(it is registered as a email template\)/
    );
  });

  test('literal props are checked against the schema; user refs by name only', () => {
    const raw = (props: Record<string, unknown>) =>
      workflow({ id: 'lit', trigger: trigger.event(e.login) }).email(
        t.email.welcome,
        props as never
      );
    expect(() => compileConfig(config([raw({ name: u.name, tone: 'loud' })]))).toThrow(
      /'tone' = "loud" is refused/
    );
    expect(() => compileConfig(config([raw({})]))).toThrow(/required prop 'name' is missing/);
    expect(() => compileConfig(config([raw({ name: 'Ada', extra: 1 })]))).toThrow(
      /'extra' is not a prop/
    );
    expect(() =>
      compileConfig(config([raw({ name: { type: 'user_property', path: 'nickname' } })]))
    ).toThrow(/reads u.nickname, which the contract's profile does not declare/);
  });
});

describe('journeyWorker({ config })', () => {
  test('serves the compiled config as its bundle and validates ingest with its contract', async () => {
    const { env } = makeEnv();
    const worker = journeyWorker({ config: config() });
    const bundle = await (await worker.fetch(new Request('https://w.test/bundle'), env)).json();
    expect(bundle).toEqual(JSON.parse(JSON.stringify(compileConfig(config()))));
    const refused = await worker.fetch(
      new Request('https://w.test/events', {
        method: 'POST',
        body: JSON.stringify({ userId: 'u', event: 'login', payload: { method: 1 } }),
      }),
      env
    );
    expect(refused.status).toBe(400);
    const preview = (path: string) =>
      worker.fetch(new Request(`https://w.test/preview/${path}`), env);
    expect(
      (await preview(`welcome?props=${encodeURIComponent(JSON.stringify({ name: 'Ada' }))}`)).status
    ).toBe(200);
    const bad = await preview('welcome');
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ issues: [{ path: 'name' }] });
    expect((await preview('nope')).status).toBe(404);
  });
});

describe('emitted events against the contract', () => {
  const shop = defineContract({
    events: {
      login: z.looseObject({ method: z.string() }),
      purchase: z.looseObject({ transaction_id: z.string(), value: z.number().positive() }),
    },
    profile: z.strictObject({ name: z.string() }),
  });
  const emitting = (payload: Record<string, unknown>, event = 'purchase') =>
    defineConfig({
      contract: shop,
      workflows: [
        workflow({ id: 'emit', trigger: trigger.event(shop.events.login) }).sendEvent(
          { type: 'event_ref', name: event } as never,
          payload as never
        ),
      ],
    });

  test('compileConfig refuses an undeclared event, a refused literal and a missing field', () => {
    expect(() => compileConfig(emitting({}, 'refund'))).toThrow(
      /emits 'refund', which is not in the contract/
    );
    expect(() => compileConfig(emitting({ transaction_id: 't', value: -1 }))).toThrow(
      /'value' = -1 is refused/
    );
    expect(() => compileConfig(emitting({ value: 1 }))).toThrow(
      /required field 'transaction_id' is missing/
    );
    expect(() => compileConfig(emitting({ transaction_id: 't', value: 1 }))).not.toThrow();
  });

  test('a nested payload is refused where the workflow is written', () => {
    expect(() =>
      workflow({ id: 'nested', trigger: trigger.event(shop.events.login) }).sendEvent(
        shop.events.purchase,
        // @ts-expect-error an emitted payload carries scalar fields only
        { transaction_id: 't', value: 1, items: [{ sku: 'x' }] }
      )
    ).toThrow(/'items' is not a scalar/);
  });
});

test('/preview takes typed JSON props, so number and boolean fields can be previewed', async () => {
  const typed = {
    credits: emailTemplate({
      title: 'Credits',
      props: z.strictObject({ credits: z.number(), trial: z.boolean() }),
      subject: 'Credits',
      preview: { credits: 1, trial: false },
      component: ({ credits, trial }) => `${credits} ${trial ? 'trial' : 'paid'}`,
    }),
  };
  const worker = journeyWorker({
    config: defineConfig({ workflows: [], templates: { email: typed } }),
  });
  const { env } = makeEnv();
  const get = (query: string) =>
    worker.fetch(new Request(`https://w.test/preview/credits${query}`), env);
  const ok = await get(`?props=${encodeURIComponent(JSON.stringify({ credits: 3, trial: true }))}`);
  expect(ok.status).toBe(200);
  expect(await ok.text()).toContain('3 trial');
  expect((await get('?props=not-json')).status).toBe(400);
  expect((await get('?props=[1]')).status).toBe(400);
});
