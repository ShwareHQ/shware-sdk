import { Container, Head, Html, Preview, Text } from '@react-email/components';

export interface OfferProps {
  coupon: string;
  expiresIn: string;
}

export const subject = 'Your discount is about to expire';

export default function Offer({ coupon, expiresIn }: OfferProps) {
  return (
    <Html>
      <Head />
      <Preview>Your code {coupon} is waiting</Preview>
      <Container style={{ fontFamily: 'Inter, sans-serif', padding: 24 }}>
        <Text style={{ fontSize: 20, fontWeight: 600 }}>Still deciding?</Text>
        <Text>
          Use code <strong>{coupon}</strong> at checkout — it expires in {expiresIn}.
        </Text>
      </Container>
    </Html>
  );
}
