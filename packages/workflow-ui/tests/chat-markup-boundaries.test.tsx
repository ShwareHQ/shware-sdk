import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { ChatMarkup, type Dialect } from '../src/components/chat-markup';

afterEach(cleanup);

test.each<{ dialect: Dialect; text: string }>([
  { dialect: 'discord', text: '*hello*' },
  { dialect: 'discord', text: '_hello_' },
  { dialect: 'slack', text: '_hello_' },
])('$dialect italic $text survives an unmatched alternate capture', ({ dialect, text }) => {
  render(<ChatMarkup dialect={dialect} text={text} linkClass="message-link" />);
  expect(screen.getByText('hello').tagName).toBe('EM');
});

test('a Slack URL without a label uses the URL as its visible text', () => {
  render(<ChatMarkup dialect="slack" text="<https://example.com>" linkClass="message-link" />);
  const link = screen.getByRole('link', { name: 'https://example.com' });
  expect(link.getAttribute('href')).toBe('https://example.com');
});

test('a Slack labeled URL keeps the optional label', () => {
  render(
    <ChatMarkup
      dialect="slack"
      text="<mailto:ada@example.com|Email Ada>"
      linkClass="message-link"
    />
  );
  expect(screen.getByRole('link', { name: 'Email Ada' }).getAttribute('href')).toBe(
    'mailto:ada@example.com'
  );
});
