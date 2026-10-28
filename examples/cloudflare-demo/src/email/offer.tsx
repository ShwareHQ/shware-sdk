import { Container, Head, Html, Preview, Text } from '@react-email/components';
import * as z from 'zod/mini';
import { emailTemplate } from '../contract';
import { senders } from './senders';

export default emailTemplate({
  id: 'demo_offer',
  topic: 'offers',
  from: senders.noreply,
  title: 'Demo · Offer',
  props: z.strictObject({ coupon: z.string(), expiresIn: z.string() }),
  subject: 'Your discount is about to expire',
  preview: { coupon: 'COMEBACK20', expiresIn: '48 hours' },
  component: function Offer({ coupon, expiresIn }) {
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
  },
});
