import { Message } from './layout';

export const from = 'Acme Growth <growth@acme.io>';
export const to = '{{ user.email }}';
export const replyTo = 'Acme Support <support@acme.io>';

export const name = 'Winback · Pro offer';
export const description =
  'For cancelled Pro subscriptions: what they lose, and the door left open.';

export const subject = 'Your Pro features are paused, not gone';

export default function WinbackProOffer() {
  return (
    <Message
      preheader="Unlimited history and guest access are waiting"
      heading="Paused, not deleted"
      body={
        'Version history, guest access and the automation quota come back the moment you resubscribe. Nothing was thrown away.'
      }
      cta={{ label: 'Resume Pro', href: 'https://example.com/billing' }}
    />
  );
}
