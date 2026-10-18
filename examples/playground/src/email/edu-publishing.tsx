import { emailTemplate } from '@shware/workflow';
import * as z from 'zod/mini';
import { Message } from './layout';

export default emailTemplate({
  id: 'edu_publishing',
  title: 'Education · Publishing',
  description: 'Week 8: publishing a doc to the web, the last module of the series.',
  props: z.strictObject({}),
  subject: 'Share it with the world',
  preview: {},
  component: () => (
    <Message
      preheader="Share it with the world"
      heading="One click from doc to web page"
      body={
        'Publish any doc as a page with its own link: readers need no account, and edits go live the moment you make them.'
      }
      cta={{ label: 'Publish a doc', href: 'https://example.com/publish' }}
    />
  ),
});
