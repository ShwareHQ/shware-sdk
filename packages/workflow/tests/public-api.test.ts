import { describe, expect, test } from 'vitest';
/**
 * Consumer-perspective smoke test: everything below goes through the public
 * entry points only (`.` and `./engine`), exactly the way an installed user
 * would — define a schema, build assets, compile, plan, run.
 */
import {
  type EngineStep,
  type FactSource,
  type JourneyOutcome,
  runJourney,
} from '../src/engine/index';
import {
  WorkflowIR,
  compileBundle,
  eq,
  event,
  performed,
  plan,
  segment,
  template,
  trigger,
  user,
  workflow,
} from '../src/index';

interface Event {
  signed_up: Record<never, never>;
  upgraded: { plan: string };
}

interface UserProperty {
  userId: string;
  email: string;
  plan: 'free' | 'pro';
}

const e = event<Event>();
const u = user<UserProperty>();

const freeUser = segment('free_user', eq(u.plan, 'free'));
const upgraded = segment('upgraded', performed(e.upgraded));
const welcome = template.email<{ plan: UserProperty['plan'] }>('welcome');

const onboarding = workflow('onboarding', {
  trigger: trigger.event(e.signed_up),
  goal: upgraded,
  description: 'Welcome new users, nudge free ones to upgrade',
})
  .email(welcome, { plan: u.plan })
  .delay('2 days')
  .branch([freeUser, (w) => w.email(welcome, { plan: 'pro' })]);

test('define -> compile -> validate -> plan round trip', () => {
  const bundle = compileBundle({
    workflows: [onboarding],
    segments: [freeUser, upgraded],
    templates: [welcome],
  });

  // the compiled IR survives serialization and the authoritative schema
  const revived = WorkflowIR.parse(JSON.parse(JSON.stringify(bundle.workflows[0])));
  expect(revived.name).toBe('onboarding');
  expect(revived.meta?.description).toContain('Welcome new users');

  // first deploy: everything is an addition
  const first = plan(bundle);
  expect(first.hasChanges).toBe(true);

  // redeploying the identical bundle is a no-op
  expect(plan(bundle, bundle).hasChanges).toBe(false);
});

describe('running the compiled IR on in-memory ports', () => {
  function run(props: Record<string, string>): Promise<JourneyOutcome> & { sent: string[] } {
    const sent: string[] = [];
    const step: EngineStep = {
      do: (_name, fn) => fn(),
      sleep: async () => {},
      sleepUntil: async () => {},
      waitForEvent: async () => 'timeout',
    };
    const facts: FactSource = {
      countEvents: async () => 0,
      getProperty: async (path) => props[path],
      getSegmentCondition: async (name) =>
        name === 'free_user'
          ? { type: 'property', path: 'plan', op: 'eq', value: 'free' }
          : { type: 'performed', event: 'upgraded' },
    };
    const promise = runJourney(onboarding.toIR(), {
      userId: 'u1',
      instanceId: 'i1',
      step,
      facts,
      messages: {
        send: async (m) => {
          sent.push(`${m.template}:${String(m.props.plan)}`);
        },
      },
      events: { emit: async () => {} },
    });
    return Object.assign(promise, { sent });
  }

  test('free user gets the personalized welcome and the upgrade nudge', async () => {
    const running = run({ plan: 'free', email: 'a@b.c' });
    await expect(running).resolves.toEqual({ status: 'completed' });
    expect(running.sent).toEqual(['welcome:free', 'welcome:pro']);
  });

  test('pro user skips the nudge arm', async () => {
    const running = run({ plan: 'pro', email: 'a@b.c' });
    await expect(running).resolves.toEqual({ status: 'completed' });
    expect(running.sent).toEqual(['welcome:pro']);
  });
});
