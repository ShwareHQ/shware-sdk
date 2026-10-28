import { emailTemplate } from '@shware/workflow';
import * as z from 'zod/mini';
import { Message } from './layout';
import { senders } from './senders';

export default emailTemplate({
  id: 'edu_integrations',
  topic: 'tips',
  from: senders.hello,
  replyTo: senders.support,
  title: 'Education · Integrations',
  description: 'Week 4: connecting the tools the work already lives in.',
  props: z.strictObject({}),
  subject: 'Connect the tools you already use',
  preview: {},
  component: () => (
    <Message
      preheader="Connect the tools you already use"
      heading="Slack, GitHub, Figma, Drive"
      body={
        'Paste a link and it unfurls: a pull request shows its status, a Figma frame shows the frame, a Drive file shows its title and owner.'
      }
      cta={{ label: 'Connect an app', href: 'https://example.com/integrations' }}
    />
  ),
});
