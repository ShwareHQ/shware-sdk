export {
  sendEvents as sendMetaEvents,
  metaConversions,
  getCapiEvent,
  type CapiEvent,
  type MetaConversionsOptions,
  type MetaConversionsResponse,
} from './meta-capi';
export { sendEvents as sendRedditEvents, redditConversions } from './reddit-conversions-api';
export { sendEvents as sendLinkedinEvents, linkedinConversions } from './linkedin-conversions-api';
export { sendEvents as sendOpenAIEvents, openaiConversions } from './openai-conversions-api';
export {
  sendEvents as sendGoogleAdsEvents,
  googleAdsConversions,
  getDataManagerEvent,
  normalizeEmail,
  type DataManagerEvent,
  type DataManagerResponse,
  type GoogleAdsActionType,
  type GoogleAdsAuth,
  type GoogleAdsConsent,
  type GoogleAdsConversionConfig,
  type GoogleAdsConversionsOptions,
} from './google-data-manager';

export {
  sendEvents as sendMicrosoftEvents,
  microsoftConversions,
  getServerEvent as getMicrosoftEvent,
  normalizeEmail as normalizeMicrosoftEmail,
  type MicrosoftEvent,
  type MicrosoftUserData,
  type MicrosoftCustomData,
  type MicrosoftConversionsOptions,
  type MicrosoftEventOptions,
  type MicrosoftConversionsResponse,
  type MicrosoftValidationDetail,
} from './microsoft-conversions-api';

export { ConversionsApiError } from './conversions-api-error';
export {
  setupConversions,
  conversionDestination,
  type ConversionDestination,
  type ConversionUser,
  type ConversionsOptions,
  type ServerEvent,
} from './setup-conversions';

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
