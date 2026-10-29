import { describe, expect, it } from 'vitest';
import { appStorePurchaseSchema, appStoreSyncSchema } from '../schema';

describe('appStorePurchaseSchema', () => {
  it('defaults the environment to Production and keeps the signed transaction optional', () => {
    expect(appStorePurchaseSchema.parse({ transactionId: '2000000123' })).toEqual({
      transactionId: '2000000123',
      environment: 'Production',
    });
    expect(
      appStorePurchaseSchema.parse({
        transactionId: '1',
        environment: 'Xcode',
        signedTransaction: 'ey.x.y',
      })
    ).toMatchObject({ environment: 'Xcode', signedTransaction: 'ey.x.y' });
  });

  it('refuses an environment Apple does not have, and a missing id', () => {
    expect(
      appStorePurchaseSchema.safeParse({ transactionId: '1', environment: 'Staging' }).success
    ).toBe(false);
    expect(appStorePurchaseSchema.safeParse({}).success).toBe(false);
  });
});

describe('appStoreSyncSchema', () => {
  it('defaults the environment to Production', () => {
    expect(appStoreSyncSchema.parse({})).toEqual({ environment: 'Production' });
    expect(appStoreSyncSchema.parse({ environment: 'Sandbox' })).toEqual({
      environment: 'Sandbox',
    });
  });
});
