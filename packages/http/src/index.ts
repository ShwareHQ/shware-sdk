/**
 * @example
 * import { Details, Status } from '@repo/error';
 *
 * Status.adapter = () => new Error('Error');
 *
 * const details = Details.new()
 *  .requestInfo({ requestId: '1234567890', servingData: '/v1/tests' })
 *  .errorInfo({ reason: 'ACCOUNT_LOCKED' });
 *
 * throw Status.alreadyExists('xxx').error(details);
 */

export {
  LoginTimeoutError,
  LoginCanceledError,
  CheckoutCreateError,
  PurchaseError,
} from './error/index';
export type {
  NetworkErrorReason,
  StatusErrorReason,
  AuthenticationErrorReason,
  ModerationErrorReason,
  MultipartErrorReason,
  AppErrorReason,
  ErrorReason,
  ResolvedErrorReason,
} from './error/reason';
export {
  DetailType,
  Details,
  type ErrorInfo,
  type RetryInfo,
  type DebugInfo,
  type QuotaFailure,
  type PreconditionFailure,
  type BadRequest,
  type RequestInfo,
  type ResourceInfo,
  type Help,
  type LocalizedMessage,
  type Detail,
} from './error/detail';
export { Status, StatusError, type ErrorBody } from './error/status';
export { getErrorReason, getErrorMessage, getFieldViolations } from './error/parse';
export {
  Items,
  Pages,
  Cursor,
  pageParamsSchema,
  initialPageParam,
  getPreviousPageParam,
  getNextPageParam,
} from './response';
export type {
  Empty,
  EntityId,
  Entity,
  Response,
  InitParams,
  NextParams,
  PrevParams,
  PageParams,
  ParentPageParams,
  Page,
  InfinitePageData,
} from './response';

export { UidGenerator, uid } from './snowflake';

export * as MAX_LENGTH from './max-length/index';
export { timing } from './utils/timing';
export { ISO_3601_1, type ISO3166CountryCode } from './iso/iso_3601_1';
