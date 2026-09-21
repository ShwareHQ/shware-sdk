import { Message } from './layout';

export const from = 'Acme Growth <growth@acme.io>';
export const to = '{{ user.email }}';
export const replyTo = 'Acme Support <support@acme.io>';

export const name = 'Re-engagement · Miss you';
export const description =
  'First email after the push: a plain reminder that the workspace is still there.';

export const subject = 'Your workspace is still here';

export default function ReengageMissYou() {
  return (
    <Message
      preheader="Nothing was archived while you were away"
      heading="Your workspace is still here"
      body={
        'Nothing was archived and nothing expired. Pick up the doc you left open, or start something new.'
      }
      cta={{ label: 'Open your workspace', href: 'https://example.com/app' }}
    />
  );
}
