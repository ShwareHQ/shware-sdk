import { Message } from './layout';

export const from = 'Acme Growth <growth@acme.io>';
export const to = '{{ user.email }}';
export const replyTo = 'Acme Support <support@acme.io>';

export const name = 'Re-engagement · What shipped';
export const description = 'Second touch: what changed while they were gone, in three lines.';

export const subject = 'What shipped while you were away';

export default function ReengageProductHighlights() {
  return (
    <Message
      preheader="Whiteboards, faster search, offline mode"
      heading="Three things that are new"
      body={
        'Whiteboards landed, search got roughly twice as fast, and offline editing now syncs without a merge dialog.'
      }
      cta={{ label: "See what's new", href: 'https://example.com/changelog' }}
    />
  );
}
