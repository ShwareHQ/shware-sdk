import {
  type EmailTemplate,
  type PushTemplate,
  emailTemplate,
  pushTemplate,
} from '@shware/workflow';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import * as z from 'zod/mini';
import { type TemplateRefInfo, collectTemplates } from '../src/components/template-refs';
import { type TemplatePreview, TemplatesPage } from '../src/components/templates-page';

const emailRef: TemplateRefInfo = {
  key: 'welcome',
  channel: 'email',
  usages: [{ workflow: 'onboarding', nodeId: '0', props: {} }],
};
const pushRef: TemplateRefInfo = {
  key: 'nudge',
  channel: 'push',
  usages: [{ workflow: 'onboarding', nodeId: '1', props: {} }],
};

const welcome = emailTemplate({
  title: 'Welcome · display name',
  props: z.strictObject({ name: z.string() }),
  subject: 'Welcome aboard',
  preview: { name: 'Ada' },
  component: ({ name }) => <p>{name}</p>,
});

const nudge = pushTemplate({
  title: 'Nudge · display name',
  props: z.strictObject({}),
  preview: {},
  content: () => ({ title: 'Come back', body: 'Your streak is waiting' }),
});

const DEFAULTS = { from: 'Acme <hello@acme.io>', replyTo: 'Acme Support <support@acme.io>' };

function setup({
  refs = [emailRef],
  emails = { welcome },
  pushes = {},
  preview = { loading: false },
  previewProps,
}: {
  refs?: TemplateRefInfo[];
  emails?: Record<string, EmailTemplate | undefined>;
  pushes?: Record<string, PushTemplate | undefined>;
  preview?: TemplatePreview;
  previewProps?: Record<string, unknown>;
} = {}) {
  render(
    <TemplatesPage
      refs={refs}
      emails={emails}
      pushes={pushes}
      selected={refs[0]?.key}
      emailDefaults={DEFAULTS}
      preview={preview}
      previewProps={previewProps}
      onPreviewPropsChange={() => {}}
    />
  );
}

afterEach(cleanup);

describe('the envelope is read-only', () => {
  test('from and reply-to are the project’s, the subject the template’s — no pickers, no editors', () => {
    setup();

    expect(screen.getByText('Acme <hello@acme.io>')).toBeDefined();
    expect(screen.getByText('Acme Support <support@acme.io>')).toBeDefined();
    expect(screen.getByText('Welcome aboard')).toBeDefined();
    expect(screen.queryByText('Welcome · display name')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  test('a rendered subject replaces the template’s own', () => {
    setup({ preview: { loading: false, subject: 'Welcome, Ada' } });
    expect(screen.getByText('Welcome, Ada')).toBeDefined();
  });

  test('a push shows its content as text', () => {
    setup({ refs: [pushRef], emails: {}, pushes: { nudge } });

    expect(screen.getAllByText('Come back').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Your streak is waiting').length).toBeGreaterThan(0);
    expect(screen.queryByText('Nudge · display name')).toBeNull();
  });
});

describe('failures and registration', () => {
  test('a refused render shows the failing field instead of a document', () => {
    setup({
      preview: {
        loading: false,
        html: '<p>stale</p>',
        failure: { phase: 'props', issues: [{ path: 'name', message: 'Required' }] },
      },
    });

    expect(screen.getByRole('alert').textContent).toContain('name');
    expect(document.querySelector('iframe')).toBeNull();
  });

  test('an unknown key says so instead of showing the first template', () => {
    render(
      <TemplatesPage
        refs={[emailRef]}
        emails={{ welcome }}
        selected="gone"
        emailDefaults={DEFAULTS}
        preview={{ loading: false }}
      />
    );
    expect(screen.getByText('No template gone here.')).toBeDefined();
    expect(screen.queryByText('Welcome aboard')).toBeNull();
  });

  test('an unregistered email template says so', () => {
    setup({ emails: {} });
    expect(screen.getByText('No component registered')).toBeDefined();
  });
});

describe('preview props', () => {
  test('the editor starts from the template’s own preview', () => {
    setup();
    expect(JSON.parse(screen.getByLabelText<HTMLTextAreaElement>('Preview props').value)).toEqual({
      name: 'Ada',
    });
  });

  test('props handed in are what the editor shows, matching what the preview renders', () => {
    setup({ previewProps: { name: 'Grace' } });
    expect(JSON.parse(screen.getByLabelText<HTMLTextAreaElement>('Preview props').value)).toEqual({
      name: 'Grace',
    });
  });
});

describe('the template list', () => {
  test('every registered template, used or not yet, plus referenced ones that are missing', () => {
    const flow = {
      name: 'onboarding',
      flow: [
        { type: 'message', id: '0', channel: 'email', template: 'welcome', props: {} },
        { type: 'message', id: '1', channel: 'push', template: 'gone', props: {} },
      ],
    } as never;
    expect(
      collectTemplates([flow], { emails: { welcome }, pushes: { nudge } }).map((ref) => ({
        id: `${ref.channel}:${ref.key}`,
        uses: ref.usages.length,
      }))
    ).toEqual([
      { id: 'push:gone', uses: 1 },
      { id: 'push:nudge', uses: 0 },
      { id: 'email:welcome', uses: 1 },
    ]);
  });
});
