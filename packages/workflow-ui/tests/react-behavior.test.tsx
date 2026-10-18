import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ThemeProvider,
  applyStoredTheme,
  useTheme,
} from '../src/app/integrations/theme/root-provider';
import { ProfileDrawer } from '../src/components/profile-drawer';
import { SlackPreview } from '../src/components/slack-preview';

const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const execDescriptor = Object.getOwnPropertyDescriptor(document, 'execCommand');
afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
  else Reflect.deleteProperty(navigator, 'clipboard');
  if (execDescriptor) Object.defineProperty(document, 'execCommand', execDescriptor);
  else Reflect.deleteProperty(document, 'execCommand');
});

function themeMedia(initial: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: initial,
    addEventListener: (_type: string, listener: () => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: () => void) => {
      listeners.delete(listener);
    },
  };
  vi.stubGlobal('matchMedia', () => query);
  return {
    listeners,
    change(matches: boolean) {
      query.matches = matches;
      act(() => listeners.forEach((listener) => listener()));
    },
  };
}
function ThemeControls() {
  const { theme, resolved, setTheme } = useTheme();
  return (
    <>
      <output>
        {theme}:{resolved}
      </output>
      <button type="button" onClick={() => setTheme('light')}>
        Light
      </button>
      <button type="button" onClick={() => setTheme('dark')}>
        Dark
      </button>
      <button type="button" onClick={() => setTheme('system')}>
        System
      </button>
    </>
  );
}

describe('theme preference and system changes', () => {
  it('follows system changes, preserves explicit preferences and cleans up subscriptions', () => {
    const media = themeMedia(true);
    applyStoredTheme();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    const view = render(
      <ThemeProvider>
        <ThemeControls />
      </ThemeProvider>
    );
    expect(screen.getByRole('status').textContent).toBe('system:dark');
    expect(media.listeners.size).toBe(1);
    fireEvent.click(screen.getByText('Light'));
    expect(localStorage.getItem('workflow-ui-theme')).toBe('light');
    expect(media.listeners.size).toBe(0);
    media.change(false);
    media.change(true);
    expect(screen.getByRole('status').textContent).toBe('light:light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    fireEvent.click(screen.getByText('Dark'));
    media.change(false);
    expect(screen.getByRole('status').textContent).toBe('dark:dark');
    fireEvent.click(screen.getByText('System'));
    expect(screen.getByRole('status').textContent).toBe('system:light');
    media.change(true);
    expect(screen.getByRole('status').textContent).toBe('system:dark');
    view.unmount();
    expect(media.listeners.size).toBe(0);
  });

  it('loads a stored explicit preference before mounting and tolerates missing matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined);
    localStorage.setItem('workflow-ui-theme', 'dark');
    applyStoredTheme();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    render(
      <ThemeProvider>
        <ThemeControls />
      </ThemeProvider>
    );
    expect(screen.getByRole('status').textContent).toBe('dark:dark');
    fireEvent.click(screen.getByText('System'));
    expect(screen.getByRole('status').textContent).toBe('system:light');
  });
});

function mountCopy() {
  render(<ProfileDrawer profile={{ id: 'profile-123' }} onClose={() => {}} />);
  return screen.getByRole('button', { name: 'Copy' });
}
function clipboard(write: (value: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: write },
  });
}
function fallback(copy: (command: string) => boolean) {
  Object.defineProperty(document, 'execCommand', { configurable: true, value: copy });
}

describe('profile copy feedback', () => {
  it('reports Clipboard API success without using the fallback', async () => {
    const write = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);
    const copy = vi.fn<(command: string) => boolean>();
    clipboard(write);
    fallback(copy);
    const button = mountCopy();
    await act(async () => button.click());
    expect(write).toHaveBeenCalledExactlyOnceWith('profile-123');
    expect(copy).not.toHaveBeenCalled();
    expect(button.querySelector('.lucide-check')).toBeTruthy();
  });

  it.each([true, false])(
    'uses the fallback result %s after Clipboard API rejection',
    async (success) => {
      clipboard(
        vi.fn<(value: string) => Promise<void>>().mockRejectedValue(new Error('Permission denied'))
      );
      const copy = vi.fn<(command: string) => boolean>().mockReturnValue(success);
      fallback(copy);
      const button = mountCopy();
      button.focus();
      await act(async () => button.click());
      expect(copy).toHaveBeenCalledExactlyOnceWith('copy');
      expect(Boolean(button.querySelector('.lucide-check'))).toBe(success);
      expect(document.querySelector('textarea')).toBeNull();
      expect(document.activeElement).toBe(button);
    }
  );

  it('cleans up a throwing fallback without displaying success', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    fallback(() => {
      throw new Error('Copy unsupported');
    });
    const button = mountCopy();
    await act(async () => button.click());
    expect(button.querySelector('.lucide-check')).toBeNull();
    expect(document.querySelector('textarea')).toBeNull();
  });
});

it('preserves Slack text and action DOM identity and focus when preview settings change', () => {
  const message = {
    text: 'Preview',
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: '<https://example.com|Open>' } },
      {
        type: 'actions',
        elements: [{ type: 'button', text: { type: 'plain_text', text: 'Reply' } }],
      },
    ],
  };
  const view = render(<SlackPreview message={message} appName="Acme" scheme="light" zoom={1} />);
  const link = screen.getByRole('link', { name: 'Open' });
  const action = screen.getByText('Reply');
  link.focus();
  view.rerender(<SlackPreview message={message} appName="Acme" scheme="dark" zoom={0.8} />);
  expect(screen.getByRole('link', { name: 'Open' })).toBe(link);
  expect(screen.getByText('Reply')).toBe(action);
  expect(document.activeElement).toBe(link);
});
