export interface NetworkErrorReason {
  DNS_ERROR: string;
  MISCONFIGURATION: string;
  CONNECTION_ERROR: string;
}

export interface StatusErrorReason {
  OK: string;
  CANCELLED: string;
  UNKNOWN: string;
  INVALID_ARGUMENT: string;
  DEADLINE_EXCEEDED: string;
  NOT_FOUND: string;
  ALREADY_EXISTS: string;
  PERMISSION_DENIED: string;
  RESOURCE_EXHAUSTED: string;
  FAILED_PRECONDITION: string;
  ABORTED: string;
  OUT_OF_RANGE: string;
  UNIMPLEMENTED: string;
  INTERNAL: string;
  UNAVAILABLE: string;
  DATA_LOSS: string;
  UNAUTHENTICATED: string;
  // other http status code
}

export interface AuthenticationErrorReason {
  ACCOUNT_LOCKED: string;
  ACCOUNT_EXPIRED: string;
  ACCOUNT_INACTIVE: string;
  ACCOUNT_DISABLED: string;
  ACCOUNT_SUSPENDED: string;
  ACCESS_DENIED: string;
  ACCESS_TOKEN_REQUIRED: string;
  PASSWORD_MISMATCH: string;
  USERNAME_ALREADY_EXISTS: string;
  VERIFICATION_CODE_MISMATCH: string;
  VERIFICATION_CODE_SEND_FAILED: string;
}

export interface ModerationErrorReason {
  POSSIBLY_SENSITIVE: string;
  ADULT_CONTENT: string;
  NUDITY_CONTENT: string;
  SEXUAL_CONTENT: string;
  BLOODY_CONTENT: string;
  WEAPON_CONTENT: string;
  POLITICS_CONTENT: string;
  VIOLENCE_CONTENT: string;
  ABUSE_CONTENT: string;
  ADVERTISEMENT_CONTENT: string;
  CONTRABAND_CONTENT: string;
  SPAM_CONTENT: string;
  MEANINGLESS_CONTENT: string;
  UNSAFE_TEXT_DETECTED: string;
}

export interface MultipartErrorReason {
  MAX_UPLOAD_SIZE_EXCEEDED: string;
  MEDIA_TYPE_NOT_SUPPORTED: string;
  MEDIA_TYPE_NOT_ACCEPTABLE: string;
}

export interface AppErrorReason {
  RATE_LIMIT_EXCEEDED: string;
  INSUFFICIENT_CREDITS: string;
  ALREADY_SUBSCRIBED_AT_OTHER_PLATFORM: string;
}

// oxlint-disable-next-line typescript/no-empty-object-type
export interface ErrorReason {}

export type ResolvedErrorReason = keyof ErrorReason extends never ? string : keyof ErrorReason;
