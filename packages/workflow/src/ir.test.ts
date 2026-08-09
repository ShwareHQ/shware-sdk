import { describe, expect, test } from 'vitest';
import { IR_VERSION, WorkflowIR } from './ir';

/** Expected compiled shape of `checkoutRecovery` (workflows/index.ts). */
const checkoutRecoveryIR = {
  irVersion: IR_VERSION,
  name: 'checkout_recovery',
  contentHash: 'a3f8c2d1e5b90776',
  trigger: { type: 'event', event: 'begin_checkout' },
  goal: {
    condition: { type: 'segment', segment: 'purchaser' },
    exitOnMatch: true,
  },
  flow: [
    { id: '0', type: 'delay', duration: { value: '1 hour', ms: 3_600_000 } },
    {
      id: '1',
      type: 'branch',
      label: 'subscriber_split',
      cases: [
        {
          condition: { type: 'segment', segment: 'active_subscriber' },
          flow: [
            {
              id: '1.c0.0',
              type: 'message',
              channel: 'email',
              template: 'u1_upgrade_recovery',
              props: { plan: { type: 'user_property', path: 'subscription_plan' } },
            },
          ],
        },
      ],
      otherwise: [
        {
          id: '1.o.0',
          type: 'message',
          channel: 'email',
          template: 'n1_first_time_recovery',
          props: {},
        },
        { id: '1.o.1', type: 'delay', duration: { value: '23 hours', ms: 82_800_000 } },
        {
          id: '1.o.2',
          type: 'message',
          channel: 'email',
          template: 'n2_limited_time_offer',
          props: { coupon: '15OFF', expiresIn: '48 hours' },
        },
      ],
    },
  ],
};

describe('WorkflowIR schema', () => {
  test('accepts a valid workflow IR (recursive branch, condition tree, property refs)', () => {
    const parsed = WorkflowIR.parse(checkoutRecoveryIR);
    expect(parsed.name).toBe('checkout_recovery');
    expect(parsed.flow).toHaveLength(2);
  });

  test('survives a JSON round-trip losslessly (IR is plain data)', () => {
    const parsed = WorkflowIR.parse(checkoutRecoveryIR);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed);
  });

  test('rejects unknown node type', () => {
    const bad = {
      ...checkoutRecoveryIR,
      flow: [{ id: '0', type: 'goto', target: '1' }],
    };
    expect(() => WorkflowIR.parse(bad)).toThrow();
  });

  test('rejects mismatched irVersion (readers dispatch by format version)', () => {
    expect(() => WorkflowIR.parse({ ...checkoutRecoveryIR, irVersion: 999 })).toThrow();
  });
});
