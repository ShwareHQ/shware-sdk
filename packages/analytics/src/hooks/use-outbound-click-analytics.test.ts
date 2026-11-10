// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://app.www.example.co.uk/page" }
import { describe, expect, it } from 'vitest';
import { registrableDomain } from './use-outbound-click-analytics';

/**
 * The real probe against jsdom's cookie jar, which refuses public suffixes (`uk`, `co.uk`) the
 * way browsers do.
 */
describe('registrableDomain with the cookie probe', () => {
  it('finds the registrable domain of the page and leaves no cookie behind', () => {
    expect(registrableDomain(window.location.hostname)).toBe('example.co.uk');
    expect(document.cookie).toBe('');
  });

  it("is not fooled by a cookie of the probe's name the site already holds", () => {
    document.cookie = '_sa_d=1; path=/';
    expect(registrableDomain(window.location.hostname)).toBe('example.co.uk');
    expect(document.cookie).toBe('_sa_d=1');
    document.cookie = '_sa_d=; path=/; max-age=0';
  });
});
