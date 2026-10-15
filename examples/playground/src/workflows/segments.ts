import { and, eq, performed, segment } from '@shware/workflow';
import { e, u } from './schema';

/**
 * Segments: named condition expressions in drizzle style — predicates,
 * combinators and reference tables. Types flow in from the u.xxx / e.xxx
 * references, so property names, values and operator applicability are all
 * checked at compile time.
 */

/** Active subscriber: subscription_status = 'active' and auto_renew_enabled = true. */
export const activeSubscriber = segment({
  id: 'active_subscriber',
  name: 'Saved · Auto-renew Restored',
  description:
    'Subscription is still ACTIVE and auto-renew is back on — the conversion goal of the pre-churn save flow.',
  condition: and(eq(u.subscription_status, 'active'), eq(u.auto_renew_enabled, true)),
});

/** Purchased within 30 days — the goal of the checkout recovery flow. */
export const purchaser = segment({
  id: 'purchaser',
  name: 'Purchased (last 30d)',
  condition: performed(e.purchase, { within: '30 days' }),
});

/** Activated: created a first document after signing up. */
export const activated = segment({
  id: 'activated',
  name: 'Activated',
  condition: performed(e.doc_created),
});

/** New users (signed up within 7 days) — onboarding's entry gate. */
export const newUsers7d = segment({
  id: 'new_users_7d',
  name: 'New Users (7d)',
  condition: performed(e.sign_up, { within: '7 days' }),
});

/* ---- Feature-usage segments driving the onboarding series (customer.io's "Used X") ---- */

export const usedTemplates = segment({
  id: 'used_templates',
  condition: performed(e.template_used),
});
/** Collaboration counts only when a teammate was invited *and* a comment was posted. */
export const usedCollaboration = segment({
  id: 'used_collaboration',
  condition: and(performed(e.teammate_invited), performed(e.comment_added)),
});
export const usedWhiteboards = segment({
  id: 'used_whiteboards',
  condition: performed(e.whiteboard_created),
});
export const usedIntegrations = segment({
  id: 'used_integrations',
  condition: performed(e.integration_connected),
});
export const usedAutomations = segment({
  id: 'used_automations',
  condition: performed(e.automation_created),
});
export const usedApi = segment({ id: 'used_api', condition: performed(e.api_key_created) });
export const usedMobile = segment({ id: 'used_mobile', condition: performed(e.mobile_app_opened) });
export const usedPublishing = segment({
  id: 'used_publishing',
  condition: performed(e.doc_published),
});
