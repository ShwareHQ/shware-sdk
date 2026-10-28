import { Button, Container, Head, Html, Preview, Text } from '@react-email/components';
import * as z from 'zod/mini';
import { emailTemplate } from '../contract';
import { senders } from './senders';

export default emailTemplate({
  id: 'demo_welcome',
  transactional: true,
  from: senders.noreply,
  title: 'Demo · Welcome',
  props: z.strictObject({ plan: z.string() }),
  subject: 'Welcome to your new plan',
  preview: { plan: 'Pro' },
  component: function Welcome({ plan }) {
    return (
      <Html>
        <Head />
        <Preview>Your {plan} workspace is ready</Preview>
        <Container style={{ fontFamily: 'Inter, sans-serif', padding: 24 }}>
          <Text style={{ fontSize: 20, fontWeight: 600 }}>Your {plan} workspace is ready</Text>
          <Text>Create your first doc and invite a teammate to get going.</Text>
          <Button
            href="https://example.com/start"
            style={{ background: '#0f172a', color: '#fff', padding: '10px 16px', borderRadius: 8 }}
          >
            Open workspace
          </Button>
        </Container>
      </Html>
    );
  },
});
