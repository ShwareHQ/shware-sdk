import { emailTemplate } from '@shware/workflow';
import * as z from 'zod/mini';
import { Message } from './layout';

export default emailTemplate({
  id: 'winback_pro_offer',
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
