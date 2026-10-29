import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { StatusError } from '../../error/status';
import { verifyStandardWebhook } from '../index';

const secret = Buffer.from('webhook-secret').toString('base64');
const payload = JSON.stringify({ type: 'ping' });

function headers(signature: string) {
  return {
    'webhook-id': 'msg_1',
    'webhook-timestamp': String(Math.floor(Date.now() / 1000)),
    'webhook-signature': signature,
  };
}

function sign(h: Record<string, string>) {
  const digest = createHmac('sha256', Buffer.from(secret, 'base64'))
    .update(`${h['webhook-id']}.${h['webhook-timestamp']}.${payload}`)
    .digest('base64');
  return `v1,${digest}`;
}

function verify(signature: string) {
  return () => verifyStandardWebhook(headers(signature), payload, secret);
}

describe('verifyStandardWebhook', () => {
  it('accepts a valid v1 signature among others', () => {
    const h = headers('');
    h['webhook-signature'] = `v1 v1,short ${sign(h)}`;
    expect(verifyStandardWebhook(h, payload, secret)).toEqual({ type: 'ping' });
  });

  it.each([
    ['a signature of another length', 'v1,x'],
    ['a missing signature', 'v1'],
    ['an empty signature', 'v1,'],
  ])('refuses %s as an invalid signature', (_, signature) => {
    expect(verify(signature)).toThrow(StatusError);
    expect(verify(signature)).toThrow('invalid webhook signature');
  });
});
