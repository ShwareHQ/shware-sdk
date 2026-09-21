import { Button, Container, Head, Html, Preview, Text } from '@react-email/components';

/**
 * The shell every demo email shares: preheader, one heading, one paragraph and
 * an optional button.
 *
 * Four of these were written out longhand before the drip series arrived; at
 * fifteen the boilerplate was the only thing on screen. A real project's
 * emails each have their own layout — here the interesting part is the
 * registry contract, so the markup is factored out to keep each module down to
 * its envelope and its copy.
 */
export interface MessageProps {
  /** Inbox preview line, after the subject. */
  preheader: string;
  heading: string;
  body: string;
  cta?: { label: string; href: string };
}

export function Message({ preheader, heading, body, cta }: MessageProps) {
  return (
    <Html>
      <Head />
      <Preview>{preheader}</Preview>
      <Container style={{ fontFamily: 'Inter, sans-serif', padding: 24, maxWidth: 560 }}>
        <Text style={{ fontSize: 20, fontWeight: 600, margin: '0 0 12px' }}>{heading}</Text>
        <Text style={{ color: '#475569', lineHeight: '22px' }}>{body}</Text>
        {cta !== undefined && (
          <Button
            href={cta.href}
            style={{
              background: '#0f172a',
              color: '#fff',
              padding: '10px 16px',
              borderRadius: 8,
              display: 'inline-block',
              marginTop: 8,
            }}
          >
            {cta.label}
          </Button>
        )}
      </Container>
    </Html>
  );
}
