import { describe, expect, it, vi } from 'vitest';
import { baseOptions } from '../test/setup';
import { setupAnalytics } from './index';

describe('setupAnalytics deepLink', () => {
  it('starts its listeners once the configuration is in place', () => {
    const listen = vi.fn<() => void>();
    setupAnalytics(baseOptions({ deepLink: { listen, getTags: () => ({}) } }));
    expect(listen).toHaveBeenCalledTimes(1);
  });

  it('logs a listen that throws instead of breaking the setup', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failure = new Error('no linking module');
    const listen = () => {
      throw failure;
    };
    expect(() =>
      setupAnalytics(baseOptions({ deepLink: { listen, getTags: () => ({}) } }))
    ).not.toThrow();
    expect(error).toHaveBeenCalledWith('analytics deepLink.listen failed', failure);
    error.mockRestore();
  });
});
