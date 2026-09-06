import { describe, expect, it } from 'vitest';
import {
  FBC_COOKIE,
  GCL_AW_COOKIE,
  GCL_GB_COOKIE,
  RDT_CID_COOKIE,
  parseFbc,
  parseGcl,
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
    const { cookie, fbc } = fbcCookie('https://shware.io/?fbclid=ABC123');
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
      'https://shware.io/?fbclid=ABC123',
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
      'https://shware.io/?fbclid=XYZ',
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
    const { cookie, fbc } = fbcCookie('https://shware.io/', `_fbc=${existing}`, later);
    expect(cookie?.value).toBe(existing);
    expect(cookie?.maxAge).toBe(((90 - 10) * DAY_MS) / 1000);
    expect(fbc).toBe(existing);
  });

  it('leaves a valid same-fbclid cookie untouched with refresh: false (strict Meta conditional-write), but exposes fbc', () => {
    const existing = `fb.1.${NOW}.ABC123`;
    const later = NOW + 10 * DAY_MS;
    const { cookie, fbc } = fbcCookie('https://shware.io/', `_fbc=${existing}`, later, {
      refresh: false,
    });
    expect(cookie).toBeUndefined();
    expect(fbc).toBe(existing);
  });

  it('preserves a foreign subdomainIndex when refreshing (e.g. Pixel-set fb.2.*)', () => {
    const existing = `fb.2.${NOW}.PIXEL`;
    const { cookie } = fbcCookie('https://shware.io/', `_fbc=${existing}`, NOW + DAY_MS);
    expect(cookie?.value).toBe(existing);
  });

  it('deletes an expired (>90d) cookie instead of forwarding it', () => {
    const old = NOW - 100 * DAY_MS;
    const { cookie, fbc } = fbcCookie('https://shware.io/', `_fbc=fb.1.${old}.OLD`);
    expect(cookie).toMatchObject({ value: '', maxAge: 0 });
    expect(fbc).toBeUndefined();
  });

  it('deletes a malformed leftover cookie', () => {
    const { cookie, fbc } = fbcCookie('https://shware.io/', '_fbc=broken');
    expect(cookie).toMatchObject({ value: '', maxAge: 0 });
    expect(fbc).toBeUndefined();
  });

  it('rebuilds when a fresh fbclid accompanies a malformed cookie', () => {
    const { cookie } = fbcCookie('https://shware.io/?fbclid=NEW', '_fbc=broken');
    expect(cookie?.value).toBe(`fb.1.${NOW}.NEW`);
  });

  it('is a no-op with no fbclid and no cookie', () => {
    const { cookies } = resolveClickIdCookies({ url: 'https://shware.io/', now: NOW });
    expect(cookies).toEqual([]);
  });

  it('applies domain and secure options and serializes correctly', () => {
    const { cookies } = resolveClickIdCookies({
      url: 'https://shware.io/?fbclid=ABC',
      now: NOW,
      domain: '.shware.io',
      secure: true,
    });
    const header = toSetCookieHeaders(cookies)[0];
    expect(header).toContain('_fbc=fb.1.');
    expect(header).toContain('Domain=.shware.io');
    expect(header).toContain('Max-Age=7776000');
    expect(header).toContain('Path=/');
    expect(header).toContain('Secure');
    expect(header).toContain('SameSite=Lax');
  });

  it('does not emit Domain=undefined when domain is omitted', () => {
    const { cookies } = fbcCookie('https://shware.io/?fbclid=ABC');
    expect(toSetCookieHeaders(cookies)[0]).not.toContain('Domain');
  });
});

describe('resolveClickIdCookies — _rdt_cid', () => {
  it('sets rdt_cid from the URL on first capture', () => {
    const { cookies, rdt_cid } = resolveClickIdCookies({
      url: 'https://shware.io/?rdt_cid=RDT1',
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
      url: 'https://shware.io/',
      cookieHeader: '_rdt_cid=RDT1',
      now: NOW,
    });
    expect(cookies.find((c) => c.name === RDT_CID_COOKIE)).toBeUndefined();
    expect(rdt_cid).toBe('RDT1');
  });

  it('replaces the cookie when a different rdt_cid arrives in the URL', () => {
    const { cookies, rdt_cid } = resolveClickIdCookies({
      url: 'https://shware.io/?rdt_cid=RDT2',
      cookieHeader: '_rdt_cid=RDT1',
      now: NOW,
    });
    expect(cookies.find((c) => c.name === RDT_CID_COOKIE)?.value).toBe('RDT2');
    expect(rdt_cid).toBe('RDT2');
  });
});

describe('resolveClickIdCookies — URL parsing', () => {
  it('still reads the query from a relative URL (framework middlewares pass pathname+search)', () => {
    const { fbc } = resolveClickIdCookies({ url: '/landing?fbclid=REL1', now: NOW });
    expect(fbc).toBe(`fb.1.${NOW}.REL1`);
  });

  it('a relative URL without a query resolves nothing and emits nothing', () => {
    const { cookies } = resolveClickIdCookies({ url: '/landing', now: NOW });
    expect(cookies).toEqual([]);
  });
});

const SEC = Math.floor(NOW / 1000);

describe('parseGcl', () => {
  it('parses a well-formed value (seconds precision)', () => {
    expect(parseGcl(`GCL.${SEC}.Cj0KCQiA-abc_123`, NOW)).toEqual({
      raw: `GCL.${SEC}.Cj0KCQiA-abc_123`,
      creationTime: SEC * 1000,
      clickId: 'Cj0KCQiA-abc_123',
    });
  });

  it("accepts gtag's alternate version segment '1' and keeps a labels tail in raw", () => {
    const raw = `1.${SEC}.ABC.label1.label2`;
    expect(parseGcl(raw, NOW)).toMatchObject({ raw, clickId: 'ABC' });
  });

  it.each([
    ['empty', ''],
    ['garbage', 'not-a-gcl'],
    ['wrong version', `fb.${SEC}.ABC`],
    ['millisecond-precision timestamp', `GCL.${NOW}.ABC`],
    ['non-numeric timestamp', 'GCL.nope.ABC'],
    ['future timestamp', `GCL.${SEC + 2 * (DAY_MS / 1000)}.ABC`],
    ['click id with invalid chars', `GCL.${SEC}.ABC$DEF`],
    ['missing click id', `GCL.${SEC}.`],
  ])('rejects %s', (_label, value) => {
    expect(parseGcl(value, NOW)).toBeUndefined();
  });
});

describe('resolveClickIdCookies — _gcl_aw / _gcl_gb', () => {
  function gclCookies(url: string, cookieHeader = '', now = NOW, extra = {}) {
    const result = resolveClickIdCookies({ url, cookieHeader, now, ...extra });
    return {
      aw: result.cookies.find((c) => c.name === GCL_AW_COOKIE),
      gb: result.cookies.find((c) => c.name === GCL_GB_COOKIE),
      result,
    };
  }

  it("builds a fresh _gcl_aw from a gclid in gtag's exact format with a 90-day window", () => {
    const { aw, result } = gclCookies('https://shware.io/?gclid=Cj0KCQiA-abc');
    expect(aw).toMatchObject({
      name: '_gcl_aw',
      value: `GCL.${SEC}.Cj0KCQiA-abc`,
      maxAge: (90 * DAY_MS) / 1000,
    });
    expect(result.gclid).toBe('Cj0KCQiA-abc');
  });

  it('routes wbraid into _gcl_gb', () => {
    const { gb, result } = gclCookies('https://shware.io/?wbraid=1kA9Xyz');
    expect(gb).toMatchObject({ name: '_gcl_gb', value: `GCL.${SEC}.1kA9Xyz` });
    expect(result.wbraid).toBe('1kA9Xyz');
  });

  it("applies gtag's gclsrc gate: aw.ds passes, ds and 3p.ds do not", () => {
    expect(gclCookies('https://shware.io/?gclid=A&gclsrc=aw.ds').aw).toBeDefined();
    expect(gclCookies('https://shware.io/?gclid=A&gclsrc=ds').aw).toBeUndefined();
    expect(gclCookies('https://shware.io/?gclid=A&gclsrc=3p.ds').aw).toBeUndefined();
  });

  it('re-issues a still-valid cookie byte-identically at its remaining lifetime', () => {
    const raw = `GCL.${SEC}.ABC.label1`;
    const later = NOW + 30 * DAY_MS;
    const { aw, result } = gclCookies('https://shware.io/', `_gcl_aw=${raw}`, later);
    expect(aw).toMatchObject({ value: raw, maxAge: (60 * DAY_MS) / 1000 });
    expect(result.gclid).toBe('ABC');
  });

  it('a new gclid in the URL replaces the cookie; the same gclid preserves the original window', () => {
    const raw = `GCL.${SEC}.OLD`;
    const later = NOW + 10 * DAY_MS;
    const replaced = gclCookies('https://shware.io/?gclid=NEW', `_gcl_aw=${raw}`, later);
    expect(replaced.aw?.value).toBe(`GCL.${Math.floor(later / 1000)}.NEW`);

    const same = gclCookies('https://shware.io/?gclid=OLD', `_gcl_aw=${raw}`, later);
    expect(same.aw?.value).toBe(raw); // creationTime preserved, window anchored
    expect(same.aw?.maxAge).toBe((80 * DAY_MS) / 1000);
  });

  it('never rewrites or deletes a value it cannot parse — gtag owns the cookie', () => {
    const { aw, result } = gclCookies('https://shware.io/', '_gcl_aw=SOMETHING.new.format');
    expect(aw).toBeUndefined();
    expect(result.gclid).toBeUndefined();
  });

  it('does not return or delete an expired value', () => {
    const raw = `GCL.${SEC}.ABC`;
    const later = NOW + 91 * DAY_MS;
    const { aw, result } = gclCookies('https://shware.io/', `_gcl_aw=${raw}`, later);
    expect(aw).toBeUndefined();
    expect(result.gclid).toBeUndefined();
  });

  it('ignores a URL click id that fails the charset validator', () => {
    const { aw } = gclCookies('https://shware.io/?gclid=bad$id');
    expect(aw).toBeUndefined();
  });

  it('refresh: false skips the re-issue but still resolves the click id', () => {
    const raw = `GCL.${SEC}.ABC`;
    const { aw, result } = gclCookies('https://shware.io/', `_gcl_aw=${raw}`, NOW + DAY_MS, {
      refresh: false,
    });
    expect(aw).toBeUndefined();
    expect(result.gclid).toBe('ABC');
  });
});
