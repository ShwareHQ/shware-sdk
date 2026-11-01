// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://shop.example/pricing"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  googleAnalytics,
  linkedInAds,
  metaAds,
  microsoftAds,
  openaiAds,
  redditAds,
  uetCustomerIdOf,
} from './index';
import { CONVERSION_EVENTS, type Integration } from './integration';

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  delete window.fbq;
  delete window.rdt;
  delete window.gtag;
  delete window.lintrk;
  delete window.uetq;
  delete window.oaiq;
  vi.restoreAllMocks();
});

const purchase = { value: 9, currency: 'USD', transaction_id: 'cs_1', items: [] };

describe('googleAnalytics', () => {
  it('is analytics, receives every event, custom ones included', () => {
    const { value: gtag } = vi.mockObject<{ value: NonNullable<Window['gtag']> }>({ value() {} });
    window.gtag = gtag;
    const ga = googleAnalytics({ id: 'G-ABC' });

    ga.track('onboarding_step', { step: 2 });
    expect(ga.type).toBe('analytics');
    expect(gtag).toHaveBeenCalledWith('event', 'onboarding_step', { step: 2 });
    expect(ga.script?.id).toBe('gtag');
    expect(ga.script?.inline).toContain('gtag(\'config\', "G-ABC")');
    expect(ga.script?.inline).toContain('https://www.googletagmanager.com/gtag/js?id=G-ABC');
  });
});

describe('metaAds', () => {
  it('sends the events it maps to a Meta standard event', () => {
    const { value: fbq } = vi.mockObject<{ value: NonNullable<Window['fbq']> }>({ value() {} });
    window.fbq = fbq;
    metaAds({ pixelId: '123' }).track('purchase', purchase, 'e1');
    expect(fbq).toHaveBeenCalledWith('track', 'Purchase', expect.anything(), { eventID: 'e1' });
  });

  it('drops the rest of the product unless it is listed in customEvents', () => {
    const { value: fbq } = vi.mockObject<{ value: NonNullable<Window['fbq']> }>({ value() {} });
    window.fbq = fbq;
    metaAds({ pixelId: '123' }).track('onboarding_step', { step: 2 });
    expect(fbq).not.toHaveBeenCalled();

    metaAds({ pixelId: '123', customEvents: ['onboarding_step'] }).track('onboarding_step', {
      step: 2,
    });
    expect(fbq).toHaveBeenCalledWith(
      'trackCustom',
      'onboarding_step',
      { step: 2 },
      {
        eventID: undefined,
      }
    );
  });

  it('identifies the user on its own pixel, and names its script', () => {
    const { value: fbq } = vi.mockObject<{ value: NonNullable<Window['fbq']> }>({ value() {} });
    window.fbq = fbq;
    const meta = metaAds({ pixelId: '123' });
    meta.setUser?.({ user_id: 'u1', user_data: { email: 'a@b.co' } });
    expect(fbq).toHaveBeenCalledWith('init', '123', expect.objectContaining({ em: 'a@b.co' }));
    expect(meta.script?.id).toBe('meta-pixel');
    expect(meta.script?.inline).toContain(`fbq('init', "123")`);
  });
});

describe('redditAds and openaiAds', () => {
  it('send standard events and drop unlisted custom ones', () => {
    const { value: rdt } = vi.mockObject<{ value: NonNullable<Window['rdt']> }>({ value() {} });
    window.rdt = rdt;
    const reddit = redditAds({ pixelId: 'a2_x' });
    reddit.track('sign_up', { method: 'email' });
    reddit.track('onboarding_step', { step: 2 });
    expect(rdt).toHaveBeenCalledTimes(1);
    expect(rdt).toHaveBeenCalledWith('track', 'SignUp', expect.anything());

    const { value: oaiq } = vi.mockObject<{ value: NonNullable<Window['oaiq']> }>({ value() {} });
    window.oaiq = oaiq;
    const openai = openaiAds({ pixelId: 'px_1' });
    openai.track('onboarding_step', { step: 2 });
    expect(oaiq).not.toHaveBeenCalled();
  });
});

describe('linkedInAds', () => {
  it('sends only the events it has a conversion id for', () => {
    const { value: lintrk } = vi.mockObject<{ value: NonNullable<Window['lintrk']> }>({
      value() {},
    });
    window.lintrk = lintrk;
    const linkedin = linkedInAds({ partnerId: '42', conversions: { sign_up: 7 } });
    linkedin.track('sign_up', { method: 'email' }, 'e1');
    linkedin.track('purchase', purchase, 'e2');
    expect(lintrk).toHaveBeenCalledTimes(1);
    expect(lintrk).toHaveBeenCalledWith('track', { conversion_id: 7, event_id: 'e1' });
    expect(linkedin.script?.inline).toContain('_linkedin_partner_id = "42"');
  });
});

describe('microsoftAds', () => {
  it('sends the conversion events by default, an explicit list when given', () => {
    const push = vi.fn<(...args: unknown[]) => void>();
    window.uetq = { push };
    const uet = microsoftAds({ tagId: '9' });
    uet.track('begin_checkout', { value: 9, currency: 'USD', items: [] });
    uet.track('onboarding_step', { step: 2 });
    expect(push).toHaveBeenCalledTimes(1);
    expect(CONVERSION_EVENTS).toContain('begin_checkout');

    push.mockClear();
    microsoftAds({ tagId: '9', events: ['sign_up'] }).track('begin_checkout', {
      value: 9,
      currency: 'USD',
      items: [],
    });
    expect(push).not.toHaveBeenCalled();
  });
});

describe('scripts', () => {
  it('serve gtag.js from another path and turn on DebugView when asked', () => {
    const ga = googleAnalytics({ id: 'G-ABC', src: '/gtag.js', debug: true });
    expect(ga.script?.inline).toContain('"/gtag.js"');
    expect(ga.script?.inline).toContain('debug_mode: true');
  });

  it('push the UET consent default, granted unless given, none for false', () => {
    expect(microsoftAds({ tagId: '9' }).script?.inline).toContain(
      'w[u].push("consent", "default", {"ad_storage":"granted"})'
    );
    expect(
      microsoftAds({ tagId: '9', consent: { ad_storage: 'denied' } }).script?.inline
    ).toContain('{"ad_storage":"denied"}');
    expect(microsoftAds({ tagId: '9', consent: false }).script?.inline).not.toContain('consent');
  });

  it('name the UET customer id for ID Sync', () => {
    const integrations: Integration[] = [
      googleAnalytics({ id: 'G-ABC' }),
      microsoftAds({ tagId: '9', customerId: '77' }),
    ];
    expect(uetCustomerIdOf(integrations)).toBe('77');
    expect(uetCustomerIdOf([googleAnalytics({ id: 'G-ABC' })])).toBeUndefined();
  });
});
