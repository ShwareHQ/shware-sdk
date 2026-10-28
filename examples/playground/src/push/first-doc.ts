import * as z from 'zod/mini';
import { pushTemplate } from '../workflows/schema';

/**
 * Onboarding's activation nudge: only the sign-ups who still have no document
 * when the three-day wait runs out get it — a branch in the flow, not a
 * condition in the content.
 */
export default pushTemplate({
  id: 'onboarding_first_doc_push',
  topic: 'tips',
  title: 'Onboarding · First doc',
  description: 'For new users three days in without a single document.',
  props: z.strictObject({}),
  preview: {},
  content: () => ({
    title: 'Start with a blank page',
    body: 'Your workspace is ready. Create your first doc — it takes less than a minute.',
  }),
});
