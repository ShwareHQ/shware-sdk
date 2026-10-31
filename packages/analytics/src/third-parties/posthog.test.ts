// @vitest-environment jsdom
import type { posthog as PostHog } from 'posthog-js';
// @vitest-environment-options {"url": "https://shop.example/checkout"}
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendPosthogEvent, setPosthogUser } from './posthog';

const { capture, reset, identify } = vi.hoisted(() => ({
  capture: vi.fn<typeof PostHog.capture>(),
  reset: vi.fn<typeof PostHog.reset>(),
  identify: vi.fn<typeof PostHog.identify>(),
}));
vi.mock<{ posthog: Pick<typeof PostHog, 'capture' | 'reset' | 'identify'> }>(
  import('posthog-js'),
  () => ({ posthog: { capture, reset, identify } })
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sendPosthogEvent', () => {
  it('captures the event with its properties', () => {
    sendPosthogEvent('sign_up', { method: 'email' });
    expect(capture).toHaveBeenCalledWith('sign_up', { method: 'email' });
    expect(reset).not.toHaveBeenCalled();
  });

  it('captures a logout like any other event, without resetting the identity', () => {
    sendPosthogEvent('logout', undefined);
    expect(capture).toHaveBeenCalledWith('logout', undefined);
    expect(reset).not.toHaveBeenCalled();
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
  it('identifies as the user, with the email to match on', () => {
    setPosthogUser({ user_id: 'u1', user_data: { email: 'a@b.co' } });
    expect(identify).toHaveBeenCalledWith('u1', { email: 'a@b.co' });

    setPosthogUser({ user_id: 'u1' });
    expect(identify).toHaveBeenLastCalledWith('u1', { email: undefined });
  });

  it('resets the posthog identity on sign-out: reset() hands no user', () => {
    identify.mockClear();
    setPosthogUser({});
    expect(reset).toHaveBeenCalledTimes(1);
    expect(identify).not.toHaveBeenCalled();

    setPosthogUser({ user_id: 'u1' });
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
