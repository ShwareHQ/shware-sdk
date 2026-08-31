// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://shop.example/landing"}
/**
 * Attribution as a business journey, not as units: an ad click lands, the server persists the
 * click id, the page reports a conversion, and the same identity reaches the browser pixel and
 * the Conversions API with a shared dedupe id. Only the network is mocked — the cookie really
 * travels document.cookie → getTags → the wire → the server event.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const T0 = new Date('2026-01-01T10:00:00Z');
const fetchMock = vi.fn();

function eventsBody(): Record<string, unknown>[] {
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/events'));
  if (!call) throw new Error('no events request went out');
  return JSON.parse((call[1] as RequestInit).body as string);
}

async function launch() {
  const { baseOptions, memoryStorage } = await import('../test/setup');
  const storage = memoryStorage();
  const setup = await import('../setup/index');
  const web = await import('../web/index');
  // The real browser getTags: page, cookies, click ids — not the stub the lifecycle suite uses.
  setup.setupAnalytics(
    baseOptions({ storage, getTags: web.getTags, getDeviceId: web.getDeviceId })
  );
  const { track } = await import('../track/index');
  return { track, config: setup.config, storage };
}

function clearCookies() {
  for (const name of ['_fbc', '_fbp', '_rdt_cid', 'li_fat_id']) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  }
}

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.stubGlobal('fetch', fetchMock);
  window.localStorage.clear();
  clearCookies();

  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/events')) {
      const body = JSON.parse(init?.body as string) as unknown[];
      return new Response(JSON.stringify(body.map((_, i) => ({ id: `event-${i}` }))), {
        status: 200,
      });
    }
    if (url.includes('/links/')) {
      return new Response(
        JSON.stringify({ id: 'abc', utm_source: 'newsletter', utm_medium: 'partner-email' }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({ id: 'visitor-1' }), { status: 200 });
  });
});

afterEach(() => {
  window.history.replaceState(null, '', '/landing');
  clearCookies();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('a Meta ad click, from landing to the Conversions API', () => {
  it('carries one _fbc and one dedupe id through cookie, wire, pixel and server', async () => {
    // Given: the visitor lands from an ad, and the document response persists the click id —
    // what clickIdMiddleware does in production, run against the real jsdom cookie jar.
    window.history.replaceState(null, '', '/landing?fbclid=CLK99');
    const { resolveClickIdCookies } = await import('../click-id/index');
    const resolved = resolveClickIdCookies({
      url: window.location.href,
      cookieHeader: document.cookie || null,
    });
    // A Set-Cookie header lands in the jar as name=value; the attributes don't matter here.
    for (const cookie of resolved.cookies) document.cookie = `${cookie.name}=${cookie.value}`;
    expect(resolved.fbc).toBe(`fb.1.${T0.getTime()}.CLK99`);

    // And: the Meta Pixel script has loaded on the page.
    const fbq = vi.fn();
    (window as unknown as { fbq: typeof fbq }).fbq = fbq;

    const { track, config } = await launch();
    const { sendFBEvent } = await import('../third-parties/meta-pixel');
    config.thirdPartyTrackers = [sendFBEvent];

    // When: the visitor purchases.
    track('purchase', { value: 49.99, currency: 'usd', transaction_id: 't1', items: [] });
    await vi.advanceTimersByTimeAsync(2000);

    // Then: the event reaches the backend with the click identity captured on landing.
    const purchase = eventsBody().find((e) => e.name === 'purchase');
    if (!purchase) throw new Error('purchase never reached the wire');
    const tags = purchase.tags as Record<string, unknown>;
    expect(tags.fbc).toBe(resolved.fbc);
    expect(tags.fbclid).toBe('CLK99');
    expect(tags.page_location).toContain('/landing?fbclid=CLK99');

    // And: the pixel fired the mapped event under the server-issued dedupe id.
    const pixelCall = fbq.mock.calls.find(([, name]) => name === 'Purchase');
    if (!pixelCall) throw new Error('the pixel never saw the purchase');
    const pixelEventId = (pixelCall[3] as { eventID: string }).eventID;
    expect(pixelEventId).toMatch(/^event-\d$/);

    // And: the backend forwarding that same stored event to the Conversions API produces a
    // server event that deduplicates against the pixel and carries the same _fbc.
    const { getServerEvent } = await import('../server/meta-conversions-api');
    const serverEvent = getServerEvent(
      {
        id: pixelEventId,
        name: purchase.name,
        properties: purchase.properties,
        tags: purchase.tags,
        visitor_id: purchase.visitor_id,
        session_id: purchase.session_id,
        platform: purchase.platform,
        environment: purchase.environment,
        created_at: purchase.timestamp,
      } as never,
      {}
    );
    expect(serverEvent.event_id).toBe(pixelEventId);
    expect(serverEvent.user_data.fbc).toBe(resolved.fbc);
    expect(serverEvent.event_source_url).toContain('/landing?fbclid=CLK99');
    expect(serverEvent.action_source).toBe('website');
    expect(serverEvent.custom_data.value).toBe(49.99);
  });
});

describe('a marketing short link, from landing to the conversion event', () => {
  it('stamps every event with the utm campaign stored behind ?s=', async () => {
    // Given: the visitor arrives through a short link whose utm params live on the backend, and
    // the URL also carries a utm_source of its own.
    window.history.replaceState(null, '', '/landing?s=abc&utm_source=url-fallback');
    const { track } = await launch();

    // When: they sign up during that visit.
    track('sign_up', { method: 'email' });
    await vi.advanceTimersByTimeAsync(2000);

    // Then: the event reports the campaign the link defines — the stored link outranks the URL.
    const signUp = eventsBody().find((e) => e.name === 'sign_up');
    if (!signUp) throw new Error('sign_up never reached the wire');
    expect(signUp.tags).toMatchObject({
      utm_source: 'newsletter',
      utm_medium: 'partner-email',
    });
  });
});
