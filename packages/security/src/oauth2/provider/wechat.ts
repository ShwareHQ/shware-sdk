import { invariant } from '@shware/utils';
import { OAuth2Error, type OAuth2ErrorType } from '../error';
import type { OAuth2Token, Provider } from '../types';

/**
 * WeChat error codes mapped to the closest OAuth2 error. Anything not listed is a `server_error`.
 * reference: https://developers.weixin.qq.com/doc/oplatform/Return_codes/Return_code_descriptions_new.html
 */
const WECHAT_ERRORS: Record<number, { status: number; error: OAuth2ErrorType }> = {
  [-1]: { status: 503, error: 'temporarily_unavailable' }, // system busy
  40001: { status: 401, error: 'invalid_token' }, // invalid credential / access_token
  40014: { status: 401, error: 'invalid_token' }, // invalid access_token
  42001: { status: 401, error: 'invalid_token' }, // access_token expired
  40013: { status: 401, error: 'invalid_client' }, // invalid appid
  40125: { status: 401, error: 'invalid_client' }, // invalid appsecret
  40029: { status: 400, error: 'invalid_grant' }, // invalid code
  40163: { status: 400, error: 'invalid_grant' }, // code been used
  40030: { status: 400, error: 'invalid_grant' }, // invalid refresh_token
  42002: { status: 400, error: 'invalid_grant' }, // refresh_token expired
  40003: { status: 400, error: 'invalid_request' }, // invalid openid
};

/**
 * WeChat answers most failures with HTTP 200 and a `{ errcode, errmsg }` body, so the body decides
 * whether the call succeeded, not the status. The raw errcode is kept in the message for the logs.
 */
async function readWechatResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as
    | (T & Partial<WechatErrorResponse>)
    | null;
  const errcode = body?.errcode;
  if (typeof errcode === 'number' && errcode !== 0) {
    const mapped = WECHAT_ERRORS[errcode] ?? { status: 500, error: 'server_error' };
    const status = response.ok ? mapped.status : response.status;
    throw new OAuth2Error(
      status,
      mapped.error,
      `${body?.errmsg ?? 'wechat error'} (errcode: ${errcode})`
    );
  }
  if (!response.ok || !body) {
    throw new OAuth2Error(
      response.ok ? 502 : response.status,
      'server_error',
      `Unexpected wechat response (HTTP ${response.status})`
    );
  }
  return body;
}

export type Options = { isWechatBrowser: boolean };

/**
 * reference: https://developers.weixin.qq.com/doc/offiaccount/en/OA_Web_Apps/Wechat_webpage_authorization.html
 */
export function createWechatProvider(options: Options = { isWechatBrowser: false }): Provider {
  const { isWechatBrowser } = options;
  return {
    authorizationUri: isWechatBrowser
      ? 'https://open.weixin.qq.com/connect/oauth2/authorize'
      : 'https://open.weixin.qq.com/connect/qrconnect',
    tokenUri: 'https://api.weixin.qq.com/sns/oauth2/access_token',
    tokenRefreshUri: 'https://api.weixin.qq.com/sns/oauth2/refresh_token',
    userInfoUri: 'https://api.weixin.qq.com/sns/userinfo',
    defaultScope: [isWechatBrowser ? 'snsapi_userinfo' : 'snsapi_login'],
    createAuthorizationUri(params) {
      const url = new URL(this.authorizationUri);
      url.searchParams.set('appid', params.clientId);
      url.searchParams.set('scope', (params.scope ?? this.defaultScope).join(','));
      url.searchParams.set('redirect_uri', params.redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('state', params.state);
      return url;
    },
    async exchangeAuthorizationCode(params) {
      invariant(params.clientSecret, 'clientSecret is required for wechat');
      const url = new URL(this.tokenUri);
      url.searchParams.set('appid', params.clientId);
      url.searchParams.set('secret', params.clientSecret);
      url.searchParams.set('code', params.code);
      url.searchParams.set('grant_type', 'authorization_code');
      return readWechatResponse<WechatToken>(await fetch(url.href));
    },
    async getUserInfo({ access_token, openid }) {
      invariant(this.userInfoUri, 'userInfoUri is required');
      invariant(openid && typeof openid === 'string', 'openid is required');
      const url = new URL(this.userInfoUri);
      url.searchParams.set('access_token', access_token);
      url.searchParams.set('openid', openid);
      const data = await readWechatResponse<WechatUserInfo>(await fetch(url.href));

      return {
        data,
        claims: {
          sub: data.unionid ?? data.openid,
          name: data.nickname,
          picture: data.headimgurl
            ? `${data.headimgurl.split('/').slice(0, -1).join('/')}/0`
            : undefined,
          gender: data.sex === 1 ? 'male' : data.sex === 2 ? 'female' : undefined,
        },
      };
    },
    async refreshAccessToken(params) {
      invariant(this.tokenRefreshUri, 'tokenRefreshUri is required');
      const url = new URL(this.tokenRefreshUri);
      url.searchParams.set('appid', params.clientId);
      url.searchParams.set('grant_type', 'refresh_token');
      url.searchParams.set('refresh_token', params.refreshToken);
      return readWechatResponse<WechatToken>(await fetch(url.href));
    },
  };
}

export const wechat = createWechatProvider();

export interface WechatUserInfo {
  openid: string;
  nickname: string;
  sex: 0 | 1 | 2; // 0: unknown, 1: male, 2: female
  province: string;
  city: string;
  country: string;
  /**
   * User's profile photo. The last numeric value represents the size of a square profile photo
   * (The value can be 0, 46, 64, 96, or 132. The value 0 represents a 640*640 square profile
   * photo). This parameter is left blank if a user has no profile photo. If the user changes the
   * profile photo, the URL of the original profile photo will expire.
   * e.g. http://thirdwx.qlogo.cn/mmopen/g3MonUZtNHkdmzicIlibx6iaFqAc56vxLSUfpb6n5WKSYVY0ChQKkiaJSgQ1dZuTOgvLLrhJbERQQ4eMsv84eavHiaiceqxibJxCfHe/46
   */
  headimgurl: string;
  privilege: string[];
  unionid?: string;
}

export interface WechatToken extends OAuth2Token {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  openid: string;
  scope: string;
  unionid?: string;
}

interface WechatErrorResponse {
  errcode: number;
  errmsg: string;
}
