import { Message } from './layout';

export const from = 'Acme <hello@acme.io>';
export const to = '{{ user.email }}';
export const replyTo = 'Acme Support <support@acme.io>';

export const name = 'Onboarding · Pro tips';
export const description =
  'For users already active: the shortcuts that separate daily drivers from visitors.';

export const subject = 'Four shortcuts our heaviest users live in';

export default function OnboardingProTips() {
  return (
    <Message
      preheader="Command palette, backlinks, snippets, offline"
      heading="Four shortcuts worth learning"
      body={
        'The command palette opens everything, backlinks find what you forgot you wrote, snippets expand as you type, and offline mode keeps writing on a plane.'
      }
      cta={{ label: 'See all shortcuts', href: 'https://example.com/docs/shortcuts' }}
    />
  );
}
