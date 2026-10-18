import { emailTemplate } from '@shware/workflow';
import * as z from 'zod/mini';
import { Message } from './layout';

export default emailTemplate({
  id: 'edu_api',
  title: 'Education · API',
  description: 'Week 6: for the teams who want to build on top of the workspace.',
  props: z.strictObject({}),
  subject: 'The workspace has an API',
  preview: {},
  component: () => (
    <Message
      preheader="The workspace has an API"
      heading="Read and write your own docs"
      body={
        'A REST API and webhooks for every document, comment and event. Ship an internal tool this afternoon.'
      }
      cta={{ label: 'Read the API docs', href: 'https://example.com/docs/api' }}
    />
  ),
});
