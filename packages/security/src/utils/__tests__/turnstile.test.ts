import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorResponse } from '../../auth/respond';
import {
  TURNSTILE_SITEVERIFY_URL,
  type VerifyTurnstileTokenOptions,
  verifyTurnstileToken,
} from '../turnstile';

const siteverify = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal('fetch', siteverify);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  siteverify.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The status and ErrorInfo reason the response for the thrown error carries, or `null`. */
async function outcome(options: Partial<VerifyTurnstileTokenOptions> = {}) {
  try {
    await verifyTurnstileToken({ secret: 'secret', token: 'tok', ...options });
    return null;
  } catch (error) {
    const response = errorResponse(error);
    if (!response) throw error;
    const body = (await response.json()) as {
      error: { status: string; details: { reason: string }[] };
    };
    return { status: response.status, reason: body.error.details[0]?.reason };
  }
}

/** The form each siteverify call posted. */
function sent() {
  return siteverify.mock.calls.map(([, init]) =>
    Object.fromEntries(new URLSearchParams(init?.body as URLSearchParams))
  );
}

const FAILED = { status: 403, reason: 'TURNSTILE_VERIFICATION_FAILED' };
const UNAVAILABLE = { status: 503, reason: 'TURNSTILE_UNAVAILABLE' };

describe('verifyTurnstileToken', () => {
  it('resolves on success, posting to Cloudflare with a timeout signal', async () => {
    siteverify.mockImplementation(async () => Response.json({ success: true }));

    expect(await outcome()).toBeNull();

    const [url, init] = siteverify.mock.calls[0] ?? [];
    expect(url).toBe(TURNSTILE_SITEVERIFY_URL);
    expect(init?.method).toBe('POST');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('sends remoteip only when there is an address', async () => {
    siteverify.mockImplementation(async () => Response.json({ success: true }));

    await outcome({ remoteIp: '198.51.100.1' });
    await outcome();
    await outcome({ remoteIp: null });

    expect(sent()).toEqual([
      { secret: 'secret', response: 'tok', remoteip: '198.51.100.1' },
      { secret: 'secret', response: 'tok' },
      { secret: 'secret', response: 'tok' },
    ]);
  });

  it('posts to the siteverifyUrl given', async () => {
    siteverify.mockImplementation(async () => Response.json({ success: true }));

    await outcome({ siteverifyUrl: 'https://turnstile.test/turnstile/v0/siteverify' });

    expect(siteverify.mock.calls[0]?.[0]).toBe('https://turnstile.test/turnstile/v0/siteverify');
  });

  it('fails with 403 and logs the error codes on success: false', async () => {
    siteverify.mockResolvedValue(
      Response.json({ success: false, 'error-codes': ['invalid-input-response'] })
    );

    expect(await outcome()).toEqual(FAILED);
    expect(console.warn).toHaveBeenCalledWith('Turnstile verification failed', [
      'invalid-input-response',
    ]);
  });

  it('checks hostname and action only when expected', async () => {
    siteverify.mockImplementation(async () =>
      Response.json({ success: true, hostname: 'app.example.com', action: 'login' })
    );

    expect(await outcome()).toBeNull();
    expect(await outcome({ hostname: 'app.example.com', action: 'login' })).toBeNull();
    expect(await outcome({ hostname: ['example.com', 'app.example.com'] })).toBeNull();
    expect(await outcome({ hostname: 'evil.example' })).toEqual(FAILED);
    expect(await outcome({ hostname: ['example.com'] })).toEqual(FAILED);
    expect(await outcome({ action: 'feedback' })).toEqual(FAILED);
    expect(console.warn).toHaveBeenCalledWith('Turnstile verification failed', [
      'action-mismatch: login',
    ]);
  });

  it('fails an expected hostname or action that siteverify does not report', async () => {
    siteverify.mockImplementation(async () => Response.json({ success: true }));

    expect(await outcome({ hostname: 'app.example.com' })).toEqual(FAILED);
    expect(await outcome({ action: 'login' })).toEqual(FAILED);
  });

  it.each([
    ['a non-2xx answer', () => Promise.resolve(new Response('<html>', { status: 502 }))],
    ['a network error', () => Promise.reject(new TypeError('fetch failed'))],
    ['an abort', () => Promise.reject(new DOMException('timed out', 'TimeoutError'))],
    ['a body that is not JSON', () => Promise.resolve(new Response('<html>', { status: 200 }))],
    ['JSON null', () => Promise.resolve(Response.json(null))],
    ['JSON without a boolean success', () => Promise.resolve(Response.json({ success: 'yes' }))],
  ])('answers 503 on %s', async (_, answer) => {
    siteverify.mockImplementation(answer);

    expect(await outcome()).toEqual(UNAVAILABLE);
    expect(console.error).toHaveBeenCalledWith(
      'Turnstile siteverify unavailable',
      expect.any(Error)
    );
  });

  it('gives siteverify 5 seconds, then answers 503', async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    siteverify.mockImplementation(
      (_, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          signal?.addEventListener('abort', () => reject(signal.reason as Error));
        })
    );

    const pending = outcome();
    controller.abort(new DOMException('The operation timed out.', 'TimeoutError'));

    expect(await pending).toEqual(UNAVAILABLE);
    expect(timeout).toHaveBeenCalledWith(5000);
  });
});
