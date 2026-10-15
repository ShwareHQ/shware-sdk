import { describe, expect, test } from 'vitest';
import { collectSegments } from '../src/app/routes/segments';

describe('the segment list', () => {
  test('every deployed segment, used or not, plus referenced ones that are not deployed', () => {
    const ir = {
      id: 'reengagement',
      trigger: { type: 'segment', segment: 'dormant' },
      flow: [
        {
          type: 'branch',
          id: '0',
          cases: [{ condition: { type: 'segment', segment: 'vip' }, flow: [] }],
        },
      ],
    } as never;
    expect(collectSegments([ir], [{ id: 'dormant' }, { id: 'ios_users' }])).toEqual([
      { id: 'dormant', usedBy: ['reengagement'] },
      { id: 'ios_users', usedBy: [] },
      { id: 'vip', usedBy: ['reengagement'] },
    ]);
  });
});
