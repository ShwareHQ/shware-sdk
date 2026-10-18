import { emailTemplate } from '@shware/workflow';
import * as z from 'zod/mini';
import { Message } from './layout';

export default emailTemplate({
  id: 'reengage_product_highlights',
  title: 'Re-engagement · What shipped',
  description: 'Second touch: what changed while they were gone, in three lines.',
  props: z.strictObject({}),
  subject: 'What shipped while you were away',
  preview: {},
  component: () => (
    <Message
      preheader="Whiteboards, faster search, offline mode"
      heading="Three things that are new"
      body={
        'Whiteboards landed, search got roughly twice as fast, and offline editing now syncs without a merge dialog.'
      }
      cta={{ label: "See what's new", href: 'https://example.com/changelog' }}
    />
  ),
});
