/**
 * The refusal reasons the host's `onAuthorized` may throw, each with the metadata it carries.
 * Empty here: declare yours by augmenting it, and `AuthenticationError` accepts only those
 * reasons, each with its own metadata shape (a key with no required field needs no metadata):
 *
 * ```ts
 * declare module '@shware/security' {
 *   interface AuthenticationReasons {
 *     EMAIL_ALREADY_USED: { provider?: string };
 *     CLOSED_BETA: { invite?: string };
 *   }
 * }
 * ```
 *
 * Without an augmentation any string reason with string metadata is accepted.
 */
// oxlint-disable-next-line typescript/no-empty-object-type -- augmented by the host
export interface AuthenticationReasons {}

type Metadata = Record<string, string>;
/**
 * Each declared reason's metadata, as declared; a field that is not a string makes the reason
 * unusable (`never`), since metadata travels as URL parameters and JSON strings.
 */
type Reasons = keyof AuthenticationReasons extends never
  ? Record<string, Metadata>
  : {
      [K in keyof AuthenticationReasons]: AuthenticationReasons[K] extends Partial<Metadata>
        ? AuthenticationReasons[K]
        : never;
    };

/** A reason `onAuthorized` may refuse with: the keys of `AuthenticationReasons`, else any string. */
export type AuthenticationReason = keyof Reasons;

/** `true` when the reason's metadata has no required field, so it may be left out. */
type Optional<R extends AuthenticationReason> =
  Partial<Reasons[R]> extends Reasons[R] ? true : false;
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
    const given = options as
      | { message?: string; cause?: unknown; metadata?: Partial<Metadata> }
      | undefined;
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
