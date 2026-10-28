import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { isUnsubscribeLink } from '../src/email';
import type { OutboundMessage } from '../src/engine/ports';
import { forgetUser, sweepSegments } from '../src/host/ingest';
import { InstanceNotFoundError, type JourneyEnv } from '../src/host/platform';
import { classifyClick, classifyOpen } from '../src/reporting/classify';
import { reportingObserver } from '../src/reporting/observer';
import { handleTracking, recordPushOpen } from '../src/reporting/tracking';
import { type Engagement, UserErasedError } from '../src/store/index';
import { PostgresJourneyStore, type SqlClientLike } from '../src/store/postgres';
import { type PgliteDatabase, pgliteDatabase, truncateAll } from './pglite';

/**
 * Reporting on Postgres: what the observer records as a journey runs, and what the tracking
 * routes record when a recipient opens, clicks or unsubscribes.
 */

let database: PgliteDatabase;
let pg: PgliteDatabase['pg'];

beforeAll(async () => {
  database = await pgliteDatabase();
  pg = database.pg;
}, 30_000);

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  vi.useRealTimers();
  await truncateAll(pg);
});

const reporting = () => database.storeIn().reporting;

const email = (overrides: Partial<OutboundMessage> = {}): OutboundMessage => ({
  workflow: 'welcome',
  instanceId: 'i1',
  nodeId: 'n1',
  channel: 'email',
  template: 'welcome',
  props: {},
  userId: 'u1',
  recipient: 'ada@example.com',
  idempotencyKey: 'i1:n1',
  topic: 'promotions',
  ...overrides,
});

/** An email with these links sent; `unsubscribeUrl` is the one it was rendered with. */
async function sendEmail(
  urls: string[],
  unsubscribeUrl?: string,
  overrides: Partial<OutboundMessage> = {}
) {
  const observer = reportingObserver(reporting(), 'https://wf.example.com/');
  const message = email(overrides);
  const tracking = await observer.messagePrepared?.(message);
  const tracked = urls.map((url) =>
    tracking?.link?.(url, isUnsubscribeLink(url, unsubscribeUrl) ? 'unsubscribe' : 'link')
  );
  // What the email sender does once the links are rewritten, before the transport takes it
  await tracking?.commit?.();
  await observer.messageSent?.(message, { delivered: true });
  const id = /\/t\/o\/(.+)$/.exec(tracking?.pixel ?? '')?.[1] ?? '';
  return { id, tracked, tracking };
}

const get = (path: string, userAgent = 'Mozilla/5.0 (Macintosh) AppleWebKit Version/18 Mail') =>
  new Request(`https://wf.example.com${path}`, { headers: { 'user-agent': userAgent } });

describe('observer', () => {
  test('an instance a guard ends at entry still has its row, with its conversion', async () => {
    const observer = reportingObserver(reporting(), undefined);
    await observer.started?.({ workflow: 'welcome', instanceId: 'i9', userId: 'u1', at: 1_000 });
    await observer.finished?.({
      workflow: 'welcome',
      instanceId: 'i9',
      userId: 'u1',
      status: 'goal',
      at: 1_500,
      convertedAt: 1_200,
    });
    // A finish reported without its start (an instance from before the hook) still lands
    await observer.finished?.({
      workflow: 'welcome',
      instanceId: 'i10',
      userId: 'u2',
      status: 'completed',
      at: 3_000,
    });

    const rows = (
      await pg.query(
        `SELECT instance_id, status, node_id,
           (extract(epoch from entered_at) * 1000)::int AS entered,
           (extract(epoch from converted_at) * 1000)::int AS converted
         FROM workflow.instance ORDER BY instance_id`
      )
    ).rows;
    expect(rows).toEqual([
      { instance_id: 'i10', status: 'completed', node_id: null, entered: 3000, converted: null },
      { instance_id: 'i9', status: 'goal', node_id: null, entered: 1000, converted: 1200 },
    ]);
  });

  test('records the instance, the copy with its links, and the outcome', async () => {
    const observer = reportingObserver(reporting(), 'https://wf.example.com');
    await observer.nodeReached?.({
      workflow: 'welcome',
      instanceId: 'i1',
      userId: 'u1',
      nodeId: 'n1',
      at: 1_000,
    });
    const { id, tracked, tracking } = await sendEmail([
      'https://app.example.com/a',
      'https://app.example.com/b',
    ]);
    expect(tracked).toEqual([
      `https://wf.example.com/t/l/${id}/0`,
      `https://wf.example.com/t/l/${id}/1`,
    ]);
    // The id the pixel and links name travels to the renderer too, for the preferences link
    expect(tracking?.messageId).toBe(id);
    await observer.finished?.({
      workflow: 'welcome',
      instanceId: 'i1',
      userId: 'u1',
      status: 'goal',
      at: 2_000,
    });

    const [instance] = (await pg.query('SELECT status, node_id FROM workflow.instance')).rows;
    expect(instance).toEqual({ status: 'goal', node_id: 'n1' });
    const links = (
      await pg.query('SELECT position, url FROM workflow.message_link ORDER BY position')
    ).rows;
    expect(links).toEqual([
      { position: 0, url: 'https://app.example.com/a' },
      { position: 1, url: 'https://app.example.com/b' },
    ]);
    const [message] = (
      await pg.query<{ channel: string; delivered: boolean }>(
        'SELECT channel, delivered_at IS NOT NULL AS delivered FROM workflow.message'
      )
    ).rows;
    expect(message).toEqual({ channel: 'email', delivered: true });
  });

  test('a retried step finds the copy it already recorded', async () => {
    const observer = reportingObserver(reporting(), 'https://wf.example.com');
    const first = await observer.messagePrepared?.(email());
    const again = await observer.messagePrepared?.(email());
    expect(again?.pixel).toBe(first?.pixel);
  });

  test('a push carries its message id; a dead token is recorded undelivered', async () => {
    const observer = reportingObserver(reporting(), undefined);
    const push = email({
      channel: 'push',
      device: { token: 'tok', platform: 'ios' },
      idempotencyKey: 'i1:n1:tok',
    });
    const tracking = await observer.messagePrepared?.(push);
    expect(tracking?.data?.message_id).toMatch(/^[0-9a-f-]{36}$/);
    await observer.messageSent?.(push, { delivered: false, reason: 'Unregistered' });
    const [row] = (await pg.query('SELECT channel, undelivered_reason FROM workflow.message')).rows;
    expect(row).toEqual({ channel: 'push_ios', undelivered_reason: 'Unregistered' });
  });

  test('without an origin, emails go out untracked', async () => {
    const observer = reportingObserver(reporting(), undefined);
    expect(await observer.messagePrepared?.(email())).toBeUndefined();
  });
});

describe('tracking', () => {
  test('a scanner walking every link: the first clicks are reclassified with the burst', async () => {
    vi.useFakeTimers({ now: 1_000_000, toFake: ['Date'] });
    const { id } = await sendEmail([
      'https://app.example.com/a',
      'https://app.example.com/b',
      'https://app.example.com/c',
    ]);
    vi.setSystemTime(1_000_000 + 60_000);
    for (const position of [0, 1, 2]) {
      await handleTracking(get(`/t/l/${id}/${position}`), reporting());
      vi.setSystemTime(Date.now() + 200);
    }
    const clicks = (
      await pg.query('SELECT machine, reason FROM workflow.message_click ORDER BY clicked_at')
    ).rows;
    expect(clicks).toEqual([
      { machine: true, reason: 'link_burst' },
      { machine: true, reason: 'link_burst' },
      { machine: true, reason: 'link_burst' },
    ]);
    const [message] = (
      await pg.query(
        'SELECT human_clicked_at IS NULL AS no_click, human_opened_at IS NULL AS no_open, clicked_at IS NOT NULL AS clicked FROM workflow.message'
      )
    ).rows;
    expect(message).toEqual({ no_click: true, no_open: true, clicked: true });
  });

  test('the request network is stored, never the address', async () => {
    const { id } = await sendEmail(['https://app.example.com/a']);
    const request = get(`/t/l/${id}/0`);
    Object.defineProperty(request, 'cf', {
      value: { asn: 8075, asOrganization: 'Microsoft Corporation', country: 'US' },
    });
    await handleTracking(request, reporting());
    const [row] = (
      await pg.query(
        'SELECT machine, reason, asn, as_organization, country FROM workflow.message_click'
      )
    ).rows;
    expect(row).toEqual({
      machine: true,
      reason: 'datacenter',
      asn: 8075,
      as_organization: 'Microsoft Corporation',
      country: 'US',
    });
  });

  test('a person opening and clicking: recorded, redirected to the recorded URL', async () => {
    vi.useFakeTimers({ now: 1_000_000, toFake: ['Date'] });
    const { id } = await sendEmail(['https://app.example.com/pricing']);
    vi.setSystemTime(1_000_000 + 60_000);

    const pixel = await handleTracking(get(`/t/o/${id}`), reporting());
    expect(pixel?.headers.get('content-type')).toBe('image/gif');
    const click = await handleTracking(get(`/t/l/${id}/0`), reporting());
    expect(click?.status).toBe(302);
    expect(click?.headers.get('location')).toBe('https://app.example.com/pricing');

    const [message] = (
      await pg.query(
        'SELECT human_opened_at IS NOT NULL AS human_open, human_clicked_at IS NOT NULL AS human_click FROM workflow.message'
      )
    ).rows;
    expect(message).toEqual({ human_open: true, human_click: true });
  });

  test("Apple's privacy proxy fetching the pixel is a machine open", async () => {
    vi.useFakeTimers({ now: 1_000_000, toFake: ['Date'] });
    const { id } = await sendEmail([]);
    vi.setSystemTime(1_000_000 + 60_000);
    await handleTracking(get(`/t/o/${id}`, 'Mozilla/5.0'), reporting());
    const [open] = (await pg.query('SELECT machine, reason FROM workflow.message_open')).rows;
    expect(open).toEqual({ machine: true, reason: 'apple_privacy_proxy' });
    const [message] = (
      await pg.query(
        'SELECT opened_at IS NOT NULL AS opened, human_opened_at IS NULL AS no_human FROM workflow.message'
      )
    ).rows;
    expect(message).toEqual({ opened: true, no_human: true });
  });

  test('an unknown link is a 404; a path that is not a tracking route passes through', async () => {
    const { id } = await sendEmail(['https://app.example.com/a']);
    expect((await handleTracking(get(`/t/l/${id}/7`), reporting()))?.status).toBe(404);
    expect(await handleTracking(get('/t/l/not-a-uuid/0'), reporting())).toBeUndefined();
    expect(await handleTracking(get('/events'), reporting())).toBeUndefined();
  });

  test('the unsubscribe link asks first; only the confirmation unsubscribes', async () => {
    const { id, tracked } = await sendEmail(
      ['https://app.example.com/a', 'https://app.example.com/unsubscribe?list=journeys'],
      'https://app.example.com/unsubscribe'
    );
    expect(tracked).toEqual([
      `https://wf.example.com/t/l/${id}/0`,
      `https://wf.example.com/t/u/${id}/1`,
    ]);
    // What the link is was fixed when it was sent: no config needed to recognize it
    const options = { product: 'Acme' };
    const confirm = await handleTracking(get(`/t/u/${id}/1`), reporting(), options);
    expect(confirm?.status).toBe(200);
    expect(await confirm?.text()).toContain(`action="/t/u/${id}"`);
    const head = new Request(`https://wf.example.com/t/u/${id}/1`, { method: 'HEAD' });
    expect((await handleTracking(head, reporting(), options))?.status).toBe(200);
    const clicks = await pg.query('SELECT position FROM workflow.message_click ORDER BY position');
    expect(clicks.rows).toEqual([{ position: 1 }, { position: 1 }]);
    const unsubscribed = () =>
      pg.query('SELECT unsubscribed_at IS NOT NULL AS u FROM workflow.message');
    expect((await unsubscribed()).rows).toEqual([{ u: false }]);

    const post = (scope = '') =>
      new Request(`https://wf.example.com/t/u/${id}${scope}`, { method: 'POST' });
    expect(await (await handleTracking(post(), reporting(), options))?.text()).toContain(
      "You won't get promotions emails from Acme anymore."
    );
    expect((await handleTracking(post(), reporting(), options))?.status).toBe(200);
    expect((await unsubscribed()).rows).toEqual([{ u: true }]);
    // The opt-out the engine reads before every email: the copy's topic, not the whole channel
    const store = database.storeIn();
    expect(await store.isSuppressed('u1', 'email', 'promotions')).toBe(true);
    expect(await store.isSuppressed('u1', 'email', 'newsletter')).toBe(false);
    expect(await store.isSuppressed('u1', 'email')).toBe(false);
    expect(await store.isSuppressed('u1', 'push')).toBe(false);
    expect(await store.listSuppressions('u1', 'email')).toEqual(['promotions']);

    // The page's second button: every email, the channel-wide row every topic reads
    expect(
      await (await handleTracking(post('?scope=all'), reporting(), options))?.text()
    ).toContain("You won't get emails from Acme anymore.");
    expect(await store.isSuppressed('u1', 'email')).toBe(true);
    expect(await store.isSuppressed('u1', 'email', 'newsletter')).toBe(true);
    expect(await store.listSuppressions('u1', 'email')).toEqual([null, 'promotions']);
    const topics = await pg.query(
      'SELECT topic FROM workflow.message UNION ALL SELECT topic FROM workflow.suppression ORDER BY 1'
    );
    expect(topics.rows).toEqual([
      { topic: 'promotions' },
      { topic: 'promotions' },
      { topic: null },
    ]);
  });

  test('the confirmation page names the topic and offers both buttons; nobody-knows and transactional copies are expired links', async () => {
    const { id } = await sendEmail(['https://app.example.com/a'], undefined, {
      topic: 'product_updates',
    });
    const options = { product: 'Acme' };
    const page = await handleTracking(get(`/t/u/${id}`), reporting(), options);
    expect(page?.status).toBe(200);
    const html = await page?.text();
    expect(html).toContain('Unsubscribe from product updates emails from Acme?');
    expect(html).toContain(`action="/t/u/${id}"`);
    expect(html).toContain('Unsubscribe from product updates</button>');
    expect(html).toContain(`action="/t/u/${id}?scope=all"`);
    expect(html).toContain('Unsubscribe from all emails');
    // No copy on record: the question cannot be asked
    const gone = await handleTracking(
      get('/t/u/0190f000-0000-7000-8000-00000000dead'),
      reporting(),
      options
    );
    expect(gone?.status).toBe(404);

    // A transactional copy never carried the link: every variant is an expired link, and
    // neither the copy nor a suppression records anything
    const receipt = await sendEmail(['https://app.example.com/a'], undefined, {
      idempotencyKey: 'i1:n2',
      nodeId: 'n2',
      topic: null,
    });
    expect((await handleTracking(get(`/t/u/${receipt.id}`), reporting(), options))?.status).toBe(
      404
    );
    const post = (scope = '') =>
      new Request(`https://wf.example.com/t/u/${receipt.id}${scope}`, { method: 'POST' });
    const heard: unknown[] = [];
    const hooked = { ...options, onUnsubscribed: async (u: unknown) => void heard.push(u) };
    expect((await handleTracking(post(), reporting(), hooked))?.status).toBe(404);
    expect((await handleTracking(post('?scope=all'), reporting(), hooked))?.status).toBe(404);
    expect(heard).toEqual([]);
    const rows = await pg.query(
      `SELECT unsubscribed_at IS NOT NULL AS u FROM workflow.message WHERE id = '${receipt.id}'`
    );
    expect(rows.rows).toEqual([{ u: false }]);
    expect(await database.storeIn().listSuppressions('u1', 'email')).toEqual([]);
  });

  test("the List-Unsubscribe URL: a mail client's one-click POST unsubscribes, a browser asks", async () => {
    const { id, tracking } = await sendEmail(
      ['https://app.example.com/unsubscribe'],
      'https://app.example.com/unsubscribe'
    );
    // The copy's one-click endpoint: the message, no link position
    expect(tracking?.unsubscribe).toBe(`https://wf.example.com/t/u/${id}`);
    const options = { product: 'Acme' };
    // Opened in a browser (a client without one-click): the same question, nothing recorded
    const opened = await handleTracking(get(`/t/u/${id}`), reporting(), options);
    expect(opened?.status).toBe(200);
    expect(await opened?.text()).toContain(`action="/t/u/${id}"`);
    const unsubscribed = () =>
      pg.query('SELECT unsubscribed_at IS NOT NULL AS u FROM workflow.message');
    expect((await unsubscribed()).rows).toEqual([{ u: false }]);
    // RFC 8058: the provider POSTs the form body, with no cookie and no confirmation
    const oneClick = new Request(`https://wf.example.com/t/u/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    });
    expect((await handleTracking(oneClick, reporting(), options))?.status).toBe(200);
    expect((await unsubscribed()).rows).toEqual([{ u: true }]);
    // One-click is the header's URL, which names no scope: the copy's topic, never every email
    expect(await database.storeIn().isSuppressed('u1', 'email', 'promotions')).toBe(true);
    expect(await database.storeIn().isSuppressed('u1', 'email')).toBe(false);

    // A copy no longer on record (its user erased): the one-click still succeeds, changing nothing
    const gone = new Request('https://wf.example.com/t/u/0190f000-0000-7000-8000-00000000dead', {
      method: 'POST',
      body: 'List-Unsubscribe=One-Click',
    });
    expect((await handleTracking(gone, reporting(), options))?.status).toBe(200);
  });

  test('an email sent without an unsubscribe URL has none, whatever the config says now', async () => {
    const { id } = await sendEmail(['https://app.example.com/unsubscribe']);
    const click = await handleTracking(get(`/t/l/${id}/0`), reporting(), { product: 'Acme' });
    expect(click?.status).toBe(302);
    expect(click?.headers.get('location')).toBe('https://app.example.com/unsubscribe');
  });

  test('an unsubscribe yields the recipient from its own transaction, the same one every time', async () => {
    const { id } = await sendEmail([]);
    expect(await reporting().recordUnsubscribe(id, 5_000)).toEqual({
      userId: 'u1',
      topic: 'promotions',
    });
    // Repeated: the first time stands, the recipient is still named
    expect(await reporting().recordUnsubscribe(id, 9_000)).toEqual({
      userId: 'u1',
      topic: 'promotions',
    });
    const [row] = (
      await pg.query(
        'SELECT (extract(epoch from unsubscribed_at) * 1000)::int AS at FROM workflow.message'
      )
    ).rows;
    expect(row).toEqual({ at: 5_000 });
    expect(
      await reporting().recordUnsubscribe('0190f000-0000-7000-8000-00000000dead', 5_000)
    ).toBeUndefined();
  });

  test('the host hears the unsubscribe with its recipient; its failure never fails the page', async () => {
    const { id } = await sendEmail([]);
    const heard: { messageId: string; userId: string; at: number; topic: string; all: boolean }[] =
      [];
    const post = () => new Request(`https://wf.example.com/t/u/${id}`, { method: 'POST' });
    // The recipient comes from the unsubscribe itself: no read of the copy on the side
    const noReads = reporting();
    vi.spyOn(noReads, 'recordOpen').mockRejectedValue(
      new Error('recordOpen must not be called on the unsubscribe path')
    );
    const first = await handleTracking(post(), noReads, {
      onUnsubscribed: async (unsubscribe) => void heard.push(unsubscribe),
    });
    expect(first?.status).toBe(200);
    expect(heard).toEqual([
      { messageId: id, userId: 'u1', at: expect.any(Number), topic: 'promotions', all: false },
    ]);

    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const second = await handleTracking(post(), noReads, {
      onUnsubscribed: async () => {
        throw new Error('wake failed');
      },
    });
    expect(second?.status).toBe(200);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
    expect(await database.storeIn().isSuppressed('u1', 'email', 'promotions')).toBe(true);
    // The "all emails" button: the host hears so, and acts on reachability
    const all = new Request(`https://wf.example.com/t/u/${id}?scope=all`, { method: 'POST' });
    await handleTracking(all, noReads, {
      onUnsubscribed: async (unsubscribe) => void heard.push(unsubscribe),
    });
    expect(heard.at(-1)).toMatchObject({
      messageId: id,
      userId: 'u1',
      topic: 'promotions',
      all: true,
    });

    // An unknown copy: nothing to tell the host, the page still answers success
    const gone = new Request('https://wf.example.com/t/u/0190f000-0000-7000-8000-00000000dead', {
      method: 'POST',
    });
    expect((await handleTracking(gone, noReads, { onUnsubscribed: async () => {} }))?.status).toBe(
      200
    );
    expect(heard).toHaveLength(2);
  });

  test('a suppression that fails to write rolls the unsubscribe back with it', async () => {
    const { id } = await sendEmail([]);
    // One transaction: the suppression insert fails, so the copy is not marked either
    const failing: SqlClientLike = {
      query: async (text, params) => {
        if (text.includes('suppression')) throw new Error('suppression table unavailable');
        return database.client.query(text, params);
      },
      transaction: (fn) =>
        pg.transaction((tx) =>
          fn({
            query: async <T>(text: string, params: readonly unknown[] = []) => {
              if (text.includes('suppression')) throw new Error('suppression table unavailable');
              return (await tx.query<T>(text, [...params])).rows;
            },
            transaction: async () => {
              throw new Error('nested');
            },
          })
        ),
    };
    const broken = new PostgresJourneyStore(failing).reporting;
    const post = new Request(`https://wf.example.com/t/u/${id}`, { method: 'POST' });
    await expect(handleTracking(post, broken)).rejects.toThrow('suppression table unavailable');
    const [row] = (
      await pg.query('SELECT unsubscribed_at IS NULL AS untouched FROM workflow.message')
    ).rows;
    expect(row).toEqual({ untouched: true });
    expect(await database.storeIn().isSuppressed('u1', 'email', 'promotions')).toBe(false);
  });

  test('a scanner following every link at once: clicks judged one after another', async () => {
    vi.useFakeTimers({ now: 1_000_000, toFake: ['Date'] });
    const { id } = await sendEmail([
      'https://app.example.com/a',
      'https://app.example.com/b',
      'https://app.example.com/c',
    ]);
    vi.setSystemTime(1_000_000 + 60_000);
    await Promise.all(
      [0, 1, 2].map((position) => handleTracking(get(`/t/l/${id}/${position}`), reporting()))
    );
    const clicks = (
      await pg.query<{ machine: boolean }>('SELECT machine FROM workflow.message_click')
    ).rows;
    expect(clicks).toEqual([{ machine: true }, { machine: true }, { machine: true }]);
  });

  test('a push carries the device delivery and open URLs; posting them records both', async () => {
    const observer = reportingObserver(reporting(), 'https://wf.example.com');
    const push = email({ channel: 'push', device: { token: 't', platform: 'ios' } });
    const data = (await observer.messagePrepared?.(push))?.data ?? {};
    expect(data).toHaveProperty('message_id', expect.any(String));
    const id = data.message_id;
    expect(data).toEqual({
      message_id: id,
      delivered_url: `https://wf.example.com/t/d/${id}`,
      opened_url: `https://wf.example.com/t/p/${id}`,
    });
    const post = (path: string) =>
      handleTracking(new Request(`https://wf.example.com${path}`, { method: 'POST' }), reporting());
    expect((await post(`/t/d/${id}`))?.status).toBe(204);
    expect((await post(`/t/p/${id}`))?.status).toBe(204);
    expect((await post('/t/d/0190f000-0000-7000-8000-000000000000'))?.status).toBe(404);
    // A scanner's GET does neither
    expect(await handleTracking(get(`/t/d/${id}`), reporting())).toBeUndefined();
    const [row] = (
      await pg.query(
        'SELECT device_delivered_at IS NOT NULL AS delivered, human_opened_at IS NOT NULL AS opened FROM workflow.message'
      )
    ).rows;
    expect(row).toEqual({ delivered: true, opened: true });
  });

  test('a browser-reported tap hands the host the copy and its recipient, for the event', async () => {
    const observer = reportingObserver(reporting(), 'https://wf.example.com');
    const push = email({ channel: 'push', device: { token: 't', platform: 'web' } });
    const id = (await observer.messagePrepared?.(push))?.data?.message_id ?? '';
    const opened: { messageId: string; userId: string }[] = [];
    const pushOpened = async (open: { messageId: string; userId: string }) =>
      void opened.push({ messageId: open.messageId, userId: open.userId });
    const post = (path: string) =>
      handleTracking(
        new Request(`https://wf.example.com${path}`, { method: 'POST' }),
        reporting(),
        {
          pushOpened,
        }
      );

    expect((await post(`/t/p/${id}`))?.status).toBe(204);
    expect(opened).toEqual([{ messageId: id, userId: 'u1' }]);
    // An unknown copy is no tap at all
    expect((await post('/t/p/0190f000-0000-7000-8000-000000000000'))?.status).toBe(404);
    expect(opened).toHaveLength(1);
  });

  test("a push tap counts for the copy's own recipient only", async () => {
    const observer = reportingObserver(reporting(), undefined);
    const push = email({ channel: 'push', device: { token: 't', platform: 'android' } });
    const id = (await observer.messagePrepared?.(push))?.data?.message_id ?? '';
    expect(await recordPushOpen(reporting(), 'someone-else', id)).toBe(false);
    expect(await recordPushOpen(reporting(), 'u1', id)).toBe(true);
    const [open] = (await pg.query('SELECT machine FROM workflow.message_open')).rows;
    expect(open).toEqual({ machine: false });
  });
});

describe('forgetUser', () => {
  /** A JOURNEY binding whose instances stop, refuse to, or are unknown to the platform. */
  const binding = (behaviour: 'stops' | 'refuses' | 'unknown') => {
    const terminated: string[] = [];
    const env = {
      JOURNEY: {
        create: async () => {
          throw new Error('unused');
        },
        get: async (id: string) => {
          if (behaviour === 'unknown') throw new InstanceNotFoundError(id);
          return {
            id,
            sendEvent: async () => undefined,
            terminate: async () => {
              if (behaviour === 'refuses') throw new Error('internal error');
              terminated.push(id);
            },
            status: async () => ({ status: 'running' }),
          };
        },
      },
    } as unknown as JourneyEnv;
    return { env, terminated };
  };

  async function seed(store: PostgresJourneyStore) {
    await sendEmail(['https://app.example.com/a']);
    await store.mergeProfile('u1', { email: 'ada@example.com' });
    await store.upsertDevice({ userId: 'u1', token: 't', platform: 'ios', ts: 1 });
    await store.enterJourney({ workflow: 'w', userId: 'u1', instanceId: 'i9', hash: 'h', ts: 1 });
    // Its runner reached the runtime: the erasure has to stop it
    expect(await store.admitInstance('i9', 'u1')).toBe(true);
  }

  const rowsOf = async (table: string) =>
    (await pg.query(`SELECT 1 FROM workflow.${table}`)).rows.length;

  test('stops the running instances first, then erases everything, the request with it', async () => {
    const store = database.storeIn();
    await seed(store);
    const { env, terminated } = binding('stops');

    expect(await forgetUser(env, 'u1', store)).toEqual({ ok: true, erased: true, pending: [] });
    expect(terminated).toEqual(['i9']);
    for (const table of ['profile', 'device', 'entry', 'message', 'message_link']) {
      expect(await rowsOf(table)).toBe(0);
    }
    // The tombstone stays, marked erased: a later write about u1 is refused for good
    expect(await store.erasureState('u1')).toBe('erased');
  });

  test('an instance that will not stop keeps everything, and a retry finishes the job', async () => {
    const store = database.storeIn();
    await seed(store);

    const refused = await forgetUser(binding('refuses').env, 'u1', store);
    expect(refused).toEqual({ ok: true, erased: false, pending: ['i9'] });
    // Nothing erased: the entry still names the instance to stop, the request is on record
    expect(await rowsOf('entry')).toBe(1);
    expect(await rowsOf('profile')).toBe(1);
    expect(await store.pendingErasures()).toEqual(['u1']);

    // The sweep's retry, once the platform cooperates; an instance it no longer knows is stopped
    await sweepSegments(binding('unknown').env, store);
    expect(await store.pendingErasures()).toEqual([]);
    expect(await rowsOf('entry')).toBe(0);
    expect(await rowsOf('profile')).toBe(0);
  });
});

describe('reporting after a tombstone', () => {
  const instanceRows = async () =>
    (await pg.query('SELECT instance_id, status FROM workflow.instance')).rows;
  const instance = { workflow: 'w', instanceId: 'i1', userId: 'u1' };

  test.each(['erasing', 'erased'] as const)(
    'a late start, node or finish of a user %s leaves no instance row',
    async (state) => {
      const store = database.storeIn();
      await store.requestErasure('u1', 5);
      if (state === 'erased') await store.forgetUser('u1', 6);
      const reporting = store.reporting;

      await reporting.instanceStarted({ ...instance, at: 7 });
      await reporting.nodeReached({ ...instance, nodeId: 'n1', at: 8 });
      await reporting.instanceFinished({ ...instance, status: 'completed', at: 9 });
      await reporting.instanceFinished({ ...instance, status: 'failed', at: 9 });
      expect(await instanceRows()).toEqual([]);

      // Another user's reporting is untouched
      await reporting.instanceStarted({ ...instance, instanceId: 'i2', userId: 'u2', at: 7 });
      await reporting.instanceFinished({
        ...instance,
        instanceId: 'i2',
        userId: 'u2',
        status: 'completed',
        at: 9,
      });
      expect(await instanceRows()).toEqual([{ instance_id: 'i2', status: 'completed' }]);
    }
  );

  test('a finish arriving after the erase does not put the instance back', async () => {
    const store = database.storeIn();
    await store.reporting.instanceStarted({ ...instance, at: 1 });
    await store.reporting.nodeReached({ ...instance, nodeId: 'n1', at: 2 });
    await store.requestErasure('u1', 5);
    await store.forgetUser('u1', 6);
    expect(await instanceRows()).toEqual([]);
    await store.reporting.instanceFinished({ ...instance, status: 'completed', at: 9 });
    await store.reporting.nodeReached({ ...instance, nodeId: 'n2', at: 9 });
    expect(await instanceRows()).toEqual([]);
  });

  test('a copy for a user with a tombstone is refused for good, so it is never sent', async () => {
    const store = database.storeIn();
    const copy = {
      idempotencyKey: 'i1:n1',
      workflow: 'w',
      instanceId: 'i1',
      nodeId: 'n1',
      template: 'welcome',
      channel: 'email',
      topic: null,
      userId: 'u1',
      sentAt: 1,
    };
    expect(await store.reporting.recordMessage(copy)).toEqual(expect.any(String));
    await store.requestErasure('u1', 5);

    const refused = store.reporting.recordMessage({ ...copy, idempotencyKey: 'i1:n2' });
    await expect(refused).rejects.toBeInstanceOf(UserErasedError);
    await expect(refused).rejects.toMatchObject({ userId: 'u1', retryable: false });
    // A retry of the copy already recorded is refused too: nothing of theirs goes out
    await expect(store.reporting.recordMessage(copy)).rejects.toBeInstanceOf(UserErasedError);
    const rows = await pg.query('SELECT idempotency_key FROM workflow.message');
    expect(rows.rows).toEqual([{ idempotency_key: 'i1:n1' }]);

    await store.forgetUser('u1', 6);
    await expect(store.reporting.recordMessage(copy)).rejects.toBeInstanceOf(UserErasedError);
    expect((await pg.query('SELECT 1 FROM workflow.message')).rows).toEqual([]);
  });

  test('the paths that know only the copy re-check its owner: a tombstone makes them no-ops', async () => {
    const store = database.storeIn();
    const { id } = await sendEmail(['https://example.com/a']);
    const person = (at: number): Engagement => ({
      at,
      machine: false,
      reason: null,
      userAgent: null,
      asn: null,
      organization: null,
      country: null,
    });
    const links = async () =>
      (await pg.query('SELECT position FROM workflow.message_link')).rows.length;
    await store.requestErasure('u1', 5);

    // The copy is still there while the erasure is under way; nothing more is recorded under it
    await store.reporting.recordLinks(id, ['https://example.com/b']);
    expect(await links()).toBe(1);
    expect(await store.reporting.recordOpen(id, () => person(6))).toBe(false);
    expect(await store.reporting.recordDeviceDelivered(id, 6)).toBe(false);
    expect(
      await store.reporting.recordClick(id, 0, 6, 1_000, () => ({
        engagement: person(6),
        backdate: false,
      }))
    ).toBeUndefined();
    expect((await pg.query('SELECT 1 FROM workflow.message_open')).rows).toEqual([]);
    expect((await pg.query('SELECT 1 FROM workflow.message_click')).rows).toEqual([]);
    // The unsubscribe is the compliance exception: recorded whatever the user's state
    expect(await store.reporting.recordUnsubscribe(id, 6)).toEqual({
      userId: 'u1',
      topic: 'promotions',
    });
    expect(await store.isSuppressed('u1', 'email', 'promotions')).toBe(true);

    await store.forgetUser('u1', 7);
    await store.reporting.recordLinks(id, ['https://example.com/c']);
    expect(await links()).toBe(0);
    expect(await store.reporting.recordOpen(id, () => person(8))).toBe(false);
    expect(await store.reporting.recordUnsubscribe(id, 8)).toBeUndefined();
    expect((await pg.query('SELECT 1 FROM workflow.message')).rows).toEqual([]);
  });
});

describe('snapshotSegments', () => {
  test("records every deployed segment's size and drops members of removed ones", async () => {
    await pg.exec(`
      INSERT INTO workflow.segment (id, condition, hash) VALUES
        ('a', '{}', 'h'), ('b', '{}', 'h');
      INSERT INTO workflow.segment_member (segment, user_id, ts) VALUES
        ('a', 'u1', now()), ('a', 'u2', now()), ('gone', 'u1', now());`);
    expect(await reporting().snapshotSegments(5_000)).toEqual([
      { segment: 'a', size: 2 },
      { segment: 'b', size: 0 },
    ]);
    const gone = await pg.query("SELECT 1 FROM workflow.segment_member WHERE segment = 'gone'");
    expect(gone.rows).toEqual([]);
  });
});

describe('classify', () => {
  const facts = {
    method: 'GET',
    userAgent: 'Mozilla/5.0 (iPhone) Mobile',
    organization: 'T-Mobile USA',
    sinceDeliveredMs: 60_000,
  };
  const click = { ...facts, linksInBurst: 1, linkCount: 4 };

  test('opens: scanners and the Apple proxy are machines; Gmail only when it prefetches', () => {
    expect(classifyOpen(facts)).toEqual({ machine: false, reason: null });
    expect(classifyOpen({ ...facts, userAgent: 'Barracuda Sentinel' }).reason).toBe('scanner');
    expect(classifyOpen({ ...facts, userAgent: 'Mozilla/5.0' }).reason).toBe('apple_privacy_proxy');
    const gmail = { ...facts, userAgent: 'Mozilla/5.0 (via ggpht.com GoogleImageProxy)' };
    expect(classifyOpen(gmail).machine).toBe(false);
    expect(classifyOpen({ ...gmail, sinceDeliveredMs: 300 }).reason).toBe('gmail_prefetch');
    // An image proxy fetches from its own network when the person opens: not a datacenter verdict
    expect(classifyOpen({ ...facts, organization: 'Microsoft Corporation' }).machine).toBe(false);
  });

  test('a person tapping a mail notification and clicking within seconds is a person', () => {
    expect(classifyClick({ ...click, sinceDeliveredMs: 3_000 }).machine).toBe(false);
    expect(classifyClick({ ...click, sinceDeliveredMs: 400 }).machine).toBe(false);
  });

  test('clicks: strong signals alone, weak ones only together', () => {
    expect(classifyClick({ ...click, method: 'HEAD' }).reason).toBe('head_request');
    expect(classifyClick({ ...click, userAgent: 'python-requests/2' }).reason).toBe('scanner');
    expect(classifyClick({ ...click, organization: 'Microsoft Corporation' }).reason).toBe(
      'datacenter'
    );
    expect(classifyClick({ ...click, linksInBurst: 3 }).reason).toBe('link_burst');
    expect(classifyClick({ ...click, linksInBurst: 2, linkCount: 2 }).reason).toBe('link_burst');
    expect(classifyClick({ ...click, linksInBurst: 2 }).machine).toBe(false);
    expect(classifyClick({ ...click, linksInBurst: 2, sinceDeliveredMs: 500 }).reason).toBe(
      'quick+link_pair'
    );
    expect(
      classifyClick({ ...click, linksInBurst: 2, sinceDeliveredMs: 1_500 }, { quickMs: 2_000 })
        .reason
    ).toBe('quick+link_pair');
  });
});
