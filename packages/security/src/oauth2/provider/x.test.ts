import { afterEach, describe, expect, it, vi } from 'vitest';
import { createXProvider, x } from './x';

const token = { access_token: 't' } as never;
const context = {} as never;

/** A `/2/users/me` stub answering with `data`, recording the URL it was asked for. */
function me(data: Record<string, unknown>) {
  const asked: URL[] = [];
  const fetch = vi.fn<(input: URL | string, init?: RequestInit) => Promise<Response>>(
    async (input) => {
      const url = input instanceof URL ? input : new URL(input);
      asked.push(url);
      expect(`${url.origin}${url.pathname}`).toBe('https://api.x.com/2/users/me');
      return Response.json({ data: { id: 'x-1', name: 'Jane', username: 'jane', ...data } });
    }
  );
  vi.stubGlobal('fetch', fetch);
  return asked;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('x provider user info', () => {
  it('asks for the user fields, confirmed_email included, and trusts only that address', async () => {
    const asked = me({ confirmed_email: 'jane@example.com', verified: false });

    const { claims } = await x.getUserInfo(token, context);

    expect(asked[0]?.searchParams.getAll('user.fields')).toContain('confirmed_email');
    expect(claims.email).toBe('jane@example.com');
    expect(claims.email_verified).toBe(true);
    expect(x.defaultScope).toContain('users.email');
  });

  it('leaves the email unset, and unverified, when X returns none (blue check or not)', async () => {
    me({ verified: true });

    const { claims } = await x.getUserInfo(token, context);

    expect(claims.email).toBeUndefined();
    expect(claims.email_verified).toBeUndefined();
  });

  it('sends the fields a host configures', async () => {
    const asked = me({});

    await createXProvider({ userFields: ['id', 'username'] }).getUserInfo(token, context);

    expect(asked[0]?.searchParams.getAll('user.fields')).toEqual(['id', 'username']);
  });
});
