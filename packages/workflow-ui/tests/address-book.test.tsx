import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { AddressBook, isValidEmailAddress } from '../src/components/address-book';

const ADDRESSES = ['Acme <hello@acme.io>', 'Acme Support <support@acme.io>'];

function setup(addresses: string[] = ADDRESSES) {
  const onAdd = vi.fn();
  const onUpdate = vi.fn();
  const onRemove = vi.fn();
  render(
    <AddressBook addresses={addresses} onAdd={onAdd} onUpdate={onUpdate} onRemove={onRemove} />
  );
  return { onAdd, onUpdate, onRemove };
}

afterEach(cleanup);

describe('address validation (shared shape rule)', () => {
  test('accepts a bare email and the display-name form, rejects everything else', () => {
    expect(isValidEmailAddress('hello@acme.io')).toBe(true);
    expect(isValidEmailAddress('Acme <hello@acme.io>')).toBe(true);
    expect(isValidEmailAddress('not-an-email')).toBe(false);
    expect(isValidEmailAddress('Acme <not-an-email>')).toBe(false);
    expect(isValidEmailAddress('<hello@acme.io>')).toBe(false);
    expect(isValidEmailAddress('')).toBe(false);
  });
});

describe('adding an address', () => {
  test('an invalid address shows the error and never reaches the callback', async () => {
    const user = userEvent.setup();
    const { onAdd } = setup();

    await user.type(screen.getByPlaceholderText('Acme <hello@acme.io>'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: /add/i }));

    expect(await screen.findByText('Enter an email, or Name <email>')).toBeDefined();
    expect(onAdd).not.toHaveBeenCalled();
  });

  test('a valid address submits, trims, and clears the input', async () => {
    const user = userEvent.setup();
    const { onAdd } = setup();
    const input = screen.getByPlaceholderText<HTMLInputElement>('Acme <hello@acme.io>');

    await user.type(input, '  Growth <growth@acme.io>  ');
    await user.click(screen.getByRole('button', { name: /add/i }));

    expect(onAdd).toHaveBeenCalledExactlyOnceWith('Growth <growth@acme.io>');
    expect(input.value).toBe('');
  });

  test('enter submits the add form too', async () => {
    const user = userEvent.setup();
    const { onAdd } = setup();

    await user.type(screen.getByPlaceholderText('Acme <hello@acme.io>'), 'growth@acme.io{Enter}');

    expect(onAdd).toHaveBeenCalledExactlyOnceWith('growth@acme.io');
  });
});

describe('editing an address', () => {
  test('the pencil opens an editor prefilled with the address; enter saves the new value', async () => {
    const user = userEvent.setup();
    const { onUpdate } = setup();

    await user.click(screen.getAllByTitle('Edit')[0]);
    const editor = screen.getByDisplayValue<HTMLInputElement>(ADDRESSES[0]);
    await user.clear(editor);
    await user.type(editor, 'Renamed <renamed@acme.io>{Enter}');

    expect(onUpdate).toHaveBeenCalledExactlyOnceWith(ADDRESSES[0], 'Renamed <renamed@acme.io>');
  });

  test('an invalid edit shows the error and keeps the callback untouched', async () => {
    const user = userEvent.setup();
    const { onUpdate } = setup();

    await user.click(screen.getAllByTitle('Edit')[0]);
    const editor = screen.getByDisplayValue(ADDRESSES[0]);
    await user.clear(editor);
    await user.type(editor, 'broken{Enter}');

    expect(await screen.findByText('Enter an email, or Name <email>')).toBeDefined();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  test('escape closes the editor without saving; an unchanged value saves nothing', async () => {
    const user = userEvent.setup();
    const { onUpdate } = setup();

    await user.click(screen.getAllByTitle('Edit')[0]);
    await user.keyboard('{Escape}');
    expect(screen.queryByDisplayValue(ADDRESSES[0])).toBeNull();

    await user.click(screen.getAllByTitle('Edit')[0]);
    await user.keyboard('{Enter}');
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

describe('removing an address', () => {
  test('the trash button reports exactly the row it belongs to', async () => {
    const user = userEvent.setup();
    const { onRemove } = setup();

    await user.click(screen.getAllByTitle('Remove')[1]);

    expect(onRemove).toHaveBeenCalledExactlyOnceWith(ADDRESSES[1]);
  });
});

describe('empty state', () => {
  test('an empty book says not configured instead of rendering a bare list', () => {
    setup([]);
    expect(screen.getByText('Not configured')).toBeDefined();
  });
});
