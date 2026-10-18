import { emailTemplate } from '@shware/workflow';
import * as z from 'zod/mini';
import { Message } from './layout';
import { senders } from './senders';

export default emailTemplate({
  id: 'edu_whiteboards',
  from: senders.hello,
  replyTo: senders.support,
  title: 'Education · Whiteboards',
  description: 'Week 3: the canvas, for the thinking that does not fit in paragraphs.',
  props: z.strictObject({}),
  subject: 'For the thinking that is not a paragraph',
  preview: {},
  component: () => (
    <Message
      preheader="For the thinking that is not a paragraph"
      heading="Open a whiteboard"
      body={
        'Sticky notes, arrows and rough boxes, on an infinite canvas that lives next to your docs instead of in another tab.'
      }
      cta={{ label: 'Try a whiteboard', href: 'https://example.com/whiteboard' }}
    />
  ),
});
