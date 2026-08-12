import { not, performed, segment, template, trigger, workflow } from '@shware/workflow';
import { e } from '../schema';

/**
 * Re-engaging dormant users.
 *
 * What this one shows: a segment-entry trigger (not an event trigger),
 * waitUntil for the user to come back, a single-arm branch whose arm exits,
 * and a cohort A/B that tests whether the incentive is needed at all.
 */

/* --------------------------- Triggers and conditions -------------------------- */

/** No login for 30 days — a segment-entry trigger fires the moment a user goes from active to dormant. */
const inactive30d = segment('inactive_30d', not(performed(e.login, { within: '30 days' })));

/** Came back = logged in within the last 7 days. */
const cameBack = performed(e.login, { within: '7 days' });

/* --------------------------------- Templates -------------------------------- */

const missYou = template.email('reengage_miss_you');
const highlights = template.email('reengage_product_highlights');
const incentive = template.email<{ coupon: string }>('reengage_incentive');

/* -------------------------------- workflow -------------------------------- */

export const reengagement = workflow('reengagement', {
  trigger: trigger.segment(inactive30d),
})
  .email(missYou)
  .waitUntil(cameBack, { timeout: '7 days', onTimeout: 'continue' }) // wait a week at most
  .branch([cameBack, (w) => w.exit('reengaged')]) // back already: done. Still gone: carry on down the main line
  .email(highlights)
  .delay('7 days')
  .branch([
    not(cameBack),
    // Only the still-dormant reach the A/B: the control arm tests whether the coupon is needed at all
    (w) =>
      w.cohort({
        control: { weight: 50 },
        coupon: { weight: 50, flow: (x) => x.email(incentive, { coupon: 'WELCOMEBACK15' }) },
      }),
  ]);
