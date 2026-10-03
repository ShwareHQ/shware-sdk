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

// A minute ago: the senders leave out events older than their API accepts.
const CREATED_AT = new Date(Date.now() - 60_000).toISOString();

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

  it('sends the app install and app open from an app only, as OpenAI takes them', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await sendOpenAIEvents('key', 'pixel-1', [
      // first_open is left out of what GA collects itself, not of what OpenAI takes.
      event({ id: 'install', name: 'first_open', platform: 'ios', properties: {} }),
      event({ id: 'open', name: 'app_open', platform: 'android', properties: {} }),
      event({ id: 'web-open', name: 'app_open', platform: 'web', properties: {} }),
    ]);

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.events).toMatchObject([
      {
        id: 'install',
        type: 'app_installed',
        action_source: 'mobile_app',
        data: { type: 'customer_action' },
      },
      { id: 'open', type: 'app_opened', action_source: 'mobile_app' },
    ]);
    expect(body.events).toHaveLength(2);
  });

  it('marks a validation run and hashes the user identity', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await sendOpenAIEvents('key', 'pixel-1', [event()], { email: ' Ada@Example.COM ' }, true);

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.validate_only).toBe(true);
    expect(body.events[0].user.emails_sha256).toEqual([expect.stringMatching(/^[0-9a-f]{64}$/)]);
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
    // `user_id` so the event carries an identifier and survives to the request; an element
    // LinkedIn could not match on is dropped before the fetch and there would be nothing to log.
    await expect(
      sendLinkedinEvents('token', { purchase: 1 }, [event()], { user_id: 'u1' })
    ).resolves.toBeUndefined();
    expect(String(errorSpy.mock.calls[0][0])).toContain('status: 422');
  });

  it('absorbs a network failure after the retry wrapper gives up', async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValue(new Error('offline'));

    const pending = sendLinkedinEvents('token', { purchase: 1 }, [event()], { user_id: 'u1' });
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(pending).resolves.toBeUndefined();
    expect(String(errorSpy.mock.calls[0][0])).toContain('network error');
    vi.useRealTimers();
  });
});

describe('events outside the API time window', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

  it('Meta, Reddit and OpenAI leave out what is over 7 days old, and send the rest', async () => {
    fetchMock.mockImplementation(async () => new Response('{}', { status: 200 }));
    const execute = vi.spyOn(EventRequest.prototype, 'execute').mockResolvedValue({} as never);
    const events = [event({ id: 'fresh' }), event({ id: 'stale', created_at: ago(7 * DAY) })];

    await sendMetaEvents('token', 'pixel', events);
    expect(execute).toHaveBeenCalledTimes(1);
    const sent = (execute.mock.contexts[0] as EventRequest).events.map((e) => e.event_id);
    expect(sent).toEqual(['fresh']);

    await sendRedditEvents('token', 'pixel', events);
    await sendOpenAIEvents('key', 'pixel', events);
    const bodies = fetchMock.mock.calls.map(([, init]) =>
      JSON.parse((init as RequestInit).body as string)
    );
    expect(
      bodies[0].data.events.map(
        (e: { metadata: { conversion_id: string } }) => e.metadata.conversion_id
      )
    ).toEqual(['fresh']);
    expect(bodies[1].events.map((e: { id: string }) => e.id)).toEqual(['fresh']);
  });

  it('OpenAI also leaves out what is over 10 minutes ahead', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    const ahead = new Date(Date.now() + 11 * 60 * 1000).toISOString();
    await sendOpenAIEvents('key', 'pixel', [event({ created_at: ahead })]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('LinkedIn keeps 90 days', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 201 }));
    const events = [
      event({ id: 'month', created_at: ago(30 * DAY) }),
      event({ id: 'quarter', created_at: ago(91 * DAY) }),
    ];
    await sendLinkedinEvents('token', { purchase: 1 }, events, { user_id: 'u1' });
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.elements.map((e: { eventId: string }) => e.eventId)).toEqual(['month']);
  });
});

describe('Meta client_user_agent', () => {
  it('warns when website events go without a user agent, which Meta requires of them', async () => {
    vi.spyOn(EventRequest.prototype, 'execute').mockResolvedValue({} as never);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await sendMetaEvents('token', 'pixel', [event()], {});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('client_user_agent'));

    warn.mockClear();
    await sendMetaEvents('token', 'pixel', [event()], { user_agent: 'Mozilla/5.0' });
    expect(warn).not.toHaveBeenCalled();
  });
});
