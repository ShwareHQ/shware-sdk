import { type SubFlow, not, trigger, workflow } from '@shware/workflow';
import { discord } from '../discord';
import { email } from '../email';
import { e } from './schema';
import {
  newUsers7d,
  usedApi,
  usedAutomations,
  usedCollaboration,
  usedIntegrations,
  usedMobile,
  usedPublishing,
  usedTemplates,
  usedWhiteboards,
} from './segments';

/**
 * Onboarding education series (a feature-adoption drip).
 *
 * Shape: triggered by login (new users only, first entry only) -> Welcome ->
 * one educational email a week, each sent only to people who have not used the
 * matching feature yet; everyone else skips straight past and rejoins at the
 * next module.
 * The same flow on a UI canvas runs to roughly 40 nodes: eight
 * branch + email + delay groups plus their rejoin edges.
 */

/* --------------------------------- Trigger ---------------------------------- */

/** Login puts a user in, with the filter holding back existing ones. TODO: first-entry-only, once options support a re-entry policy. */
const login = trigger.event(e.login, { filter: newUsers7d });

/* -------------------------------- Templates --------------------------------- */

const welcome = email.onboardingWelcome;
/** The series ends in the community server rather than with a ninth email. */
const graduation = discord.communitySeriesGraduation;

const edu = {
  templates: email.eduTemplates,
  collaboration: email.eduCollaboration,
  whiteboards: email.eduWhiteboards,
  integrations: email.eduIntegrations,
  automations: email.eduAutomations,
  api: email.eduApi,
  mobile: email.eduMobile,
  publishing: email.eduPublishing,
};

/** One education module: send the email, wait a week, then rejoin for the next module. */
const eduModule =
  (template: (typeof edu)[keyof typeof edu]): SubFlow =>
  (w) =>
    w.email(template).delay('1 week');

/* -------------------------------- workflow -------------------------------- */

export const onboardingEdu = workflow({
  id: 'onboarding_edu',
  name: 'Onboarding · Education Series',
  trigger: login,
})
  .email(welcome)
  .delay('1 week')
  .branch([not(usedTemplates), eduModule(edu.templates)])
  .branch([not(usedCollaboration), eduModule(edu.collaboration)])
  .branch([not(usedWhiteboards), eduModule(edu.whiteboards)])
  .branch([not(usedIntegrations), eduModule(edu.integrations)])
  .branch([not(usedAutomations), eduModule(edu.automations)])
  .branch([not(usedApi), eduModule(edu.api)])
  .branch([not(usedMobile), eduModule(edu.mobile)])
  .branch([not(usedPublishing), eduModule(edu.publishing)])
  .discord(graduation);
