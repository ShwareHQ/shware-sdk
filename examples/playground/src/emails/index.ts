import type { ReactElement } from 'react';
import * as firstTimeRecovery from './first-time-recovery';
import * as limitedTimeOffer from './limited-time-offer';
import * as onboardingWelcome from './onboarding-welcome';
import * as upgradeRecovery from './upgrade-recovery';

/**
 * Email registry: keys map one-to-one onto the DSL's template.email(key).
 * Only four are registered here — checkout recovery plus welcome. Every other
 * key shows up as "no content" on the template page, which is precisely the
 * audit signal for "a flow references this but nobody has written it yet".
 */
export const emails = {
  u1_upgrade_recovery: upgradeRecovery,
  n1_first_time_recovery: firstTimeRecovery,
  n2_limited_time_offer: limitedTimeOffer,
  onboarding_welcome: onboardingWelcome,
} as const;

export type Emails = typeof emails;

/**
 * Shape of one template module: a default-exported component plus optional
 * subject / preview props. `never` sits in the contravariant position so any
 * props shape is accepted.
 */
export interface EmailModule {
  default: (props: never) => ReactElement;
  subject?: (props: never) => string;
  preview?: object;
}

/** Look a module up by key; unregistered keys return undefined, and the type says so. */
export const emailModules: Record<string, EmailModule | undefined> = emails;
