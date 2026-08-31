import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const MINUTE = 60 * 1000;

async function load(seed: Record<string, string> = {}) {
  const { baseOptions, memoryStorage } = await import('../test/setup');
  const storage = memoryStorage(seed);
  const { setupAnalytics } = await import('./index');
  setupAnalytics(baseOptions({ storage }));
  const session = await import('./session');
  return { storage, ...session };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('touch', () => {
  it('starts a session when nothing is stored, and persists it', async () => {
    const { getSession, storage } = await load();
    const now = Date.now();

    const first = getSession().touch(now);
    expect(first.started).toBe(true);
    expect(storage.map.get('session')).toBe(`1.${first.id}.${now}`);
  });

  it('continues the stored session within the timeout and advances its clock', async () => {
    const { getSession, storage } = await load();
    const first = getSession().touch(Date.now());

    vi.advanceTimersByTime(29 * MINUTE);
    const second = getSession().touch(Date.now());

    expect(second).toEqual({ id: first.id, started: false });
    expect(storage.map.get('session')).toBe(`1.${first.id}.${Date.now()}`);
  });

  it('starts a new session once the timeout has passed', async () => {
    const { getSession } = await load();
    const first = getSession().touch(Date.now());

    vi.advanceTimersByTime(31 * MINUTE);
    const second = getSession().touch(Date.now());

    expect(second.started).toBe(true);
    expect(second.id).not.toBe(first.id);
  });

  it('measures the timeout from the event time it is given, not from the wall clock', async () => {
    const { getSession } = await load();
    const first = getSession().touch(Date.now());

    // The batch was held in a frozen tab: the wall clock has moved 40 minutes, but the events in
    // it happened 5 minutes after the last one.
    const eventTime = Date.now() + 5 * MINUTE;
    vi.advanceTimersByTime(40 * MINUTE);
    const second = getSession().touch(eventTime);

    expect(second).toEqual({ id: first.id, started: false });
  });

  it('never moves the stored clock backwards', async () => {
    const { getSession, storage } = await load();
    const { id } = getSession().touch(Date.now());
    const newest = Date.now() + 10 * MINUTE;
    getSession().touch(newest);

    // A late arrival from another tab, older than what is stored.
    getSession().touch(Date.now() + 5 * MINUTE);

    expect(storage.map.get('session')).toBe(`1.${id}.${newest}`);
  });

  it('starts fresh over an unparseable record', async () => {
    for (const raw of ['2.abc.123', '1..123', '1.abc.NaN', 'garbage']) {
      vi.resetModules();
      const { getSession } = await load({ session: raw });
      expect(getSession().touch(Date.now()).started).toBe(true);
    }
  });
});

describe('extend', () => {
  it('extends a live session without starting a new one', async () => {
    const { getSession, storage } = await load();
    const { id } = getSession().touch(Date.now());

    vi.advanceTimersByTime(10 * MINUTE);
    expect(getSession().extend()).toBe(id);
    expect(storage.map.get('session')).toBe(`1.${id}.${Date.now()}`);
  });

  it('returns an expired session without reviving it', async () => {
    const { getSession, storage } = await load();
    const start = Date.now();
    const { id } = getSession().touch(start);

    vi.advanceTimersByTime(45 * MINUTE);
    expect(getSession().extend()).toBe(id);
    // Not rewritten: the next touch must still see it as expired and announce a new session.
    expect(storage.map.get('session')).toBe(`1.${id}.${start}`);
    expect(getSession().touch(Date.now()).started).toBe(true);
  });

  it('creates a session when nothing is stored at all', async () => {
    const { getSession, storage } = await load();
    const id = getSession().extend();
    expect(storage.map.get('session')).toContain(id);
  });
});

describe('the engagement accumulator', () => {
  it('accrues time while focused, visible and active', async () => {
    const { getSession } = await load();
    const session = getSession();
    session.touch(Date.now());

    vi.advanceTimersByTime(5000);
    session.updateAccumulator();
    expect(session.flush()).toBe(5000);
  });

  it('flush is destructive', async () => {
    const { getSession } = await load();
    const session = getSession();
    vi.advanceTimersByTime(5000);
    session.updateAccumulator();
    session.flush();
    expect(session.flush()).toBe(0);
  });

  it('stops accruing on blur and resumes on focus', async () => {
    const { getSession } = await load();
    const session = getSession();

    vi.advanceTimersByTime(2000);
    session.blur(); // settles 2s, then stops the clock
    vi.advanceTimersByTime(60_000); // unfocused minute: not engagement
    session.focus();
    vi.advanceTimersByTime(3000);

    expect(session.flush()).toBe(5000);
  });

  it('drops a single stretch of SESSION_TIMEOUT or more', async () => {
    // The deliberate divergence documented in GA4.md: a gap with no interaction signals at all is
    // not believed, even though the page stayed focused and visible throughout.
    const { getSession, SESSION_TIMEOUT } = await load();
    const session = getSession();

    vi.advanceTimersByTime(SESSION_TIMEOUT);
    session.updateAccumulator();
    expect(session.flush()).toBe(0);
  });

  it('a clock that jumps backwards cannot produce negative engagement', async () => {
    const { getSession } = await load();
    const session = getSession();

    vi.advanceTimersByTime(3000);
    session.updateAccumulator(); // 3s banked

    vi.setSystemTime(Date.now() - 60_000); // NTP correction rewinds the clock
    session.updateAccumulator(); // negative delta: must be ignored, not subtracted
    vi.advanceTimersByTime(2000);
    session.updateAccumulator();

    expect(session.flush()).toBe(5000);
  });

  it('a new session does not inherit unreported engagement', async () => {
    const { getSession } = await load();
    const session = getSession();
    session.touch(Date.now());

    vi.advanceTimersByTime(5000);
    session.updateAccumulator(); // 5s pending, never flushed

    vi.advanceTimersByTime(31 * MINUTE);
    const next = session.touch(Date.now());
    expect(next.started).toBe(true);
    expect(session.flush()).toBe(0);
  });
});
