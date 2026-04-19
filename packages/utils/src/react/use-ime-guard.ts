import { useRef } from 'react';

export function useIMEGuard() {
  const composing = useRef(false);
  return {
    composing,
    onCompositionStart: () => (composing.current = true),
    onCompositionEnd: () => (composing.current = false),
  };
}
