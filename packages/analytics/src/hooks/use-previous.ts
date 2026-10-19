import { useEffect, useRef } from 'react';

export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  });
  // Private history adapter: effects write the ref, and consumers use its snapshot only in effects.
  // oxlint-disable-next-line react/refs -- Preserve this effect-only previous-value contract.
  return ref.current;
}
