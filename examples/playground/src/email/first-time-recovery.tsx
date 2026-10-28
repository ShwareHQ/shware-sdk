import { emailTemplate } from '@shware/workflow';
import * as z from 'zod/mini';
import { Cta, Heading, Paragraph, Shell } from './layout';
import { senders } from './senders';

export default emailTemplate({
  id: 'n1_first_time_recovery',
  topic: 'offers',
  from: senders.hello,
  replyTo: senders.support,
  title: 'Cart Recovery · First touch',
  props: z.strictObject({}),
  subject: 'Your workspace is waiting',
  preview: {},
  component: () => (
    <Shell preheader="Pick up where you left off">
      <Heading>Pick up where you left off</Heading>
      <Paragraph>
        Your checkout is still open. Plans are month-to-month, cancel anytime, and payment is
        handled by Stripe.
      </Paragraph>
      <Cta href="https://example.com/checkout">Resume checkout</Cta>
    </Shell>
  ),
});
