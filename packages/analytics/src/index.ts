export { setupAnalytics } from './setup/index';
export { track, trackAsync } from './track/index';
export { getVisitor, setVisitor } from './visitor/index';
export { sendFeedback } from './feedback/index';
export { createLink, getLink, type Link } from './link/index';
export {
  ALL_PLATFORMS,
  ALL_ENVIRONMENTS,
  createTrackEventSchemaV1,
  createTrackEventSchema,
  createVisitorSchema,
  updateVisitorSchema,
  createFeedbackSchema,
  createLinkSchema,
  type CreateFeedbackDTO,
  type CreateLinkDTO,
} from './schema/index';
export { stripeMinorUnits } from './utils/stripe';

export type {
  Platform,
  Environment,
  TrackTags,
  TrackProperties,
  AllowedPropertyValues,
  UserProvidedData,
} from './track/types';
export type { VisitorProperties } from './visitor/types';
