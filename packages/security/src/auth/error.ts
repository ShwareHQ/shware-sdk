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
  'ACCOUNT_DISABLED',
  'ACCOUNT_LOCKED',
  'EMAIL_ALREADY_USED',
  'EMAIL_NOT_VERIFIED',
  'SIGNUP_DISABLED',
] as const satisfies readonly (keyof AuthenticationReasons)[];

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
 * - JSON routes (native, One Tap, email): `403` with a google.rpc error body whose `ErrorInfo`
 *   holds `reason` and `metadata`.
 *
 * Anything else `onAuthorized` throws is a server fault: `server_error` on the redirect, rethrown
 * to the host's error handler on the JSON routes.
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
