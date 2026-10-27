// reference: https://datatracker.ietf.org/doc/html/rfc6749#section-4.2.2.1
export type OAuth2ErrorType =
  | 'invalid_request' // 400
  | 'invalid_client' // 401
  | 'invalid_grant' // 400
  | 'invalid_token' // 401
  | 'invalid_scope' // 400
  | 'unauthorized_client' // 401
  | 'unsupported_grant_type' // 400
  | 'unsupported_response_type' // 400
  | 'insufficient_scope' // 403
  | 'redirect_uri_mismatch' // 400
  | 'access_denied' // 400
  | 'server_error' // 500
  | 'temporarily_unavailable' // 503
  | (string & {});

/** The registered error codes of `OAuth2ErrorType`, for checking untrusted input at runtime. */
const OAUTH2_ERROR_TYPES: ReadonlySet<string> = new Set([
  'invalid_request',
  'invalid_client',
  'invalid_grant',
  'invalid_token',
  'invalid_scope',
  'unauthorized_client',
  'unsupported_grant_type',
  'unsupported_response_type',
  'insufficient_scope',
  'redirect_uri_mismatch',
  'access_denied',
  'server_error',
  'temporarily_unavailable',
]);

export function isKnownOAuth2ErrorType(value: string): boolean {
  return OAUTH2_ERROR_TYPES.has(value);
}

export class OAuth2Error extends Error {
  readonly status: number;
  readonly error: OAuth2ErrorType;

  constructor(status: number, error: OAuth2ErrorType, message?: string) {
    super(message ?? `OAuth2 error: ${error}`);
    this.status = status;
    this.error = error;
    Object.setPrototypeOf(this, OAuth2Error.prototype);
  }
}
