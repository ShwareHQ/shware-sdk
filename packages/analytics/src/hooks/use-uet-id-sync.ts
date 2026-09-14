import { useEffect } from 'react';
import { configureUET, syncUETVisitor } from '../third-parties/microsoft-uet';

/**
 * Microsoft Advertising ID Sync from the framework `Analytics` components: record the customer
 * id for `setUETUser` and sync the visitor once per mount — the first page view of the visit,
 * which is where Microsoft wants it. No-op without a customer id.
 */
export function useUETIdSync(customerId: string | number | undefined) {
  useEffect(() => {
    configureUET({ customerId });
    if (customerId !== undefined) void syncUETVisitor();
  }, [customerId]);
}
