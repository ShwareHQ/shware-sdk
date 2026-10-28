import { emailTemplate } from '@shware/workflow';
import * as z from 'zod/mini';
import { Message } from './layout';
import { senders } from './senders';

export default emailTemplate({
  id: 'winback_final_offer',
  topic: 'offers',
  from: senders.hello,
  replyTo: senders.support,
  title: 'Winback · Final offer',
  description: 'Last touch of the win-back flow, paired with the lock-screen push.',
  props: z.strictObject({ coupon: z.string(), expiresIn: z.string() }),
  subject: 'Last call on your 20% code',
  preview: { coupon: 'COMEBACK20', expiresIn: '72 hours' },
  component: ({ coupon, expiresIn }) => (
    <Message
      preheader="The code expires soon"
      heading="Last call"
      body={`${coupon} takes 20% off for a year, and it expires in ${expiresIn}. After that this flow stops emailing you.`}
      cta={{ label: 'Use the code', href: 'https://example.com/billing' }}
    />
  ),
});
