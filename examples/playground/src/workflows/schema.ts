import { event, user } from '@shware/workflow';

/**
 * App-side schema: the type definitions for events and user properties.
 * Eventually this should be generated from (or imported out of) the analytics
 * tracking schema; for now it is a hand-written sample.
 * Sample product: a collaborative docs workspace, the Notion/Linear kind of SaaS.
 */

type Empty = Record<never, never>;

export interface Event {
  login: Empty;
  sign_up: { method: 'google' | 'apple' | 'email' };
  begin_checkout: { plan: 'pro' | 'business'; seats: number };
  purchase: { value: number; currency: string };
  subscription_cancelled: { reason: 'too_expensive' | 'not_useful' | 'missing_features' | 'other' };

  /* Feature-usage events: what the onboarding education series keys off. */
  doc_created: Empty;
  template_used: Empty;
  teammate_invited: Empty;
  comment_added: Empty;
  whiteboard_created: Empty;
  integration_connected: { provider: 'slack' | 'github' | 'figma' | 'google_drive' };
  automation_created: Empty;
  api_key_created: Empty;
  mobile_app_opened: Empty;
  doc_published: Empty;

  /** Workflow-emitted event: the activation nudge came due (no payload). */
  activation_nudge_due: Empty;
}

export interface UserProperty {
  userId: string;
  email: string;
  subscription_status: 'active' | 'none';
  subscription_plan: 'free' | 'pro' | 'business';
  auto_renew_enabled: boolean;
  docs_count: number;
}

/** Reference tables: the DSL's only two type injection points (drizzle's table objects). */
export const u = user<UserProperty>();
export const e = event<Event>();
