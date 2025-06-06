import invariant from 'tiny-invariant';
import type { OAuth2Token, Provider } from '../types';
import { OAuth2Error } from '../error';

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
      const url = new URL(this.tokenUri);
      url.searchParams.set('appid', params.clientId);
      url.searchParams.set('secret', params.clientSecret);
      url.searchParams.set('code', params.code);
      url.searchParams.set('grant_type', 'authorization_code');
      const response = await fetch(url.href);
      if (!response.ok) {
        const { errcode, errmsg } = (await response.json()) as WechatErrorResponse;
        throw new OAuth2Error(response.status, errmsg, `errcode: ${errcode}`);
      }
      return (await response.json()) as WechatToken;
    },
    async getUserInfo({ access_token, openid }) {
      invariant(this.userInfoUri, 'userInfoUri is required');
      invariant(openid && typeof openid === 'string', 'openid is required');
      const url = new URL(this.userInfoUri);
      url.searchParams.set('access_token', access_token);
      url.searchParams.set('openid', openid);
      const response = await fetch(url.href);
      if (!response.ok) {
        const { errcode, errmsg } = (await response.json()) as WechatErrorResponse;
        throw new OAuth2Error(response.status, errmsg, `errcode: ${errcode}`);
      }
      const data = (await response.json()) as WechatUserInfo;

      return {
        data,
        claims: {
          sub: data.unionid ?? data.openid,
          name: data.nickname,
          picture: data.headimgurl.split('/').slice(0, -1).join('/') + '/0',
          gender: data.sex === 1 ? 'male' : data.sex === 2 ? 'female' : undefined,
        },
      };
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
