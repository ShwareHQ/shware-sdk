import { Message } from './layout';

export const from = 'Acme Growth <growth@acme.io>';
export const to = '{{ user.email }}';
export const replyTo = 'Acme Support <support@acme.io>';

export const name = 'Education · Templates';
export const description =
  'Week 1 of the education series: starting from a template instead of a blank page.';

export const subject = 'Never start from a blank page';

export default function EduTemplates() {
  return (
    <Message
      preheader="Never start from a blank page"
      heading="Forty starting points, free"
      body={
        'Project briefs, retros, one-on-ones — forty templates, each one a working document rather than a set of headings.'
      }
      cta={{ label: 'Browse templates', href: 'https://example.com/templates' }}
    />
  );
}
