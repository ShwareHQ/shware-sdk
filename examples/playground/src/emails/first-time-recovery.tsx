import { Button, Container, Head, Html, Preview, Text } from '@react-email/components';

export const from = 'Acme Growth <growth@acme.io>';
export const to = '{{ user.email }}';
export const replyTo = 'Acme Contact <contact@acme.io>';
export const preheader = 'Your cart is still waiting';

export const name = 'Cart Recovery · First touch';

export const subject = 'Hi, {{ user.name }}, your workspace is waiting';

export default function FirstTimeRecovery() {
  return (
    <Html>
      <Head />
      <Preview>Pick up where you left off</Preview>
      <Container style={{ fontFamily: 'Inter, sans-serif', padding: 24, maxWidth: 560 }}>
        <Text style={{ fontSize: 20, fontWeight: 600, margin: '0 0 12px' }}>
          Pick up where you left off
        </Text>
        <Text style={{ color: '#475569', lineHeight: '22px' }}>
          Your checkout is still open. Plans are month-to-month, cancel anytime, and payment is
          handled by Stripe.
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
          Resume checkout
        </Button>
      </Container>
    </Html>
  );
}
