import { Message } from './layout';

export const from = 'Acme Growth <growth@acme.io>';
export const to = '{{ user.email }}';
export const replyTo = 'Acme Support <support@acme.io>';

export const name = 'Winback · Final offer';
export const description = 'Last touch of the win-back flow, paired with the lock-screen push.';

export const subject = 'Last call on your 20% code';

/** Sample props for the studio preview; the engine passes the real ones. */
export const preview = { coupon: 'COMEBACK20', expiresIn: '72 hours' };

export default function WinbackFinalOffer({
  coupon,
  expiresIn,
}: {
  coupon: string;
  expiresIn: string;
}) {
  return (
    <Message
      preheader="The code expires soon"
      heading="Last call"
      body={`${coupon} takes 20% off for a year, and it expires in ${expiresIn}. After that this flow stops emailing you.`}
      cta={{ label: 'Use the code', href: 'https://example.com/billing' }}
    />
  );
}
