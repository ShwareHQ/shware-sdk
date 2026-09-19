import { Message } from './layout';

export const from = 'Acme Growth <growth@acme.io>';
export const to = '{{ user.email }}';
export const replyTo = 'Acme Support <support@acme.io>';

export const name = 'Education · Automations';
export const description = 'Week 5: rules that do the filing so nobody has to remember to.';

export const subject = 'Let the workspace do the filing';

export default function EduAutomations() {
  return (
    <Message
      preheader="Let the workspace do the filing"
      heading="One rule, no more chasing"
      body={
        'When a doc is marked done, move it, notify the channel and archive the thread. Rules run on your workspace, not on your memory.'
      }
      cta={{ label: 'Create a rule', href: 'https://example.com/automations' }}
    />
  );
}
