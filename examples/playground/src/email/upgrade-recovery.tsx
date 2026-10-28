import { emailTemplate } from '@shware/workflow';
import * as z from 'zod/mini';
import { Cta, FinePrint, Heading, Paragraph, Shell } from './layout';
import { senders } from './senders';

export default emailTemplate({
  id: 'u1_upgrade_recovery',
  topic: 'offers',
  from: senders.hello,
  replyTo: senders.support,
  title: 'Upgrade Recovery',
  props: z.strictObject({ plan: z.enum(['free', 'pro', 'business']) }),
  subject: 'Your upgrade is one click away',
  preview: { plan: 'business' },
  component: ({ plan }) => (
    <Shell preheader={`You still have work to do on your ${plan} upgrade`}>
      <Heading>Your {plan} upgrade is one click away</Heading>
      <Paragraph>
        {plan} unlocks unlimited docs, advanced permissions, and priority support for the whole
        workspace. Nothing has been charged yet.
      </Paragraph>
      <Cta href="https://example.com/billing">Complete upgrade</Cta>
      <FinePrint>Ran into a problem? Just reply to this email — a human reads every one.</FinePrint>
    </Shell>
  ),
});
