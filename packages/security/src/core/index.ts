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
