import { Message } from './layout';

export const from = 'Acme Growth <growth@acme.io>';
export const to = '{{ user.email }}';
export const replyTo = 'Acme Support <support@acme.io>';

export const name = 'Education · API';
export const description = 'Week 6: for the teams who want to build on top of the workspace.';

export const subject = 'The workspace has an API';

export default function EduApi() {
  return (
    <Message
      preheader="The workspace has an API"
      heading="Read and write your own docs"
      body={
        'A REST API and webhooks for every document, comment and event. Ship an internal tool this afternoon.'
      }
      cta={{ label: 'Read the API docs', href: 'https://example.com/docs/api' }}
    />
  );
}
