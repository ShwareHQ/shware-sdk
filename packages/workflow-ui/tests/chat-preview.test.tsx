import { discordTemplate, slackTemplate } from '@shware/workflow';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import * as z from 'zod/mini';
import type { TemplateRefInfo } from '../src/components/template-refs';
import { type TemplatePreview, TemplatesPage } from '../src/components/templates-page';

/** Discord and Slack templates preview as the message their client would draw. */

afterEach(cleanup);

const props = z.strictObject({ name: z.string() });
const discords = {
  sale: discordTemplate({
    id: 'sale',
    title: 'Sale',
    props,
    preview: { name: 'Ada' },
    webhook: () => 'https://discord.com/api/webhooks/1/x',
    content: ({ name }) => ({
      content: `**${name}** bought [Pro](https://example.com/pro)`,
      embeds: [
        { title: 'Pro · monthly', fields: [{ name: 'Amount', value: '$9.99', inline: true }] },
      ],
    }),
  }),
};
const slacks = {
  alert: slackTemplate({
    id: 'alert',
    title: 'Alert',
    props,
    preview: { name: 'Ada' },
    webhook: () => 'https://hooks.slack.com/services/T/B/x',
    content: ({ name }) => ({
      text: `${name} scored 4`,
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: 'Detractor alert' } },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*${name}* — <mailto:ada@example.com|email her>` },
        },
        {
          type: 'actions',
          elements: [{ type: 'button', text: { type: 'plain_text', text: 'Reply' } }],
        },
      ],
    }),
  }),
};
const preview: TemplatePreview = { loading: false };
const ref = (channel: string, key: string): TemplateRefInfo => ({ key, channel, usages: [] });

describe('chat previews', () => {
  test('a Discord message: the app name, formatted content and its embed', () => {
    render(
      <TemplatesPage
        refs={[ref('discord', 'sale')]}
        emails={{}}
        discords={discords}
        appName="Acme"
        selected="sale"
        selectedChannel="discord"
        preview={preview}
      />
    );
    expect(screen.getByText('Acme')).toBeTruthy();
    expect(screen.getByText('Ada').tagName).toBe('STRONG');
    expect(screen.getByRole('link', { name: 'Pro' }).getAttribute('href')).toBe(
      'https://example.com/pro'
    );
    expect(screen.getByText('Pro · monthly')).toBeTruthy();
    expect(screen.getByText('$9.99')).toBeTruthy();
  });

  test('a Slack message: its blocks, mrkdwn links and buttons', () => {
    render(
      <TemplatesPage
        refs={[ref('slack', 'alert')]}
        emails={{}}
        slacks={slacks}
        appName="Acme"
        selected="alert"
        selectedChannel="slack"
        preview={preview}
      />
    );
    expect(screen.getByText('Detractor alert')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'email her' }).getAttribute('href')).toBe(
      'mailto:ada@example.com'
    );
    expect(screen.getByText('Reply')).toBeTruthy();
  });

  test('content the template refuses shows the failure instead of a message', () => {
    render(
      <TemplatesPage
        refs={[ref('slack', 'alert')]}
        emails={{}}
        slacks={slacks}
        selected="alert"
        selectedChannel="slack"
        preview={preview}
        previewProps={{}}
      />
    );
    expect(screen.getByRole('alert').textContent).toContain('name');
  });
});
