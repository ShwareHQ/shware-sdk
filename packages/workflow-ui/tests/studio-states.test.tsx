import { type NodeIR, defineConfig } from '@shware/workflow';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { StatsNotice, errorMessage, statsStatus } from '../src/app/routes/metrics';
import { NodeInspector } from '../src/components/node-inspector';
import { statsTimeScale } from '../src/postgres';
import { lookup } from '../src/utils/lookup';

afterEach(cleanup);

describe('lookup reads own properties only', () => {
  test('a route param naming an Object.prototype member is a miss, not a function', () => {
    const registry: Record<string, { id: string }> = { onboarding: { id: 'onboarding' } };
    expect(lookup(registry, 'onboarding')).toEqual({ id: 'onboarding' });
    for (const key of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
      expect(lookup(registry, key)).toBeUndefined();
    }
  });
});

describe('the inspector prints cohort weights as the percentages they are', () => {
  test('a 50/50 cohort reads 50%, not 0.5%', () => {
    const node: NodeIR = {
      id: '5',
      type: 'cohort',
      key: 'exp',
      arms: [
        { name: 'control', weight: 50, flow: [] },
        { name: 'variant', weight: 50, flow: [] },
      ],
    };
    render(<NodeInspector node={node} onClose={() => {}} />);
    expect(screen.getAllByText('50%')).toHaveLength(2);
    expect(screen.queryByText('0.5%')).toBeNull();
  });
});

describe('a stats panel tells loading, failure and emptiness apart', () => {
  test('statsStatus: pending first, then error, then empty, then ready', () => {
    expect(statsStatus({ isPending: true, isError: false }, 0)).toBe('pending');
    expect(statsStatus({ isPending: false, isError: true }, 0)).toBe('error');
    expect(statsStatus({ isPending: false, isError: false }, 0)).toBe('empty');
    expect(statsStatus({ isPending: false, isError: false }, 3)).toBe('ready');
  });

  test('loading is announced as status, a failure as an alert carrying its message', () => {
    const { rerender } = render(<StatsNotice status="pending" empty="Nothing here" />);
    expect(screen.getByRole('status').textContent).toBe('Loading…');
    expect(screen.queryByText('Nothing here')).toBeNull();

    rerender(<StatsNotice status="error" error={new Error('db down')} empty="Nothing here" />);
    expect(screen.getByRole('alert').textContent).toBe('Could not load metrics: db down');

    rerender(<StatsNotice status="empty" empty="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('a non-Error failure is still printed', () => {
    expect(errorMessage('boom')).toBe('boom');
    expect(errorMessage(new Error('x'))).toBe('x');
  });
});

describe('postgresStats reads production data at its real pace', () => {
  const config = defineConfig({
    workflows: [],
    runtime: { development: { timeScale: 600 } },
  });

  test('the environment defaults to production, whose time scale is 1', () => {
    expect(statsTimeScale(config)).toBe(1);
    expect(statsTimeScale(config, 'production')).toBe(1);
  });

  test('a fast-forwarded environment is read at its own scale when named', () => {
    expect(statsTimeScale(config, 'development')).toBe(600);
  });
});
