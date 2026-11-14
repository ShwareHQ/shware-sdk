const warned = new Set<string>();

/**
 * `console.warn(message)` the first time it is called with that message in this isolate, silent
 * after. For a condition that holds for the whole page, such as a tracker's script blocked by an
 * ad blocker or `localStorage` denied, so one line says so instead of one per event.
 */
export function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}

/** Forgets every message warned so far; for tests. */
export function resetWarnOnce(): void {
  warned.clear();
}
