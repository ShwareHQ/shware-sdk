import { eq, trigger, workflow } from '@shware/workflow';
import { email } from '../email';
import { push } from '../push';
import { slack } from '../slack';
import { e, u } from './schema';
import { purchaser } from './segments';

/**
 * Subscription winback.
 *
 * A tour of branch shapes: multi-arm first-match tiered by plan, .exit() inside
 * an arm (terminate without rejoining), a bare tail argument as the default
 * arm, and a post-branch rejoin that only the non-exiting arms reach.
 */

/* --------------------------------- Templates -------------------------------- */

const csAlert = slack.csChurnAlert;

const proWinback = email.winbackProOffer;
const freeWinback = email.winbackFreeTips;
const finalOffer = email.winbackFinalOffer;
/** Same last call on the lock screen — the push mirrors the email's props. */
const finalOfferPush = push.finalOffer;

/* -------------------------------- workflow -------------------------------- */

export const winback = workflow({
  id: 'winback',
  name: 'Winback',
  trigger: trigger.event(e.subscription_cancelled),
  goal: purchaser, // paying again is the conversion; exits on match by default
})
  .delay('1 day') // a cooling-off period rather than reaching out mid-frustration
  .branch(
    'plan_split',
    // Business customers go to a human, and the flow ends here — exit, no rejoin
    [
      eq(u.subscription_plan, 'business'),
      (w) => w.slack(csAlert, { plan: u.subscription_plan }).exit('handed_to_cs'),
    ],
    // Pro: an automated winback offer
    [eq(u.subscription_plan, 'pro'), (w) => w.email(proWinback)],
    // Everyone else (downgraded to free, …): content marketing
    (w) => w.email(freeWinback)
  )
  // Rejoined tail: pro and the default arm arrive here; business already exited
  .delay('7 days')
  .email(finalOffer, { coupon: 'COMEBACK20', expiresIn: '72 hours' })
  .push(finalOfferPush, { coupon: 'COMEBACK20', expiresIn: '72 hours' });
