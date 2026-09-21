import { Message } from './layout';

export const from = 'Acme Growth <growth@acme.io>';
export const to = '{{ user.email }}';
export const replyTo = 'Acme Support <support@acme.io>';

export const name = 'Re-engagement · Incentive';
export const description = 'The A/B variant arm: the same nudge, with a discount attached.';

export const subject = 'A discount, if that is what is missing';

/** Sample props for the studio preview; the engine passes the real ones. */
export const preview = { coupon: 'WELCOMEBACK15' };

export default function ReengageIncentive({ coupon }: { coupon: string }) {
  return (
    <Message
      preheader="15% off, no expiry games"
      heading="15% off, if that helps"
      body={`Use ${coupon} on any plan. We would rather you came back for the product, but if price is the blocker, this removes it.`}
      cta={{ label: 'Claim the discount', href: 'https://example.com/billing' }}
    />
  );
}
