import { trigger, workflow } from '@shware/workflow';
import { t } from '../templates';
import { activeSubscriber } from './segments';

/** Scheduled trigger: a holiday promo for active subscribers only. Segment and webhook triggers work the same way. */
export const christmasPromo = workflow({
  id: 'christmas_promo',
  name: 'Christmas Promo',
  trigger: trigger.date('2026-12-25 09:00:00'),
})
  .filter(activeSubscriber)
  .push(t.push.christmas_promo_push, { coupon: 'XMAS25' })
  .email(t.email.n2_limited_time_offer, { coupon: 'XMAS25', expiresIn: '72 hours' });
