import { type ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Renders into the header's slot from whichever route is active — the header
 * lives in the root layout, but its right-hand controls belong to the view.
 */
export function HeaderSlot({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHost(document.getElementById('studio-header-slot'));
  }, []);

  return host ? createPortal(children, host) : null;
}
