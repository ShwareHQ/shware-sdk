import type { Environment } from '@apple/app-store-server-library';
import { _default, enum as _enum, object, optional, type output, string } from 'zod/mini';

/**
 * Apple's `Environment` values as strings, so a host's request schema needs no runtime import of
 * the App Store library (its enum is a string enum: the values are these, and assignable with a
 * cast where the library's type is wanted).
 */
export const APP_STORE_ENVIRONMENTS = [
  'Sandbox',
  'Production',
  'Xcode',
  'LocalTesting',
] as const satisfies readonly `${Environment}`[];
export type AppStoreEnvironment = (typeof APP_STORE_ENVIRONMENTS)[number];

/**
 * What an app sends to have a StoreKit 2 purchase verified. Only the transaction id is trusted,
 * and only as "which transaction to look at": the host fetches the transaction itself from the
 * App Store Server API. `environment` says where to ask, `Production` unless the app says
 * otherwise. `signedTransaction` is the JWS the app holds (expo-iap's `Purchase.purchaseToken`);
 * it is the only copy that exists for a StoreKit configuration file (`Xcode` / `LocalTesting`),
 * which has no server API behind it, and a host should read it for those environments alone.
 */
export const appStorePurchaseSchema = object({
  transactionId: string(),
  environment: _default(_enum(APP_STORE_ENVIRONMENTS), 'Production'),
  signedTransaction: optional(string()),
});
export type AppStorePurchase = output<typeof appStorePurchaseSchema>;

/** What an app sends to have its App Store subscriptions re-read (after the manage sheet). */
export const appStoreSyncSchema = object({
  environment: _default(_enum(APP_STORE_ENVIRONMENTS), 'Production'),
});
export type AppStoreSync = output<typeof appStoreSyncSchema>;
