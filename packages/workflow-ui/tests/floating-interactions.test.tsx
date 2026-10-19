import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { DateRangePicker } from '../src/components/date-range';
import { Dropdown } from '../src/components/dropdown';
import { Menu } from '../src/components/menu';
import { Modal } from '../src/components/modal';

afterEach(cleanup);

it('opens a dropdown, selects an option and dismisses with Escape', async () => {
  function Select() {
    const [value, setValue] = useState('daily');
    return (
      <Dropdown
        value={value}
        onChange={setValue}
        options={[
          { value: 'daily', label: 'Daily' },
          { value: 'weekly', label: 'Weekly' },
        ]}
      />
    );
  }
  render(<Select />);
  fireEvent.click(screen.getByRole('combobox'));
  fireEvent.click(await screen.findByRole('option', { name: 'Weekly' }));
  expect(screen.getByRole('combobox').textContent).toContain('Weekly');
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  fireEvent.click(screen.getByRole('combobox'));
  expect(await screen.findByRole('listbox')).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
});

it('invokes a floating menu action once and closes it', async () => {
  const select = vi.fn<() => void>();
  render(<Menu aria-label="Actions" items={[{ key: 'edit', label: 'Edit', onSelect: select }]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));
  expect(select).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
});

it('keeps modal dismissal disabled during saving', async () => {
  const cancel = vi.fn<() => void>();
  const view = render(
    <Modal visible disabled onCancel={cancel}>
      <button type="button">Save</button>
    </Modal>
  );
  fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' });
  expect(cancel).not.toHaveBeenCalled();
  view.rerender(
    <Modal visible onCancel={cancel}>
      <button type="button">Save</button>
    </Modal>
  );
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('opens a date range and applies a preset through its real floating panel', async () => {
  const change = vi.fn<(value: { from: string; to: string }) => void>();
  render(<DateRangePicker value={{ from: '2026-08-01', to: '2026-08-02' }} onChange={change} />);
  fireEvent.click(screen.getByRole('button'));
  fireEvent.click(await screen.findByRole('button', { name: 'Last 7 days' }));
  expect(change).toHaveBeenCalledTimes(1);
  expect(change.mock.calls[0][0].from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
