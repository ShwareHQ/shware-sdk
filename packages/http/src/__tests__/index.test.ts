import { describe, expect, test } from 'vitest';
import { DetailType, Details, Status, StatusError, isErrorReason } from '../index';

describe('error details', () => {
  test('detail list constructor', () => {
    const details = Details.new()
      .requestInfo({ requestId: '123456', servingData: '/v1/tests' })
      .errorInfo({ reason: 'ACCESS_DENIED' });

    expect(details.list).toEqual([
      {
        '@type': DetailType.REQUEST_INFO,
        requestId: '123456',
        servingData: '/v1/tests',
      },
      {
        '@type': DetailType.ERROR_INFO,
        reason: 'ACCESS_DENIED',
      },
    ]);
  });
});

describe('error status', () => {
  test('status type', () => {
    const error = Status.invalidArgument().error();
    expect(error instanceof StatusError).toBe(true);
  });
});

describe('isErrorReason', () => {
  const body = Status.invalidArgument('bad code').body(
    Details.new().errorInfo({ reason: 'INVALID_VERIFICATION_CODE' })
  );

  test('matches the ErrorInfo reason', () => {
    expect(isErrorReason(body, 'INVALID_VERIFICATION_CODE')).toBe(true);
    expect(isErrorReason(body, 'ACCOUNT_LOCKED', 'INVALID_VERIFICATION_CODE')).toBe(true);
  });

  test('is false for other reasons, no reasons, or bodies without ErrorInfo', () => {
    expect(isErrorReason(body, 'ACCOUNT_LOCKED')).toBe(false);
    expect(isErrorReason(body)).toBe(false);
    expect(isErrorReason(Status.invalidArgument('x').body(), 'ACCOUNT_LOCKED')).toBe(false);
    expect(isErrorReason(undefined, 'ACCOUNT_LOCKED')).toBe(false);
    expect(isErrorReason('oops', 'ACCOUNT_LOCKED')).toBe(false);
  });
});
