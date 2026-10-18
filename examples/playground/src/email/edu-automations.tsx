import { emailTemplate } from '@shware/workflow';
import * as z from 'zod/mini';
import { Message } from './layout';
import { senders } from './senders';

export default emailTemplate({
  id: 'edu_automations',
  from: senders.hello,
  replyTo: senders.support,
  title: 'Education · Automations',
  description: 'Week 5: rules that do the filing so nobody has to remember to.',
  props: z.strictObject({}),
  preview: {},
  subject: 'Let the workspace do the filing',
  component: () => (
    <Message
      preheader="Let the workspace do the filing"
      heading="One rule, no more chasing"
      body={
        'When a doc is marked done, move it, notify the channel and archive the thread. Rules run on your workspace, not on your memory.'
      }
      cta={{ label: 'Create a rule', href: 'https://example.com/automations' }}
    />
  ),
});
