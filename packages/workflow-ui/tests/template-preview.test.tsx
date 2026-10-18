import {
  type EmailTemplate,
  type PushTemplate,
  emailTemplate,
  pushTemplate,
} from '@shware/workflow';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as z from 'zod/mini';
import { useEmailPreview } from '../src/app/email-preview';
import type { TemplateRefInfo } from '../src/components/template-refs';
import { TemplatesPage } from '../src/components/templates-page';
import { type Props, prepareEmail, resolvePush } from '../src/utils/template-content';

const named = z.strictObject({ name: z.string().check(z.minLength(1)) });

const welcome = emailTemplate({
  id: 'welcome',
  title: 'Welcome (display name)',
  description: 'First email after sign-up.',
  props: named,
  subject: 'Welcome aboard',
  preview: { name: 'Ada' },
  component: ({ name }) => <p>Hello {name}</p>,
});

const nudge = pushTemplate({
  id: 'nudge',
  title: 'Nudge (display name)',
  props: named,
  preview: { name: 'Ada' },
  content: ({ name }) => ({ title: `Still there, ${name}?`, body: 'Use code {code} today' }),
});

afterEach(cleanup);

describe('labels and notification', () => {
  test('a push never shows its display name as the notification title', () => {
    const result = resolvePush(nudge);
    expect(result.ok && result.push.title).toBe('Still there, Ada?');
  });

  test('an email preview hands the component the parsed props', () => {
    const result = prepareEmail(welcome, { name: 'Grace' });
    expect(result.ok && result.email.props).toEqual({ name: 'Grace' });
    expect(result.ok && result.email.subject).toBe('Welcome aboard');
  });
});

describe('push content', () => {
  test('content runs over the parsed props and its braces are never expanded', () => {
    const content = vi.fn<(props: { name: string }) => { title: string; body: string }>(
      ({ name }) => ({
        title: `Hi ${name}`,
        body: 'Use code {code}',
      })
    );
    const template = pushTemplate({
      id: 'template',
      title: 'Spy',
      props: named,
      preview: { name: 'Ada' },
      content,
    });
    const input = { name: 'Linus' };

    const result = resolvePush(template, input);

    expect(result).toEqual({ ok: true, push: { title: 'Hi Linus', body: 'Use code {code}' } });
    /* The parsed copy, not the object the studio passed in. */
    const received = content.mock.calls.at(-1)?.[0];
    expect(received).toEqual({ name: 'Linus' });
    expect(received).not.toBe(input);
  });

  test('props the schema refuses never reach content, and the failure names the field', () => {
    const content = vi.fn<() => { title: string; body: string }>(() => ({ title: 't', body: 'b' }));
    const template = pushTemplate({
      id: 'spy',
      title: 'Spy',
      props: named,
      preview: { name: 'A' },
      content,
    });
    content.mockClear();

    const result = resolvePush(template, { name: '' });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.phase).toBe('props');
    expect(!result.ok && result.failure.issues.map((issue) => issue.path)).toEqual(['name']);
    expect(content).not.toHaveBeenCalled();
  });

  test('content that returns no notification is a content failure', () => {
    const template = pushTemplate({
      id: 'template',
      title: 'Broken',
      props: named,
      preview: { name: 'A' },
      content: () => ({ title: 'ok', body: 'ok' }),
    });
    const broken = { ...template, content: () => ({ title: 1 }) } as unknown as PushTemplate;

    const result = resolvePush(broken);

    expect(!result.ok && result.failure.phase).toBe('content');
    expect(!result.ok && result.failure.issues.map((issue) => issue.path)).toContain('title');
  });
});

/* ------------------------------ Page, end to end ----------------------------- */

const emailRef: TemplateRefInfo = { key: 'welcome', channel: 'email', usages: [] };
const pushRef: TemplateRefInfo = { key: 'welcome', channel: 'push', usages: [] };

/** The route's wiring, minus the router: props override in state, the email render through the shared hook. */
function Harness({
  emails,
  pushes,
  channel,
}: {
  emails: Record<string, EmailTemplate>;
  pushes: Record<string, PushTemplate>;
  channel: 'email' | 'push';
}) {
  const [override, setOverride] = useState<Props | undefined>();
  const entry = channel === 'email' ? emails.welcome : undefined;
  const { data, error, isPending } = useEmailPreview(entry, 'welcome', override);
  return (
    <TemplatesPage
      refs={[emailRef, pushRef]}
      emails={emails}
      pushes={pushes}
      selected="welcome"
      selectedChannel={channel}
      emailDefaults={{ from: 'Acme <hello@acme.io>', replyTo: 'Acme Support <support@acme.io>' }}
      previewProps={override}
      onPreviewPropsChange={setOverride}
      preview={{
        ...(data?.status === 'ok' ? { html: data.html } : {}),
        ...(data?.status === 'ok' && data.subject !== undefined ? { subject: data.subject } : {}),
        ...(data?.status === 'invalid' ? { failure: data.failure } : {}),
        ...(error ? { error: error.message } : {}),
        loading: isPending && entry !== undefined,
      }}
    />
  );
}

function renderHarness(
  channel: 'email' | 'push',
  emails: Record<string, EmailTemplate> = { welcome },
  pushes: Record<string, PushTemplate> = { welcome: nudge }
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness emails={emails} pushes={pushes} channel={channel} />
    </QueryClientProvider>
  );
}

function editProps(text: string) {
  fireEvent.change(screen.getByLabelText('Preview props'), { target: { value: text } });
}

const frame = () => document.querySelector<HTMLIFrameElement>('iframe');

describe('email preview validation', () => {
  test('a valid preview renders, with the project defaults as its envelope', async () => {
    renderHarness('email');

    await waitFor(() => expect(frame()?.srcdoc).toContain('Hello <!-- -->Ada'));
    expect(screen.getByText('Acme <hello@acme.io>')).toBeDefined();
    expect(screen.getByText('Welcome aboard')).toBeDefined();
  });

  test('invalid in-memory props show the field path and drop the last good render', async () => {
    renderHarness('email');
    await waitFor(() => expect(frame()).not.toBeNull());

    editProps('{ "name": "" }');

    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.getByText('name')).toBeDefined();
    expect(frame()).toBeNull();

    editProps('{ "name": "Grace" }');
    await waitFor(() => expect(frame()?.srcdoc).toContain('Hello <!-- -->Grace'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('text that is not JSON is a failure too, never the previous render', async () => {
    renderHarness('email');
    await waitFor(() => expect(frame()).not.toBeNull());

    editProps('{ "name": ');

    expect((await screen.findByRole('alert')).textContent).toContain('Not valid JSON');
    expect(frame()).toBeNull();
  });
});

describe('push preview validation', () => {
  test('the same key as an email resolves to the push, drawn from validated content', () => {
    renderHarness('push');

    expect(screen.getAllByText('Still there, Ada?').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Use code {code} today').length).toBeGreaterThan(0);
    expect(screen.queryByText('Nudge (display name)')).toBeNull();
    expect(screen.queryByText('Welcome aboard')).toBeNull();
  });

  test('invalid in-memory props show the field path and no notification', () => {
    renderHarness('push');

    editProps('{ "name": 5 }');

    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText('name')).toBeDefined();
    expect(screen.queryByText(/Still there/)).toBeNull();
  });
});

describe('typing in the props editor', () => {
  test('keystroke by keystroke, the textarea stays the same mounted, focused node', async () => {
    const user = userEvent.setup();
    renderHarness('push');
    const editor = screen.getByLabelText<HTMLTextAreaElement>('Preview props');

    await user.clear(editor);
    /* `{}` is valid JSON at the second keystroke — the moment an override first exists. */
    await user.type(editor, '{{}');
    expect(screen.getByLabelText('Preview props')).toBe(editor);
    expect(document.activeElement).toBe(editor);

    /* Keep typing into the same node: the text is the user's, not a re-serialized copy. */
    await user.keyboard('{ArrowLeft}"name": "Bo"');
    expect(screen.getByLabelText('Preview props')).toBe(editor);
    expect(document.activeElement).toBe(editor);
    expect(editor.value).toBe('{"name": "Bo"}');
    expect(screen.getAllByText('Still there, Bo?').length).toBeGreaterThan(0);
  });

  test('reset puts the template’s own preview back in the editor', async () => {
    const user = userEvent.setup();
    renderHarness('push');
    const editor = screen.getByLabelText<HTMLTextAreaElement>('Preview props');

    await user.clear(editor);
    await user.type(editor, '{{"name": "Bo"}');
    await user.click(screen.getByRole('button', { name: 'Reset' }));

    expect(screen.getByLabelText<HTMLTextAreaElement>('Preview props').value).toBe(
      JSON.stringify({ name: 'Ada' }, null, 2)
    );
    expect(screen.getAllByText('Still there, Ada?').length).toBeGreaterThan(0);
  });
});
