import { emailTemplate } from '@shware/workflow';
import * as z from 'zod/mini';
import { Message } from './layout';

export default emailTemplate({
  title: 'Re-engagement · Miss you',
  description: 'First email after the push: a plain reminder that the workspace is still there.',
  props: z.strictObject({}),
  subject: 'Your workspace is still here',
  preview: {},
  component: () => (
    <Message
      preheader="Nothing was archived while you were away"
      heading="Your workspace is still here"
      body={
        'Nothing was archived and nothing expired. Pick up the doc you left open, or start something new.'
      }
      cta={{ label: 'Open your workspace', href: 'https://example.com/app' }}
    />
  ),
});
