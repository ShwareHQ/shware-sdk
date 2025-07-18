export { setupAnalytics } from './setup/index';
export { track, trackAsync } from './track/index';
export { getVisitor, setVisitor, setUserId } from './visitor/index';
export { sendFeedback } from './feedback/index';
export { createLink, getLink, type Link } from './link/index';
export {
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
  TrackProperties,
  TrackTags,
  AllowedPropertyValues,
  UserProvidedData,
} from './track/types';
export type { VisitorProperties } from './visitor/types';
