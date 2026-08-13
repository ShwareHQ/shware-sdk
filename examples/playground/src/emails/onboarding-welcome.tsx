import { Button, Container, Head, Html, Preview, Text } from '@react-email/components';

export const from = 'Acme <hello@acme.io>';
export const to = '{{ user.email }}';
export const replyTo = 'Acme Support <support@acme.io>';
export const preheader = 'Create your first doc in under a minute';
export const headers = { 'X-Campaign': 'onboarding' };

export const subject = 'Welcome aboard';

export default function OnboardingWelcome() {
  return (
    <Html>
      <Head />
      <Preview>Create your first doc in under a minute</Preview>
      <Container style={{ fontFamily: 'Inter, sans-serif', padding: 24, maxWidth: 560 }}>
        <Text style={{ fontSize: 20, fontWeight: 600, margin: '0 0 12px' }}>Welcome aboard</Text>
        <Text style={{ color: '#475569', lineHeight: '22px' }}>
          Start with a template, invite a teammate, and your workspace is live. We&apos;ll send one
          short tip a week — nothing else.
        </Text>
        <Button
          href="https://example.com/new"
          style={{
            background: '#0f172a',
            color: '#fff',
            padding: '10px 16px',
            borderRadius: 8,
            display: 'inline-block',
            marginTop: 8,
          }}
        >
          Create your first doc
        </Button>
      </Container>
    </Html>
  );
}
