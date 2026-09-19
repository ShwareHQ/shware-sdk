import * as communityWelcome from './community-welcome';
import * as seriesGraduation from './series-graduation';

/**
 * Discord registry: keys map one-to-one onto the DSL's template.discord(key).
 * Slack and Discord keep separate registries because a key belongs to exactly
 * one channel — the same reason emails and pushes are not one map.
 */
export const discord = {
  community_welcome: communityWelcome,
  community_series_graduation: seriesGraduation,
} as const;

export type Discord = typeof discord;
