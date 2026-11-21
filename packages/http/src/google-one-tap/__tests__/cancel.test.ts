import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { PromptMomentNotification } from '../types';

const CANCELLED = { authorized: false, dismissed: true, reason: 'cancel_called' };

type Listener = (notification: PromptMomentNotification) => void;
type Config = { callback: (credential: unknown) => void };

/**
 * Stubs the browser and `google.accounts.id`. The GSI script loads when `load()` is called
 * (at once with `loaded`), and the prompt stays on screen until the test ends it.
 */
function stubGoogle({ loaded = true, reportsCancel = false } = {}) {
  let listener: Listener | undefined;
  let onload: (() => void) | undefined;
  const id = {
    initialize: vi.fn<(config: Config) => void>(),
    prompt: vi.fn<(l: Listener) => void>((l) => {
      listener = l;
    }),
    cancel: vi.fn<() => void>(() => {
      if (!reportsCancel) return; // under FedCM the dismissal may never be reported
      listener?.({
        isSkippedMoment: () => false,
        isDismissedMoment: () => true,
        getDismissedReason: () => 'cancel_called',
      } as PromptMomentNotification);
    }),
  };
  vi.stubGlobal('window', { IdentityCredential: class {}, google: { accounts: { id } } });
  vi.stubGlobal('document', {
    createElement: () => ({}),
    head: {
      appendChild: (script: { onload?: () => void }) => {
        onload = script.onload;
        if (loaded) onload?.();
      },
    },
  });
  return {
    id,
    load: () => onload?.(),
    pick: () => id.initialize.mock.calls.at(-1)?.[0].callback({ credential: 'jwt' }),
  };
}

/** A fresh module per test: the script element and the prompts in flight are module state. */
async function load() {
  vi.resetModules();
  return import('../index');
}

const flush = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

describe('google one tap cancel', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  test('closes a prompt on screen, which GSI reports as cancel_called', async () => {
    const { id } = stubGoogle({ reportsCancel: true });
    const { prompt, cancel } = await load();
    const result = prompt({ client_id: 'client' });
    await vi.waitFor(() => expect(id.prompt).toHaveBeenCalledTimes(1));

    cancel();

    expect(id.cancel).toHaveBeenCalledTimes(1);
    await expect(result).resolves.toEqual(CANCELLED);
  });

  test('settles the prompt itself when GSI reports nothing (FedCM)', async () => {
    const { id } = stubGoogle({ reportsCancel: false });
    const { prompt, cancel } = await load();
    const result = prompt({ client_id: 'client' });
    await vi.waitFor(() => expect(id.prompt).toHaveBeenCalledTimes(1));

    cancel();

    expect(id.cancel).toHaveBeenCalledTimes(1);
    await expect(result).resolves.toEqual(CANCELLED);
  });

  test('settles the prompt even if GSI cancel throws', async () => {
    const { id } = stubGoogle();
    id.cancel.mockImplementation(() => {
      throw new Error('gsi');
    });
    const { prompt, cancel } = await load();
    const result = prompt({ client_id: 'client' });
    await vi.waitFor(() => expect(id.prompt).toHaveBeenCalledTimes(1));

    expect(() => cancel()).not.toThrow();
    await expect(result).resolves.toEqual(CANCELLED);
  });

  test('a prompt cancelled while the script loads never shows nor asks for the nonce', async () => {
    const google = stubGoogle({ loaded: false });
    const { prompt, cancel } = await load();
    const nonce = vi.fn<() => string>(() => 'nonce');
    const result = prompt({ client_id: 'client', nonce });
    await flush();

    cancel();
    google.load();

    await expect(result).resolves.toEqual(CANCELLED);
    expect(nonce).not.toHaveBeenCalled();
    expect(google.id.initialize).not.toHaveBeenCalled();
    expect(google.id.prompt).not.toHaveBeenCalled();
    // Nothing was on screen, so GSI was left alone
    expect(google.id.cancel).not.toHaveBeenCalled();
  });

  test('a prompt cancelled while the nonce is pending never shows', async () => {
    const { id } = stubGoogle();
    const { prompt, cancel } = await load();
    let resolveNonce: (nonce: string) => void = () => {};
    const nonce = vi.fn<() => Promise<string>>(
      () =>
        new Promise((resolve) => {
          resolveNonce = resolve;
        })
    );
    const result = prompt({ client_id: 'client', nonce });
    await vi.waitFor(() => expect(nonce).toHaveBeenCalledTimes(1));

    cancel();
    resolveNonce('nonce');

    await expect(result).resolves.toEqual(CANCELLED);
    expect(id.initialize).not.toHaveBeenCalled();
    expect(id.prompt).not.toHaveBeenCalled();
  });

  test('a nonce that rejects after the cancel does not reject the prompt', async () => {
    stubGoogle();
    const { prompt, cancel } = await load();
    let rejectNonce: (error: Error) => void = () => {};
    const nonce = vi.fn<() => Promise<string>>(
      () =>
        new Promise((_, reject) => {
          rejectNonce = reject;
        })
    );
    const result = prompt({ client_id: 'client', nonce });
    await vi.waitFor(() => expect(nonce).toHaveBeenCalledTimes(1));

    cancel();
    rejectNonce(new Error('aborted'));

    await expect(result).resolves.toEqual(CANCELLED);
  });

  test('does nothing with no prompt in flight', async () => {
    const { id } = stubGoogle();
    const { cancel } = await load();

    expect(() => cancel()).not.toThrow();
    expect(id.cancel).not.toHaveBeenCalled();
  });

  test('does nothing outside a browser', async () => {
    const { cancel } = await load();
    expect(typeof window).toBe('undefined');

    expect(() => cancel()).not.toThrow();
  });

  test('a prompt after a cancel runs normally', async () => {
    const google = stubGoogle();
    const { prompt, cancel } = await load();
    const first = prompt({ client_id: 'client' });
    await vi.waitFor(() => expect(google.id.prompt).toHaveBeenCalledTimes(1));
    cancel();
    await expect(first).resolves.toEqual(CANCELLED);

    const second = prompt({ client_id: 'client' });
    await vi.waitFor(() => expect(google.id.prompt).toHaveBeenCalledTimes(2));
    google.pick();

    await expect(second).resolves.toEqual({ authorized: true, credential: { credential: 'jwt' } });
  });

  test('leaves a credential already returned alone', async () => {
    const google = stubGoogle();
    const { prompt, cancel } = await load();
    const result = prompt({ client_id: 'client' });
    await vi.waitFor(() => expect(google.id.prompt).toHaveBeenCalledTimes(1));
    google.pick();

    cancel();

    await expect(result).resolves.toEqual({ authorized: true, credential: { credential: 'jwt' } });
    expect(google.id.cancel).not.toHaveBeenCalled();
  });
});
