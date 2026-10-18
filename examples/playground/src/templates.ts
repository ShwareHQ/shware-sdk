import { discord } from './discord';
import { email } from './email';
import { push } from './push';
import { slack } from './slack';

/**
 * Every channel's templates, as workflow.config.ts registers them. The
 * workflows send the definitions themselves (`.email(email.onboardingWelcome)`,
 * imported from the channel's module), so each template's `props` schema types
 * its call; the IR, the Worker and the studio find each template by its own `id`.
 */
export const templates = { email, push, discord, slack };
