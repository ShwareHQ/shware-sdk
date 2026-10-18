import { describe, expect, test } from 'vitest';
import { scaleDurations, scaleSegmentWindows } from '../src/engine/time-scale';
import { event, not, performed, trigger, workflow } from '../src/index';
import { plainEmail } from './fixtures';

interface Event {
  login: { method: string };
  purchase: Record<never, never>;
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

  test('a factor of 1 (or an invalid one) returns the IR as is', () => {
    const ir = flow.toIR();
    expect(scaleDurations(ir, 1)).toBe(ir);
    expect(scaleDurations(ir, 0)).toBe(ir);
    expect(scaleDurations(ir, Number.NaN)).toBe(ir);
  });
});

describe('scaleSegmentWindows', () => {
  const condition = {
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

  test('a factor of 1 hands back the store unwrapped', () => {
    expect(scaleSegmentWindows(store, 1)).toBe(store);
  });
});
