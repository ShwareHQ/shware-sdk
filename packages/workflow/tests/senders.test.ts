import { describe, expect, test } from 'vitest';
import { CfEmailSender, type EmailBindingLike } from '../src/cloudflare/senders';
import type { OutboundMessage } from '../src/engine/ports';

/** A binding that de-duplicates the way the port asks it to — one delivery per key. */
function fakeBinding() {
  const calls: { to: string; subject: string; idempotencyKey: string }[] = [];
  const delivered = new Set<string>();
  const binding: EmailBindingLike = {
    async send(message) {
      calls.push({
        to: message.to,
        subject: message.subject,
        idempotencyKey: message.idempotencyKey,
      });
      delivered.add(message.idempotencyKey);
      return { ok: true };
    },
  };
  return { binding, calls, delivered };
}

const render = async (template: string) => ({
  subject: `${template} for {{ user.first_name }}`,
  html: `<p>${template}</p>`,
});

const message: OutboundMessage = {
  channel: 'email',
  template: 'welcome',
  props: {},
  userId: 'u_1',
  recipient: 'ada@example.com',
  idempotencyKey: 'inst_1:2',
};

describe('CfEmailSender', () => {
  test('the idempotency key travels with the binding call', async () => {
    const { binding, calls } = fakeBinding();

    await new CfEmailSender(binding, 'noreply@acme.test', render, async () => 'Ada').send(message);

    expect(calls).toEqual([
      { to: 'ada@example.com', subject: 'welcome for Ada', idempotencyKey: 'inst_1:2' },
    ]);
  });

  test('a replayed step body does not mail the user twice', async () => {
    // The send sits inside step.do, which re-runs after fn resolved but before
    // the checkpoint committed; the key is what lets the binding collapse it.
    const { binding, calls, delivered } = fakeBinding();
    const sender = new CfEmailSender(binding, 'noreply@acme.test', render);

    await sender.send(message);
    await sender.send(message);

    expect(calls).toHaveLength(2);
    expect(delivered.size).toBe(1);
  });

  test('a missing recipient fails the step instead of sending nowhere', async () => {
    const { binding, calls } = fakeBinding();
    const sender = new CfEmailSender(binding, 'noreply@acme.test', render);

    await expect(sender.send({ ...message, recipient: undefined })).rejects.toThrow(/no recipient/);
    expect(calls).toEqual([]);
  });
});
