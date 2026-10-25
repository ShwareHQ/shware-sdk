import { describe, expect, it } from 'vitest';
import { REDACTED_URL_PARAMS, redactUrl } from './redact-url';

describe('redactUrl', () => {
  it.each(REDACTED_URL_PARAMS)('removes %s from the query', (key) => {
    expect(redactUrl(`https://a.com/p?x=1&${key}=secret&y=2`)).toBe('https://a.com/p?x=1&y=2');
  });

  it('matches the parameter name case-insensitively', () => {
    expect(redactUrl('https://a.com/?Code=1&STATE=2&Session_Id=cs_3&utm_source=x')).toBe(
      'https://a.com/?utm_source=x'
    );
  });

  it('matches a percent-encoded name', () => {
    expect(redactUrl('https://a.com/?%63ode=1&a=2')).toBe('https://a.com/?a=2');
  });

  it('keeps every other parameter as written and in order', () => {
    expect(redactUrl('https://a.com/p?b=2&code=x&a=%20q&c&code_hint=1&a=3')).toBe(
      'https://a.com/p?b=2&a=%20q&c&code_hint=1&a=3'
    );
  });

  it('drops the `?` when nothing is left of the query', () => {
    expect(redactUrl('https://a.com/cb?code=1&state=2')).toBe('https://a.com/cb');
    expect(redactUrl('https://a.com/cb?code=1#top')).toBe('https://a.com/cb#top');
  });

  it('returns a URL without credentials unchanged', () => {
    for (const url of [
      'https://a.com/',
      'https://a.com/p?q=1#faq',
      'https://a.com/p?',
      'https://a.com/#',
    ]) {
      expect(redactUrl(url)).toBe(url);
    }
  });

  it('redacts an implicit flow hash', () => {
    expect(redactUrl('https://a.com/cb#access_token=t&token_type=bearer&expires_in=3600')).toBe(
      'https://a.com/cb#token_type=bearer&expires_in=3600'
    );
    expect(redactUrl('https://a.com/cb#id_token=t&state=s')).toBe('https://a.com/cb');
  });

  it("redacts a hash router's query", () => {
    expect(redactUrl('https://a.com/#/callback?code=1&next=%2F')).toBe(
      'https://a.com/#/callback?next=%2F'
    );
    expect(redactUrl('https://a.com/#/callback?code=1')).toBe('https://a.com/#/callback');
  });

  it('leaves a plain fragment alone', () => {
    expect(redactUrl('https://a.com/docs#code')).toBe('https://a.com/docs#code');
  });

  it('works on app deep links', () => {
    expect(redactUrl('myapp://auth/callback?code=1&utm_source=mail')).toBe(
      'myapp://auth/callback?utm_source=mail'
    );
  });

  it('returns a string that is not a URL unchanged', () => {
    expect(redactUrl('')).toBe('');
    expect(redactUrl('not a url')).toBe('not a url');
    // A malformed escape in a name is compared raw rather than throwing.
    expect(redactUrl('https://a.com/?%E0%A4%A=1&a=2')).toBe('https://a.com/?%E0%A4%A=1&a=2');
  });
});
