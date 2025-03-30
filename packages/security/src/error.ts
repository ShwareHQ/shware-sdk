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
  // added
  | 'server_error'
  | string;

export class OAuth2Error extends Error {
  readonly status: number;
  readonly error: OAuth2ErrorType;

  constructor(status: number, error: OAuth2ErrorType, message?: string) {
    super(message ?? `OAuth2 error: ${error}`);
    this.status = status;
    this.error = error;
    if ((Error as any).captureStackTrace) {
      (Error as any).captureStackTrace(this, OAuth2Error);
    }
    Object.setPrototypeOf(this, OAuth2Error.prototype);
  }
}

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    if ((Error as any).captureStackTrace) {
      (Error as any).captureStackTrace(this, AuthenticationError);
    }
    Object.setPrototypeOf(this, AuthenticationError.prototype);
  }
}
