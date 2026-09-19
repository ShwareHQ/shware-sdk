import { Message } from './layout';

export const from = 'Acme Growth <growth@acme.io>';
export const to = '{{ user.email }}';
export const replyTo = 'Acme Support <support@acme.io>';

export const name = 'Winback · Free tips';
export const description = 'For downgrades: make the free plan work well, and stay welcome.';

export const subject = 'Getting the most out of the free plan';

export default function WinbackFreeTips() {
  return (
    <Message
      preheader="No upsell, just the limits worth knowing"
      heading="The free plan, used well"
      body={
        'Three collaborators, unlimited personal docs and the whole template library. Here is where the limits actually bite, so nothing surprises you.'
      }
      cta={{ label: 'Read the guide', href: 'https://example.com/docs/free-plan' }}
    />
  );
}
