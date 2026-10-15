import eduApi from './edu-api';
import eduAutomations from './edu-automations';
import eduCollaboration from './edu-collaboration';
import eduIntegrations from './edu-integrations';
import eduMobile from './edu-mobile';
import eduPublishing from './edu-publishing';
import eduTemplates from './edu-templates';
import eduWhiteboards from './edu-whiteboards';
import firstTimeRecovery from './first-time-recovery';
import limitedTimeOffer from './limited-time-offer';
import onboardingGettingStarted from './onboarding-getting-started';
import onboardingProTips from './onboarding-pro-tips';
import onboardingWelcome from './onboarding-welcome';
import reengageIncentive from './reengage-incentive';
import reengageMissYou from './reengage-miss-you';
import reengageProductHighlights from './reengage-product-highlights';
import upgradeRecovery from './upgrade-recovery';
import winbackFinalOffer from './winback-final-offer';
import winbackFreeTips from './winback-free-tips';
import winbackProOffer from './winback-pro-offer';

/**
 * Email registry: every entry is an `emailTemplate({...})`, and its key is the
 * DSL's `t.email.<key>` (src/templates.ts derives the references from here).
 * Every key a workflow references has to be here — the project compile (the
 * studio's and the Worker's) fails on a message whose template is not
 * registered, naming the workflow and the node.
 */
export const email = {
  u1_upgrade_recovery: upgradeRecovery,
  n1_first_time_recovery: firstTimeRecovery,
  n2_limited_time_offer: limitedTimeOffer,
  onboarding_welcome: onboardingWelcome,
  onboarding_getting_started: onboardingGettingStarted,
  onboarding_pro_tips: onboardingProTips,
  edu_templates: eduTemplates,
  edu_collaboration: eduCollaboration,
  edu_whiteboards: eduWhiteboards,
  edu_integrations: eduIntegrations,
  edu_automations: eduAutomations,
  edu_api: eduApi,
  edu_mobile: eduMobile,
  edu_publishing: eduPublishing,
  reengage_miss_you: reengageMissYou,
  reengage_product_highlights: reengageProductHighlights,
  reengage_incentive: reengageIncentive,
  winback_pro_offer: winbackProOffer,
  winback_free_tips: winbackFreeTips,
  winback_final_offer: winbackFinalOffer,
} as const;
