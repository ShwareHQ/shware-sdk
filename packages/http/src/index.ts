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
} from './error/reason';
export * from './error/detail';
export * from './error/status';
export { getErrorMessage } from './error/parse';
export {
  pageParamsSchema,
  Cursor,
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
} from './response';

export * from './vaild';
export * from './snowflake';

export * as MAX_LENGTH from './max-length/index';
export { base62 } from './utils/base62';
export { hasText } from './utils/string';
export { timing } from './utils/timing';
export { once } from './utils/promise';
export { invariant } from './utils/invariant';
export { TokenBucket, type TokenBucketOptions } from './utils/token-bucket';

export { ISO_3601_1, type ISO3166CountryCode } from './iso/iso_3601_1';
