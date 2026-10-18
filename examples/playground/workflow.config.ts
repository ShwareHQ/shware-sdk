import { defineConfig } from '@shware/workflow';
import { templates } from './src/templates';
import {
  activationNudge,
  checkoutRecovery,
  christmasPromo,
  inactive30d,
  issueCoupon,
  onboarding,
  onboardingEdu,
  reengagement,
  winback,
} from './src/workflows';
import { contract } from './src/workflows/schema';
import {
  activated,
  activeSubscriber,
  newUsers7d,
  purchaser,
  usedApi,
  usedAutomations,
  usedCollaboration,
  usedIntegrations,
  usedMobile,
  usedPublishing,
  usedTemplates,
  usedWhiteboards,
} from './src/workflows/segments';

/**
 * The project — the one place its definitions are registered. The compiler
 * (`compileConfig`), the Worker and the Workflow Studio (`pnpm dev`) all read
 * this object: every workflow, segment, action and template is listed exactly
 * once, and a message referencing an unregistered template fails the compile.
 * The studio's numbers come from workflow.stats.ts, not from here.
 */
export default defineConfig({
  title: 'Workflow Studio · demo',
  contract,
  workflows: [
    checkoutRecovery,
    onboarding,
    onboardingEdu,
    christmasPromo,
    activationNudge,
    reengagement,
    winback,
  ],
  segments: [
    activeSubscriber,
    purchaser,
    activated,
    newUsers7d,
    usedTemplates,
    usedCollaboration,
    usedWhiteboards,
    usedIntegrations,
    usedAutomations,
    usedApi,
    usedMobile,
    usedPublishing,
    inactive30d,
  ],
  actions: [issueCoupon],
  templates,
  runtime: {
    development: { timeScale: 600, logMessages: true },
    production: { timeScale: 1, logMessages: false },
  },
});
