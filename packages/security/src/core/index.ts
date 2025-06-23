export type JSONValue =
  | null
  | string
  | number
  | boolean
  | { [value: string]: JSONValue }
  | Array<JSONValue>;

export interface Principal {
  name: string;
}

export interface Authentication extends Principal {
  authorities: string[];
  authenticated: boolean;
}

export interface CsrfToken {
  token: string;
  headerName: string;
  parameterName: string;
}

export enum Provider {
  // oauth2
  APPLE = 'APPLE',
  DISCORD = 'DISCORD',
  FACEBOOK = 'FACEBOOK',
  GITHUB = 'GITHUB',
  GOOGLE = 'GOOGLE',
  LINKEDIN = 'LINKEDIN',
  MICROSOFT = 'MICROSOFT',
  SLACK = 'SLACK',
  WECHAT = 'WECHAT',
  X = 'X',
  // contact
  EMAIL = 'EMAIL',
  PHONE = 'PHONE',
}

export const ALL_PROVIDERS = [
  Provider.APPLE,
  Provider.DISCORD,
  Provider.FACEBOOK,
  Provider.GITHUB,
  Provider.GOOGLE,
  Provider.LINKEDIN,
  Provider.MICROSOFT,
  Provider.SLACK,
  Provider.WECHAT,
  Provider.X,
  Provider.EMAIL,
  Provider.PHONE,
] as const;
