import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  type EngineStep,
  type FactSource,
  type JourneyContext,
  type OutboundMessage,
  type PushDevice,
  runJourney,
} from '../src/engine/index';
import {
  type FlowBuilder,
  compileConfig,
  defineConfig,
  defineContract,
  emailTemplate,
  flow,
  pushTemplate,
  reachable,
  template,
  trigger,
  workflow,
} from '../src/index';
import type { ConditionIR, NodeIR, ScalarIR, WorkflowIR } from '../src/ir';

const contract = defineContract({
  events: { login: z.looseObject({}) },
  profile: z.strictObject({ name: z.string(), email: z.email().optional() }),
});
const { events: e, user: u } = contract;

const named = z.strictObject({ name: z.string() });
const templates = {
  email: {
    tip: emailTemplate({
      id: 'tip',
      from: 'noreply@acme.test',
      title: 'Tip',
      props: named,
      subject: 'Tip',
      preview: { name: 'Ada' },
      component: () => null,
    }),
    tip_long: emailTemplate({
      id: 'tip_long',
      from: 'noreply@acme.test',
      title: 'Tip',
      props: z.strictObject({ name: z.string().min(3) }),
      subject: 'Tip',
      preview: { name: 'Ada' },
      component: () => null,
    }),
  },
  push: {
    tip_push: pushTemplate({
      id: 'tip_push',
      title: 'Tip',
      props: named,
      preview: { name: 'Ada' },
      content: ({ name }) => ({ title: name, body: 'b' }),
    }),
  },
};

const start = () => workflow({ id: 'w', trigger: trigger.event(e.login) });

/** The executable IR: provenance dropped. */
function executable(ir: WorkflowIR): unknown {
  return JSON.parse(
    JSON.stringify(ir, (key, value: unknown) => (key === 'meta' ? undefined : value))
  );
}

function ids(nodes: readonly NodeIR[]): string[] {
  return nodes.flatMap((node) =>
    node.type === 'branch'
      ? [node.id, ...node.cases.flatMap((c) => ids(c.flow)), ...ids(node.otherwise ?? [])]
      : [node.id]
  );
}

describe('prefer() compiles to the branch it stands for', () => {
  test.each([
    ['push first, labelled', 'push', 'tip by channel'],
    ['email first, labelled', 'email', 'tip by channel'],
    ['push first, no label', 'push', undefined],
    ['email first, no label', 'email', undefined],
  ] as const)('%s', (_, first, label) => {
    const props = { name: u.name };
    const push = (b: FlowBuilder) => b.push(templates.push.tip_push, props);
    const email = (b: FlowBuilder) => b.email(templates.email.tip, props);
    const [preferred, fallback] = first === 'push' ? [push, email] : [email, push];
    const arms = [[reachable(first), preferred], fallback] as const;

    const written = (label === undefined ? start().branch(...arms) : start().branch(label, ...arms))
      .delay('1 day')
      .toIR();
    const candidates =
      first === 'push'
        ? ([templates.push.tip_push, templates.email.tip] as const)
        : ([templates.email.tip, templates.push.tip_push] as const);
    const preferredIR = (
      label === undefined
        ? start().prefer(candidates, props)
        : start().prefer(candidates, props, { label })
    )
      .delay('1 day')
      .toIR();

    expect(executable(preferredIR)).toEqual(executable(written));
    expect(ids(preferredIR.flow)).toEqual(ids(written.flow));
    expect(preferredIR.contentHash).toBe(written.contentHash);
    expect('label' in (preferredIR.flow[0] as object)).toBe(label !== undefined);
  });

  test('every generated node points at the prefer() call', () => {
    const ir = start()
      .prefer([templates.push.tip_push, templates.email.tip], { name: u.name })
      .toIR();
    const branch = ir.flow[0] as Extract<NodeIR, { type: 'branch' }>;
    const locs = [
      branch.meta?.loc,
      branch.cases[0]?.condition.meta?.loc,
      branch.cases[0]?.flow[0]?.meta?.loc,
      branch.otherwise?.[0]?.meta?.loc,
    ];
    for (const loc of locs) {
      expect(loc?.file.endsWith('tests/prefer.test.ts')).toBe(true);
    }
    expect(new Set(locs.map((loc) => `${loc?.line}:${loc?.column}`)).size).toBe(1);
  });

  test('each message holds its own props object', () => {
    const ir = start()
      .prefer([templates.push.tip_push, templates.email.tip], { name: 'Ada' })
      .toIR();
    const branch = ir.flow[0] as Extract<NodeIR, { type: 'branch' }>;
    type Message = Extract<NodeIR, { type: 'message' }>;
    const first = branch.cases[0]?.flow[0] as Message;
    const second = branch.otherwise?.[0] as Message;
    expect(first.props).toEqual(second.props);
    expect(first.props).not.toBe(second.props);
  });

  test('a fragment with a prefer used twice gets its own nodes and ids each time', () => {
    const tip = flow((w) =>
      w.prefer([templates.push.tip_push, templates.email.tip], { name: u.name })
    );
    const ir = start().use(tip).delay('1 day').use(tip).toIR();
    const all = ids(ir.flow);
    expect(new Set(all).size).toBe(all.length);
    expect(ir.flow[0]).not.toBe(ir.flow[2]);
    // and nests inside a sub-flow
    const nested = start()
      .branch([reachable('email'), (b) => b.use(tip)])
      .toIR();
    expect(ids(nested.flow)).toEqual(['0', '0.c0.0', '0.c0.0.c0.0', '0.c0.0.o.0']);
  });
});

describe('prefer() checks untyped calls', () => {
  const bad: [string, unknown[], RegExp][] = [
    ['no candidates', [[], {}], /exactly two templates/],
    ['one candidate', [[templates.push.tip_push], {}], /exactly two templates/],
    [
      'three candidates',
      [[templates.push.tip_push, templates.email.tip, templates.email.tip], {}],
      /exactly two/,
    ],
    ['not an array', [templates.push.tip_push, {}], /exactly two templates/],
    [
      'two pushes',
      [[templates.push.tip_push, templates.push.tip_push], {}],
      /one push and one email/,
    ],
    [
      'another channel',
      [[template.sms('s'), templates.email.tip], {}],
      /pushTemplate or an emailTemplate/,
    ],
    [
      'not a reference',
      [[{ channel: 'push' }, templates.email.tip], {}],
      /pushTemplate or an emailTemplate/,
    ],
    ['a null candidate', [[null, templates.email.tip], {}], /pushTemplate or an emailTemplate/],
    ['props left out', [[templates.push.tip_push, templates.email.tip]], /props must be an object/],
    [
      'null props',
      [[templates.push.tip_push, templates.email.tip], null],
      /props must be an object/,
    ],
    [
      'array props',
      [[templates.push.tip_push, templates.email.tip], []],
      /props must be an object/,
    ],
    [
      'string options',
      [[templates.push.tip_push, templates.email.tip], {}, 'x'],
      /options must be an object/,
    ],
    [
      'an unknown option',
      [[templates.push.tip_push, templates.email.tip], {}, { name: 'A' }],
      /unknown option/,
    ],
    [
      'a non-string label',
      [[templates.push.tip_push, templates.email.tip], {}, { label: 1 }],
      /'label'/,
    ],
  ];
  test.each(bad)('%s', (_, args, message) => {
    const builder = start();
    const untyped = builder as unknown as { prefer: (...a: unknown[]) => unknown };
    expect(() => untyped.prefer(...args)).toThrow(message);
    // nothing was half-built
    expect(builder.toIR().flow).toEqual([]);
  });
});

describe('compileConfig checks both candidates', () => {
  const config = (w: ReturnType<typeof start>) =>
    compileConfig(
      defineConfig({
        title: 'Acme',
        contract,
        workflows: [w],
        templates,
      })
    );
  const raw = (props: Record<string, unknown>, fallback = templates.email.tip) =>
    start().prefer([templates.push.tip_push, fallback] as const, props as never);

  test('a valid prefer compiles', () => {
    expect(() => config(raw({ name: u.name }))).not.toThrow();
  });
  test('an unregistered fallback fails by its node', () => {
    expect(() => config(raw({ name: 'Ada' }, { ...templates.email.tip, id: 'gone' }))).toThrow(
      /node 0\.o\.0: email template 'gone' is not registered/
    );
  });
  test('missing, unknown and refused literals fail on either template', () => {
    expect(() => config(raw({}))).toThrow(/required prop 'name' is missing/);
    expect(() => config(raw({ name: 'Ada', extra: 1 }))).toThrow(/'extra' is not a prop/);
    // both templates' static types are string, but the fallback refuses a short literal
    expect(() => config(raw({ name: 'Al' }, templates.email.tip_long))).toThrow(
      /node 0\.o\.0.*'name' = "Al" is refused/
    );
    expect(() => config(raw({ name: { type: 'user_property', path: 'nickname' } }))).toThrow(
      /reads u.nickname/
    );
  });
});

/* ---------------------------------- engine ---------------------------------- */

class DurableStep implements EngineStep {
  readonly done = new Map<string, unknown>();
  onSleep: () => void = () => {};
  async do<T>(name: string, fn: () => Promise<T>): Promise<T> {
    if (this.done.has(name)) return this.done.get(name) as T;
    const result = await fn();
    this.done.set(name, result);
    return result;
  }
  async sleep(): Promise<void> {
    this.onSleep();
  }
  async subscribe(): Promise<void> {}
  async unsubscribe(): Promise<void> {}
  async waitForWake(): Promise<'event' | 'timeout'> {
    return 'timeout';
  }
}

class Facts implements FactSource {
  props: Record<string, ScalarIR> = {};
  devices: PushDevice[] = [];
  suppressed = new Set<string>();
  async countEvents(): Promise<number> {
    return 0;
  }
  async getProperty(path: string): Promise<ScalarIR | undefined> {
    return this.props[path];
  }
  async getSegmentCondition(): Promise<ConditionIR | undefined> {
    return undefined;
  }
  async listDevices(): Promise<PushDevice[]> {
    return this.devices;
  }
  async isSuppressed(channel: string): Promise<boolean> {
    return this.suppressed.has(channel);
  }
}

const phone: PushDevice = { token: 'tok-phone', platform: 'ios' };

function harness() {
  const step = new DurableStep();
  const facts = new Facts();
  facts.props = { name: 'Ada', email: 'ada@acme.test' };
  const sent: OutboundMessage[] = [];
  let send = async (message: OutboundMessage) => {
    // Like CfEmailSender: an email without an address is an error, not a skip
    if (message.channel === 'email' && message.recipient === undefined) {
      throw new Error('email has no recipient');
    }
    sent.push(message);
  };
  const ctx: JourneyContext = {
    userId: 'u_1',
    instanceId: 'inst_1',
    enteredAtMs: Date.now(),
    step,
    facts,
    messages: { send: (message) => send(message) },
    events: { emit: async () => {} },
  };
  return {
    ctx,
    step,
    facts,
    sent,
    channels: () => sent.map((m) => `${m.channel}:${m.template}`),
    setSend: (fn: typeof send) => {
      send = fn;
    },
  };
}

const pushFirst = start()
  .prefer([templates.push.tip_push, templates.email.tip], { name: u.name }, { label: 'tip' })
  .delay('1 day')
  .toIR();
const emailFirst = start()
  .prefer([templates.email.tip, templates.push.tip_push], { name: u.name })
  .toIR();

describe('prefer() at run time', () => {
  test('a reachable first choice is the only message, and the journey goes on', async () => {
    const h = harness();
    h.facts.devices = [phone];
    let slept = false;
    h.step.onSleep = () => {
      slept = true;
    };
    expect(await runJourney(pushFirst, h.ctx)).toEqual({ status: 'completed' });
    expect(h.channels()).toEqual(['push:tip_push']);
    expect(h.sent[0]?.props).toEqual({ name: 'Ada' });
    expect(slept).toBe(true);
  });

  test('no device or a suppressed push falls back to the email', async () => {
    const none = harness();
    await runJourney(pushFirst, none.ctx);
    expect(none.channels()).toEqual(['email:tip']);
    expect(none.sent[0]?.recipient).toBe('ada@acme.test');

    const suppressed = harness();
    suppressed.facts.devices = [phone];
    suppressed.facts.suppressed.add('push');
    await runJourney(pushFirst, suppressed.ctx);
    expect(suppressed.channels()).toEqual(['email:tip']);
  });

  test('email first: an address picks the email, none or a suppressed one picks the push', async () => {
    const reachableEmail = harness();
    reachableEmail.facts.devices = [phone];
    await runJourney(emailFirst, reachableEmail.ctx);
    expect(reachableEmail.channels()).toEqual(['email:tip']);

    const suppressed = harness();
    suppressed.facts.devices = [phone];
    suppressed.facts.suppressed.add('email');
    await runJourney(emailFirst, suppressed.ctx);
    expect(suppressed.channels()).toEqual(['push:tip_push']);
  });

  test('a fallback push without a device is skipped as any push is', async () => {
    const h = harness();
    h.facts.props = { name: 'Ada' };
    expect(await runJourney(emailFirst, h.ctx)).toEqual({ status: 'completed' });
    expect(h.sent).toEqual([]);
  });

  test('a fallback email without an address keeps the sender error', async () => {
    const h = harness();
    h.facts.props = { name: 'Ada' };
    await expect(runJourney(pushFirst, h.ctx)).rejects.toThrow('email has no recipient');
    expect(h.sent).toEqual([]);
  });

  test('a first choice that fails to send retries as itself, never as the second', async () => {
    const h = harness();
    h.facts.devices = [phone];
    let down = true;
    h.setSend(async (message) => {
      if (down) throw new Error('APNs 503');
      h.sent.push(message);
    });
    await expect(runJourney(pushFirst, h.ctx)).rejects.toThrow('APNs 503');
    expect(h.sent).toEqual([]);
    // The device went away before the retry: the checkpointed choice and plan still hold
    h.facts.devices = [];
    down = false;
    await runJourney(pushFirst, h.ctx);
    expect(h.channels()).toEqual(['push:tip_push']);
  });

  test('props the chosen template refuses fail that message, not over to the other', async () => {
    const h = harness();
    h.facts.devices = [phone];
    h.ctx.validator = {
      validate: () => {
        throw new Error("push template 'tip_push' rejected its props");
      },
    };
    await expect(runJourney(pushFirst, h.ctx)).rejects.toThrow(/rejected its props/);
    expect(h.sent).toEqual([]);
  });

  test('each prefer chooses with the facts of its own moment', async () => {
    const twice = start()
      .prefer([templates.push.tip_push, templates.email.tip], { name: u.name })
      .delay('2 days')
      .prefer([templates.push.tip_push, templates.email.tip], { name: u.name })
      .toIR();
    const h = harness();
    h.facts.devices = [phone];
    h.step.onSleep = () => {
      h.facts.devices = [];
    };
    await runJourney(twice, h.ctx);
    expect(h.channels()).toEqual(['push:tip_push', 'email:tip']);
  });
});
