import { emailTemplate } from '@shware/workflow';
import * as z from 'zod/mini';
import { Message } from './layout';

export default emailTemplate({
  id: 'edu_collaboration',
  title: 'Education · Collaboration',
  description: 'Week 2: invites, comments and the parts of a doc that involve other people.',
  props: z.strictObject({}),
  subject: 'Docs are better with someone else in them',
  preview: {},
  component: () => (
    <Message
      preheader="Docs are better with someone else in them"
      heading="Invite one person"
      body={
        'Comments thread, mentions notify, and suggestions keep the original intact until you accept them. It all starts with one invite.'
      }
      cta={{ label: 'Invite a teammate', href: 'https://example.com/invite' }}
    />
  ),
});
