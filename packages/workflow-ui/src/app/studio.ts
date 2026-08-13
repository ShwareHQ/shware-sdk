import { toast } from 'sonner';
import { PENDING_TOAST_KEY, raisePendingToast } from './integrations/toast/pending';

/**
 * Client for the studio's write-back endpoints (source patches on the dev
 * server). Success feedback goes through the pending-toast machinery: a save
 * changes a file, the file change full-reloads the page, and the toast has to
 * survive that (see pending.ts).
 */

export async function studioPost(path: string, body: Record<string, unknown>): Promise<void> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `${response.status} ${response.statusText}`);
  }
}

/**
 * Run a save and report it exactly once: park the success message for the
 * post-reload raise, with a timer covering the no-reload case — the raiser is
 * consume-once, so the two paths cannot both fire. Failures change no files
 * (nothing reloads), so they toast immediately.
 */
export function reportSave(
  request: Promise<void>,
  messages: { saved: string; failed: string }
): Promise<void> {
  return request
    .then(() => {
      sessionStorage.setItem(PENDING_TOAST_KEY, messages.saved);
      setTimeout(raisePendingToast, 1000);
    })
    .catch((cause: unknown) => {
      toast.error(`${messages.failed}: ${cause instanceof Error ? cause.message : String(cause)}`);
    });
}
