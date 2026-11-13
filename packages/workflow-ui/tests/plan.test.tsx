import { describe, expect, test } from 'vitest';
import { formatPlan } from '../src/plan';

const pin = (workflow: string, contentHash: string, running: number, carried: boolean) => ({
  workflow,
  contentHash,
  running,
  carried,
  ir: undefined,
});

describe('formatPlan', () => {
  test('nothing running: safe', () => {
    expect(formatPlan({ pinned: [], problems: [], schema: [] })).toEqual([
      'no journey is running: nothing is pinned',
      'this bundle keeps every running journey: safe to deploy',
    ]);
  });

  test('pinned versions, a schema gap and the problems, with how to go on', () => {
    const lines = formatPlan({
      pinned: [pin('onboarding', 'abcdef0123', 5, true), pin('winback', '0123456789', 1, false)],
      problems: [
        {
          workflow: 'winback',
          contentHash: '0123456789',
          running: 1,
          problem: "segment 'vip' is not in the bundle",
        },
      ],
      schema: ['column "workflow"."entry"."claimed_at" is missing'],
    });
    expect(lines).toEqual([
      '2 pinned versions, 6 running journeys:',
      '  onboarding@abcdef01  5 running',
      '  winback@01234567  1 running  (finish on their version; this bundle changes the workflow)',
      'the database lacks (run the migrations before deploying):',
      '  column "workflow"."entry"."claimed_at" is missing',
      'this bundle would break running journeys:',
      "  winback@01234567 (1 running journey): segment 'vip' is not in the bundle",
      'fix the bundle (keep the segment or action, give the template a new id, make the prop optional), or deploy with POST /bundle/deploy?force=1 to fail them',
    ]);
  });
});
