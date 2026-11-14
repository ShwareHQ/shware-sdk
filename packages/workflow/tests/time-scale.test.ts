import { describe, expect, test } from 'vitest';
import { scaleDurations, scaleSegmentWindows } from '../src/engine/time-scale';
import { event, not, performed, trigger, workflow } from '../src/index';
import type { ConditionIR } from '../src/ir';
import { plainEmail } from './fixtures';

interface Event {
  login: { method: string };
  purchase: Record<string, never>;
}
const e = event<Event>();
const tpl = plainEmail('t');

const flow = workflow({
  id: 'scaled',
  trigger: trigger.event(e.login),
  goal: { condition: performed(e.purchase), within: '30 days' },
})
  .email(tpl)
  .delay('2 days')
  .waitUntil(performed(e.login, { count: 2, within: '1 day' }), {
    timeout: '3 days',
    onTimeout: 'continue',
  })
  .branch([not(performed(e.login, { count: 2 })), (w) => w.email(tpl)]);

const DAY = 24 * 60 * 60 * 1000;

describe('scaleDurations', () => {
  test('drops time windows, which are times of day, and keeps every other id', () => {
    const windowed = workflow({ id: 'windowed', trigger: trigger.event(e.login) })
      .delay('1 hour')
      .timeWindow({ between: ['09:00', '21:00'] })
      .email(tpl)
      .branch([
        performed(e.purchase),
        (w) => w.timeWindow({ between: ['09:00', '21:00'] }).email(tpl),
      ])
      .toIR();
    const scaled = scaleDurations(windowed, 600);
    const types = (nodes: readonly { type: string }[]) => nodes.map((node) => node.type);

    expect(types(scaled.flow)).toEqual(['delay', 'message', 'branch']);
    expect(scaled.flow.map((node) => node.id)).toEqual(['0', '2', '3']);
    const branch = scaled.flow[2];
    expect(branch?.type === 'branch' && types(branch.cases[0]?.flow ?? [])).toEqual(['message']);
    // Unscaled, nothing is touched.
    expect(scaleDurations(windowed, 1)).toBe(windowed);
  });

  test('divides every duration by the factor and keeps the source text', () => {
    const ir = flow.toIR();
    const scaled = scaleDurations(ir, 3600);
    const text = JSON.stringify(scaled);

    expect(text).toContain(JSON.stringify({ value: '2 days', ms: (2 * DAY) / 3600 }));
    expect(text).toContain(JSON.stringify({ value: '3 days', ms: (3 * DAY) / 3600 }));
    expect(text).toContain(JSON.stringify({ value: '1 day', ms: DAY / 3600 }));
    expect(text).toContain(JSON.stringify({ value: '30 days', ms: (30 * DAY) / 3600 }));
    expect(text).not.toContain(`"ms":${2 * DAY}`);
    // Identity and hash untouched: the pinned version still names the deployed workflow
    expect(scaled.contentHash).toBe(ir.contentHash);
    expect(scaled.id).toBe(ir.id);
  });

  test('a message prop or an emitted payload shaped like a duration is not a duration', () => {
    const ir = flow.toIR();
    const lookalike = { value: '2 days', ms: 2 * DAY };
    const first = ir.flow[0];
    if (first.type !== 'message') throw new Error('fixture: first node is the email');
    const decoy: typeof ir = {
      ...ir,
      flow: [
        { ...first, props: { ...first.props, window: lookalike as never } },
        ...ir.flow.slice(1),
      ],
    };
    const scaled = scaleDurations(decoy, 3600);
    const node = scaled.flow[0];
    if (node.type !== 'message') throw new Error('scaled: first node is the email');
    expect(node.props.window).toEqual(lookalike);
  });

  test('a factor of 1 (or an invalid one) returns the IR as is', () => {
    const ir = flow.toIR();
    expect(scaleDurations(ir, 1)).toBe(ir);
    expect(scaleDurations(ir, 0)).toBe(ir);
    expect(scaleDurations(ir, Number.NaN)).toBe(ir);
  });
});

describe('scaleSegmentWindows', () => {
  const condition: ConditionIR = {
    type: 'performed',
    event: 'login',
    within: { value: '7 days', ms: 604_800_000 },
  };
  const store = {
    calls: 0,
    async getSegmentCondition(name: string) {
      this.calls += 1;
      return name === 'inactive' ? condition : undefined;
    },
    async listSegments() {
      return [{ id: 'inactive', condition: { type: 'not', condition } satisfies ConditionIR }];
    },
    async findTriggers(event: string) {
      return [{ workflow: event, hash: 'h', where: null, filter: condition, visitors: false }];
    },
    other() {
      return this.calls;
    },
  };

  test('segment definitions come back scaled; everything else is the store itself', async () => {
    const scaled = scaleSegmentWindows(store, 3600);
    expect(await scaled.getSegmentCondition('inactive')).toEqual({
      ...condition,
      within: { value: '7 days', ms: 168_000 },
    });
    expect(await scaled.getSegmentCondition('missing')).toBeUndefined();
    expect(scaled.other()).toBe(2);
  });

  test('the sweep and trigger routing read scaled conditions; the store keeps its own', async () => {
    const scaled = scaleSegmentWindows(store, 3600);
    const window = { value: '7 days', ms: 168_000 };
    expect(await scaled.listSegments()).toEqual([
      { id: 'inactive', condition: { type: 'not', condition: { ...condition, within: window } } },
    ]);
    expect(await scaled.findTriggers('login')).toEqual([
      {
        workflow: 'login',
        hash: 'h',
        where: null,
        filter: { ...condition, within: window },
        visitors: false,
      },
    ]);
    // The wrapped store is untouched: its own reads still see the written window
    expect((await store.listSegments())[0]?.condition).toEqual({ type: 'not', condition });
    expect((await store.findTriggers('login'))[0]?.filter).toBe(condition);
    expect(condition.within).toEqual({ value: '7 days', ms: 604_800_000 });
  });

  test('a factor of 1 hands back the store unwrapped', () => {
    expect(scaleSegmentWindows(store, 1)).toBe(store);
  });
});
