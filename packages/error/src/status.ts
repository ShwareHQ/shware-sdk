import type { Detail, Details } from './detail';

export const Code = {
  // Not an error; returned on success
  //
  // HTTP Mapping: 200 OK
  OK: 200,

  // The operation was cancelled, typically by the caller.
  //
  // HTTP Mapping: 499 Client Closed Request
  CANCELLED: 499,

  // Unknown error.  For example, this error may be returned when
  // a `Status` value received from another address space belongs to
  // an error space that is not known in this address space.  Also,
  // errors raised by APIs that do not return enough error information
  // may be converted to this error.
  //
  // HTTP Mapping: 500 Internal Server Error
  UNKNOWN: 500,

  // The client specified an invalid argument.  Note that this differs
  // from `FAILED_PRECONDITION`.  `INVALID_ARGUMENT` indicates arguments
  // that are problematic regardless of the state of the system
  // (e.g., a malformed file name).
  //
  // HTTP Mapping: 400 Bad Request
  INVALID_ARGUMENT: 400,

  // The deadline expired before the operation could complete. For operations
  // that change the state of the system, this error may be returned
  // even if the operation has completed successfully.  For example, a
  // successful response from a server could have been delayed long
  // enough for the deadline to expire.
  //
  // HTTP Mapping: 504 Gateway Timeout
  DEADLINE_EXCEEDED: 504,

  // Some requested entity (e.g., file or directory) was not found.
  //
  // Note to server developers: if a request is denied for an entire class
  // of users, such as gradual feature rollout or undocumented whitelist,
  // `NOT_FOUND` may be used. If a request is denied for some users within
  // a class of users, such as user-based access control, `PERMISSION_DENIED`
  // must be used.
  //
  // HTTP Mapping: 404 Not Found
  NOT_FOUND: 404,

  // The entity that a client attempted to create (e.g., file or directory)
  // already exists.
  //
  // HTTP Mapping: 409 Conflict
  ALREADY_EXISTS: 409,

  // The caller does not have permission to execute the specified
  // operation. `PERMISSION_DENIED` must not be used for rejections
  // caused by exhausting some resource (use `RESOURCE_EXHAUSTED`
  // instead for those errors). `PERMISSION_DENIED` must not be
  // used if the caller can not be identified (use `UNAUTHENTICATED`
  // instead for those errors). This error code does not imply the
  // request is valid or the requested entity exists or satisfies
  // other pre-conditions.
  //
  // HTTP Mapping: 403 Forbidden
  PERMISSION_DENIED: 403,

  // Some resource has been exhausted, perhaps a per-user quota, or
  // perhaps the entire file system is out of space.
  //
  // HTTP Mapping: 429 Too Many Requests
  RESOURCE_EXHAUSTED: 429,

  // The operation was rejected because the system is not in a state
  // required for the operation's execution.  For example, the directory
  // to be deleted is non-empty, a rmdir operation is applied to
  // a non-directory, etc.
  //
  // Service implementors can use the following guidelines to decide
  // between `FAILED_PRECONDITION`, `ABORTED`, and `UNAVAILABLE`:
  //  (a) Use `UNAVAILABLE` if the client can retry just the failing call.
  //  (b) Use `ABORTED` if the client should retry at a higher level
  //      (e.g., when a client-specified test-and-set fails, indicating the
  //      client should restart a read-modify-write sequence).
  //  (c) Use `FAILED_PRECONDITION` if the client should not retry until
  //      the system state has been explicitly fixed.  E.g., if a "rmdir"
  //      fails because the directory is non-empty, `FAILED_PRECONDITION`
  //      should be returned since the client should not retry unless
  //      the files are deleted from the directory.
  //
  // HTTP Mapping: 400 Bad Request
  FAILED_PRECONDITION: 400,

  // The operation was aborted, typically due to a concurrency issue such as
  // a sequencer check failure or transaction abort.
  //
  // See the guidelines above for deciding between `FAILED_PRECONDITION`,
  // `ABORTED`, and `UNAVAILABLE`.
  //
  // HTTP Mapping: 409 Conflict
  ABORTED: 409,

  // The operation was attempted past the valid range.  E.g., seeking or
  // reading past end-of-file.
  //
  // Unlike `INVALID_ARGUMENT`, this error indicates a problem that may
  // be fixed if the system state changes. For example, a 32-bit file
  // system will generate `INVALID_ARGUMENT` if asked to read at an
  // offset that is not in the range [0,2^32-1], but it will generate
  // `OUT_OF_RANGE` if asked to read from an offset past the current
  // file size.
  //
  // There is a fair bit of overlap between `FAILED_PRECONDITION` and
  // `OUT_OF_RANGE`.  We recommend using `OUT_OF_RANGE` (the more specific
  // error) when it applies so that callers who are iterating through
  // a space can easily look for an `OUT_OF_RANGE` error to detect when
  // they are done.
  //
  // HTTP Mapping: 400 Bad Request
  OUT_OF_RANGE: 400,

  // The operation is not implemented or is not supported/enabled in this
  // service.
  //
  // HTTP Mapping: 501 Not Implemented
  UNIMPLEMENTED: 501,

  // Internal errors.  This means that some invariants expected by the
  // underlying system have been broken.  This error code is reserved
  // for serious errors.
  //
  // HTTP Mapping: 500 Internal Server Error
  INTERNAL: 500,

  // The service is currently unavailable.  This is most likely a
  // transient condition, which can be corrected by retrying with
  // a backoff. Note that it is not always safe to retry
  // non-idempotent operations.
  //
  // See the guidelines above for deciding between `FAILED_PRECONDITION`,
  // `ABORTED`, and `UNAVAILABLE`.
  //
  // HTTP Mapping: 503 Service Unavailable
  UNAVAILABLE: 503,

  // Unrecoverable data loss or corruption.
  //
  // HTTP Mapping: 500 Internal Server Error
  DATA_LOSS: 500,

  // The request does not have valid authentication credentials for the
  // operation.
  //
  // HTTP Mapping: 401 Unauthorized
  UNAUTHENTICATED: 401,
} as const;

export const DEFAULT_MESSAGES: Record<keyof typeof Code, string> = {
  OK: 'OK',
  CANCELLED: 'The operation was cancelled',
  UNKNOWN: 'Unknown error',
  INVALID_ARGUMENT: 'The client specified an invalid argument',
  DEADLINE_EXCEEDED: 'The deadline expired before the operation could complete',
  NOT_FOUND: 'Some requested entity was not found',
  ALREADY_EXISTS: 'The entity that a client attempted to create already exists',
  PERMISSION_DENIED: 'The caller does not have permission to execute the specified operation',
  RESOURCE_EXHAUSTED: 'Some resource has been exhausted',
  FAILED_PRECONDITION:
    "The operation was rejected because the system is not in a state required for the operation's execution",
  ABORTED: 'The operation was aborted',
  OUT_OF_RANGE: 'The operation was attempted past the valid range',
  UNIMPLEMENTED: 'The operation is not implemented or is not supported/enabled in this service',
  INTERNAL: 'Internal errors',
  UNAVAILABLE: 'The service is currently unavailable',
  DATA_LOSS: 'Unrecoverable data loss or corruption',
  UNAUTHENTICATED: 'The request does not have valid authentication credentials for the operation',
};

export interface ErrorResponse {
  error: {
    code: number;
    status: keyof typeof Code;
    message: string;
    details: Detail[];
  };
}

export class StatusError extends Error {
  readonly status: number;
  readonly response?: ErrorResponse;

  constructor(status: number, response?: ErrorResponse) {
    super(response?.error?.message ?? `Status Error: ${status}`);
    this.name = 'StatusError';
    this.status = status;
    this.response = response;
    if ((Error as any).captureStackTrace) {
      (Error as any).captureStackTrace(this, StatusError);
    }
    Object.setPrototypeOf(this, StatusError.prototype);
  }
}

export class StatusCode {
  code: keyof typeof Code;
  message?: string;
  private constructor(code: keyof typeof Code, message?: string) {
    this.code = code;
    this.message = message;
  }

  static of(code: keyof typeof Code, message?: string) {
    return new StatusCode(code, message ?? DEFAULT_MESSAGES[code]);
  }

  response(details?: Details): ErrorResponse {
    return {
      error: {
        code: Code[this.code],
        status: this.code,
        message: this.message ?? '',
        details: details?.list ?? [],
      },
    };
  }

  error(details?: Details): Error {
    const response: ErrorResponse = {
      error: {
        code: Code[this.code],
        status: this.code,
        message: this.message ?? '',
        details: details?.list ?? [],
      },
    };
    if (Status.adapter) return Status.adapter(Code[this.code], response);
    return new StatusError(Code[this.code], response);
  }
}

export class Status {
  static adapter?: (status: number, response: ErrorResponse) => Error;

  static ok = (message?: string) => StatusCode.of('OK', message);
  static cancelled = (message?: string) => StatusCode.of('CANCELLED', message);
  static unknown = (message?: string) => StatusCode.of('UNKNOWN', message);
  static invalidArgument = (message?: string) => StatusCode.of('INVALID_ARGUMENT', message);
  static deadlineExceeded = (message?: string) => StatusCode.of('DEADLINE_EXCEEDED', message);
  static notFound = (message?: string) => StatusCode.of('NOT_FOUND', message);
  static alreadyExists = (message?: string) => StatusCode.of('ALREADY_EXISTS', message);
  static permissionDenied = (message?: string) => StatusCode.of('PERMISSION_DENIED', message);
  static unauthorized = (message?: string) => StatusCode.of('UNAUTHENTICATED', message);
  static resourceExhausted = (message?: string) => StatusCode.of('RESOURCE_EXHAUSTED', message);
  static failedPrecondition = (message?: string) => StatusCode.of('FAILED_PRECONDITION', message);
  static aborted = (message?: string) => StatusCode.of('ABORTED', message);
  static outOfRange = (message?: string) => StatusCode.of('OUT_OF_RANGE', message);
  static unimplemented = (message?: string) => StatusCode.of('UNIMPLEMENTED', message);
  static internal = (message?: string) => StatusCode.of('INTERNAL', message);
  static unavailable = (message?: string) => StatusCode.of('UNAVAILABLE', message);
  static dataLoss = (message?: string) => StatusCode.of('DATA_LOSS', message);
}
