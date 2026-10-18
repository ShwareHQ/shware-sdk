import { emailTemplate } from '@shware/workflow';
import * as z from 'zod/mini';
import { Message } from './layout';
import { senders } from './senders';

export default emailTemplate({
  id: 'edu_templates',
  from: senders.hello,
  replyTo: senders.support,
  title: 'Education · Templates',
  description: 'Week 1 of the education series: starting from a template instead of a blank page.',
  props: z.strictObject({}),
  subject: 'Never start from a blank page',
  preview: {},
  component: () => (
    <Message
      preheader="Never start from a blank page"
      heading="Forty starting points, free"
      body={
        'Project briefs, retros, one-on-ones — forty templates, each one a working document rather than a set of headings.'
      }
      cta={{ label: 'Browse templates', href: 'https://example.com/templates' }}
    />
  ),
});
