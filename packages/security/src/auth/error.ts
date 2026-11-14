type Metadata = Record<string, string>;
/** A reason that carries no metadata. */
type NoMetadata = { [key: string]: never };

/**
 * The reasons `onAuthorized` may refuse a sign-in with, each with the metadata it carries (string
 * fields only: metadata travels as URL parameters and JSON). The built-in ones cover the account
 * states every host meets; add your own by augmenting the interface, and `AuthenticationError`
 * accepts exactly these reasons, requiring the metadata when one of its fields is required:
 *
 * ```ts
 * declare module '@shware/security' {
 *   interface AuthenticationReasons {
 *     CLOSED_BETA: { invite?: string };
 *   }
 * }
 * ```
 */
export interface AuthenticationReasons {
  // Thrown by the SDK itself.
  /** The emailed code is wrong, or none is pending for the address. */
  INVALID_VERIFICATION_CODE: NoMetadata;
  /** More than `verificationCode.maxAttempts` guesses at the code; it is discarded. */
  VERIFICATION_CODE_ATTEMPTS_EXCEEDED: NoMetadata;
  /** The id token carries no nonce and the provider's flow requires one (`oauth2.nonce.optional`). */
  NONCE_MISSING: NoMetadata;
  /**
   * The id token's nonce is not the one this sign-in was started with: not issued for this
   * provider, used already, or (redirect flow) not the one sent with the authorization request.
   */
  NONCE_MISMATCH: NoMetadata;
  /** The desktop sign-in code is unknown, expired, used, or its verifier does not match. */
  INVALID_DESKTOP_CODE: NoMetadata;

  // For the host's `onAuthorized`.
  /** The account is disabled: banned, or closed by its owner. */
  ACCOUNT_DISABLED: NoMetadata;
  /** The account is locked for now; `until` is when it opens again, when known. */
  ACCOUNT_LOCKED: { until?: string };
  /** The address belongs to another account; `provider` is the one to sign in with instead. */
  EMAIL_ALREADY_USED: { provider?: string };
  /** The host accepts only verified addresses and this provider did not verify it. */
  EMAIL_NOT_VERIFIED: { provider?: string };
  /** No new accounts: registration is closed or by invitation. */
  SIGNUP_DISABLED: NoMetadata;
}

/** The built-in reasons, for a client's message table or a check that every reason is handled. */
export const AUTHENTICATION_REASONS = [
  'INVALID_VERIFICATION_CODE',
  'VERIFICATION_CODE_ATTEMPTS_EXCEEDED',
  'NONCE_MISSING',
  'NONCE_MISMATCH',
  'INVALID_DESKTOP_CODE',
  'ACCOUNT_DISABLED',
  'ACCOUNT_LOCKED',
  'EMAIL_ALREADY_USED',
  'EMAIL_NOT_VERIFIED',
  'SIGNUP_DISABLED',
] as const satisfies readonly (keyof AuthenticationReasons)[];

/**
 * The reasons the SDK answers with for a request it cannot act on, as the `ErrorInfo.reason` of a
 * `RequestError` (see `respond.ts`): about the request itself, not who is signing in, so the host
 * never throws them. Every throw site is typed against this list, so a new reason is added here
 * first, and a client's message table can cover them all.
 */
export const REQUEST_REASONS = [
  /** 400: a field failed schema validation; a `BadRequest` detail names it. */
  'INVALID_ARGUMENT',
  /** 400: a login body's `attributes` is not strings to strings within the size limit. */
  'INVALID_ATTRIBUTES',
  /** 400: a native login's `code_verifier` is not 43-128 characters from `[A-Za-z0-9-._~]`. */
  'INVALID_CODE_VERIFIER',
  /** 400: a form route was posted a content type other than `application/x-www-form-urlencoded`. */
  'INVALID_CONTENT_TYPE',
  /** 400: the body of a JSON route is not JSON. */
  'INVALID_JSON',
  /** 400: the Turnstile token sent with an email code request was rejected. */
  'TURNSTILE_VERIFICATION_FAILED',
  /** 401: `desktopAuthorize` without a signed-in session. */
  'UNAUTHENTICATED',
  /** 429: a code was sent to this email within `verificationCode.resendCooldown`. */
  'VERIFICATION_CODE_RESEND_TOO_SOON',
  /** 503: the email sender threw; the cooldown is released so the user can retry at once. */
  'EMAIL_DELIVERY_FAILED',
] as const;

/** A reason the SDK answers a malformed, too-soon or unauthenticated request with. */
export type RequestReason = (typeof REQUEST_REASONS)[number];

/**
 * Each reason's metadata as declared; a field that is not a string makes the reason unusable
 * (`never`).
 */
type Reasons = {
  [K in keyof AuthenticationReasons]: AuthenticationReasons[K] extends Partial<Metadata>
    ? AuthenticationReasons[K]
    : never;
};

/** A reason `onAuthorized` may refuse with: the keys of `AuthenticationReasons`. */
export type AuthenticationReason = keyof Reasons;

/** `true` when the reason's metadata has no required field, so it may be left out. */
type Optional<R extends AuthenticationReason> = Reasons[R] extends NoMetadata
  ? true
  : Partial<Reasons[R]> extends Reasons[R]
    ? true
    : false;
type Options<R extends AuthenticationReason> = {
  message?: string;
  cause?: unknown;
} & (Optional<R> extends true ? { metadata?: Reasons[R] } : { metadata: Reasons[R] });

/**
 * Thrown by the host's `onAuthorized` to refuse a sign-in it could complete but will not: an
 * address another account holds, a banned user, a closed beta. `reason` is the code the client
 * branches on, `metadata` what it needs to act (the provider to sign in with instead); both
 * travel as they are, so keep them short and free of secrets. `Auth` answers a refusal itself,
 * in the shape of the route it came through:
 *
 * - redirect flow (`loginOAuth2Code`): `errorUri?error=access_denied&reason=<reason>&<metadata>`;
 * - JSON routes (native, One Tap, email, desktop): `403` with a google.rpc error body whose
 *   `ErrorInfo` holds `reason` and `metadata`.
 *
 * The SDK throws it too, for a credential it checked itself (a wrong emailed code, a replayed
 * nonce), so a client handles both the same way. Anything else `onAuthorized` throws is a server
 * fault: `server_error` on the redirect, rethrown to the host's error handler on the JSON routes.
 */
export class AuthenticationError<
  R extends AuthenticationReason = AuthenticationReason,
> extends Error {
  readonly reason: R;
  readonly metadata: Metadata;

  constructor(reason: R, ...[options]: Optional<R> extends true ? [Options<R>?] : [Options<R>]) {
    const given = options;
    const { message, cause, metadata = {} } = given ?? {};
    super(message ?? `Sign-in refused: ${reason}`, { cause });
    this.name = 'AuthenticationError';
    this.reason = reason;
    this.metadata = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (typeof value === 'string') this.metadata[key] = value;
    }
    Object.setPrototypeOf(this, AuthenticationError.prototype);
  }
}
