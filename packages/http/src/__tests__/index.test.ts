import { DetailType, Details, Status, StatusError } from '../index';

describe('error details', () => {
  test('test detail list constructor', () => {
    const details = Details.new()
      .requestInfo({ requestId: '123456', servingData: '/v1/tests' })
      .errorInfo({ reason: 'ACCESS_DENIED' });

    expect(details.list).toEqual([
      {
        type: DetailType.REQUEST_INFO,
        requestId: '123456',
        servingData: '/v1/tests',
      },
      {
        type: DetailType.ERROR_INFO,
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
