import { describe, expect, it } from 'vitest';
import {
  CHANNELS,
  CLICK_ID_CHANNELS,
  REFERRERS_NOT_A_TOUCH,
  REFERRER_SITES,
  REPORTED_TOUCH_KINDS,
  REPORTED_TOUCH_PRIORITY,
  SOURCE_ALIASES,
  TOUCH_PRIORITY,
} from './vocabulary';

/** The patterns are written for Postgres; POSIX ERE and JavaScript agree on everything used here. */
const matches = (pattern: string, host: string) => new RegExp(pattern).test(host);

describe('referrer sites', () => {
  it.each([
    ['www.google.com', 'google', 'organic'],
    ['www.google.co.uk', 'google', 'organic'],
    ['www.google.com.hk', 'google', 'organic'],
    ['www.bing.com', 'microsoft', 'organic'],
    ['search.brave.com', 'brave', 'organic'],
    ['l.facebook.com', 'meta', 'social'],
    ['www.instagram.com', 'meta', 'social'],
    ['t.co', 'x', 'social'],
    ['lnkd.in', 'linkedin', 'social'],
    ['youtu.be', 'youtube', 'video'],
  ])('%s → %s / %s', (host, channel, medium) => {
    const hit = REFERRER_SITES.find(([, , pattern]) => matches(pattern, host));
    expect(hit?.[0]).toBe(channel);
    expect(hit?.[1]).toBe(medium);
  });

  it('does not take a look-alike host for the site', () => {
    for (const host of ['notgoogle.com', 'google.com.evil.io', 'xtwitter.com', 'brave.com']) {
      expect(REFERRER_SITES.some(([, , pattern]) => matches(pattern, host))).toBe(false);
    }
  });

  it('names only known channels', () => {
    for (const [channel] of REFERRER_SITES) expect(CHANNELS).toContain(channel);
  });
});

describe('referrers that are not a touch', () => {
  it.each(['checkout.stripe.com', 'accounts.google.com', 'appleid.apple.com', 'localhost:3000'])(
    '%s',
    (host) => {
      expect(REFERRERS_NOT_A_TOUCH.some((pattern) => matches(pattern, host))).toBe(true);
    }
  );

  it('leaves real referrers alone', () => {
    for (const host of ['www.google.com', 'news.ycombinator.com', 'mail.google.com']) {
      expect(REFERRERS_NOT_A_TOUCH.some((pattern) => matches(pattern, host))).toBe(false);
    }
  });
});

describe('aliases and click ids', () => {
  it('fold onto known channels', () => {
    for (const channel of Object.values(SOURCE_ALIASES)) expect(CHANNELS).toContain(channel);
    for (const [, channel] of CLICK_ID_CHANNELS) expect(CHANNELS).toContain(channel);
  });

  it('list each click id once', () => {
    const keys = CLICK_ID_CHANNELS.map(([key]) => key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('priorities', () => {
  it('rank a claim below a referrer and a staff fact with a campaign touch', () => {
    expect(TOUCH_PRIORITY.claimed).toBeGreaterThan(TOUCH_PRIORITY.referrer);
    expect(TOUCH_PRIORITY.referrer).toBeGreaterThan(TOUCH_PRIORITY.campaign);
    expect(TOUCH_PRIORITY.verified).toBe(TOUCH_PRIORITY.campaign);
    for (const kind of REPORTED_TOUCH_KINDS) expect(REPORTED_TOUCH_PRIORITY[kind]).toBeDefined();
  });
});

describe('channels', () => {
  it('name a referral programme', () => {
    expect(CHANNELS).toContain('referral_program');
  });
});
