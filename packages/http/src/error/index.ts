export class LoginTimeoutError extends Error {
  constructor(timeout: number) {
    super(`Login timeout after ${timeout}ms`);
    this.name = 'LoginTimeoutError';
  }
}

export class LoginCanceledError extends Error {
  constructor() {
    super('Login canceled by user');
    this.name = 'LoginCanceledError';
  }
}

export class CheckoutCreateError extends Error {
  constructor() {
    super('Failed to create checkout session');
    this.name = 'SessionCreateError';
  }
}

export enum PurchaseError {
  LOGIN_TIMEOUT = 'LOGIN_TIMEOUT',
  LOGIN_CANCELED = 'LOGIN_CANCELED',
  CHECKOUT_CANCELED = 'CHECKOUT_CANCELED',
  CHECKOUT_CREATE_FAILED = 'CHECKOUT_CREATE_FAILED',
  CHECKOUT_SESSION_ID_NOT_FOUND = 'CHECKOUT_SESSION_ID_NOT_FOUND',
  UNKNOWN = 'UNKNOWN',
}
