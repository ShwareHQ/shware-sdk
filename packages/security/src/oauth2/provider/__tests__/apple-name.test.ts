import { invariant } from '@shware/utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { composeName } from '../../name';
import type { NativeCredential } from '../../types';
import { createAppleProvider } from '../apple';

const idToken = {
  sub: '001234.abcd',
  email: 'relay@privaterelay.appleid.com',
  email_verified: true,
  is_private_email: true,
};

vi.mock(import('../common'), async (importOriginal) => {
  const actual = await importOriginal();
  vi.spyOn(actual, 'verifyIdToken').mockImplementation(async () => ({ ...idToken }));
  return actual;
});

const registration = {
  clientId: 'com.example.app',
  clientSecret: 'secret',
  redirectUri: 'https://api.example.com/login/oauth2/code/apple',
};

const token = { access_token: 'at', id_token: 'idt', token_type: 'Bearer', expires_in: 3600 };

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json(token)));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function login(credentials: Omit<NativeCredential, 'code'>) {
  const provider = createAppleProvider();
  invariant(provider.loginOAuth2Native, 'apple supports native login');
  return provider.loginOAuth2Native({
    ...registration,
    credentials: { code: 'c0de', ...credentials },
  });
}

describe('composeName', () => {
  test('writes Western names given name first', () => {
    expect(composeName({ given_name: 'John', family_name: 'Appleseed' })).toBe('John Appleseed');
  });

  test('writes CJK names family name first, without a space', () => {
    expect(composeName({ given_name: '小明', family_name: '王' })).toBe('王小明');
    expect(composeName({ given_name: 'はると', family_name: '山田' })).toBe('山田はると');
    expect(composeName({ given_name: '민준', family_name: '김' })).toBe('김민준');
  });

  test('falls back to given name first for mixed scripts', () => {
    expect(composeName({ given_name: 'John', family_name: '王' })).toBe('John 王');
    expect(composeName({ given_name: '小明', family_name: 'Wang' })).toBe('小明 Wang');
  });

  test('uses the one part present, and nothing when there is none', () => {
    expect(composeName({ given_name: 'John' })).toBe('John');
    expect(composeName({ family_name: ' 王 ' })).toBe('王');
    expect(composeName({ given_name: '  ' })).toBeUndefined();
    expect(composeName({})).toBeUndefined();
  });
});

describe('apple getUserInfo (web, form_post user)', () => {
  test('turns the first authorization user into standard claims and keeps it in data', async () => {
    const user = JSON.stringify({
      name: { firstName: ' John ', lastName: 'Appleseed' },
      email: 'spoofed@example.com',
    });
    const { claims, data } = await createAppleProvider().getUserInfo(token, { user });

    expect(claims).toEqual({
      sub: idToken.sub,
      email: idToken.email,
      email_verified: true,
      given_name: 'John',
      family_name: 'Appleseed',
      name: 'John Appleseed',
    });
    expect(data).toMatchObject({
      sub: idToken.sub,
      user: { name: { firstName: 'John', lastName: 'Appleseed' }, email: 'spoofed@example.com' },
    });
  });

  test('ignores a malformed user without failing', async () => {
    for (const user of ['{not json', '"John"', JSON.stringify({ name: { firstName: 42 } })]) {
      const { claims, data } = await createAppleProvider().getUserInfo(token, { user });
      expect(claims).toEqual({ sub: idToken.sub, email: idToken.email, email_verified: true });
      expect(data).not.toHaveProperty('user');
    }
  });

  test('caps each name part', async () => {
    const user = JSON.stringify({ name: { firstName: 'x'.repeat(200) } });
    const { claims } = await createAppleProvider().getUserInfo(token, { user });
    expect(claims.given_name).toHaveLength(64);
  });

  test('without a user, claims carry no name', async () => {
    const { claims, data } = await createAppleProvider().getUserInfo(token);
    expect(claims).toEqual({ sub: idToken.sub, email: idToken.email, email_verified: true });
    expect(data).toEqual(idToken);
  });
});

describe('apple loginOAuth2Native', () => {
  test('maps the standard name fields of the login body to claims', async () => {
    const { userInfo } = await login({
      given_name: '小明',
      family_name: '王',
      middle_name: '',
      nickname: 'Ming',
    });

    expect(userInfo.claims).toMatchObject({
      given_name: '小明',
      family_name: '王',
      nickname: 'Ming',
      name: '王小明',
    });
    expect(userInfo.claims).not.toHaveProperty('middle_name');
    expect(userInfo.data).not.toHaveProperty('full_name');
  });

  test('reads full_name, keeping prefix and suffix in data only', async () => {
    const { userInfo } = await login({
      full_name: {
        givenName: 'John',
        familyName: 'Appleseed',
        middleName: 'Q',
        namePrefix: 'Dr.',
        nameSuffix: 'Jr.',
        nickname: null,
      },
    });

    expect(userInfo.claims).toEqual({
      sub: idToken.sub,
      email: idToken.email,
      email_verified: true,
      given_name: 'John',
      family_name: 'Appleseed',
      middle_name: 'Q',
      name: 'John Appleseed',
    });
    expect(userInfo.data).toMatchObject({
      full_name: {
        givenName: 'John',
        familyName: 'Appleseed',
        middleName: 'Q',
        namePrefix: 'Dr.',
        nameSuffix: 'Jr.',
      },
    });
  });

  test('prefers the standard fields over full_name', async () => {
    const { userInfo } = await login({
      given_name: 'Johnny',
      full_name: { givenName: 'John', familyName: 'Appleseed' },
    });
    expect(userInfo.claims.name).toBe('Johnny Appleseed');
  });

  test('ignores name fields of the wrong type', async () => {
    const { userInfo } = await login({
      given_name: 42,
      full_name: 'John Appleseed',
    } as unknown as NativeCredential);
    expect(userInfo.claims).toEqual({
      sub: idToken.sub,
      email: idToken.email,
      email_verified: true,
    });
    expect(userInfo.data).toEqual(idToken);
  });

  test('without any name, behaves as before', async () => {
    const { userInfo } = await login({});
    expect(userInfo).toEqual({
      data: idToken,
      claims: { sub: idToken.sub, email: idToken.email, email_verified: true },
    });
  });
});
