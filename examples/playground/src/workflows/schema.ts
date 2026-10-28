import { defineContract, templatesFor } from '@shware/workflow';
import * as z from 'zod/mini';

/**
 * The journey contract: the events journeys are written against and the
 * profile fields they read, as Zod schemas. The producer types `track` /
 * `identify` with it, the Worker validates every inbound event and patch
 * against it, and the DSL's `e.xxx` / `u.xxx` reference tables come from it.
 * Sample product: a collaborative docs workspace, the Notion/Linear kind of SaaS.
 */
export const contract = defineContract({
  events: {
    login: z.looseObject({}),
    sign_up: z.looseObject({ method: z.enum(['google', 'apple', 'email']) }),
    begin_checkout: z.looseObject({ plan: z.enum(['pro', 'business']), seats: z.number() }),
    purchase: z.looseObject({ value: z.number(), currency: z.string() }),
    subscription_cancelled: z.looseObject({
      reason: z.enum(['too_expensive', 'not_useful', 'missing_features', 'other']),
    }),

    /* Feature-usage events: what the onboarding education series keys off. */
    doc_created: z.looseObject({}),
    template_used: z.looseObject({}),
    teammate_invited: z.looseObject({}),
    comment_added: z.looseObject({}),
    whiteboard_created: z.looseObject({}),
    integration_connected: z.looseObject({
      provider: z.enum(['slack', 'github', 'figma', 'google_drive']),
    }),
    automation_created: z.looseObject({}),
    api_key_created: z.looseObject({}),
    mobile_app_opened: z.looseObject({}),
    doc_published: z.looseObject({}),

    /** Workflow-emitted event: the activation nudge came due (no payload). */
    activation_nudge_due: z.strictObject({}),
  },
  /**
   * The subscription topics, opted out of one at a time per channel: every journey email and
   * push names one (the welcome is transactional, and names none). Ids only — the preference
   * page labels them.
   */
  subscriptions: { topics: ['tips', 'offers', 'product_updates'] },
  profile: z.strictObject({
    email: z.string(),
    name: z.string(),
    subscription_status: z.enum(['active', 'none']),
    subscription_plan: z.enum(['free', 'pro', 'business']),
    auto_renew_enabled: z.boolean(),
    docs_count: z.number(),
  }),
});

/** Reference tables: `e.purchase`, `u.subscription_plan` (plus the system `u.userId`). */
export const e = contract.events;
export const u = contract.user;

/** The template factories bound to the contract: a topic it does not declare fails at the template. */
export const { emailTemplate, pushTemplate } = templatesFor(contract);
