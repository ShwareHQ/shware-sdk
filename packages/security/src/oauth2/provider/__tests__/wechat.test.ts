import { afterEach, describe, expect, test, vi } from 'vitest';
import { OAuth2Error } from '../../error';
import { createWechatProvider } from '../wechat';

const client = { clientId: 'wx-app', clientSecret: 'wx-secret' };
const redirectUri = 'https://api.example.com/login/oauth2/code/wechat';

/** Stubs `fetch` with the given responses in order; returns the mock to inspect the requests. */
function stubFetch(...responses: Response[]) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const wechat = createWechatProvider();
const context = { clientId: client.clientId, response: {} };

describe('wechat provider', () => {
  test('exchanges a code and reads the user info', async () => {
    stubFetch(
      Response.json({
        access_token: 'at',
        expires_in: 7200,
        refresh_token: 'rt',
        openid: 'o1',
        scope: 'snsapi_login',
        unionid: 'u1',
      }),
      Response.json({
        openid: 'o1',
        unionid: 'u1',
        nickname: 'Alice',
        sex: 2,
        province: '',
        city: '',
        country: '',
        headimgurl: 'https://thirdwx.qlogo.cn/mmopen/abc/132',
        privilege: [],
      })
    );
    const token = await wechat.exchangeAuthorizationCode({ ...client, code: 'c0de', redirectUri });
    expect(token).toMatchObject({ access_token: 'at', openid: 'o1' });

    const { claims } = await wechat.getUserInfo(token, context);
    expect(claims).toEqual({
      sub: 'u1',
      name: 'Alice',
      picture: 'https://thirdwx.qlogo.cn/mmopen/abc/0',
      gender: 'female',
    });
  });

  test('refuses an error body answered with HTTP 200 on the token exchange', async () => {
    stubFetch(Response.json({ errcode: 40029, errmsg: 'invalid code' }));
    const error = await wechat
      .exchangeAuthorizationCode({ ...client, code: 'c0de', redirectUri })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OAuth2Error);
    expect(error).toMatchObject({ status: 400, error: 'invalid_grant' });
    expect((error as OAuth2Error).message).toBe('invalid code (errcode: 40029)');
  });

  test('refuses an error body answered with HTTP 200 on the token refresh', async () => {
    stubFetch(Response.json({ errcode: 40125, errmsg: 'invalid appsecret' }));
    const refresh = wechat.refreshAccessToken?.bind(wechat);
    expect(refresh).toBeDefined();
    const error = await refresh?.({ ...client, refreshToken: 'rt' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OAuth2Error);
    expect(error).toMatchObject({ status: 401, error: 'invalid_client' });
  });

  test('refuses an error body answered with HTTP 200 on the user info', async () => {
    stubFetch(Response.json({ errcode: 42001, errmsg: 'access_token expired' }));
    const error = await wechat
      .getUserInfo({ access_token: 'at', token_type: 'bearer', openid: 'o1' }, context)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OAuth2Error);
    expect(error).toMatchObject({ status: 401, error: 'invalid_token' });
  });

  test('maps an unknown errcode to server_error and keeps a non-2xx status', async () => {
    stubFetch(Response.json({ errcode: 99999, errmsg: 'boom' }, { status: 502 }));
    const error = await wechat
      .exchangeAuthorizationCode({ ...client, code: 'c0de', redirectUri })
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 502, error: 'server_error' });
  });
});
