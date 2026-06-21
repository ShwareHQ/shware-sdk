/**
 * Tracks checkouts that have been started but may not have been confirmed
 * yet — e.g. the user paid on Stripe and closed the tab before being
 * redirected back to the success page (where `confirmCheckoutSession` runs).
 *
 * IMPORTANT: this stores only the *session ids to retry confirmation on*, a
 * best-effort retry hint — NOT the user's paid/balance state. The server
 * remains the single source of truth for entitlements; on the next app boot
 * we simply re-run the (idempotent, ownership-checked) confirm for each
 * session so the credit balance reflects the purchase without waiting on the
 * async Stripe webhook. Scoped to a single browser; cross-device is covered by
 * the webhook backstop.
 *
 * A *list* (not a single value) is kept on purpose: localStorage is shared
 * across tabs, so two concurrent checkouts — or a second checkout started
 * before the first was reconciled — must not clobber each other.
 */

const KEY = 'pending-checkout';

/** Drop a hint after this long — an abandoned/unpaid checkout shouldn't retry forever. */
const TTL = 60 * 60 * 1000; // 1 hour

/** Cap the list so a string of abandoned checkouts can't grow it unbounded. */
const MAX = 5;

type Entry = { sessionId: string; ts: number };

function isFresh(entry: Entry): boolean {
  return Date.now() - entry.ts <= TTL;
}

function read(): Entry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is Entry => !!e && typeof e.sessionId === 'string' && typeof e.ts === 'number'
    );
  } catch {
    return [];
  }
}

function write(entries: Entry[]) {
  try {
    if (entries.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(entries.slice(-MAX)));
  } catch {
    // ignore — storage unavailable / quota; the webhook still reconciles.
  }
}

/** Record a started checkout to retry confirmation on later. Dedupes by session id. */
export function addPendingCheckout(sessionId: string) {
  const entries = read().filter((e) => isFresh(e) && e.sessionId !== sessionId);
  entries.push({ sessionId, ts: Date.now() });
  write(entries);
}

/** Fresh session ids awaiting confirmation. Persists the pruned list as a side effect. */
export function getPendingCheckouts(): string[] {
  const all = read();
  const fresh = all.filter(isFresh);
  if (fresh.length !== all.length) write(fresh);
  return fresh.map((e) => e.sessionId);
}

/** Drop one session once it's confirmed (or known not to belong to this user). */
export function removePendingCheckout(sessionId: string) {
  write(read().filter((e) => isFresh(e) && e.sessionId !== sessionId));
}
