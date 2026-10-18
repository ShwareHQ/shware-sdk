import { discordTemplate } from '@shware/workflow';
import * as z from 'zod/mini';

/** The community server's webhook: a secret, so the Worker's environment holds it. */
interface Env {
  WEBHOOK_DISCORD_COMMUNITY?: string;
}

const communityWelcome = discordTemplate({
  id: 'community_welcome',
  title: 'Community · Welcome',
  props: z.strictObject({}),
  preview: {},
  webhook: (env: Env) => env.WEBHOOK_DISCORD_COMMUNITY,
  content: () => ({ content: 'Someone new just joined — say hi in #introductions 👋' }),
});

const communitySeriesGraduation = discordTemplate({
  id: 'community_series_graduation',
  title: 'Community · Education series graduate',
  props: z.strictObject({}),
  preview: {},
  webhook: (env: Env) => env.WEBHOOK_DISCORD_COMMUNITY,
  content: () => ({ content: 'Another member finished the education series 🎓' }),
});

/** Discord registry: posts to the community server, previewed in the studio as Discord draws them. */
export const discord = { communityWelcome, communitySeriesGraduation };
