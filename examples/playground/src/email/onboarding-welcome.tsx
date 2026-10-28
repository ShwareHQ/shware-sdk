import { emailTemplate } from '@shware/workflow';
import * as z from 'zod/mini';
import { Cta, Heading, Paragraph, Shell } from './layout';
import { senders } from './senders';

export default emailTemplate({
  id: 'onboarding_welcome',
  transactional: true,
  from: senders.hello,
  replyTo: senders.support,
  title: 'Welcome · Day 0',
  description: 'First message after sign-up: one action, one promise about frequency.',
  props: z.strictObject({}),
  subject: 'Welcome aboard',
  preview: {},
  component: () => (
    <Shell preheader="Create your first doc in under a minute">
      <Heading>Welcome aboard</Heading>
      <Paragraph>
        Start with a template, invite a teammate, and your workspace is live. We&apos;ll send one
        short tip a week — nothing else.
      </Paragraph>
      <Cta href="https://example.com/new">Create your first doc</Cta>
    </Shell>
  ),
});
