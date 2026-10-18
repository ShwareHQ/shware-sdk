import { describe, expect, test } from 'vitest';
import {
  CfEmailSender,
  type EmailBindingLike,
  routeByPlatform,
  trackEmail,
} from '../src/cloudflare/senders';
import type { MessageSender, OutboundMessage } from '../src/engine/ports';

/** A binding that de-duplicates the way the port asks it to — one delivery per key. */
function fakeBinding() {
  const calls: { to: string; subject: string; idempotencyKey: string }[] = [];
  const delivered = new Set<string>();
  const binding: EmailBindingLike = {
    async send(message) {
      calls.push({
        to: message.to as string,
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
  from: 'noreply@acme.test',
  subject: `${template} for {{ user.first_name }}`,
  html: `<p>${template}</p>`,
});

const message: OutboundMessage = {
  workflow: 'w',
  instanceId: 'inst',
  nodeId: '0',
  channel: 'email',
  template: 'welcome',
  props: {},
  userId: 'u_1',
  recipient: 'ada@example.com',
  idempotencyKey: 'inst_1:2',
};

describe('CfEmailSender', () => {
  test('the idempotency key travels with the binding call; the subject goes out as written', async () => {
    const { binding, calls } = fakeBinding();

    await new CfEmailSender({ binding, render }).send(message);

    expect(calls).toEqual([
      {
        to: 'ada@example.com',
        subject: 'welcome for {{ user.first_name }}',
        idempotencyKey: 'inst_1:2',
      },
    ]);
  });

  test('a replayed step body does not mail the user twice', async () => {
    // The send sits inside step.do, which re-runs after fn resolved but before
    // the checkpoint committed; the key is what lets the binding collapse it.
    const { binding, calls, delivered } = fakeBinding();
    const sender = new CfEmailSender({ binding, render });

    await sender.send(message);
    await sender.send(message);

    expect(calls).toHaveLength(2);
    expect(delivered.size).toBe(1);
  });

  test('a missing recipient fails the step instead of sending nowhere', async () => {
    const { binding, calls } = fakeBinding();
    const sender = new CfEmailSender({ binding, render });

    await expect(sender.send({ ...message, recipient: undefined })).rejects.toThrow(/no recipient/);
    expect(calls).toEqual([]);
  });
});

describe('routeByPlatform', () => {
  const sent: string[] = [];
  const outlet = (name: string): MessageSender => ({
    async send() {
      sent.push(name);
    },
  });
  const push: OutboundMessage = { ...message, channel: 'push', recipient: 'tok' };

  test("hands each copy to the sender of its device's platform", async () => {
    sent.length = 0;
    const route = routeByPlatform({ ios: outlet('ios'), android: outlet('android') });
    await route.send({ ...push, device: { token: 'a', platform: 'android' } });
    await route.send({ ...push, device: { token: 'i', platform: 'ios' } });
    expect(sent).toEqual(['android', 'ios']);
  });

  test('fails the step when the copy has no device or its platform has no sender', async () => {
    const route = routeByPlatform({ ios: outlet('ios') });
    await expect(route.send(push)).rejects.toThrow(/carries no device/);
    await expect(route.send({ ...push, device: { token: 'w', platform: 'web' } })).rejects.toThrow(
      /no push sender configured for platform 'web'/
    );
  });
});

describe('trackEmail', () => {
  const link = (url: string, purpose = 'link') =>
    `https://t.test/${purpose === 'unsubscribe' ? 'u' : 'c'}?u=${encodeURIComponent(url)}`;

  test('routes every http(s) anchor through link, decoding and re-escaping the attribute', () => {
    const html =
      '<a href="https://acme.test/a?x=1&amp;y=2">A</a> <a class="b" href=\'http://acme.test/b\'>B</a> <a href="mailto:hi@acme.test">M</a>';
    expect(trackEmail(html, { link })).toBe(
      `<a href="${link('https://acme.test/a?x=1&y=2').replaceAll('&', '&amp;')}">A</a> <a class="b" href='${link('http://acme.test/b')}'>B</a> <a href="mailto:hi@acme.test">M</a>`
    );
  });

  test('marks the link the email was rendered with as its unsubscribe link, matched by path', () => {
    const html =
      '<a href="https://acme.test/unsubscribe?list=news">U</a> <a href="https://acme.test/unsubscribe-faq">F</a>';
    expect(trackEmail(html, { link }, 'https://acme.test/unsubscribe')).toBe(
      `<a href="${link('https://acme.test/unsubscribe?list=news', 'unsubscribe')}">U</a> <a href="${link('https://acme.test/unsubscribe-faq')}">F</a>`
    );
    // Without an unsubscribe URL, nothing is one — not even a link that looks like it
    expect(trackEmail(html, { link })).not.toContain('https://t.test/u');
  });

  test('appends the open pixel before </body>, or at the end without one', () => {
    expect(trackEmail('<html><body><p>x</p></body></html>', { pixel: 'https://t.test/o' })).toMatch(
      /<p>x<\/p><img src="https:\/\/t\.test\/o" width="1" height="1"[^>]*\/><\/body>/
    );
    expect(trackEmail('<p>x</p>', { pixel: 'https://t.test/o' })).toMatch(/^<p>x<\/p><img /);
  });

  test('CfEmailSender sends the tracked HTML when the copy carries tracking', async () => {
    const htmls: string[] = [];
    const sender = new CfEmailSender({
      binding: {
        send: async (m) => {
          htmls.push(m.html);
          return {};
        },
      },
      render: async () => ({
        from: 'a@acme.test',
        subject: 's',
        html: '<body><a href="https://acme.test">go</a></body>',
      }),
    });
    await sender.send({ ...message, tracking: { link, pixel: 'https://t.test/o' } });
    expect(htmls[0]).toContain(link('https://acme.test'));
    expect(htmls[0]).toContain('src="https://t.test/o"');
  });

  test('CfEmailSender tracks the unsubscribe link the email was rendered with as one', async () => {
    const purposes: string[] = [];
    const sender = new CfEmailSender({
      binding: { send: async () => ({}) },
      render: async () => ({
        from: 'a@acme.test',
        unsubscribeUrl: 'https://acme.test/bye',
        subject: 's',
        html: '<a href="https://acme.test">go</a><a href="https://acme.test/bye">bye</a>',
      }),
    });
    const tracking = {
      link: (url: string, purpose: string) => {
        purposes.push(purpose);
        return url;
      },
    };
    await sender.send({ ...message, tracking });
    expect(purposes).toEqual(['link', 'unsubscribe']);
  });
});
