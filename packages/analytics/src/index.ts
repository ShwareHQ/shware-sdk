export { setupAnalytics } from './setup/index';
export { track, trackAsync, sendBeacon, sendPendingEvents } from './track/index';
export { setVisitor, visitorId } from './visitor/index';
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
  AllowedPropertyValues,
  UserProvidedData,
  UTMParams,
} from './track/types';
export type { VisitorProperties } from './visitor/types';
