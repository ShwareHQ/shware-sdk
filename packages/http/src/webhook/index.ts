import { createHmac, timingSafeEqual } from 'crypto';
import { Status } from '../status';

const WEBHOOK_TOLERANCE_IN_SECONDS = 5 * 60; // 5 minutes

function verifyTimestamp(webhookTimestamp: string) {
  const now = Math.floor(Date.now() / 1000);
  const timestamp = parseInt(webhookTimestamp, 10);
  if (isNaN(timestamp)) {
    throw Status.invalidArgument('invalid webhook timestamp').error();
  }
  if (timestamp < now - WEBHOOK_TOLERANCE_IN_SECONDS) {
    throw Status.invalidArgument('webhook timestamp is too old').error();
  }
  if (timestamp > now + WEBHOOK_TOLERANCE_IN_SECONDS) {
    throw Status.invalidArgument('webhook timestamp is too new').error();
  }
  return timestamp;
}

/**
 * reference: https://github.com/standard-webhooks/standard-webhooks/tree/main/libraries/javascript
 * hono usage:
 * ```ts
 * const webhook = verifyStandardWebhook(c.req.header(), await c.req.text(), 'secret');
 * ```
 */
export function verifyStandardWebhook<T = unknown>(
  headers: Record<string, string>,
  payload: string,
  secret: string
): T {
  const webhookId = headers['webhook-id'];
  const webhookTimestamp = headers['webhook-timestamp'];
  const webhookSignature = headers['webhook-signature'];
  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    throw Status.invalidArgument('invalid webhook').error();
  }
  const timestamp = verifyTimestamp(webhookTimestamp);

  const encoder = new TextEncoder();
  const toSign = encoder.encode(`${webhookId}.${timestamp}.${payload}`);
  const hmac = createHmac('sha256', Buffer.from(secret, 'base64'));
  const digest = hmac.update(toSign).digest();

  const computedSignature = `v1,${Buffer.from(digest).toString('base64')}`;
  const expectedSignature = computedSignature.split(',')[1];
  const passedSignatures = webhookSignature.split(' ');

  for (const versionedSignature of passedSignatures) {
    const [version, signature] = versionedSignature.split(',');
    if (version !== 'v1') continue;
    if (timingSafeEqual(encoder.encode(signature), encoder.encode(expectedSignature))) {
      try {
        return JSON.parse(payload) as T;
      } catch (_) {
        console.error('invalid payload', payload);
        throw Status.invalidArgument('invalid webhook payload').error();
      }
    }
  }
  console.error('webhook verification failed');
  throw Status.invalidArgument('invalid webhook signature').error();
}
