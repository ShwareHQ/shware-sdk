import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { EmailDefaults } from '../src/components/email-defaults';

afterEach(cleanup);

describe("the config's email in Settings", () => {
  test('shows the default unsubscribe link and the quick-click window, with nothing to edit', () => {
    render(<EmailDefaults unsubscribeUrl="https://acme.io/unsubscribe" quickClickMs={2_000} />);

    expect(screen.getByText('https://acme.io/unsubscribe')).toBeDefined();
    expect(screen.getByText('Within 2000 ms of delivery: a weak machine signal')).toBeDefined();
    // Senders are each template's: none is shown here as everyone's
    expect(screen.queryByText('From')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('no default link says not configured; the window is the default one', () => {
    render(<EmailDefaults />);
    expect(screen.getByText('Not configured')).toBeDefined();
    expect(screen.getByText('Within 1000 ms of delivery: a weak machine signal')).toBeDefined();
  });
});
