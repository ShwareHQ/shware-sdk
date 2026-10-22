import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapSession } from '../../session/map-session';
import type { KVRepository, SessionRepository } from '../../session/types';
import { Auth } from '../index';
import type { AuthorizedHandler } from '../types';

function memorySessions(): SessionRepository<MapSession> {
  return {
    createSession: () => new MapSession(),
    save: async () => {},
    findById: async () => null,
    deleteById: async () => {},
    findByIndexNameAndIndexValue: async () => new Map(),
    findByPrincipalName: async () => new Map(),
    cleanupExpiredSessions: async () => {},
  };
}

/**
 * Keys expire by `Date.now()`, so fake timers drive the TTLs. Every call yields to the event loop
 * first, letting parallel requests interleave between reading the code and counting the attempt.
 */
function memoryKV() {
  const store = new Map<string, { value: string; expiresAt?: number }>();
  const tick = () =>
    new Promise<void>((resolve) => {
      queueMicrotask(resolve);
    });
  const live = (key: string) => {
    const entry = store.get(key);
    if (entry?.expiresAt !== undefined && entry.expiresAt <= Date.now()) store.delete(key);
    return store.get(key);
  };
  const expiresAt = (expiresIn?: number) => (expiresIn ? Date.now() + expiresIn * 1000 : undefined);

  const kv: KVRepository = {
    setItem: async (key, value, expiresIn) => {
      await tick();
      store.set(key, { value, expiresAt: expiresAt(expiresIn) });
    },
    getItem: async (key) => {
      await tick();
      return live(key)?.value ?? null;
    },
    removeItem: async (key) => {
      await tick();
      store.delete(key);
    },
    increment: async (key, expiresIn) => {
      await tick();
      const entry = live(key);
      const count = entry ? Number(entry.value) + 1 : 1;
      store.set(key, { value: String(count), expiresAt: entry?.expiresAt ?? expiresAt(expiresIn) });
      return count;
    },
  };
  return Object.assign(kv, { store });
}

const EMAIL = 'user@example.com';
const CODE_KEY = `email:verification:${EMAIL}`;
const ATTEMPTS_KEY = `email:verification-attempts:${EMAIL}`;
const COOLDOWN_KEY = `email:verification-cooldown:${EMAIL}`;

let kv: ReturnType<typeof memoryKV>;
type Sender = (data: { email: string; verificationCode: string }) => Promise<void>;
let sender: Mock<Sender>;
let handler: Mock<AuthorizedHandler>;

function createAuth(verificationCode?: { maxAttempts?: number; resendCooldown?: number }) {
  return new Auth({
    sessionRepository: memorySessions(),
    kvRepository: kv,
    turnstileSecretKey: 'turnstile-secret',
    verificationCode,
  });
}

function postJson(path: string, body: unknown) {
  return new Request(`https://api.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function send(auth: Auth) {
  return auth.sendEmailVerificationCode(
    postJson('/auth/sendEmailVerificationCode', { email: EMAIL, turnstileToken: 'token' }),
    sender
  );
}

function login(auth: Auth, verificationCode: string) {
  return auth.loginEmail(postJson('/login/email', { email: EMAIL, verificationCode }), handler);
}

async function reason(response: Response) {
  const body = (await response.json()) as { error: { details: { reason: string }[] } };
  return body.error.details[0]?.reason;
}

/** The code the last send delivered. */
function sentCode() {
  const code = sender.mock.calls.at(-1)?.[0].verificationCode;
  if (!code) throw new Error('no code was sent');
  return code;
}

function wrong(code: string) {
  return ((Number(code) + 1) % 1_000_000).toString().padStart(6, '0');
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  kv = memoryKV();
  sender = vi.fn<Sender>(async () => {});
  handler = vi.fn<AuthorizedHandler>(async () => ({ name: 'user-1' }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ success: true }))
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('email verification code attempts', () => {
  it('signs in with the sent code and clears the code and its counter', async () => {
    const auth = createAuth();
    await send(auth);
    expect((await login(auth, wrong(sentCode()))).status).toBe(400);

    const response = await login(auth, sentCode());

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
    expect(kv.store.has(CODE_KEY)).toBe(false);
    expect(kv.store.has(ATTEMPTS_KEY)).toBe(false);
  });

  it('answers a wrong code with INVALID_VERIFICATION_CODE', async () => {
    const auth = createAuth();
    await send(auth);

    const response = await login(auth, wrong(sentCode()));

    expect(response.status).toBe(400);
    expect(await reason(response)).toBe('INVALID_VERIFICATION_CODE');
  });

  it('rejects the right code after maxAttempts wrong guesses and discards it', async () => {
    const auth = createAuth();
    await send(auth);
    for (let i = 0; i < 5; i++) {
      expect(await reason(await login(auth, wrong(sentCode())))).toBe('INVALID_VERIFICATION_CODE');
    }

    const response = await login(auth, sentCode());

    expect(response.status).toBe(400);
    expect(await reason(response)).toBe('VERIFICATION_CODE_ATTEMPTS_EXCEEDED');
    expect(handler).not.toHaveBeenCalled();
    expect(kv.store.has(CODE_KEY)).toBe(false);
    // Once the code is gone, a login is turned away before it is counted.
    expect(await reason(await login(auth, sentCode()))).toBe('INVALID_VERIFICATION_CODE');
  });

  it('honours a configured maxAttempts', async () => {
    const auth = createAuth({ maxAttempts: 2 });
    await send(auth);
    await login(auth, wrong(sentCode()));
    await login(auth, wrong(sentCode()));

    expect(await reason(await login(auth, sentCode()))).toBe('VERIFICATION_CODE_ATTEMPTS_EXCEEDED');
  });

  it('compares at most maxAttempts times under parallel guesses', async () => {
    const auth = createAuth();
    await send(auth);
    const code = sentCode();
    const guesses = Array.from({ length: 20 }, (_, i) =>
      ((Number(code) + 1 + i) % 1_000_000).toString().padStart(6, '0')
    );
    // The right code rides along last; it must not get through once the budget is spent.
    guesses.push(code);

    const reasons = await Promise.all(
      guesses.map(async (guess) => reason(await login(auth, guess)))
    );

    expect(reasons.filter((r) => r === 'INVALID_VERIFICATION_CODE')).toHaveLength(5);
    expect(reasons.filter((r) => r === 'VERIFICATION_CODE_ATTEMPTS_EXCEEDED')).toHaveLength(16);
    expect(handler).not.toHaveBeenCalled();
    expect((await login(auth, code)).status).toBe(400);
  });

  it('does not count logins while no code is stored', async () => {
    const auth = createAuth();

    expect(await reason(await login(auth, '123456'))).toBe('INVALID_VERIFICATION_CODE');
    expect(kv.store.has(ATTEMPTS_KEY)).toBe(false);
  });
});

describe('email verification code resend cooldown', () => {
  it('refuses a resend within the cooldown without sending', async () => {
    const auth = createAuth();
    expect((await send(auth)).status).toBe(200);
    vi.advanceTimersByTime(59_000);

    const response = await send(auth);

    expect(response.status).toBe(429);
    expect(await reason(response)).toBe('VERIFICATION_CODE_RESEND_TOO_SOON');
    expect(sender).toHaveBeenCalledOnce();
  });

  it('sends one code for parallel requests', async () => {
    const auth = createAuth();

    const statuses = await Promise.all([send(auth), send(auth), send(auth)]);

    expect(statuses.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 429, 429]);
    expect(sender).toHaveBeenCalledOnce();
  });

  it('resends after the cooldown with a fresh attempt budget', async () => {
    const auth = createAuth();
    await send(auth);
    for (let i = 0; i < 6; i++) await login(auth, wrong(sentCode()));
    vi.advanceTimersByTime(60_000);

    expect((await send(auth)).status).toBe(200);
    expect(sender).toHaveBeenCalledTimes(2);
    expect(kv.store.has(ATTEMPTS_KEY)).toBe(false);
    for (let i = 0; i < 4; i++) await login(auth, wrong(sentCode()));
    expect((await login(auth, sentCode())).status).toBe(200);
  });

  it('honours a configured resendCooldown', async () => {
    const auth = createAuth({ resendCooldown: 10 });
    await send(auth);
    vi.advanceTimersByTime(10_000);

    expect((await send(auth)).status).toBe(200);
  });

  it('releases the cooldown when delivery fails and keeps the previous code', async () => {
    const auth = createAuth();
    await send(auth);
    const previous = sentCode();
    vi.advanceTimersByTime(60_000);
    sender.mockRejectedValueOnce(new Error('mailbox unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const failed = await send(auth);

    expect(await reason(failed)).toBe('EMAIL_DELIVERY_FAILED');
    expect(kv.store.has(COOLDOWN_KEY)).toBe(false);
    expect((await login(auth, previous)).status).toBe(200);
    expect((await send(auth)).status).toBe(200);
  });

  it('does not claim the cooldown when Turnstile fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ success: false }))
    );
    const auth = createAuth();

    expect(await reason(await send(auth))).toBe('TURNSTILE_VERIFICATION_FAILED');
    expect(kv.store.has(COOLDOWN_KEY)).toBe(false);
    expect(sender).not.toHaveBeenCalled();
  });
});
