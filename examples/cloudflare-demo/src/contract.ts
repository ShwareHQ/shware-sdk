import { defineContract, templatesFor } from '@shware/workflow';
import * as z from 'zod/mini';

/**
 * The demo's contract: its events and profile, and the one topic its offer emails belong to
 * (the welcome is transactional). The Worker validates ingest against it, and
 * `JourneyClient.setSubscriptions` is typed by it.
 */
export const contract = defineContract({
  events: {
    demo_signup: z.looseObject({}),
    demo_click: z.looseObject({}),
    demo_purchase: z.looseObject({ value: z.number() }),
  },
  profile: z.strictObject({ email: z.string(), plan: z.string() }),
  subscriptions: { topics: ['offers'] },
});

/** The template factories bound to the contract: a topic it does not declare fails at the template. */
export const { emailTemplate } = templatesFor(contract);
