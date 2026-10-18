import { emailTemplate } from '@shware/workflow';
import * as z from 'zod/mini';
import { Message } from './layout';
import { senders } from './senders';

export default emailTemplate({
  id: 'winback_pro_offer',
  from: senders.hello,
  replyTo: senders.support,
  title: 'Winback · Pro offer',
  description: 'For cancelled Pro subscriptions: what they lose, and the door left open.',
  props: z.strictObject({}),
  subject: 'Your Pro features are paused, not gone',
  preview: {},
  component: () => (
    <Message
      preheader="Unlimited history and guest access are waiting"
      heading="Paused, not deleted"
      body={
        'Version history, guest access and the automation quota come back the moment you resubscribe. Nothing was thrown away.'
      }
      cta={{ label: 'Resume Pro', href: 'https://example.com/billing' }}
    />
  ),
});
