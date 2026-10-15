import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { EmailDefaults } from '../src/components/email-defaults';

afterEach(cleanup);

describe('the email envelope in Settings', () => {
  test('shows from and reply-to, with nothing to edit', () => {
    render(<EmailDefaults from="Acme <hello@acme.io>" replyTo="Acme Support <support@acme.io>" />);

    expect(screen.getByText('Acme <hello@acme.io>')).toBeDefined();
    expect(screen.getByText('Acme Support <support@acme.io>')).toBeDefined();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('a missing reply-to says not configured', () => {
    render(<EmailDefaults from="Acme <hello@acme.io>" />);
    expect(screen.getByText('Not configured')).toBeDefined();
  });
});
