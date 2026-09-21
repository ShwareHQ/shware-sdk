import { Message } from './layout';

export const from = 'Acme Growth <growth@acme.io>';
export const to = '{{ user.email }}';
export const replyTo = 'Acme Support <support@acme.io>';

export const name = 'Education · Mobile';
export const description = 'Week 7: the app, for capture away from the desk.';

export const subject = 'Capture it before you forget it';

export default function EduMobile() {
  return (
    <Message
      preheader="Capture it before you forget it"
      heading="The app for the other 8 hours"
      body={
        'Offline notes, voice capture and the same search as the desktop. Ideas arrive on the walk home, not at the keyboard.'
      }
      cta={{ label: 'Get the app', href: 'https://example.com/mobile' }}
    />
  );
}
