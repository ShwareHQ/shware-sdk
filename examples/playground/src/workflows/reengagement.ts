import { not, performed, segment, trigger, workflow } from '@shware/workflow';
import { t } from '../templates';
import { e, u } from './schema';

/**
 * Re-engaging dormant users.
 *
 * What this one shows: a segment-entry trigger (not an event trigger),
 * waitUntil for the user to come back, a single-arm branch whose arm exits,
 * and a cohort A/B that tests whether the incentive is needed at all.
 */

/* --------------------------- Triggers and conditions -------------------------- */

/** No login for 30 days — a segment-entry trigger fires the moment a user goes from active to dormant. */
export const inactive30d = segment({
  id: 'inactive_30d',
  condition: not(performed(e.login, { within: '30 days' })),
});

/** Came back = logged in within the last 7 days. */
const cameBack = performed(e.login, { within: '7 days' });

/* -------------------------------- workflow -------------------------------- */
/** Cheapest channel first: a push nudge before any email lands in the inbox. */
export const reengagement = workflow({
  id: 'reengagement',
  name: 'Re-engagement',
  trigger: trigger.segment(inactive30d),
})
  .push(t.push.reengage_comeback_push, { name: u.name })
  .delay('1 day') // give the push a day to work before falling back to email
  .email(t.email.reengage_miss_you)
  .waitUntil(cameBack, { timeout: '7 days', onTimeout: 'continue' }) // wait a week at most
  .branch([cameBack, (w) => w.exit('reengaged')]) // back already: done. Still gone: carry on down the main line
  .email(t.email.reengage_product_highlights)
  .delay('7 days')
  .branch([
    not(cameBack),
    // Only the still-dormant reach the A/B: the control arm tests whether the coupon is needed at all
    (w) =>
      w.cohort({
        control: { weight: 50 },
        coupon: {
          weight: 50,
          flow: (x) => x.email(t.email.reengage_incentive, { coupon: 'WELCOMEBACK15' }),
        },
      }),
  ]);
