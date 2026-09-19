import * as eduApi from './edu-api';
import * as eduAutomations from './edu-automations';
import * as eduCollaboration from './edu-collaboration';
import * as eduIntegrations from './edu-integrations';
import * as eduMobile from './edu-mobile';
import * as eduTemplates from './edu-templates';
import * as eduWhiteboards from './edu-whiteboards';
import * as firstTimeRecovery from './first-time-recovery';
import * as limitedTimeOffer from './limited-time-offer';
import * as onboardingGettingStarted from './onboarding-getting-started';
import * as onboardingProTips from './onboarding-pro-tips';
import * as onboardingWelcome from './onboarding-welcome';
import * as reengageIncentive from './reengage-incentive';
import * as reengageMissYou from './reengage-miss-you';
import * as reengageProductHighlights from './reengage-product-highlights';
import * as upgradeRecovery from './upgrade-recovery';
import * as winbackFinalOffer from './winback-final-offer';
import * as winbackFreeTips from './winback-free-tips';
import * as winbackProOffer from './winback-pro-offer';

/**
 * Email registry: keys map one-to-one onto the DSL's template.email(key).
 *
 * One key the workflows reference is deliberately absent — `edu_publishing`,
 * the last module of the education series. The template page shows it as "no
 * content", which is exactly the audit signal this registry exists to give:
 * a flow references it, nobody has written it yet. Keeping one shows the
 * state; keeping fifteen only showed that the demo was unfinished.
 */
export const emails = {
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
  /* edu_publishing: intentionally unregistered — see the note above. */
  reengage_miss_you: reengageMissYou,
  reengage_product_highlights: reengageProductHighlights,
  reengage_incentive: reengageIncentive,
  winback_pro_offer: winbackProOffer,
  winback_free_tips: winbackFreeTips,
  winback_final_offer: winbackFinalOffer,
} as const;

export type Emails = typeof emails;
