import { emailTemplate } from '@shware/workflow';
import * as z from 'zod/mini';
import { Message } from './layout';

export default emailTemplate({
  title: 'Onboarding · Getting started',
  description: 'The first step for people who have not created anything yet.',
  props: z.strictObject({}),
  subject: 'Three things worth doing first',
  preview: {},
  component: () => (
    <Message
      preheader="A doc, a teammate, a template"
      heading="Three things worth doing first"
      body={
        'Create a doc, invite one teammate, and start from a template. Ten minutes in total, and your workspace stops being empty.'
      }
      cta={{ label: 'Open your workspace', href: 'https://example.com/app' }}
    />
  ),
});
