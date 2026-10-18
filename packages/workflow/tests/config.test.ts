import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { journeyWorker } from '../src/cloudflare/worker';
import {
  ConfigCompileError,
  compileConfig,
  defineConfig,
  defineContract,
  emailTemplate,
  flow,
  performed,
  pushTemplate,
  slackTemplate,
  trigger,
  workflow,
} from '../src/index';
import { makeEnv } from './fake-cloudflare';

const contract = defineContract({
  events: { login: z.looseObject({ method: z.string() }) },
  profile: z.strictObject({ name: z.string(), email: z.email().optional() }),
});
const { events: e, user: u } = contract;
const performedLogin = performed(e.login);

const named = z.strictObject({ name: z.string(), tone: z.enum(['warm', 'brief']).optional() });
const emails = {
  welcome: emailTemplate({
    id: 'welcome',
    from: 'noreply@acme.test',
    title: 'Welcome',
    props: named,
    subject: 'Hi',
    preview: { name: 'A' },
    component: () => null,
  }),
  nudge: emailTemplate({
    id: 'nudge',
    from: 'noreply@acme.test',
    title: 'Nudge',
    props: named,
    subject: 'Hey',
    preview: { name: 'A' },
    component: () => null,
  }),
};
const pushes = {
  nudge: pushTemplate({
    id: 'nudge',
    title: 'Nudge',
    props: named,
    preview: { name: 'A' },
    content: ({ name }) => ({ title: name, body: 'b' }),
  }),
};
const registry = { email: emails, push: pushes };

const onboarding = workflow({ id: 'onboarding', trigger: trigger.event(e.login) })
  .email(emails.welcome, { name: u.name })
  .push(pushes.nudge, { name: u.name, tone: 'warm' });

const config = (flows = [onboarding]) =>
  defineConfig({
    title: 'Acme',
    contract,
    workflows: flows,
    templates: registry,
  });

/** Another email definition, its own object, under an id of our choosing. */
const welcomeTwin = (id = 'welcome') =>
  emailTemplate({
    id,
    from: 'noreply@acme.test',
    title: 'Twin',
    props: named,
    subject: 'Hi',
    preview: { name: 'A' },
    component: () => null,
  });

describe('template ids', () => {
  test('a factory refuses a missing, empty or blank id', () => {
    const define = (id: unknown) => () => emailTemplate({ ...emails.welcome, id: id as string });
    expect(define(undefined)).toThrow(
      new TypeError("emailTemplate(): 'id' must be a non-empty string")
    );
    expect(define('')).toThrow(/'id' must be a non-empty string/);
    expect(define('  ')).toThrow(/'id' must be a non-empty string/);
    expect(() =>
      // @ts-expect-error id is required
      pushTemplate({
        title: 'N',
        props: named,
        preview: { name: 'A' },
        content: () => ({ title: 't', body: 'b' }),
      })
    ).toThrow(/pushTemplate\(\): 'id'/);
  });

  test('the property a template is registered under is a JavaScript name; the id is its identity', () => {
    const aliased = (name: string) =>
      compileConfig(
        defineConfig({
          workflows: [onboarding],
          templates: { email: { [name]: emails.welcome, nudge: emails.nudge }, push: pushes },
        })
      );
    const bundle = aliased('welcomeAlias');
    expect(bundle.templates.map((x) => `${x.channel}:${x.key}`)).toEqual([
      'email:welcome',
      'email:nudge',
      'push:nudge',
    ]);
    expect(bundle.workflows[0].flow[0]).toMatchObject({ type: 'message', template: 'welcome' });
    expect(aliased('renamed')).toEqual(bundle);
    expect(bundle).toEqual(compileConfig(config()));
  });

  test('an id is registered once per channel, even the same object twice', () => {
    const twice = (email: Record<string, unknown>) => () =>
      compileConfig(defineConfig({ workflows: [], templates: { email: email as never } }));
    expect(twice({ welcome: emails.welcome, other: welcomeTwin() })).toThrow(
      new ConfigCompileError(
        "email template id 'welcome' is registered twice: templates.email.welcome and templates.email.other"
      )
    );
    expect(twice({ a: emails.welcome, b: emails.welcome })).toThrow(/registered twice/);
  });

  test('every registered entry is checked, used or not', () => {
    const registered = (templates: Record<string, unknown>) => () =>
      compileConfig(defineConfig({ workflows: [], templates }));
    expect(registered({ push: { welcome: emails.welcome } })).toThrow(
      new ConfigCompileError('templates.push.welcome is not a push template')
    );
    expect(registered({ email: { x: { ...emails.welcome, id: ' ' } } })).toThrow(
      'templates.email.x has no id'
    );
  });

  test('a workflow sends the registered definition, not another one with the same id', () => {
    const twin = welcomeTwin();
    const sends = (build: (w: ReturnType<typeof start>) => unknown) => {
      const w = start();
      build(w);
      return () => compileConfig(config([w]));
    };
    const start = () => workflow({ id: 'twin', trigger: trigger.event(e.login) });
    const message =
      /workflow 'twin' \(.+config\.test\.ts:\d+\): email template 'welcome' is not the definition registered under that id \(templates\.email\.welcome\)/;
    expect(sends((w) => w.email(twin, { name: 'A' }))).toThrow(message);
    expect(sends((w) => w.prefer([pushes.nudge, twin], { name: 'A' }))).toThrow(message);
    expect(sends((w) => w.branch([performedLogin, (b) => b.email(twin, { name: 'A' })]))).toThrow(
      message
    );
    expect(
      sends((w) => w.cohort({ a: { weight: 100, flow: (b) => b.email(twin, { name: 'A' }) } }))
    ).toThrow(message);
    expect(
      sends((w) =>
        w.waitUntil(performedLogin, {
          timeout: '1 day',
          onTimeout: (b) => b.email(twin, { name: 'A' }),
        })
      )
    ).toThrow(message);
    const fragment = flow((b) => b.email(twin, { name: 'A' }));
    expect(sends((w) => w.use(fragment))).toThrow(message);
    expect(sends((w) => w.email(emails.welcome, { name: 'A' }))).not.toThrow();
  });

  test('a fragment used twice, in two workflows, keeps its templates and its own node ids', () => {
    const fragment = flow((b) => b.email(emails.welcome, { name: u.name }).delay('1 day'));
    const a = workflow({ id: 'a', trigger: trigger.event(e.login) })
      .use(fragment)
      .use(fragment);
    const b = workflow({ id: 'b', trigger: trigger.event(e.login) }).use(fragment);
    const bundle = compileConfig(config([a, b]));
    expect(bundle.workflows[0].flow.map((n) => n.id)).toEqual(['0', '1', '2', '3']);
    const twin = welcomeTwin();
    const c = workflow({ id: 'c', trigger: trigger.event(e.login) })
      .use(fragment)
      .email(twin, { name: 'A' });
    expect(() => compileConfig(config([a, c]))).toThrow(
      /workflow 'c'.*not the definition registered/
    );
    expect(JSON.stringify(bundle)).not.toContain('component');
  });

  test('a template with no workflow sending it is still in the manifest', () => {
    const alert = slackTemplate({
      id: 'unused_alert',
      title: 'Unused',
      props: z.strictObject({}),
      preview: {},
      webhook: () => 'https://hooks.slack.com/services/T/B/x',
      content: () => ({ text: 'x' }),
    });
    const bundle = compileConfig(
      defineConfig({ workflows: [], templates: { slack: { alertAlias: alert } } })
    );
    expect(bundle.templates).toEqual([
      { irVersion: expect.any(Number), channel: 'slack', key: 'unused_alert' },
    ]);
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
      welcomeTwin('gone'),
      { name: 'A' }
    );
    expect(() => compileConfig(config([missing]))).toThrow(
      new ConfigCompileError("workflow 'w' node 0: email template 'gone' is not registered")
    );
    const crossed = workflow({ id: 'x', trigger: trigger.event(e.login) }).push(
      pushTemplate({
        id: 'welcome',
        title: 'Welcome',
        props: named,
        preview: { name: 'A' },
        content: () => ({ title: 't', body: 'b' }),
      }),
      { name: 'A' }
    );
    expect(() => compileConfig(config([crossed]))).toThrow(
      /push template 'welcome' is not registered \(it is registered as a email template\)/
    );
  });

  test('literal props are checked against the schema; user refs by name only', () => {
    const raw = (props: Record<string, unknown>) =>
      workflow({ id: 'lit', trigger: trigger.event(e.login) }).email(
        emails.welcome,
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
          // oxlint-disable-next-line no-unnecessary-type-assertion -- the payload is deliberately untyped
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
      id: 'credits',
      from: 'noreply@acme.test',
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
