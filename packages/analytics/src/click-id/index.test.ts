import { describe, expect, it } from 'vitest';
import {
  FBC_COOKIE,
  RDT_CID_COOKIE,
  parseFbc,
  resolveClickIdCookies,
  toSetCookieHeaders,
} from './index';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-01-01T00:00:00Z').getTime();

function fbcCookie(url: string, cookieHeader = '', now = NOW, extra = {}) {
  const { cookies, fbc } = resolveClickIdCookies({ url, cookieHeader, now, ...extra });
  return { cookie: cookies.find((c) => c.name === FBC_COOKIE), fbc, cookies };
}

describe('parseFbc', () => {
  it('parses a well-formed value', () => {
    expect(parseFbc(`fb.1.${NOW}.ABC123`, NOW)).toEqual({
      raw: `fb.1.${NOW}.ABC123`,
      creationTime: NOW,
      fbclid: 'ABC123',
    });
  });

  it('keeps a fbclid that contains dots', () => {
    expect(parseFbc(`fb.1.${NOW}.A.B.C`, NOW)?.fbclid).toBe('A.B.C');
  });

  it.each([
    ['empty', ''],
    ['garbage', 'not-an-fbc'],
    ['wrong prefix', `xx.1.${NOW}.ABC`],
    ['missing fbclid', `fb.1.${NOW}.`],
    ['seconds-precision creationTime', 'fb.1.1767225600.ABC'],
    ['non-numeric creationTime', 'fb.1.nope.ABC'],
    ['future creationTime', `fb.1.${NOW + 2 * DAY_MS}.ABC`],
  ])('rejects %s', (_label, value) => {
    expect(parseFbc(value, NOW)).toBeUndefined();
  });
});

describe('resolveClickIdCookies — _fbc', () => {
  it('builds a fresh fbc from a new fbclid with a 90-day window', () => {
    const { cookie, fbc } = fbcCookie('https://edensign.io/?fbclid=ABC123');
    expect(cookie).toMatchObject({
      name: '_fbc',
      value: `fb.1.${NOW}.ABC123`,
      maxAge: (90 * DAY_MS) / 1000,
    });
    expect(fbc).toBe(`fb.1.${NOW}.ABC123`);
  });

  it('does not rewrite the value when the same fbclid returns in the URL (preserves creationTime)', () => {
    const existing = `fb.1.${NOW}.ABC123`;
    const later = NOW + 30 * DAY_MS;
    const { cookie, fbc } = fbcCookie(
      'https://edensign.io/?fbclid=ABC123',
      `_fbc=${existing}`,
      later
    );
    // Same fbclid → the value and creationTime survive; the default refresh re-issues it
    // unchanged at its remaining lifetime.
    expect(cookie).toMatchObject({ value: existing, maxAge: ((90 - 30) * DAY_MS) / 1000 });
    expect(fbc).toBe(existing);
  });

  it('opens a new window when a different fbclid arrives', () => {
    const later = NOW + 30 * DAY_MS;
    const { cookie, fbc } = fbcCookie(
      'https://edensign.io/?fbclid=XYZ',
      `_fbc=fb.1.${NOW}.ABC123`,
      later
    );
    expect(cookie?.value).toBe(`fb.1.${later}.XYZ`);
    expect(cookie?.maxAge).toBe((90 * DAY_MS) / 1000);
    expect(fbc).toBe(`fb.1.${later}.XYZ`);
  });

  it('re-issues a valid cookie unchanged at remaining lifetime by default (ITP self-heal)', () => {
    const existing = `fb.1.${NOW}.ABC123`;
    const later = NOW + 10 * DAY_MS;
    const { cookie, fbc } = fbcCookie('https://edensign.io/', `_fbc=${existing}`, later);
    expect(cookie?.value).toBe(existing);
    expect(cookie?.maxAge).toBe(((90 - 10) * DAY_MS) / 1000);
    expect(fbc).toBe(existing);
  });

  it('leaves a valid same-fbclid cookie untouched with refresh: false (strict Meta conditional-write), but exposes fbc', () => {
    const existing = `fb.1.${NOW}.ABC123`;
    const later = NOW + 10 * DAY_MS;
    const { cookie, fbc } = fbcCookie('https://edensign.io/', `_fbc=${existing}`, later, {
      refresh: false,
    });
    expect(cookie).toBeUndefined();
    expect(fbc).toBe(existing);
  });

  it('preserves a foreign subdomainIndex when refreshing (e.g. Pixel-set fb.2.*)', () => {
    const existing = `fb.2.${NOW}.PIXEL`;
    const { cookie } = fbcCookie('https://edensign.io/', `_fbc=${existing}`, NOW + DAY_MS);
    expect(cookie?.value).toBe(existing);
  });

  it('deletes an expired (>90d) cookie instead of forwarding it', () => {
    const old = NOW - 100 * DAY_MS;
    const { cookie, fbc } = fbcCookie('https://edensign.io/', `_fbc=fb.1.${old}.OLD`);
    expect(cookie).toMatchObject({ value: '', maxAge: 0 });
    expect(fbc).toBeUndefined();
  });

  it('deletes a malformed leftover cookie', () => {
    const { cookie, fbc } = fbcCookie('https://edensign.io/', '_fbc=broken');
    expect(cookie).toMatchObject({ value: '', maxAge: 0 });
    expect(fbc).toBeUndefined();
  });

  it('rebuilds when a fresh fbclid accompanies a malformed cookie', () => {
    const { cookie } = fbcCookie('https://edensign.io/?fbclid=NEW', '_fbc=broken');
    expect(cookie?.value).toBe(`fb.1.${NOW}.NEW`);
  });

  it('is a no-op with no fbclid and no cookie', () => {
    const { cookies } = resolveClickIdCookies({ url: 'https://edensign.io/', now: NOW });
    expect(cookies).toEqual([]);
  });

  it('applies domain and secure options and serializes correctly', () => {
    const { cookies } = resolveClickIdCookies({
      url: 'https://edensign.io/?fbclid=ABC',
      now: NOW,
      domain: '.edensign.io',
      secure: true,
    });
    const header = toSetCookieHeaders(cookies)[0];
    expect(header).toContain('_fbc=fb.1.');
    expect(header).toContain('Domain=.edensign.io');
    expect(header).toContain('Max-Age=7776000');
    expect(header).toContain('Path=/');
    expect(header).toContain('Secure');
    expect(header).toContain('SameSite=Lax');
  });

  it('does not emit Domain=undefined when domain is omitted', () => {
    const { cookies } = fbcCookie('https://edensign.io/?fbclid=ABC');
    expect(toSetCookieHeaders(cookies)[0]).not.toContain('Domain');
  });
});

describe('resolveClickIdCookies — _rdt_cid', () => {
  it('sets rdt_cid from the URL on first capture', () => {
    const { cookies, rdt_cid } = resolveClickIdCookies({
      url: 'https://edensign.io/?rdt_cid=RDT1',
      now: NOW,
    });
    expect(cookies.find((c) => c.name === RDT_CID_COOKIE)).toMatchObject({
      value: 'RDT1',
      maxAge: (90 * DAY_MS) / 1000,
    });
    expect(rdt_cid).toBe('RDT1');
  });

  it('does not re-issue an existing rdt_cid (no embedded timestamp to anchor)', () => {
    const { cookies, rdt_cid } = resolveClickIdCookies({
      url: 'https://edensign.io/',
      cookieHeader: '_rdt_cid=RDT1',
      now: NOW,
    });
    expect(cookies.find((c) => c.name === RDT_CID_COOKIE)).toBeUndefined();
    expect(rdt_cid).toBe('RDT1');
  });
});
