import { useRef } from 'react';

/**
 * A stable ref updated synchronously during render, retained for compatibility.
 * This legacy timing can expose values from an uncommitted concurrent render. Do not use it
 * for callbacks that may run while rendering is pending; keep those refs in commit effects.
 */
export function useLatestRef<T>(value: T) {
  const ref = useRef<T>(value);
  // oxlint-disable-next-line react/refs -- The public helper intentionally retains its synchronous render-time contract.
  ref.current = value;
  return ref;
}
