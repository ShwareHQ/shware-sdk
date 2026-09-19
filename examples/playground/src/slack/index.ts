import * as csChurnAlert from './cs-churn-alert';

/**
 * Slack registry: keys map one-to-one onto the DSL's template.slack(key), the
 * same contract as the emails and pushes indexes. The studio previews each
 * entry as a message in a Slack channel.
 */
export const slack = {
  cs_churn_alert: csChurnAlert,
} as const;

export type Slack = typeof slack;
