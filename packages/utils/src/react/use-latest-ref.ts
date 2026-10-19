import { useRef } from 'react';

/**
 * A stable ref updated synchronously during render, retained for compatibility.
 * This preserves existing reads from layout effects, ref callbacks, and debounced callbacks.
 * Concurrent renders can expose uncommitted values; this helper is not a committed-only snapshot.
 */
export function useLatestRef<T>(value: T) {
  const ref = useRef<T>(value);
  // oxlint-disable-next-line react/refs -- The public helper intentionally retains its synchronous render-time contract.
  ref.current = value;
  return ref;
}
