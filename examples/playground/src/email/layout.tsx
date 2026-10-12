import { Button, Container, Head, Html, Preview, Tailwind, Text } from '@react-email/components';
import type { ReactNode } from 'react';
import { tailwindConfig } from './tailwind';

/**
 * The document every demo email shares: the inbox preheader and one centred
 * column, inside the single `<Tailwind>` that inlines every `className` into
 * `style` at render time — so templates write utilities and never repeat the
 * config.
 */
export function Shell({ preheader, children }: { preheader: string; children: ReactNode }) {
  return (
    <Tailwind config={tailwindConfig}>
      <Html>
        <Head />
        <Preview>{preheader}</Preview>
        <Container className="max-w-140 p-6 font-sans">{children}</Container>
      </Html>
    </Tailwind>
  );
}

/** The email's one heading. */
export function Heading({ children }: { children: ReactNode }) {
  return <Text className="mt-0 mb-3 text-xl leading-6 font-semibold">{children}</Text>;
}

/** A paragraph of body copy. */
export function Paragraph({ children }: { children: ReactNode }) {
  return <Text className="text-body leading-5.5">{children}</Text>;
}

/**
 * The call to action: a solid ink button. The radius is spelled in px:
 * pixelBasedPreset converts the spacing and type scales, not `rounded-*`, which
 * would otherwise inline as rem.
 */
export function Cta({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button href={href} className="bg-ink mt-2 inline-block rounded-lg px-4 py-2.5 text-white">
      {children}
    </Button>
  );
}

/** Small grey print under everything else. */
export function FinePrint({ children }: { children: ReactNode }) {
  return <Text className="text-muted mt-6 text-xs leading-6">{children}</Text>;
}

/**
 * The shape most demo emails share: preheader, one heading, one paragraph and
 * an optional button. A real project's emails each have their own layout —
 * here the interesting part is the registry contract, so the markup is
 * factored out to keep each module down to its copy.
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
    <Shell preheader={preheader}>
      <Heading>{heading}</Heading>
      <Paragraph>{body}</Paragraph>
      {cta !== undefined && <Cta href={cta.href}>{cta.label}</Cta>}
    </Shell>
  );
}
