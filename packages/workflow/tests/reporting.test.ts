import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { JourneyEnv } from '../src/cloudflare/bindings';
import { forgetUser, sweepSegments } from '../src/cloudflare/router';
import { isUnsubscribeLink } from '../src/email';
import type { OutboundMessage } from '../src/engine/ports';
import { classifyClick, classifyOpen } from '../src/reporting/classify';
import { reportingObserver } from '../src/reporting/observer';
import { handleTracking, recordPushOpen } from '../src/reporting/tracking';
import { PostgresJourneyStore, type SqlClientLike } from '../src/store/postgres';
import { TABLES, renderPostgresDdl } from '../src/store/tables';

/**
 * Reporting on Postgres: what the observer records as a journey runs, and what the tracking
 * routes record when a recipient opens, clicks or unsubscribes.
 */

let pg: PGlite;

function client(db: {
  query: PGlite['query'];
  transaction?: PGlite['transaction'];
}): SqlClientLike {
  return {
    query: async <T>(text: string, params: readonly unknown[] = []) =>
      (await db.query<T>(text, [...params])).rows,
    transaction: (fn) =>
      db.transaction === undefined
        ? fn(client(db))
        : db.transaction((tx) => fn(client({ query: tx.query.bind(tx) }))),
  };
}

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(renderPostgresDdl());
});

afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  vi.useRealTimers();
  await pg.exec(
    `TRUNCATE ${Object.values(TABLES)
      .map((t) => `workflow."${t.name}"`)
      .join(', ')}`
  );
});

const reporting = () => new PostgresJourneyStore(client(pg)).reporting;

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
  ...overrides,
});

/** An email with these links sent; `unsubscribeUrl` is the one it was rendered with. */
async function sendEmail(urls: string[], unsubscribeUrl?: string) {
  const observer = reportingObserver(reporting(), 'https://wf.example.com/');
  const message = email();
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
    const { id, tracked } = await sendEmail([
      'https://app.example.com/a',
      'https://app.example.com/b',
    ]);
    expect(tracked).toEqual([
      `https://wf.example.com/t/l/${id}/0`,
      `https://wf.example.com/t/l/${id}/1`,
    ]);
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

    const post = () => new Request(`https://wf.example.com/t/u/${id}`, { method: 'POST' });
    expect(await (await handleTracking(post(), reporting(), options))?.text()).toContain(
      "You won't get these emails from Acme anymore."
    );
    expect((await handleTracking(post(), reporting(), options))?.status).toBe(200);
    expect((await unsubscribed()).rows).toEqual([{ u: true }]);
    // The opt-out the engine reads before every email: the whole email channel
    const store = new PostgresJourneyStore(client(pg));
    expect(await store.isSuppressed('u1', 'email')).toBe(true);
    expect(await store.isSuppressed('u1', 'push')).toBe(false);
  });

  test('an email sent without an unsubscribe URL has none, whatever the config says now', async () => {
    const { id } = await sendEmail(['https://app.example.com/unsubscribe']);
    const options = { legacyUnsubscribeUrl: 'https://app.example.com/unsubscribe' };
    const click = await handleTracking(get(`/t/l/${id}/0`), reporting(), options);
    expect(click).toBeDefined();
    if (!click) throw new Error('The tracking URL must return a redirect');
    expect(click.status).toBe(302);
    expect(click.headers.get('location')).toBe('https://app.example.com/unsubscribe');
  });

  test('an email sent before links carried their purpose: its unsubscribe link still asks', async () => {
    // Recorded as the earlier versions did, the links behind `/t/c/<message>/<position>`
    const { id } = await sendEmail([]);
    await reporting().recordLinks(id, [
      'https://app.example.com/a',
      'https://app.example.com/unsubscribe?list=journeys',
    ]);
    const options = { legacyUnsubscribeUrl: 'https://app.example.com/unsubscribe' };
    const link = await handleTracking(get(`/t/c/${id}/0`), reporting(), options);
    expect(link?.headers.get('location')).toBe('https://app.example.com/a');
    const confirm = await handleTracking(get(`/t/c/${id}/1`), reporting(), options);
    expect(confirm?.status).toBe(200);
    expect(await confirm?.text()).toContain(`action="/t/u/${id}"`);
    // Without the URL those emails were sent with, it is a plain link
    const plain = await handleTracking(get(`/t/c/${id}/1`), reporting());
    expect(plain?.status).toBe(302);
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
          if (behaviour === 'unknown') throw new Error('instance.not_found');
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
  }

  const rowsOf = async (table: string) =>
    (await pg.query(`SELECT 1 FROM workflow.${table}`)).rows.length;

  test('stops the running instances first, then erases everything, the request with it', async () => {
    const store = new PostgresJourneyStore(client(pg));
    await seed(store);
    const { env, terminated } = binding('stops');

    expect(await forgetUser(env, 'u1', store)).toEqual({ ok: true, erased: true, pending: [] });
    expect(terminated).toEqual(['i9']);
    for (const table of ['profile', 'device', 'entry', 'message', 'message_link', 'erasure']) {
      expect(await rowsOf(table)).toBe(0);
    }
  });

  test('an instance that will not stop keeps everything, and a retry finishes the job', async () => {
    const store = new PostgresJourneyStore(client(pg));
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
