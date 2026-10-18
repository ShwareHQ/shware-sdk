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
 * Email registry: every entry is an `emailTemplate({...})`, sent as
 * `email.<name>` and identified by its own `id`. Every template a workflow
 * sends has to be here — the project compile (the studio's and the Worker's)
 * fails on a message whose template is not registered, naming the workflow
 * and the node.
 */
export const email = {
  upgradeRecovery,
  firstTimeRecovery,
  limitedTimeOffer,
  onboardingWelcome,
  onboardingGettingStarted,
  onboardingProTips,
  eduTemplates,
  eduCollaboration,
  eduWhiteboards,
  eduIntegrations,
  eduAutomations,
  eduApi,
  eduMobile,
  eduPublishing,
  reengageMissYou,
  reengageProductHighlights,
  reengageIncentive,
  winbackProOffer,
  winbackFreeTips,
  winbackFinalOffer,
} as const;
