/**
 * Transport behavior of the server-side conversion senders: what gets filtered before the wire,
 * what the request looks like, and that a vendor failure is logged rather than thrown — a
 * conversions call must never take the host's request handler down with it.
 */
import { EventRequest } from 'facebook-nodejs-business-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackEvent } from '../track/types';
import { sendEvents as sendLinkedinEvents } from './linkedin-conversions-api';
import { sendEvent as sendMetaEvent, sendEvents as sendMetaEvents } from './meta-conversions-api';
import { sendEvents as sendOpenAIEvents } from './openai-conversions-api';
import { sendEvents as sendRedditEvents } from './reddit-conversions-api';

const CREATED_AT = '2026-01-10T12:00:00.000Z';

// oxlint-disable-next-line @typescript-eslint/no-explicit-any
function event(partial: Partial<TrackEvent<any>> = {}): TrackEvent<any> {
  return {
    id: 'event-1',
    name: 'purchase',
    tags: {},
    visitor_id: 'v1',
    session_id: 's1',
    platform: 'web',
    environment: 'production',
    properties: { value: 42, currency: 'usd', items: [] },
    created_at: CREATED_AT,
    ...partial,
  };
}

const fetchMock = vi.fn();
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Meta sendEvents', () => {
  it('filters auto-collected events and skips the request when nothing remains', async () => {
    const execute = vi.spyOn(EventRequest.prototype, 'execute').mockResolvedValue({} as never);

    await expect(
      sendMetaEvents('token', 'pixel', [
        event({ name: 'session_start' }),
        event({ name: 'scroll' }),
      ])
    ).resolves.toBeUndefined();
    expect(execute).not.toHaveBeenCalled();

    await sendMetaEvents('token', 'pixel', [event({ name: 'session_start' }), event()]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('sendEvent ignores a single auto-collected event', async () => {
    const execute = vi.spyOn(EventRequest.prototype, 'execute').mockResolvedValue({} as never);
    await expect(
      sendMetaEvent('token', 'pixel', event({ name: 'page_view' }))
    ).resolves.toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
  });

  it('sendEvent executes a conversion and returns the vendor response', async () => {
    const response = { events_received: 1 };
    const execute = vi
      .spyOn(EventRequest.prototype, 'execute')
      .mockResolvedValue(response as never);
    await expect(sendMetaEvent('token', 'pixel', event())).resolves.toBe(response);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('logs an API rejection without rethrowing and without leaking the token', async () => {
    vi.spyOn(EventRequest.prototype, 'execute').mockRejectedValue({
      status: 400,
      message: 'Invalid parameter',
      response: { error: { message: 'Invalid parameter' } },
    });

    await expect(sendMetaEvents('secret-token', 'pixel', [event()])).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = String(errorSpy.mock.calls[0][0]);
    expect(logged).toContain('status: 400');
    expect(logged).not.toContain('secret-token');
  });

  it('logs a network failure distinctly', async () => {
    vi.spyOn(EventRequest.prototype, 'execute').mockRejectedValue(new Error('socket hang up'));
    await expect(sendMetaEvents('token', 'pixel', [event()])).resolves.toBeUndefined();
    expect(String(errorSpy.mock.calls[0][0])).toContain('network error');
  });
});

describe('Reddit sendEvents', () => {
  it('POSTs the filtered batch to the pixel endpoint with the bearer token', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await sendRedditEvents(
      'token',
      'a2_pixel',
      [event({ name: 'session_start' }), event()],
      { user_id: 'u1' },
      'test-run-1'
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://ads-api.reddit.com/api/v3/pixels/a2_pixel/conversion_events');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token');

    const body = JSON.parse(init.body as string);
    expect(body.data.test_id).toBe('test-run-1');
    expect(body.data.events).toHaveLength(1); // session_start filtered out
    expect(body.data.events[0].type.tracking_type).toBe('PURCHASE');
  });

  it('sends nothing when every event is filtered', async () => {
    await sendRedditEvents('token', 'a2_pixel', [event({ name: 'user_engagement' })]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs a rejected batch without throwing (4xx is not retried)', async () => {
    fetchMock.mockResolvedValueOnce(new Response('bad', { status: 403 }));
    await expect(sendRedditEvents('token', 'a2_pixel', [event()])).resolves.toBeUndefined();
    expect(String(errorSpy.mock.calls[0][0])).toContain('status: 403');
  });

  it('absorbs a network failure after the retry wrapper gives up', async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValue(new Error('offline'));

    const pending = sendRedditEvents('token', 'a2_pixel', [event()]);
    await vi.advanceTimersByTimeAsync(10_000); // ride out the retry backoff
    await expect(pending).resolves.toBeUndefined();
    expect(String(errorSpy.mock.calls[0][0])).toContain('network error');
    vi.useRealTimers();
  });
});

describe('OpenAI sendEvents', () => {
  it('filters both auto-collected and non-ad events before sending', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await sendOpenAIEvents('key', 'pixel-1', [
      event({ name: 'session_start' }), // IGNORED_EVENTS
      event({ id: 'event-2', name: 'view_promotion' }), // NON_AD_EVENTS
      event({ id: 'event-3' }),
    ]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://bzr.openai.com/v1/events?pid=pixel-1');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer key');

    const body = JSON.parse(init.body as string);
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({ id: 'event-3', type: 'order_created' });
  });

  it('marks a validation run and hashes the user identity', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await sendOpenAIEvents('key', 'pixel-1', [event()], { email: ' Ada@Example.COM ' }, true);

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.validate_only).toBe(true);
    expect(body.events[0].user.email_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('omits the user block entirely when no identity field is set', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    await sendOpenAIEvents('key', 'pixel-1', [event()]);
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.events[0].user).toBeUndefined();
  });

  it('sends nothing when every event is filtered, and never throws on failure', async () => {
    await sendOpenAIEvents('key', 'pixel-1', [event({ name: 'CLS' })]);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(new Response('bad', { status: 400 }));
    await expect(sendOpenAIEvents('key', 'pixel-1', [event()])).resolves.toBeUndefined();
    expect(String(errorSpy.mock.calls[0][0])).toContain('status: 400');
  });
});

describe('LinkedIn sendEvents failure paths', () => {
  it('logs a rejected batch without throwing', async () => {
    fetchMock.mockResolvedValueOnce(new Response('bad', { status: 422 }));
    await expect(sendLinkedinEvents('token', { purchase: 1 }, [event()])).resolves.toBeUndefined();
    expect(String(errorSpy.mock.calls[0][0])).toContain('status: 422');
  });

  it('absorbs a network failure after the retry wrapper gives up', async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValue(new Error('offline'));

    const pending = sendLinkedinEvents('token', { purchase: 1 }, [event()]);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(pending).resolves.toBeUndefined();
    expect(String(errorSpy.mock.calls[0][0])).toContain('network error');
    vi.useRealTimers();
  });
});
