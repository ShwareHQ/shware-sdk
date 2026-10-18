import { emailTemplate } from '@shware/workflow';
import * as z from 'zod/mini';
import { Message } from './layout';

export default emailTemplate({
  id: 'edu_mobile',
  title: 'Education · Mobile',
  description: 'Week 7: the app, for capture away from the desk.',
  props: z.strictObject({}),
  subject: 'Capture it before you forget it',
  preview: {},
  component: () => (
    <Message
      preheader="Capture it before you forget it"
      heading="The app for the other 8 hours"
      body={
        'Offline notes, voice capture and the same search as the desktop. Ideas arrive on the walk home, not at the keyboard.'
      }
      cta={{ label: 'Get the app', href: 'https://example.com/mobile' }}
    />
  ),
});
