import { Message } from './layout';

export const from = 'Acme <hello@acme.io>';
export const to = '{{ user.email }}';
export const replyTo = 'Acme Support <support@acme.io>';

export const name = 'Onboarding · Getting started';
export const description = 'The first step for people who have not created anything yet.';

export const subject = 'Three things worth doing first';

export default function OnboardingGettingStarted() {
  return (
    <Message
      preheader="A doc, a teammate, a template"
      heading="Three things worth doing first"
      body={
        'Create a doc, invite one teammate, and start from a template. Ten minutes in total, and your workspace stops being empty.'
      }
      cta={{ label: 'Open your workspace', href: 'https://example.com/app' }}
    />
  );
}
