/**
 * Legacy Meta Conversions API sender built on `facebook-nodejs-business-sdk`. It lives in its
 * own entry so that importing `@shware/analytics/server` never drags the 31MB SDK into a
 * serverless bundle; `sendMetaEvents` from the main server entry is the drop-in successor.
 */
export { sendEvents as sendMetaEvents } from './meta-conversions-api';
