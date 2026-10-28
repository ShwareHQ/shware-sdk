import { fetch } from '@shware/utils';
import type { CreateFeedbackDTO } from '../schema/index';
import { config } from '../setup/index';

/**
 * `POST <endpoint>/feedback` with the body `createFeedbackSchema` reads. `turnstileToken` is the
 * Cloudflare Turnstile token of the form's widget, which the host verifies server-side; it is
 * single-use, so reset the widget after every call, whether it resolved or threw. Not retried:
 * the request has no deduplication key, and the token would be spent anyway.
 */
export async function sendFeedback(dto: CreateFeedbackDTO) {
  const response = await fetch(`${config.endpoint}/feedback`, {
    method: 'POST',
    credentials: 'include',
    headers: await config.getHeaders(),
    body: JSON.stringify(dto),
  });

  if (!response.ok) {
    throw new Error(`Failed to send feedback: ${response.status} ${await response.text()}`);
  }
}
