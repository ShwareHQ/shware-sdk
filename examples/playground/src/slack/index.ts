import { slackTemplate } from '@shware/workflow';
import * as z from 'zod/mini';

/** Internal Slack ping for the customer success team — message channels are not only for end users. */
const csChurnAlert = slackTemplate({
  id: 'cs_churn_alert',
  title: 'CS · Churn alert',
  props: z.strictObject({ plan: z.enum(['free', 'pro', 'business']) }),
  preview: { plan: 'pro' },
  webhook: (env: { WEBHOOK_SLACK_CS?: string }) => env.WEBHOOK_SLACK_CS,
  content: ({ plan }) => ({ text: `A ${plan} subscriber cancelled and did not come back` }),
});

/** Slack registry: the team's own alerts. */
export const slack = { csChurnAlert };
