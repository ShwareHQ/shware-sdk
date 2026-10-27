import { describe, expectTypeOf, it } from 'vitest';
import { AuthenticationError, type AuthenticationReason } from '../src/auth/error';

declare module '../src/auth/error' {
  interface AuthenticationReasons {
    EMAIL_ALREADY_USED: { provider?: string };
    ACCOUNT_BANNED: { until: string };
    CLOSED_BETA: { invite?: string };
  }
}

describe('AuthenticationError reasons', () => {
  it('accepts only the declared reasons, each with its metadata', () => {
    expectTypeOf<AuthenticationReason>().toEqualTypeOf<
      'EMAIL_ALREADY_USED' | 'ACCOUNT_BANNED' | 'CLOSED_BETA'
    >();
    new AuthenticationError('EMAIL_ALREADY_USED');
    new AuthenticationError('EMAIL_ALREADY_USED', { metadata: { provider: 'GOOGLE' } });
    new AuthenticationError('ACCOUNT_BANNED', { metadata: { until: '2026-12-31' } });
    new AuthenticationError('CLOSED_BETA', { message: 'Invitation only' });
    // @ts-expect-error not a declared reason
    new AuthenticationError('NOT_A_REASON');
    // @ts-expect-error ACCOUNT_BANNED needs its metadata
    new AuthenticationError('ACCOUNT_BANNED');
    // @ts-expect-error not a field of EMAIL_ALREADY_USED's metadata
    new AuthenticationError('EMAIL_ALREADY_USED', { metadata: { other: 'x' } });
    // @ts-expect-error metadata values are strings
    new AuthenticationError('ACCOUNT_BANNED', { metadata: { until: 1 } });
  });
});
