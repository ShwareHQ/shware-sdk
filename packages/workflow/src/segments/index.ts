import { and, eq, performed, segment } from '../dsl';
import { e, u } from '../schema';

/**
 * Segments: named condition expressions in drizzle style — predicates,
 * combinators and reference tables. Types flow in from the u.xxx / e.xxx
 * references, so property names, values and operator applicability are all
 * checked at compile time.
 */

/** Active subscriber: subscription_status = 'active' and auto_renew_enabled = true. */
export const activeSubscriber = segment(
  'active_subscriber',
  and(eq(u.subscription_status, 'active'), eq(u.auto_renew_enabled, true))
);

/** Purchased within 30 days — the goal of the checkout recovery flow. */
export const purchaser = segment('purchaser', performed(e.purchase, { within: '30 days' }));

/** Activated: created a first document after signing up. */
export const activated = segment('activated', performed(e.doc_created));

/** New users (signed up within 7 days) — onboarding's entry gate. */
export const newUsers7d = segment('new_users_7d', performed(e.sign_up, { within: '7 days' }));

/* ---- Feature-usage segments driving the onboarding series (customer.io's "Used X") ---- */

export const usedTemplates = segment('used_templates', performed(e.template_used));
/** Collaboration counts only when a teammate was invited *and* a comment was posted. */
export const usedCollaboration = segment(
  'used_collaboration',
  and(performed(e.teammate_invited), performed(e.comment_added))
);
export const usedWhiteboards = segment('used_whiteboards', performed(e.whiteboard_created));
export const usedIntegrations = segment('used_integrations', performed(e.integration_connected));
export const usedAutomations = segment('used_automations', performed(e.automation_created));
export const usedApi = segment('used_api', performed(e.api_key_created));
export const usedMobile = segment('used_mobile', performed(e.mobile_app_opened));
export const usedPublishing = segment('used_publishing', performed(e.doc_published));
