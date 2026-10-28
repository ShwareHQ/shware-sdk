import * as z from 'zod/mini';
import { emailTemplate } from '../workflows/schema';
import { Message } from './layout';
import { senders } from './senders';

export default emailTemplate({
  id: 'reengage_product_highlights',
  topic: 'product_updates',
  from: senders.hello,
  replyTo: senders.support,
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
