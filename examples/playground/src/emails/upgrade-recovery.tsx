import { Button, Container, Head, Html, Preview, Text } from '@react-email/components';
import { emailSubject } from '@shware/workflow';
import { u } from '../workflows/schema';

export interface UpgradeRecoveryProps {
  plan: 'free' | 'pro' | 'business';
}

export const from = 'Acme <hello@acme.io>';
export const to = '{{ user.email }}';
export const replyTo = 'Acme Support <support@acme.io>';

/** A string template, not a closure: `{{ user.prop }}` placeholders are compile-checked against u, and the studio can edit it in place. */
export const name = 'Upgrade Recovery';

export const subject = emailSubject(u, 'Finish upgrading to {{ user.subscription_plan }}');

/** Sample props for previewing (injected when the template page renders it). */
export const preview: UpgradeRecoveryProps = { plan: 'business' };

export default function UpgradeRecovery({ plan }: UpgradeRecoveryProps) {
  return (
    <Html>
      <Head />
      <Preview>You still have work to do on your {plan} upgrade</Preview>
      <Container style={{ fontFamily: 'Inter, sans-serif', padding: 24, maxWidth: 560 }}>
        <Text style={{ fontSize: 20, fontWeight: 600, margin: '0 0 12px' }}>
          Your {plan} upgrade is one click away
        </Text>
        <Text style={{ color: '#475569', lineHeight: '22px' }}>
          {plan} unlocks unlimited docs, advanced permissions, and priority support for the whole
          workspace. Nothing has been charged yet.
        </Text>
        <Button
          href="https://example.com/billing"
          style={{
            background: '#0f172a',
            color: '#fff',
            padding: '10px 16px',
            borderRadius: 8,
            display: 'inline-block',
            marginTop: 8,
          }}
        >
          Complete upgrade
        </Button>
        <Text style={{ color: '#94a3b8', fontSize: 12, marginTop: 24 }}>
          Ran into a problem? Just reply to this email — a human reads every one.
        </Text>
      </Container>
    </Html>
  );
}
