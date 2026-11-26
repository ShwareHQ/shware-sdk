import { event, performed, trigger, workflow } from '@shware/workflow';
import { describe, expect, test } from 'vitest';
import { layout } from '../src/components/layout';

const e = event<{ sign_up: Record<string, never>; login: Record<string, never> }>();

const subtitleOf = (onTimeout: 'exit' | 'continue') => {
  const ir = workflow({ id: 'w', reentry: { mode: 'never' }, trigger: trigger.event(e.sign_up) })
    .waitUntil(performed(e.login), { timeout: '3 days', onTimeout })
    .toIR();
  return layout(ir).nodes.find((node) => node.data.icon === 'wait_until')?.data.subtitle;
};

describe('a wait without a timeout flow', () => {
  test('says on its card whether the timeout ends the journey or goes on', () => {
    // Drawn alike otherwise: one arrow down to the next node, whichever of the two it is
    expect(subtitleOf('exit')).toBe('timeout 3 days → exit');
    expect(subtitleOf('continue')).toBe('timeout 3 days → continue');
  });
});
