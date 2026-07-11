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

export const PROVIDERS = [
  // oauth2
  'APPLE',
  'DISCORD',
  'FACEBOOK',
  'GITHUB',
  'GOOGLE',
  'LINKEDIN',
  'MICROSOFT',
  'SLACK',
  'WECHAT',
  'X',
  // contact
  'EMAIL',
  'PHONE',
] as const;

export type Provider = (typeof PROVIDERS)[number];
