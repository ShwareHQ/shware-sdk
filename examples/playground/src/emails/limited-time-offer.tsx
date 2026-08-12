import { Button, Container, Head, Html, Preview, Text } from '@react-email/components';

export interface LimitedTimeOfferProps {
  coupon: string;
  expiresIn: string;
}

export const from = 'Acme <offers@acme.io>';
export const to = '{{ user.email }}';
export const preheader = 'Expires in 24 hours';
export const headers = { 'X-Campaign': 'checkout-recovery' };

export const subject = (props: LimitedTimeOfferProps) =>
  `${props.coupon} — your discount expires in ${props.expiresIn}`;

export const preview: LimitedTimeOfferProps = { coupon: '15OFF', expiresIn: '48 hours' };

export default function LimitedTimeOffer({ coupon, expiresIn }: LimitedTimeOfferProps) {
  return (
    <Html>
      <Head />
      <Preview>Claim your exclusive discount</Preview>
      <Container style={{ fontFamily: 'Inter, sans-serif', padding: 24, maxWidth: 560 }}>
        <Text style={{ fontSize: 20, fontWeight: 600, margin: '0 0 12px' }}>
          Claim your exclusive discount
        </Text>
        <Text style={{ color: '#475569', lineHeight: '22px' }}>
          Use code{' '}
          <strong style={{ fontFamily: 'ui-monospace, monospace', color: '#0f172a' }}>
            {coupon}
          </strong>{' '}
          at checkout. It expires in {expiresIn} and this is the last email we&apos;ll send about
          it.
        </Text>
        <Button
          href="https://example.com/checkout"
          style={{
            background: '#0f172a',
            color: '#fff',
            padding: '10px 16px',
            borderRadius: 8,
            display: 'inline-block',
            marginTop: 8,
          }}
        >
          Apply {coupon}
        </Button>
      </Container>
    </Html>
  );
}
