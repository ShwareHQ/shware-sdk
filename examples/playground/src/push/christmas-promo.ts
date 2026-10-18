import { pushTemplate } from '@shware/workflow';
import * as z from 'zod/mini';

/**
 * The holiday promo on the lock screen, ahead of the email. The coupon is a
 * prop the workflow supplies, so the same content serves any code.
 */
export default pushTemplate({
  id: 'christmas_promo_push',
  title: 'Christmas · 25% off',
  description: 'Holiday discount push for active subscribers, paired with the offer email.',
  props: z.strictObject({ coupon: z.string() }),
  preview: { coupon: 'XMAS25' },
  content: ({ coupon }) => ({
    title: `🎄 ${coupon}: 25% off for the holidays`,
    body: 'A little gift for subscribers — the code is applied at checkout until Boxing Day.',
  }),
});
