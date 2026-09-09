import { describe, expect, it } from 'vitest';
import { getPageKey } from './page-key';

describe('getPageKey', () => {
  it('is the path alone without a query', () => {
    expect(getPageKey('/pricing')).toBe('/pricing');
    expect(getPageKey('/pricing', '')).toBe('/pricing');
    expect(getPageKey('/pricing', '?')).toBe('/pricing');
  });

  it('keeps the query: a different query is a different page', () => {
    expect(getPageKey('/search', '?q=shoes')).toBe('/search?q=shoes');
    expect(getPageKey('/search', '?q=shoes')).not.toBe(getPageKey('/search', '?q=hats'));
    expect(getPageKey('/list', '?page=2')).not.toBe(getPageKey('/list', '?page=1'));
  });

  it('strips utm and click-id parameters, so a landing-page URL cleanup is not a new page', () => {
    const decorated = '?utm_source=bing&utm_medium=cpc&msclkid=abc&fbclid=def&gclid=ghi&plan=pro';
    expect(getPageKey('/pricing', decorated)).toBe('/pricing?plan=pro');
    expect(getPageKey('/pricing', '?msclkid=abc')).toBe('/pricing');
  });

  it('ignores parameter order', () => {
    expect(getPageKey('/a', '?x=1&y=2')).toBe(getPageKey('/a', '?y=2&x=1'));
  });
});
