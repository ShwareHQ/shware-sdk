import { eq, template, trigger, workflow } from '@shware/workflow';
import { e, u } from '../schema';
import { purchaser } from '../segments';

/**
 * Subscription winback.
 *
 * A tour of branch shapes: multi-arm first-match tiered by plan, .exit() inside
 * an arm (terminate without rejoining), a bare tail argument as the default
 * arm, and a post-branch rejoin that only the non-exiting arms reach.
 */

/* --------------------------------- Templates -------------------------------- */

/** Internal Slack ping for the customer success team — message channels are not only for end users. */
const csAlert = template.slack<{ plan: 'free' | 'pro' | 'business' }>('cs_churn_alert');

const proWinback = template.email('winback_pro_offer');
const freeWinback = template.email('winback_free_tips');
const finalOffer = template.email<{ coupon: string; expiresIn: string }>('winback_final_offer');

/* -------------------------------- workflow -------------------------------- */

export const winback = workflow('winback', {
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
  .email(finalOffer, { coupon: 'COMEBACK20', expiresIn: '72 hours' });
