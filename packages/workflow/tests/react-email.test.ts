import { createElement } from 'react';
import { describe, expect, test } from 'vitest';
import { registryRenderer } from '../src/react-email';

const emails = {
  welcome: {
    subject: 'Welcome {{ user.name }}',
    default: ({ name }: { name: string }) => createElement('p', null, `Hi ${name}`),
  },
  bare: { default: () => createElement('div') },
};

describe('registryRenderer', () => {
  test('renders the registered component with the doctype and returns the raw subject template', async () => {
    const render = registryRenderer(emails);
    const { subject, html } = await render('welcome', { name: 'Ada' });
    expect(subject).toBe('Welcome {{ user.name }}');
    expect(html.startsWith('<!DOCTYPE html PUBLIC')).toBe(true);
    expect(html.endsWith('<p>Hi Ada</p>')).toBe(true);
  });

  test('falls back to the key as subject and rejects unknown keys', async () => {
    const render = registryRenderer(emails);
    expect((await render('bare', {})).subject).toBe('bare');
    await expect(render('nope', {})).rejects.toThrow('unknown email template: nope');
  });
});
