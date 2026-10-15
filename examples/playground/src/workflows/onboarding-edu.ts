import { type SubFlow, type TemplateRef, not, template, trigger, workflow } from '@shware/workflow';
import { t } from '../templates';
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

const welcome = t.email.onboarding_welcome;
/** The series ends in the community server rather than with a ninth email. */
const graduation = template.discord('community_series_graduation');

const edu = {
  templates: t.email.edu_templates,
  collaboration: t.email.edu_collaboration,
  whiteboards: t.email.edu_whiteboards,
  integrations: t.email.edu_integrations,
  automations: t.email.edu_automations,
  api: t.email.edu_api,
  mobile: t.email.edu_mobile,
  publishing: t.email.edu_publishing,
};

/** One education module: send the email, wait a week, then rejoin for the next module. */
const eduModule =
  (template: TemplateRef<'email'>): SubFlow =>
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
