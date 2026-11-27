import { expect } from 'vitest';
import { BUCKET_RESOLUTION, hashToBucket } from '../../src/engine/bucket';
import type { HostName } from './driver';
import { probe } from './journeys';
import type { World } from './world';

/**
 * The scenario table: each one a script over a `World`, with the results every host must show.
 * A scenario never names a host. Where a host is known to differ, the difference is recorded
 * here, next to the expectation it breaks, and the test is marked for that host alone:
 *
 * - `diverges`: the host runs the script and shows something else. The test is `test.fails`
 *   there — it turns red the day the host agrees, so the note cannot outlive the difference.
 * - `cannot`: the host's harness has no way to drive the script. The test is `test.skip` there,
 *   with the reason in its title.
 */
export interface Scenario {
  name: string;
  run(world: World): Promise<void>;
  diverges?: Partial<Record<HostName, string>>;
  cannot?: Partial<Record<HostName, string>>;
}

/** Why the AWS harness cannot hold a journey in the middle of a sleep (see `aws-driver.ts`). */
const NO_HELD_SLEEP = {
  aws: 'the local durable runner ends a sleep as soon as nothing else runs: there is no middle of it to stand in',
};
/** Why it cannot reach a long wait's deadline. */
const NO_LONG_TIMEOUT = {
  aws: "the local durable runner keeps a callback's timeout on the real clock: an hour's wait never times out in a test",
};

/** The first of u1, u2, ... the cohort node puts in the arm (`cohort(..., { key: 'conformance' })`, 50/50). */
function userIn(arm: 'a' | 'b'): string {
  for (let n = 1; ; n++) {
    const first = hashToBucket(`u${n}:conformance`) < BUCKET_RESOLUTION / 2;
    if (first === (arm === 'a')) return `u${n}`;
  }
}

const reachable = { email: 'ada@acme.test', phone: '+15550100', name: 'Ada' };

export const scenarios: Scenario[] = [
  /* ------------------------------- node types ------------------------------- */
  {
    name: 'run: an action gets its args from the trigger payload and the profile, under a stable key',
    async run(w) {
      await w.identify('u1', { plan: 'pro' });
      await w.ingest('u1', 'order', { total: 42 });
      expect(w.of('order')).toEqual([
        { action: 'first', args: { total: 42, plan: 'pro' }, userId: 'u1', key: 'order/u1#1:0' },
      ]);
      expect(await w.statuses('order')).toEqual(['completed']);
      expect((await w.instances()).filter((row) => row.workflow === 'order')).toEqual([
        { workflow: 'order', user: 'u1', status: 'completed', node: '0', converted: false },
      ]);
    },
  },
  {
    name: 'delay: what ran before it is not run again, and the rest runs once it is over',
    async run(w) {
      await w.ingest('u1', 'start_nap');
      await w.advance('1 hour');
      expect(w.actions).toEqual([
        { action: 'first', args: {}, userId: 'u1', key: 'nap/u1#1:0' },
        { action: 'second', args: {}, userId: 'u1', key: 'nap/u1#1:2' },
      ]);
      expect(await w.statuses('nap')).toEqual(['completed']);
    },
  },
  {
    name: 'delay: the journey stands still until the last millisecond of it',
    cannot: NO_HELD_SLEEP,
    async run(w) {
      await w.ingest('u1', 'start_nap');
      expect(w.ran).toEqual(['first']);
      expect(await w.statuses('nap')).toEqual(['running']);
      expect(await w.instances()).toEqual([
        { workflow: 'nap', user: 'u1', status: 'running', node: '1', converted: false },
      ]);
      await w.advance('59 minutes');
      expect(w.ran).toEqual(['first']);
      await w.advance('1 minute');
      expect(w.ran).toEqual(['first', 'second']);
    },
  },
  {
    name: 'random delay: over by its upper bound',
    async run(w) {
      await w.ingest('u1', 'start_random_nap');
      await w.advance('2 hours');
      expect(w.ran).toEqual(['second']);
      expect(await w.statuses('random_nap')).toEqual(['completed']);
    },
  },
  {
    name: 'random delay: never over before its lower bound',
    cannot: NO_HELD_SLEEP,
    async run(w) {
      await w.ingest('u1', 'start_random_nap');
      await w.advance('59 minutes');
      expect(w.ran).toEqual([]);
      expect(await w.statuses('random_nap')).toEqual(['running']);
    },
  },
  {
    name: 'time window: the journey goes on once the window opens',
    async run(w) {
      // Tuesday 09:00 UTC; the window is Tuesday 11:00–12:00 UTC
      await w.ingest('u1', 'start_window');
      await w.advance('2 hours');
      expect(w.ran).toEqual(['second']);
      expect(await w.statuses('window')).toEqual(['completed']);
    },
  },
  {
    name: 'time window: held until the window opens',
    cannot: NO_HELD_SLEEP,
    async run(w) {
      await w.ingest('u1', 'start_window');
      await w.advance('119 minutes');
      expect(w.ran).toEqual([]);
      await w.advance('1 minute');
      expect(w.ran).toEqual(['second']);
    },
  },
  {
    name: 'messages: every channel hands its copy to the sender, with the recipient the profile gives',
    async run(w) {
      await w.identify('u1', reachable);
      await w.ingest('u1', 'start_channels');
      const copy = { userId: 'u1', platform: undefined };
      expect(w.sent).toEqual([
        {
          ...copy,
          channel: 'email',
          template: 'welcome',
          props: { name: 'Ada' },
          recipient: 'ada@acme.test',
          topic: null,
          key: 'channels/u1#1:0',
        },
        {
          ...copy,
          channel: 'sms',
          template: 'otp',
          props: { code: '4711' },
          recipient: '+15550100',
          topic: undefined,
          key: 'channels/u1#1:1',
        },
        {
          ...copy,
          channel: 'in_app',
          template: 'banner',
          props: {},
          recipient: undefined,
          topic: undefined,
          key: 'channels/u1#1:2',
        },
        {
          ...copy,
          channel: 'survey',
          template: 'nps',
          props: {},
          recipient: 'ada@acme.test',
          topic: undefined,
          key: 'channels/u1#1:3',
        },
        {
          ...copy,
          channel: 'slack',
          template: 'alert',
          props: {},
          recipient: undefined,
          topic: undefined,
          key: 'channels/u1#1:4',
        },
        {
          ...copy,
          channel: 'discord',
          template: 'alert',
          props: {},
          recipient: undefined,
          topic: undefined,
          key: 'channels/u1#1:5',
        },
      ]);
      expect(await w.statuses('channels')).toEqual(['completed']);
      // Each copy is in the report, taken by the transport
      const copies = await w.copies();
      expect(copies.map((row) => row.template).sort()).toEqual(
        ['alert', 'alert', 'banner', 'nps', 'otp', 'welcome'].sort()
      );
      expect(copies.every((row) => row.delivered && row.undelivered === null)).toBe(true);
    },
  },
  {
    name: 'push: one copy per device, the most recently registered first',
    async run(w) {
      await w.device('u1', 'token-ios', 'ios');
      await w.advance('1 minute');
      await w.device('u1', 'token-android', 'android');
      await w.ingest('u1', 'start_push_all');
      expect(w.sent).toEqual([
        {
          channel: 'push',
          template: 'ping',
          props: {},
          userId: 'u1',
          recipient: 'token-android',
          platform: 'android',
          topic: null,
          key: 'push_all/u1#1:0:token-android',
        },
        {
          channel: 'push',
          template: 'ping',
          props: {},
          userId: 'u1',
          recipient: 'token-ios',
          platform: 'ios',
          topic: null,
          key: 'push_all/u1#1:0:token-ios',
        },
      ]);
      expect(w.ran).toEqual(['after']);
      expect((await w.copies()).map((row) => [row.channel, row.delivered])).toEqual([
        ['push_android', true],
        ['push_ios', true],
      ]);
    },
  },
  {
    name: "push: `devices: 'latest'` reaches only the most recent device",
    async run(w) {
      await w.device('u1', 'token-ios', 'ios');
      await w.advance('1 minute');
      await w.device('u1', 'token-android', 'android');
      await w.ingest('u1', 'start_push_latest');
      expect(w.sent.map((copy) => copy.recipient)).toEqual(['token-android']);
      expect(w.ran).toEqual(['after']);
    },
  },
  {
    name: 'push: a user with no device is skipped, and the journey goes on',
    async run(w) {
      await w.ingest('u1', 'start_push_all');
      expect(w.sent).toEqual([]);
      expect(w.ran).toEqual(['after']);
      expect(await w.statuses('push_all')).toEqual(['completed']);
    },
  },
  {
    name: 'prefer: push for a user with a device, email for one without',
    async run(w) {
      await w.identify('u1', reachable);
      await w.identify('u2', { ...reachable, email: 'bob@acme.test' });
      await w.device('u1', 'token-ios', 'ios');
      await w.ingest('u1', 'start_prefer');
      await w.ingest('u2', 'start_prefer');
      expect(
        w.sent.map((copy) => [copy.userId, copy.channel, copy.template, copy.recipient])
      ).toEqual([
        ['u1', 'push', 'ping', 'token-ios'],
        ['u2', 'email', 'receipt', 'bob@acme.test'],
      ]);
    },
  },
  {
    name: 'branch: the first matching arm runs, then the main line',
    async run(w) {
      await w.ingest('u1', 'order', { total: 150 });
      expect(w.of('branch')).toEqual([
        { action: 'big', args: {}, userId: 'u1', key: 'branch/u1#1:0.c0.0' },
        { action: 'after', args: {}, userId: 'u1', key: 'branch/u1#1:1' },
      ]);
    },
  },
  {
    name: 'branch: with no match the default arm runs, then the main line',
    async run(w) {
      await w.ingest('u1', 'order', { total: 42 });
      expect(w.of('branch')).toEqual([
        { action: 'small', args: {}, userId: 'u1', key: 'branch/u1#1:0.o.0' },
        { action: 'after', args: {}, userId: 'u1', key: 'branch/u1#1:1' },
      ]);
      expect(await w.statuses('branch')).toEqual(['completed']);
    },
  },
  {
    name: 'filter: lets the user it holds for through, and ends the journey for another',
    async run(w) {
      await w.identify('u1', { plan: 'pro' });
      await w.identify('u2', { plan: 'free' });
      await w.ingest('u1', 'start_filter');
      await w.ingest('u2', 'start_filter');
      expect(w.actions.map((call) => [call.action, call.userId])).toEqual([['after', 'u1']]);
      expect(await w.entries()).toEqual([
        { workflow: 'filter', user: 'u1', status: 'completed' },
        { workflow: 'filter', user: 'u2', status: 'exited' },
      ]);
    },
  },
  {
    name: 'cohort: a user lands in the arm their bucket names, on every host the same',
    async run(w) {
      const [a, b] = [userIn('a'), userIn('b')];
      await w.ingest(a, 'start_cohort');
      await w.ingest(b, 'start_cohort');
      expect(w.actions.map((call) => [call.action, call.userId])).toEqual([
        ['arm_a', a],
        ['after', a],
        ['arm_b', b],
        ['after', b],
      ]);
      expect(w.actions[0]?.key).toBe(`cohort/${a}#1:0.a.0`);
      expect(w.actions[2]?.key).toBe(`cohort/${b}#1:0.b.0`);
    },
  },
  {
    name: 'send_event: the event is stored for the user, and starts the workflow it triggers',
    async run(w) {
      await w.identify('u1', { plan: 'pro' });
      await w.ingest('u1', 'start_emitter');
      expect(await w.events('u1')).toEqual(['nudge_due', 'start_emitter']);
      expect(w.of('emitter')).toEqual([
        { action: 'after', args: {}, userId: 'u1', key: 'emitter/u1#1:1' },
      ]);
      // The payload it was sent with — a literal and a profile value — is the trigger's
      expect(w.of('listener')).toEqual([
        { action: 'heard', args: { level: 3, plan: 'pro' }, userId: 'u1', key: 'listener/u1#1:0' },
      ]);
      expect(await w.entries()).toEqual([
        { workflow: 'emitter', user: 'u1', status: 'completed' },
        { workflow: 'listener', user: 'u1', status: 'completed' },
      ]);
    },
  },
  {
    name: 'waitUntil: the awaited event wakes the journey, and it goes on down the main line',
    async run(w) {
      await w.ingest('u1', 'start_wait');
      expect(w.ran).toEqual([]);
      expect(await w.statuses('wait')).toEqual(['running']);
      expect(await w.rows('subscription', 'u1')).toBe(1);
      await w.ingest('u1', 'login');
      expect(w.ran).toEqual(['woke']);
      expect(await w.statuses('wait')).toEqual(['completed']);
      expect(await w.rows('subscription', 'u1')).toBe(0);
    },
  },
  {
    name: 'waitUntil: what the user did before the wait began does not answer it',
    async run(w) {
      await w.ingest('u1', 'login');
      await w.advance('1 minute');
      await w.ingest('u1', 'start_wait');
      expect(w.ran).toEqual([]);
      expect(await w.statuses('wait')).toEqual(['running']);
      await w.ingest('u1', 'login');
      expect(w.ran).toEqual(['woke']);
    },
  },
  {
    name: 'waitUntil: an event the wait is not for leaves it waiting',
    async run(w) {
      await w.ingest('u1', 'start_wait');
      await w.ingest('u1', 'purchase');
      expect(w.ran).toEqual([]);
      expect(await w.statuses('wait')).toEqual(['running']);
    },
  },
  {
    name: 'waitUntil: a condition on the profile is answered by a profile write',
    async run(w) {
      await w.ingest('u1', 'start_wait_profile');
      await w.identify('u1', { plan: 'free' });
      expect(w.ran).toEqual([]);
      await w.identify('u1', { plan: 'pro' });
      expect(w.ran).toEqual(['woke']);
      expect(await w.statuses('wait_profile')).toEqual(['completed']);
    },
  },
  {
    name: "waitUntil: `reachable('push')` is answered by the user's first device",
    async run(w) {
      await w.ingest('u1', 'start_wait_device');
      expect(w.ran).toEqual([]);
      await w.device('u1', 'token-ios', 'ios');
      expect(w.ran).toEqual(['woke']);
      expect(await w.statuses('wait_device')).toEqual(['completed']);
    },
  },
  {
    name: 'waitUntil: nothing happens before the deadline; at it, the timeout branch runs, then the main line',
    cannot: NO_LONG_TIMEOUT,
    async run(w) {
      await w.ingest('u1', 'start_wait');
      await w.advance('59 minutes');
      expect(w.ran).toEqual([]);
      await w.advance('1 minute');
      expect(w.actions).toEqual([
        { action: 'timed_out', args: {}, userId: 'u1', key: 'wait/u1#1:0.t.0' },
        { action: 'woke', args: {}, userId: 'u1', key: 'wait/u1#1:1' },
      ]);
      expect(await w.statuses('wait')).toEqual(['completed']);
    },
  },
  {
    name: 'waitUntil: timing out into a sub-flow runs it, then the main line',
    async run(w) {
      await w.ingest('u1', 'start_brief');
      await w.advance('2 seconds');
      expect(w.ran).toEqual(['timed_out', 'woke']);
      expect(await w.statuses('brief')).toEqual(['completed']);
      expect(await w.rows('subscription', 'u1')).toBe(0);
    },
  },
  {
    name: "waitUntil: timing out with `onTimeout: 'exit'` ends the journey there",
    async run(w) {
      await w.ingest('u1', 'start_brief_exit');
      await w.advance('2 seconds');
      expect(w.ran).toEqual([]);
      expect(await w.statuses('brief_exit')).toEqual(['exited']);
    },
  },
  {
    name: 'waitUntil: timing out with no `onTimeout` goes on down the main line',
    async run(w) {
      await w.ingest('u1', 'start_brief_continue');
      await w.advance('2 seconds');
      expect(w.ran).toEqual(['woke']);
      expect(await w.statuses('brief_continue')).toEqual(['completed']);
    },
  },
  {
    name: 'goal: met before the first node, nothing runs and the instance converted',
    async run(w) {
      await w.batch({ userId: 'u1', events: [{ event: 'start_goal' }, { event: 'purchase' }] });
      expect(w.ran).toEqual([]);
      expect(await w.statuses('goal')).toEqual(['goal']);
      expect(await w.instances()).toEqual([
        { workflow: 'goal', user: 'u1', status: 'goal', node: null, converted: true },
      ]);
    },
  },
  {
    name: 'goal: met during a wait, the journey ends as a conversion before its next node',
    async run(w) {
      await w.ingest('u1', 'start_goal');
      expect(w.ran).toEqual(['first']);
      // The goal is looked at before each node, not while one waits: the wait is still its own
      await w.ingest('u1', 'purchase');
      expect(await w.statuses('goal')).toEqual(['running']);
      await w.ingest('u1', 'release');
      expect(w.ran).toEqual(['first']);
      expect(await w.statuses('goal')).toEqual(['goal']);
      expect(await w.instances()).toEqual([
        { workflow: 'goal', user: 'u1', status: 'goal', node: '1', converted: true },
      ]);
      expect(await w.rows('subscription', 'u1')).toBe(0);
    },
  },
  {
    name: 'goal: a purchase made before entering is history, not a conversion',
    async run(w) {
      await w.ingest('u1', 'purchase');
      await w.advance('1 minute');
      await w.ingest('u1', 'start_goal');
      await w.ingest('u1', 'release');
      expect(w.ran).toEqual(['first', 'second']);
      expect(await w.statuses('goal')).toEqual(['completed']);
      expect((await w.instances())[0]).toMatchObject({ status: 'completed', converted: false });
    },
  },
  {
    name: 'goal: with `exitOnMatch: false` the journey runs to its end and still counts as converted',
    async run(w) {
      await w.ingest('u1', 'start_goal_stays');
      await w.ingest('u1', 'purchase');
      await w.ingest('u1', 'release');
      expect(w.ran).toEqual(['first', 'second']);
      expect(await w.statuses('goal_stays')).toEqual(['completed']);
      expect((await w.instances())[0]).toMatchObject({ status: 'completed', converted: true });
    },
  },
  {
    name: 'exitWhen: met before the first node, nothing runs',
    async run(w) {
      await w.identify('u1', { plan: 'churned' });
      await w.ingest('u1', 'start_exit_when');
      expect(w.ran).toEqual([]);
      expect(await w.statuses('exit_when')).toEqual(['exit_when']);
      expect((await w.instances())[0]).toMatchObject({ status: 'exit_when', converted: false });
    },
  },
  {
    name: 'exitWhen: met while the journey waits, it ends before the next node',
    async run(w) {
      await w.ingest('u1', 'start_exit_when');
      await w.identify('u1', { plan: 'churned' });
      await w.ingest('u1', 'release');
      expect(w.ran).toEqual(['first']);
      expect(await w.statuses('exit_when')).toEqual(['exit_when']);
    },
  },
  {
    name: 'exitWhen: never met, the journey completes',
    async run(w) {
      await w.ingest('u1', 'start_exit_when');
      await w.ingest('u1', 'release');
      expect(w.ran).toEqual(['first', 'second']);
      expect(await w.statuses('exit_when')).toEqual(['completed']);
    },
  },
  {
    name: 'exit: inside a branch arm it ends the journey; an arm not taken lets it go on',
    async run(w) {
      await w.identify('u1', { plan: 'free' });
      await w.identify('u2', { plan: 'pro' });
      await w.ingest('u1', 'start_exit');
      await w.ingest('u2', 'start_exit');
      expect(w.actions.map((call) => [call.action, call.userId])).toEqual([
        ['first', 'u1'],
        ['first', 'u2'],
        ['second', 'u2'],
      ]);
      expect(await w.entries()).toEqual([
        { workflow: 'exit', user: 'u1', status: 'exited' },
        { workflow: 'exit', user: 'u2', status: 'completed' },
      ]);
    },
  },

  /* -------------------------------- triggers -------------------------------- */
  {
    name: 'event trigger: an event delivered twice under one id enters once, whatever the reentry policy',
    async run(w) {
      const batch = { userId: 'u1', events: [{ id: 'delivery-1', event: 'start_concurrent' }] };
      await w.batch(batch);
      await w.advance('1 minute');
      await w.batch(batch);
      expect(w.ran).toEqual(['mark']);
      expect(await w.statuses('concurrent')).toEqual(['running']);
      expect(await w.events('u1')).toEqual(['start_concurrent']);
    },
  },
  {
    name: 'event trigger: enters only when the payload and the profile both pass their gates',
    async run(w) {
      await w.identify('u1', { plan: 'pro' });
      await w.identify('u2', { plan: 'free' });
      await w.ingest('u1', 'order', { total: 999 });
      await w.ingest('u2', 'order', { total: 5_000 });
      expect(w.of('gated')).toEqual([]);
      await w.ingest('u1', 'order', { total: 1_000 });
      expect(w.of('gated')).toEqual([
        { action: 'big', args: {}, userId: 'u1', key: 'gated/u1#1:0' },
      ]);
      expect(await w.statuses('gated')).toEqual(['completed']);
    },
  },
  {
    name: 'segment trigger: entering the segment by a profile change starts the journey, staying in it does not',
    async run(w) {
      // The first sweep after a deploy ends the seeding: from here on, matching is entering
      await w.sweep();
      await w.identify('u1', { plan: 'free' });
      expect(w.of('became_pro')).toEqual([]);
      await w.identify('u1', { plan: 'pro' });
      expect(w.of('became_pro')).toEqual([
        { action: 'mark', args: { via: 'pro' }, userId: 'u1', key: 'became_pro/u1#1:0' },
      ]);
      await w.identify('u1', { name: 'Ada' });
      await w.sweep();
      expect(w.of('became_pro')).toHaveLength(1);
    },
  },
  {
    name: 'segment trigger: leaving and qualifying afresh is another entry',
    async run(w) {
      await w.sweep();
      await w.identify('u1', { plan: 'pro' });
      await w.advance('1 minute');
      await w.identify('u1', { plan: 'free' });
      await w.advance('1 minute');
      await w.identify('u1', { plan: 'pro' });
      expect(w.of('became_pro').map((call) => call.key)).toEqual([
        'became_pro/u1#1:0',
        'became_pro/u1#2:0',
      ]);
      expect(await w.statuses('became_pro')).toEqual(['completed', 'completed']);
    },
  },
  {
    name: 'segment trigger: a user who already matched when the segment was deployed starts nothing',
    async run(w) {
      await w.identify('u1', { plan: 'pro' });
      await w.sweep();
      await w.identify('u1', { name: 'Ada' });
      await w.sweep();
      expect(w.of('became_pro')).toEqual([]);
    },
  },
  {
    name: 'segment trigger: a segment entered by the clock alone is seen by the sweep, once',
    async run(w) {
      await w.sweep();
      await w.ingest('u1', 'login');
      await w.identify('u1', { plan: 'trial' });
      await w.advance('6 days');
      await w.sweep();
      expect(w.of('went_dormant')).toEqual([]);
      await w.advance('2 days');
      await w.sweep();
      expect(w.of('went_dormant')).toEqual([
        { action: 'mark', args: { via: 'dormant' }, userId: 'u1', key: 'went_dormant/u1#1:0' },
      ]);
      await w.sweep();
      expect(w.of('went_dormant')).toHaveLength(1);
      expect(await w.statuses('went_dormant')).toEqual(['completed']);
    },
  },
  {
    name: 'date trigger: at its time the sweep starts a journey for every user its filter holds for, once',
    async run(w) {
      await w.identify('u1', { plan: 'pro' });
      await w.identify('u2', { plan: 'free' });
      await w.advance('23 hours');
      await w.sweep();
      expect(w.of('dated')).toEqual([]);
      // 09:00 the next day
      await w.advance('1 hour');
      await w.sweep();
      expect(w.of('dated')).toEqual([
        { action: 'mark', args: { via: 'date' }, userId: 'u1', key: 'dated/u1#1:0' },
      ]);
      await w.advance('1 hour');
      await w.sweep();
      expect(w.of('dated')).toHaveLength(1);
      expect(await w.statuses('dated')).toEqual(['completed']);
    },
  },
  {
    name: 'date trigger: a user who turns up after the time has passed is not entered',
    async run(w) {
      await w.advance('1 day');
      await w.sweep();
      await w.identify('u1', { plan: 'pro' });
      await w.advance('1 hour');
      await w.sweep();
      expect(w.of('dated')).toEqual([]);
    },
  },
  {
    name: 'webhook trigger: the workflow deploys, and is reported as having no route',
    async run(w) {
      expect(await w.deploy()).toMatchObject({
        unrouted: [{ workflow: 'hooked', trigger: 'webhook' }],
      });
      expect(w.of('hooked')).toEqual([]);
    },
  },

  /* -------------------------------- re-entry -------------------------------- */
  {
    name: 'reentry never: one entry per user, running or over',
    async run(w) {
      await w.ingest('u1', 'start_never');
      await w.ingest('u1', 'start_never');
      expect(w.ran).toEqual(['mark']);
      await w.ingest('u1', 'release');
      expect(await w.statuses('never')).toEqual(['completed']);
      await w.ingest('u1', 'start_never');
      expect(w.ran).toEqual(['mark']);
      // Another user enters as if nobody had
      await w.ingest('u2', 'start_never');
      expect(w.actions.map((call) => call.key)).toEqual(['never/u1#1:0', 'never/u2#1:0']);
    },
  },
  {
    name: 'reentry after_exit: refused while the previous instance runs, let in once it has ended',
    async run(w) {
      await w.ingest('u1', 'start_after_exit');
      await w.advance('1 minute');
      await w.ingest('u1', 'start_after_exit');
      expect(w.ran).toEqual(['mark']);
      expect(await w.statuses('after_exit')).toEqual(['running']);
      await w.ingest('u1', 'release');
      expect(await w.statuses('after_exit')).toEqual(['completed']);
      await w.advance('1 minute');
      await w.ingest('u1', 'start_after_exit');
      expect(w.actions.map((call) => call.key)).toEqual(['after_exit/u1#1:0', 'after_exit/u1#2:0']);
      expect(await w.statuses('after_exit')).toEqual(['completed', 'running']);
    },
  },
  {
    name: 'reentry concurrent: a second instance runs beside the first',
    async run(w) {
      await w.ingest('u1', 'start_concurrent');
      await w.advance('1 minute');
      await w.ingest('u1', 'start_concurrent');
      expect(w.actions.map((call) => call.key)).toEqual(['concurrent/u1#1:0', 'concurrent/u1#2:0']);
      expect(await w.statuses('concurrent')).toEqual(['running', 'running']);
      // One release answers both waits
      await w.ingest('u1', 'release');
      expect(await w.statuses('concurrent')).toEqual(['completed', 'completed']);
    },
  },
  {
    name: 'reentry after_exit with a cooldown: an ended instance is not enough until the cooldown has passed too',
    async run(w) {
      await w.ingest('u1', 'start_after_exit_cooldown');
      await w.ingest('u1', 'release');
      expect(await w.statuses('after_exit_cooldown')).toEqual(['completed']);
      await w.advance('23 hours');
      await w.ingest('u1', 'start_after_exit_cooldown');
      expect(w.ran).toEqual(['mark']);
      await w.advance('2 hours');
      await w.ingest('u1', 'start_after_exit_cooldown');
      expect(w.ran).toEqual(['mark', 'mark']);
      expect(await w.statuses('after_exit_cooldown')).toEqual(['completed', 'running']);
    },
  },
  {
    name: 'reentry after_exit with a cooldown: past the cooldown, a running instance still refuses',
    async run(w) {
      await w.ingest('u1', 'start_after_exit_cooldown');
      await w.advance('25 hours');
      await w.ingest('u1', 'start_after_exit_cooldown');
      expect(w.ran).toEqual(['mark']);
      expect(await w.statuses('after_exit_cooldown')).toEqual(['running']);
    },
  },
  {
    name: 'reentry concurrent with a cooldown: refused inside the cooldown, let in after it beside the first',
    async run(w) {
      await w.ingest('u1', 'start_concurrent_cooldown');
      await w.advance('23 hours');
      await w.ingest('u1', 'start_concurrent_cooldown');
      expect(w.ran).toEqual(['mark']);
      await w.advance('2 hours');
      await w.ingest('u1', 'start_concurrent_cooldown');
      expect(w.ran).toEqual(['mark', 'mark']);
      expect(await w.statuses('concurrent_cooldown')).toEqual(['running', 'running']);
    },
  },

  /* ------------------------------ failure paths ----------------------------- */
  {
    name: 'retry: an action that fails twice is tried a third time, and the step before it is not run again',
    async run(w) {
      probe.failing.set('flaky', 2);
      await w.ingest('u1', 'start_flaky');
      // Every host's backoff for two failures is well inside this
      await w.advance('10 minutes');
      expect(w.actions).toEqual([
        { action: 'first', args: {}, userId: 'u1', key: 'flaky/u1#1:0' },
        // The same key on every attempt: what the far side de-duplicates on
        { action: 'flaky', args: {}, userId: 'u1', key: 'flaky/u1#1:1' },
        { action: 'flaky', args: {}, userId: 'u1', key: 'flaky/u1#1:1' },
        { action: 'flaky', args: {}, userId: 'u1', key: 'flaky/u1#1:1' },
        { action: 'second', args: {}, userId: 'u1', key: 'flaky/u1#1:2' },
      ]);
      expect(await w.statuses('flaky')).toEqual(['completed']);
    },
  },
  {
    name: 'retry: the failed attempt is not repeated at once — the backoff is waited out',
    cannot: NO_HELD_SLEEP,
    async run(w) {
      probe.failing.set('flaky', 1);
      await w.ingest('u1', 'start_flaky');
      expect(w.ran).toEqual(['first', 'flaky']);
      expect(await w.statuses('flaky')).toEqual(['running']);
      await w.advance('1 second');
      expect(w.ran).toEqual(['first', 'flaky']);
      await w.advance('10 minutes');
      expect(w.ran).toEqual(['first', 'flaky', 'flaky', 'second']);
    },
  },
  {
    name: 'retry: an action that never succeeds fails the journey once the retries are spent',
    async run(w) {
      probe.failing.set('flaky', Number.POSITIVE_INFINITY);
      await w.ingest('u1', 'start_flaky');
      await w.advance('1 day');
      // How many attempts is the host's own budget; that it ends, and how, is not
      expect(w.ran.filter((name) => name !== 'flaky')).toEqual(['first']);
      expect(w.ran.length).toBeGreaterThan(2);
      expect(await w.statuses('flaky')).toEqual(['failed']);
      expect((await w.instances())[0]).toMatchObject({ status: 'failed', node: '1' });
    },
  },
  {
    name: 'retry: a send the provider could not take is offered again, and reported delivered once',
    async run(w) {
      probe.unavailable.set('receipt', 1);
      await w.identify('u1', reachable);
      await w.ingest('u1', 'start_refused');
      await w.advance('10 minutes');
      expect(w.sent.map((copy) => copy.key)).toEqual(['refused/u1#1:0', 'refused/u1#1:0']);
      expect(w.ran).toEqual(['after']);
      expect(await w.copies()).toEqual([
        { template: 'receipt', channel: 'email', user: 'u1', delivered: true, undelivered: null },
      ]);
    },
  },
  {
    name: 'retry: a push that fails on one device is retried on that device alone',
    async run(w) {
      probe.unavailable.set('ping→token-ios', 1);
      await w.device('u1', 'token-ios', 'ios');
      await w.advance('1 minute');
      await w.device('u1', 'token-android', 'android');
      await w.ingest('u1', 'start_push_all');
      await w.advance('10 minutes');
      expect(w.sent.map((copy) => copy.recipient)).toEqual([
        'token-android',
        'token-ios',
        'token-ios',
      ]);
      expect(w.ran).toEqual(['after']);
      expect((await w.copies()).map((row) => [row.channel, row.delivered])).toEqual([
        ['push_android', true],
        ['push_ios', true],
      ]);
    },
  },
  {
    name: 'a permanent failure is not retried: the journey fails where it stands',
    async run(w) {
      await w.ingest('u1', 'start_broken');
      await w.advance('1 hour');
      expect(w.ran).toEqual(['first', 'broken']);
      expect(await w.statuses('broken')).toEqual(['failed']);
      expect(await w.instances()).toEqual([
        { workflow: 'broken', user: 'u1', status: 'failed', node: '1', converted: false },
      ]);
    },
  },
  {
    name: 'a send refused for good settles the copy undelivered, and the journey goes on',
    async run(w) {
      probe.refusing.set('receipt', 'bad_address');
      await w.identify('u1', reachable);
      await w.ingest('u1', 'start_refused');
      await w.advance('1 hour');
      // Offered to the sender once, not again
      expect(w.sent.map((copy) => copy.key)).toEqual(['refused/u1#1:0']);
      expect(w.ran).toEqual(['after']);
      expect(await w.statuses('refused')).toEqual(['completed']);
      expect(await w.copies()).toEqual([
        {
          template: 'receipt',
          channel: 'email',
          user: 'u1',
          delivered: false,
          undelivered: 'bad_address',
        },
      ]);
    },
  },
  {
    name: 'a template that refuses its props fails the journey at that step, with nothing sent and no retry',
    async run(w) {
      // An address, but no name: `welcome` requires one
      await w.identify('u1', { email: 'ada@acme.test' });
      await w.ingest('u1', 'start_strict');
      await w.advance('1 hour');
      expect(w.ran).toEqual(['first']);
      expect(w.sent).toEqual([]);
      expect(await w.statuses('strict')).toEqual(['failed']);
      expect(await w.copies()).toEqual([]);
    },
  },

  /* -------------------------------- lifecycle ------------------------------- */
  {
    name: 'erasure while the journey sleeps: it never wakes, and nothing of the user is left',
    cannot: NO_HELD_SLEEP,
    async run(w) {
      await w.ingest('u1', 'start_nap');
      expect(await w.forget('u1')).toMatchObject({ erased: true, pending: [] });
      await w.advance('2 hours');
      expect(w.ran).toEqual(['first']);
      expect(await w.left('u1')).toEqual({});
    },
  },
  {
    name: 'erasure before the instance has started: it never runs, and nothing of the user is left',
    async run(w) {
      // Accepted, not yet run: the erasure gets there first
      const reply = await w.host.request('POST', '/ingest', {
        userId: 'u1',
        events: [{ event: 'start_nap' }],
      });
      expect(reply.status).toBe(200);
      expect(await w.forget('u1')).toMatchObject({ erased: true, pending: [] });
      await w.advance('2 hours');
      expect(w.ran).toEqual([]);
      expect(await w.left('u1')).toEqual({});
    },
  },
  {
    name: 'erasure while the journey waits: the wait is never answered, and nothing of the user is left',
    async run(w) {
      await w.identify('u1', reachable);
      await w.ingest('u1', 'start_goal');
      expect(w.ran).toEqual(['first']);
      await w.forget('u1');
      // A stopped execution is given time to drain before its user is erased (AWS); the sweep
      // carries a pending erasure out. Elsewhere it was over with the request
      await w.advance('1 hour');
      await w.sweep();
      expect(await w.left('u1')).toEqual({});
      expect(w.ran).toEqual(['first']);
    },
  },
  {
    name: 'erasure: the request itself answers erased once the instance is stopped',
    async run(w) {
      await w.ingest('u1', 'start_goal');
      expect(await w.forget('u1')).toMatchObject({ erased: true, pending: [] });
    },
  },
  {
    name: 'erasure: an erased user who comes back is refused, and starts nothing',
    async run(w) {
      await w.ingest('u1', 'start_nap');
      await w.advance('1 hour');
      await w.forget('u1');
      const reply = await w.host.request('POST', '/ingest', {
        userId: 'u1',
        events: [{ event: 'start_nap' }],
      });
      await w.host.settle();
      expect(reply.status).not.toBe(200);
      expect(w.ran).toEqual(['first', 'second']);
      expect(await w.rows('entry', 'u1')).toBe(0);
    },
  },
  {
    name: 'opt-out: a topic switched off on a channel stops that copy, not the others',
    async run(w) {
      await w.identify('u1', reachable);
      await w.device('u1', 'token-ios', 'ios');
      await w.subscriptions('u1', { email: { topics: { tips: false } } });
      await w.ingest('u1', 'start_tips');
      expect(w.sent.map((copy) => [copy.channel, copy.template, copy.topic])).toEqual([
        ['push', 'tips', 'tips'],
        ['email', 'receipt', null],
      ]);
      expect(w.ran).toEqual(['after']);
      expect(await w.statuses('tips')).toEqual(['completed']);
    },
  },
  {
    name: 'opt-out: a channel switched off stops its topics, and a transactional message still goes',
    async run(w) {
      await w.identify('u1', reachable);
      await w.device('u1', 'token-ios', 'ios');
      await w.subscriptions('u1', { email: { all: false }, push: { all: false } });
      await w.ingest('u1', 'start_tips');
      expect(w.sent.map((copy) => [copy.channel, copy.template])).toEqual([['email', 'receipt']]);
      expect(w.ran).toEqual(['after']);
    },
  },
  {
    name: 'opt-out: with nothing switched off every copy goes',
    async run(w) {
      await w.identify('u1', reachable);
      await w.device('u1', 'token-ios', 'ios');
      await w.ingest('u1', 'start_tips');
      expect(w.sent.map((copy) => [copy.channel, copy.template])).toEqual([
        ['email', 'tips'],
        ['push', 'tips'],
        ['email', 'receipt'],
      ]);
    },
  },
  {
    name: 'a visitor who signs in mid-journey: the instance is the user from there on',
    async run(w) {
      await w.batch({ visitorId: 'v9', events: [{ event: 'start_visitor' }] });
      expect(w.actions).toEqual([
        { action: 'first', args: {}, userId: 'visitor:v9', key: 'visitor/visitor#1:0' },
      ]);
      // Signs in: the visitor is u9, who has an address
      await w.batch({ userId: 'u9', visitorId: 'v9', profile: reachable });
      await w.ingest('u9', 'release');
      expect(w.actions.map((call) => [call.action, call.userId])).toEqual([
        ['first', 'visitor:v9'],
        ['second', 'u9'],
      ]);
      expect(w.sent.map((copy) => [copy.template, copy.userId, copy.recipient])).toEqual([
        ['receipt', 'u9', 'ada@acme.test'],
      ]);
      expect(await w.entries()).toEqual([{ workflow: 'visitor', user: 'u9', status: 'completed' }]);
      expect(await w.instances()).toMatchObject([
        { workflow: 'visitor', user: 'u9', status: 'completed' },
      ]);
    },
  },
  {
    name: 'a visitor does not enter a workflow that did not ask for visitors',
    async run(w) {
      await w.batch({ visitorId: 'v9', events: [{ event: 'start_nap' }] });
      expect(w.ran).toEqual([]);
      expect(await w.entries()).toEqual([]);
    },
  },
];
