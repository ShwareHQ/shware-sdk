import { emailTemplate } from '@shware/workflow';
import * as z from 'zod/mini';
import { Message } from './layout';
import { senders } from './senders';

export default emailTemplate({
  id: 'reengage_incentive',
  from: senders.hello,
  replyTo: senders.support,
  title: 'Re-engagement · Incentive',
  description: 'The A/B variant arm: the same nudge, with a discount attached.',
  props: z.strictObject({ coupon: z.string() }),
  subject: 'A discount, if that is what is missing',
  preview: { coupon: 'WELCOMEBACK15' },
  component: ({ coupon }) => (
    <Message
      preheader="15% off, no expiry games"
      heading="15% off, if that helps"
      body={`Use ${coupon} on any plan. We would rather you came back for the product, but if price is the blocker, this removes it.`}
      cta={{ label: 'Claim the discount', href: 'https://example.com/billing' }}
    />
  ),
});
