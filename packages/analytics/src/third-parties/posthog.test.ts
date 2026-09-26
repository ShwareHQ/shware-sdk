// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://shop.example/checkout"}
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendPosthogEvent, setPosthogUser } from './posthog';

const { capture, reset, identify } = vi.hoisted(() => ({
  capture: vi.fn(),
  reset: vi.fn(),
  identify: vi.fn(),
}));
vi.mock('posthog-js', () => ({ posthog: { capture, reset, identify } }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sendPosthogEvent', () => {
  it('captures the event with its properties', () => {
    sendPosthogEvent('sign_up', { method: 'email' });
    expect(capture).toHaveBeenCalledWith('sign_up', { method: 'email' });
    expect(reset).not.toHaveBeenCalled();
  });

  it('resets the posthog identity after a logout event', () => {
    sendPosthogEvent('logout', undefined);
    expect(capture).toHaveBeenCalledWith('logout', undefined);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('drops web vitals', () => {
    sendPosthogEvent('LCP', { value: 1200 });
    expect(capture).not.toHaveBeenCalled();
  });

  it('stays silent during local development', () => {
    const original = window.location.href;
    Object.defineProperty(window, 'location', {
      value: new URL('http://localhost:3000/'),
      configurable: true,
    });

    sendPosthogEvent('sign_up', { method: 'email' });
    expect(capture).not.toHaveBeenCalled();

    Object.defineProperty(window, 'location', { value: new URL(original), configurable: true });
  });
});

describe('setPosthogUser', () => {
  it("identifies as the server's distinct_id once a user is known, falling back to user_id", () => {
    setPosthogUser({ distinct_id: 'd1', user_id: 'u1', user_data: { email: 'a@b.co' }, tags: {} });
    expect(identify).toHaveBeenCalledWith('d1', { email: 'a@b.co' });

    // A server from before distinct_id answers null.
    setPosthogUser({ distinct_id: null, user_id: 'u1', tags: {} });
    expect(identify).toHaveBeenLastCalledWith('u1', { email: undefined });
  });

  it('does not identify an anonymous visitor, even though it has a distinct_id', () => {
    identify.mockClear();
    setPosthogUser({ distinct_id: 'v1', tags: {} });
    expect(identify).not.toHaveBeenCalled();
  });
});
