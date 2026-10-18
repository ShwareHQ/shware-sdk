import { trigger, workflow } from '@shware/workflow';
import { email } from '../email';
import { push } from '../push';
import { activeSubscriber } from './segments';

/** Scheduled trigger: a holiday promo for active subscribers only. Segment and webhook triggers work the same way. */
export const christmasPromo = workflow({
  id: 'christmas_promo',
  name: 'Christmas Promo',
  trigger: trigger.date('2026-12-25 09:00:00'),
})
  .filter(activeSubscriber)
  .push(push.christmasPromo, { coupon: 'XMAS25' })
  .email(email.limitedTimeOffer, { coupon: 'XMAS25', expiresIn: '72 hours' });
