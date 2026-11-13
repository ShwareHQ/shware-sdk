import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  type PinnedWorkflow,
  action,
  checkInFlight,
  compileBundle,
  compileConfig,
  defineConfig,
  describeInFlight,
  emailTemplate,
  eq,
  segment,
  trigger,
  workflow,
} from '../src/index';
import { e, plainEmail, purchaser, u } from './fixtures';

/**
 * checkInFlight: what a bundle (and the registry that would serve it) takes away from the
 * journeys still running on a pinned IR. Pure — the pins are built here from `toIR()`.
 */

const welcomeWith = <S extends z.ZodObject>(props: S, preview: z.input<S>) =>
  emailTemplate({
    id: 'welcome',
    transactional: true,
    from: 'noreply@acme.test',
    title: 'Welcome',
    props,
    subject: 'Welcome aboard',
    preview,
    component: () => null,
  });

const onboarding = (template: ReturnType<typeof welcomeWith>, props: Record<string, string>) =>
  workflow({ id: 'onboarding', trigger: trigger.event(e.sign_up) }).email(
    template as never,
    props as never
  );

/** A pinned version with `running` journeys on it. */
const pinned = (flow: { toIR(): PinnedWorkflow['ir'] & object }, running = 3): PinnedWorkflow => {
  const ir = flow.toIR();
  return { workflow: ir.id, contentHash: ir.contentHash, running, ir };
};

const v1 = welcomeWith(z.strictObject({ name: z.string() }), { name: 'A' });
const pinnedV1 = pinned(onboarding(v1, { name: 'friend' }));

describe('against the registry the code would serve', () => {
  test('a template that still takes the pinned props passes: a new optional prop, reworded copy', () => {
    const next = welcomeWith(z.strictObject({ name: z.string(), tone: z.string().optional() }), {
      name: 'A',
    });
    const config = defineConfig({
      workflows: [onboarding(next, { name: 'friend', tone: 'warm' })],
      templates: { email: { welcome: next } },
    });
    expect(checkInFlight([pinnedV1], compileConfig(config), config)).toEqual([]);
  });

  test('a new required prop is reported with the node and the journeys it would strand', () => {
    const next = welcomeWith(z.strictObject({ name: z.string(), tone: z.string() }), {
      name: 'A',
      tone: 'warm',
    });
    const config = defineConfig({
      workflows: [onboarding(next, { name: 'friend', tone: 'warm' })],
      templates: { email: { welcome: next } },
    });
    const problems = checkInFlight(
      [pinned(onboarding(v1, { name: 'friend' }), 12)],
      compileConfig(config),
      config
    );
    expect(problems).toEqual([
      {
        workflow: 'onboarding',
        contentHash: pinnedV1.contentHash,
        running: 12,
        problem: expect.stringContaining("required prop 'tone' is missing"),
      },
    ]);
    expect(problems[0]?.problem).toContain("workflow 'onboarding' node 0");
  });

  test('a template gone from the registry', () => {
    const other = plainEmail('other');
    const config = defineConfig({
      workflows: [workflow({ id: 'other', trigger: trigger.event(e.login) }).email(other)],
      templates: { email: { other } },
    });
    expect(checkInFlight([pinnedV1], compileConfig(config), config)).toEqual([
      expect.objectContaining({
        problem: expect.stringContaining("email template 'welcome' is not registered"),
      }),
    ]);
  });
});

describe('against the bundle alone', () => {
  test('a template missing from the manifest; no manifest, no template check', () => {
    const other = plainEmail('other');
    const flow = workflow({ id: 'other', trigger: trigger.event(e.login) }).email(other);
    expect(
      checkInFlight([pinnedV1], compileBundle({ workflows: [flow], templates: [other] }))
    ).toEqual([
      expect.objectContaining({
        problem: "node 0: email template 'welcome' is not in the bundle",
      }),
    ]);
    expect(checkInFlight([pinnedV1], compileBundle({ workflows: [flow] }))).toEqual([]);
  });

  test('a segment the pinned IR names must stay; its condition may change', () => {
    const goalFlow = workflow({
      id: 'checkout',
      trigger: trigger.event(e.begin_checkout),
      goal: purchaser,
    }).email(plainEmail('nudge'));
    const pin = pinned(goalFlow, 2);
    const plain = workflow({ id: 'checkout', trigger: trigger.event(e.begin_checkout) }).email(
      plainEmail('nudge')
    );

    expect(checkInFlight([pin], compileBundle({ workflows: [plain], segments: [] }))).toEqual([
      {
        workflow: 'checkout',
        contentHash: pin.contentHash,
        running: 2,
        problem: "segment 'purchaser' is not in the bundle",
      },
    ]);
    // Same id, another condition: a segment is a live audience, the journey reads the new one
    const redefined = segment({ id: 'purchaser', condition: eq(u.subscription_status, 'active') });
    expect(
      checkInFlight([pin], compileBundle({ workflows: [plain], segments: [redefined] }))
    ).toEqual([]);
  });

  test('an action the pinned IR runs must stay in the bundle', () => {
    const grant = action('grant', async () => {});
    const flow = workflow({ id: 'grants', trigger: trigger.event(e.sign_up) })
      .run(grant)
      .email(plainEmail('done'));
    const pin = pinned(flow);
    const without = workflow({ id: 'grants', trigger: trigger.event(e.sign_up) }).email(
      plainEmail('done')
    );
    expect(checkInFlight([pin], compileBundle({ workflows: [without] }))).toEqual([
      expect.objectContaining({ problem: "node 0: action 'grant' is not in the bundle" }),
    ]);
    expect(checkInFlight([pin], compileBundle({ workflows: [flow], actions: [grant] }))).toEqual(
      []
    );
  });

  test('a pin whose body the store has lost is reported too', () => {
    const lost = { ...pinnedV1, ir: undefined };
    expect(checkInFlight([lost], compileBundle({ workflows: [] }))).toEqual([
      expect.objectContaining({ problem: 'its workflow body is not in the store' }),
    ]);
  });
});

test('describeInFlight: one line per pinned version, with its journeys', () => {
  const lines = describeInFlight([
    { workflow: 'a', contentHash: 'abcdef0123', running: 1, problem: 'p1' },
    { workflow: 'a', contentHash: 'abcdef0123', running: 1, problem: 'p2' },
    { workflow: 'b', contentHash: '0123456789', running: 7, problem: 'p3' },
  ]);
  expect(lines).toEqual([
    'a@abcdef01 (1 running journey): p1; p2',
    'b@01234567 (7 running journeys): p3',
  ]);
});
