import { toast } from 'sonner';

/**
 * A studio write-back edits a source file, which makes Vite full-reload the
 * page — wiping any toast raised at save time. The saving view parks the
 * message here; the root layout re-raises it right after the reload, so the
 * confirmation actually stays on screen long enough to read.
 */
export const PENDING_TOAST_KEY = 'workflow-ui:pending-toast';

export function raisePendingToast(): void {
  const message = sessionStorage.getItem(PENDING_TOAST_KEY);
  if (message === null) return;
  sessionStorage.removeItem(PENDING_TOAST_KEY);
  toast.success(message);
}
