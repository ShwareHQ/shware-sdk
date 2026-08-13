import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { TemplateRefInfo } from '../src/components/template-refs';
import { TemplatesPage } from '../src/components/templates-page';
import type { EmailModule } from '../src/config';

const ADDRESSES = ['Acme <hello@acme.io>', 'Acme Support <support@acme.io>'];

const emailRef: TemplateRefInfo = {
  key: 'welcome',
  channel: 'email',
  usages: [{ workflow: 'onboarding', nodeId: '0', props: {} }],
};
const slackRef: TemplateRefInfo = {
  key: 'cs_alert',
  channel: 'slack',
  usages: [{ workflow: 'winback', nodeId: '1.c0.0', props: {} }],
};

const welcomeModule: EmailModule = {
  default: () => <div>welcome body</div>,
  from: 'Acme <hello@acme.io>',
  replyTo: 'Acme Support <support@acme.io>',
  subject: 'Welcome {{ user.name }}',
};

function setup({
  refs = [emailRef],
  emails = { welcome: welcomeModule },
  selected = refs[0]?.key,
}: {
  refs?: TemplateRefInfo[];
  emails?: Record<string, EmailModule | undefined>;
  selected?: string | undefined;
} = {}) {
  const onSaveEnvelope = vi.fn(() => Promise.resolve());
  const onManageAddresses = vi.fn();
  render(
    <TemplatesPage
      refs={refs}
      emails={emails}
      selected={selected}
      onSelect={vi.fn()}
      preview={{ loading: false }}
      addresses={ADDRESSES}
      onSaveEnvelope={onSaveEnvelope}
      onManageAddresses={onManageAddresses}
    />
  );
  return { onSaveEnvelope, onManageAddresses };
}

afterEach(cleanup);

describe('from / reply-to pickers', () => {
  test('picking another address saves that field', async () => {
    const user = userEvent.setup();
    const { onSaveEnvelope } = setup();

    const [fromSelect] = screen.getAllByRole<HTMLSelectElement>('combobox');
    await user.selectOptions(fromSelect, 'Acme Support <support@acme.io>');

    expect(onSaveEnvelope).toHaveBeenCalledExactlyOnceWith(
      'welcome',
      'from',
      'Acme Support <support@acme.io>'
    );
  });

  test('re-picking the current value saves nothing', async () => {
    const user = userEvent.setup();
    const { onSaveEnvelope } = setup();

    const [fromSelect] = screen.getAllByRole<HTMLSelectElement>('combobox');
    await user.selectOptions(fromSelect, 'Acme <hello@acme.io>');

    expect(onSaveEnvelope).not.toHaveBeenCalled();
  });

  test('a value missing from the address book still appears as an option', () => {
    setup({
      emails: { welcome: { ...welcomeModule, from: 'Old <old@acme.io>' } },
    });
    const [fromSelect] = screen.getAllByRole<HTMLSelectElement>('combobox');
    expect(fromSelect.value).toBe('Old <old@acme.io>');
  });

  test('the manage tail item routes to settings instead of saving', async () => {
    const user = userEvent.setup();
    const { onSaveEnvelope, onManageAddresses } = setup();

    const [fromSelect] = screen.getAllByRole<HTMLSelectElement>('combobox');
    await user.selectOptions(fromSelect, 'Manage addresses…');

    expect(onManageAddresses).toHaveBeenCalledOnce();
    expect(onSaveEnvelope).not.toHaveBeenCalled();
  });
});

describe('subject editing', () => {
  test('click to edit, enter to save the new template', async () => {
    const user = userEvent.setup();
    const { onSaveEnvelope } = setup();

    await user.click(screen.getByRole('button', { name: 'Welcome {{ user.name }}' }));
    const editor = screen.getByDisplayValue('Welcome {{ user.name }}');
    await user.clear(editor);
    // user-event escapes `{` as `{{`; `}` needs no escaping
    await user.type(editor, 'Hi {{{{ user.email }}{Enter}');

    expect(onSaveEnvelope).toHaveBeenCalledExactlyOnceWith(
      'welcome',
      'subject',
      'Hi {{ user.email }}'
    );
  });

  test('escape abandons the edit without saving', async () => {
    const user = userEvent.setup();
    const { onSaveEnvelope } = setup();

    await user.click(screen.getByRole('button', { name: 'Welcome {{ user.name }}' }));
    await user.keyboard('{Escape}');

    expect(screen.queryByDisplayValue('Welcome {{ user.name }}')).toBeNull();
    expect(onSaveEnvelope).not.toHaveBeenCalled();
  });
});

describe('channel and registration gates', () => {
  test('non-email channels show no envelope rows at all', () => {
    setup({ refs: [slackRef], emails: {} });
    expect(screen.queryByText('From')).toBeNull();
    expect(screen.queryByText('Subject')).toBeNull();
  });

  test('an unregistered email template stays read-only (no pickers, no editors)', () => {
    setup({ emails: {} });
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('No component registered')).toBeDefined();
  });
});
