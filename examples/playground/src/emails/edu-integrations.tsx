import { Message } from './layout';

export const from = 'Acme Growth <growth@acme.io>';
export const to = '{{ user.email }}';
export const replyTo = 'Acme Support <support@acme.io>';

export const name = 'Education · Integrations';
export const description = 'Week 4: connecting the tools the work already lives in.';

export const subject = 'Connect the tools you already use';

export default function EduIntegrations() {
  return (
    <Message
      preheader="Connect the tools you already use"
      heading="Slack, GitHub, Figma, Drive"
      body={
        'Paste a link and it unfurls: a pull request shows its status, a Figma frame shows the frame, a Drive file shows its title and owner.'
      }
      cta={{ label: 'Connect an app', href: 'https://example.com/integrations' }}
    />
  );
}
