import { Message } from './layout';

export const from = 'Acme Growth <growth@acme.io>';
export const to = '{{ user.email }}';
export const replyTo = 'Acme Support <support@acme.io>';

export const name = 'Education · Whiteboards';
export const description = 'Week 3: the canvas, for the thinking that does not fit in paragraphs.';

export const subject = 'For the thinking that is not a paragraph';

export default function EduWhiteboards() {
  return (
    <Message
      preheader="For the thinking that is not a paragraph"
      heading="Open a whiteboard"
      body={
        'Sticky notes, arrows and rough boxes, on an infinite canvas that lives next to your docs instead of in another tab.'
      }
      cta={{ label: 'Try a whiteboard', href: 'https://example.com/whiteboard' }}
    />
  );
}
