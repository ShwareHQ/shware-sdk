import { Message } from './layout';

export const from = 'Acme Growth <growth@acme.io>';
export const to = '{{ user.email }}';
export const replyTo = 'Acme Support <support@acme.io>';

export const name = 'Education · Collaboration';
export const description =
  'Week 2: invites, comments and the parts of a doc that involve other people.';

export const subject = 'Docs are better with someone else in them';

export default function EduCollaboration() {
  return (
    <Message
      preheader="Docs are better with someone else in them"
      heading="Invite one person"
      body={
        'Comments thread, mentions notify, and suggestions keep the original intact until you accept them. It all starts with one invite.'
      }
      cta={{ label: 'Invite a teammate', href: 'https://example.com/invite' }}
    />
  );
}
