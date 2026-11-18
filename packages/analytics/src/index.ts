export { setupAnalytics } from './setup/index';
export { track, sendBeacon, sendPendingEvents } from './track/index';
export { trackOnce, type TrackOnceOptions } from './track/once';
export { IDENTIFY_EVENT, identify, reset, visitorId } from './visitor/index';
export { sendFeedback } from './feedback/index';
export { createLink, getLink, type Link } from './link/index';
export {
  ALL_PLATFORMS,
  ALL_ENVIRONMENTS,
  createTrackEventSchema,
  createVisitorSchema,
  updateVisitorSchema,
  createFeedbackSchema,
  createLinkSchema,
  type CreateTrackEventDTO,
  type CreateVisitorDTO,
  type UpdateVisitorDTO,
  type CreateFeedbackDTO,
  type CreateLinkDTO,
} from './schema/index';
export { BOT_CATEGORIES, NOT_A_BOT, botOf, type Bot, type BotCategory } from './bot/index';
export { stripeMinorUnits } from './utils/stripe';
export { useTrackImpression } from './hooks/use-track-impression';

export type {
  Platform,
  Environment,
  TrackTags,
  TrackProperties,
  CustomEventProperties,
  AnalyticsOptions,
  AllowedPropertyValues,
  UserProvidedData,
  UTMParams,
} from './track/types';
export type { VisitorProperties } from './visitor/types';
