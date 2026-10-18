import { exists, flow, gt, not, trigger, workflow } from '@shware/workflow';
import { discord } from '../discord';
import { email } from '../email';
import { push } from '../push';
import { e, u } from './schema';
import { activated, activeSubscriber } from './segments';

/** The entry gate lives on the trigger (customer.io's trigger Filters): signed up *and* has an email. */
const signedUp = trigger.event(e.sign_up, { filter: exists(u.email) });

/** An anonymous reusable condition is just a const: reused in code, but absent from the segment sidebar. */
const powerUser = gt(u.docs_count, 100);

/**
 * Nested branches: an arm is a full FlowBuilder, so it can .branch() again.
 * Convention: anything deeper than one level is pulled out into a named
 * fragment like this one, keeping every expression shallow.
 */
const subscriberSplit = flow((w) =>
  w.branch([powerUser, (w) => w.email(email.onboardingProTips)], (w) =>
    w.email(email.onboardingGettingStarted)
  )
);

/**
 * Onboarding: a tour of the remaining primitives — waitUntil / timeWindow /
 * multi-arm branch / cohort — plus inline conditions (no need to name a
 * segment first; write the expression at the use site).
 */
export const onboarding = workflow({
  id: 'onboarding',
  name: 'Onboarding · Core',
  trigger: signedUp,
})
  // The community hears about a sign-up too: a channel post reaches people the inbox does not.
  .discord(discord.communityWelcome)
  .waitUntil(activated, { timeout: '3 days', onTimeout: 'continue' })
  // Timed out without a first document: a lock-screen nudge; the activated skip straight past
  .branch([not(activated), (w) => w.push(push.firstDoc)])
  .timeWindow({
    days: ['mon', 'tue', 'wed', 'thu', 'fri'],
    between: ['09:00', '17:00'],
    tz: 'user',
  })
  .branch(
    [activeSubscriber, subscriberSplit], // nested branch inside an arm, kept shallow as a fragment
    (w) => w.email(email.onboardingGettingStarted)
  )
  .cohort({
    control: { weight: 50 },
    variant: { weight: 50, flow: (w) => w.delay('3 days').email(email.onboardingProTips) },
  });
