import { describe, expect, test } from 'vitest';
import { type JourneyRuntimeConfig, resolveRuntime } from '../src/runtime';

const config: JourneyRuntimeConfig = {
  development: { timeScale: 3600, logMessages: true },
  production: {},
};

describe('resolveRuntime', () => {
  test('returns the mode entry with defaults filled in', () => {
    expect(resolveRuntime(config, 'development')).toEqual({ timeScale: 3600, logMessages: true });
    expect(resolveRuntime(config, 'production')).toEqual({ timeScale: 1, logMessages: false });
  });

  test('an unknown mode or no config at all runs with the defaults', () => {
    expect(resolveRuntime(config, 'staging')).toEqual({ timeScale: 1, logMessages: false });
    expect(resolveRuntime(undefined, 'development')).toEqual({ timeScale: 1, logMessages: false });
  });

  test('an invalid time scale falls back to real time', () => {
    expect(resolveRuntime({ development: { timeScale: 0 } }, 'development').timeScale).toBe(1);
    expect(resolveRuntime({ development: { timeScale: -5 } }, 'development').timeScale).toBe(1);
    expect(
      resolveRuntime({ development: { timeScale: Number.NaN } }, 'development').timeScale
    ).toBe(1);
  });
});
