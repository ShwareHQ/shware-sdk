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

export * from './reason';
export * from './detail';
export * from './status';
export * from './vaild';
export * from './snowflake';
export * from './response';
