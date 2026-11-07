import { afterEach, describe, expect, it, vi } from 'vitest';

/** Safari before 16.4: compiling a pattern with lookbehind throws. */
class RegExpWithoutLookbehind extends RegExp {
  constructor(pattern: string | RegExp, flags?: string) {
    const source = typeof pattern === 'string' ? pattern : pattern.source;
    if (/\(\?<[=!]/.test(source)) {
      throw new SyntaxError('Invalid regular expression: invalid group specifier name');
    }
    super(pattern, flags);
  }
}

// Each test imports a fresh copy of the module, so the compiled pattern is not shared between them.
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('genericBot in engines without lookbehind (Safari < 16.4)', () => {
  it('imports the bot module without throwing', async () => {
    vi.stubGlobal('RegExp', RegExpWithoutLookbehind);
    await expect(import('./index')).resolves.toBeDefined();
  });

  it('still applies the patterns without lookbehind', async () => {
    vi.stubGlobal('RegExp', RegExpWithoutLookbehind);
    const { genericBot } = await import('./generic');
    expect(genericBot().test('Mozilla/5.0 (compatible; Wappalyzer)')).toBe(true);
    expect(genericBot().test('Mozilla/5.0 (Macintosh) Safari/605.1.15')).toBe(false);
  });
});

describe('genericBot where lookbehind is supported', () => {
  it('uses every pattern', async () => {
    const { genericBot } = await import('./generic');
    expect(genericBot().test('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true);
    expect(genericBot().source).toContain('(?<!');
  });
});
