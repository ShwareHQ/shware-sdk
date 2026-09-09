export {
  sendEvents as sendMetaEvents,
  getCapiEvent,
  type CapiEvent,
  type MetaConversionsOptions,
  type MetaConversionsResponse,
} from './meta-capi';
export { sendEvents as sendRedditEvents } from './reddit-conversions-api';
export { sendEvents as sendLinkedinEvents } from './linkedin-conversions-api';
export { sendEvents as sendOpenAIEvents } from './openai-conversions-api';
export {
  sendEvents as sendGoogleAdsEvents,
  getDataManagerEvent,
  normalizeEmail,
  type DataManagerEvent,
  type DataManagerResponse,
  type GoogleAdsAuth,
  type GoogleAdsConsent,
  type GoogleAdsConversionConfig,
  type GoogleAdsConversionsOptions,
} from './google-data-manager';

export {
  sendEvents as sendMicrosoftEvents,
  getServerEvent as getMicrosoftEvent,
  normalizeEmail as normalizeMicrosoftEmail,
  type MicrosoftEvent,
  type MicrosoftUserData,
  type MicrosoftCustomData,
  type MicrosoftConversionsOptions,
  type MicrosoftConversionsResponse,
  type MicrosoftValidationDetail,
} from './microsoft-conversions-api';

export type { LinkedinConversionConfig } from './linkedin-conversions-api';
export type { EventActionSource } from './action-source';

export {
  resolveClickIdCookies,
  toSetCookieHeaders,
  parseFbc,
  formatFbc,
  parseGcl,
  formatGcl,
  parseUetMsclkid,
  formatUetMsclkid,
  formatMsclkid,
  FBC_COOKIE,
  RDT_CID_COOKIE,
  GCL_AW_COOKIE,
  GCL_GB_COOKIE,
  UET_MSCLKID_COOKIE,
  type ResolveClickIdCookiesInput,
  type ResolveClickIdCookiesResult,
  type ParsedFbc,
  type ParsedGcl,
} from '../click-id/index';
