import { createServer } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { PermanentError } from '../src/engine/retry';
import { InstanceNotFoundError } from '../src/host/platform';
import { action, defineConfig, event, performed, trigger, workflow } from '../src/index';
import { DEFAULT_LEASE_MS, RunStore, journeyNode } from '../src/node/index';
import { type PgliteDatabase, pgliteDatabase, truncateAll } from './pglite';

/**
 * The self-hosted runtime (`@shware/workflow/node`): journeys as rows in Postgres, a turn at a
 * time. Here it runs over PGlite with the clock faked — the host is asked for a request, then
 * for the turns that are due, and nothing runs in the background unless a test starts it.
 */

let database: PgliteDatabase;
beforeAll(async () => {
  database = await pgliteDatabase();
}, 30_000);
afterAll(async () => {
  await database.close();
});

const START = Date.parse('2026-12-01T09:00:00Z');
const HOUR = 3_600_000;
const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);

interface Events {
  order: { total: number };
  nap: Record<string, never>;
  sign_up: Record<string, never>;
  login: Record<string, never>;
  flaky_start: Record<string, never>;
  broken_start: Record<string, never>;
  doomed_start: Record<string, never>;
  slow_start: Record<string, never>;
}
const e = event<Events>();

/** What the actions did, in order. */
const log: string[] = [];
let flakyFailures = 0;
let slow: { entered: () => void; release: () => void; gate: Promise<void> } | undefined;

const note = (name: string) =>
  action<{ total?: number }>(name, async (args) => {
    log.push(args.total === undefined ? name : `${name}:${args.total}`);
  });
const first = note('first');
const second = note('second');
const woke = note('woke');
const timedOut = note('timed_out');
const flaky = action('flaky', async () => {
  log.push('flaky');
  if (flakyFailures-- > 0) throw new Error('provider unavailable');
});
const broken = action('broken', async () => {
  log.push('broken');
  throw new PermanentError('a retry would only repeat this');
});
const slowly = action('slowly', async () => {
  log.push('slowly');
  slow?.entered();
  await slow?.gate;
});

const order = trigger.event(e.order);
const again = { mode: 'concurrent' } as const;
const config = defineConfig({
  workflows: [
    workflow({ id: 'order', reentry: again, trigger: order }).run(first, {
      total: order.payload.total,
    }),
    workflow({ id: 'nap', reentry: again, trigger: trigger.event(e.nap) })
      .run(first)
      .delay('1 hour')
      .run(second),
    workflow({ id: 'wait', reentry: again, trigger: trigger.event(e.sign_up) })
      .waitUntil(performed(e.login), { timeout: '1 hour', onTimeout: (w) => w.run(timedOut) })
      .run(woke),
    workflow({ id: 'flaky', reentry: again, trigger: trigger.event(e.flaky_start) })
      .run(first)
      .run(flaky)
      .run(second),
    workflow({ id: 'broken', reentry: again, trigger: trigger.event(e.broken_start) }).run(broken),
    workflow({ id: 'doomed', reentry: again, trigger: trigger.event(e.doomed_start) }).run(flaky),
    workflow({ id: 'slow', reentry: again, trigger: trigger.event(e.slow_start) }).run(slowly),
  ],
  actions: [first, second, woke, timedOut, flaky, broken, slowly],
  templates: {},
});

const node = (extra: Partial<Parameters<typeof journeyNode>[0]> = {}) =>
  journeyNode({ config, sql: database.client, vars: { ENVIRONMENT: 'development' }, ...extra });

const post = (host: ReturnType<typeof node>, path: string, body?: unknown) =>
  host.fetch(
    new Request(`http://node${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  );

/** A deployed host, and an event ingested through its HTTP API. */
async function deployed(extra?: Parameters<typeof node>[0]) {
  const host = node(extra);
  expect((await post(host, '/bundle/deploy')).status).toBe(200);
  const ingest = async (name: keyof Events, payload?: Record<string, unknown>, userId = 'u1') => {
    const response = await post(host, '/ingest', { userId, events: [{ event: name, payload }] });
    expect(response.status).toBe(200);
  };
  return { host, ingest };
}

const runs = () =>
  database.client.query<{ status: string; error: string | null }>(
    'SELECT status, error FROM workflow.run ORDER BY created_at'
  );
const entryStatus = async () =>
  (await database.client.query<{ status: string }>('SELECT status FROM workflow.entry'))[0]?.status;

beforeEach(async () => {
  await truncateAll(database.pg);
  log.length = 0;
  flakyFailures = 0;
  slow = undefined;
  vi.useFakeTimers({ now: START, toFake: ['Date'] });
  vi.restoreAllMocks();
});

describe('a journey as rows', () => {
  test('an event starts a run, a turn runs it to its end, and the entry says so', async () => {
    const { host, ingest } = await deployed();
    await ingest('order', { total: 42 });
    expect(await runs()).toEqual([{ status: 'queued', error: null }]);

    const [turn] = await host.drain();
    expect(turn).toMatchObject({ ended: 'complete', outcome: { status: 'completed' } });
    // The trigger payload came through the run's params
    expect(log).toEqual(['first:42']);
    expect(await runs()).toEqual([{ status: 'complete', error: null }]);
    expect(await entryStatus()).toBe('completed');
    expect(await host.drain()).toEqual([]);
  });

  test('a sleep ends the turn; the run is due again when it is over, and what ran is not run again', async () => {
    const { host, ingest } = await deployed();
    await ingest('nap');

    const [turn] = await host.drain();
    expect(turn).toMatchObject({ ended: 'suspended', wakeAt: START + HOUR });
    expect(log).toEqual(['first']);
    expect(await runs()).toEqual([{ status: 'sleeping', error: null }]);

    advance(HOUR - 1);
    expect(await host.drain()).toEqual([]);
    advance(1);
    expect(await host.drain()).toMatchObject([{ ended: 'complete' }]);
    expect(log).toEqual(['first', 'second']);
  });
});

describe('waiting for a wake', () => {
  test('the awaited event wakes the run; nothing is due before it', async () => {
    const { host, ingest } = await deployed();
    await ingest('sign_up');
    expect(await host.drain()).toMatchObject([{ ended: 'suspended', wakeAt: START + HOUR }]);
    expect(await runs()).toEqual([{ status: 'waiting', error: null }]);
    expect(await host.drain()).toEqual([]);

    advance(60_000);
    await ingest('login');
    expect(await host.drain()).toMatchObject([{ ended: 'complete' }]);
    expect(log).toEqual(['woke']);
    expect(await database.client.query('SELECT 1 FROM workflow.subscription')).toEqual([]);
  });

  test('a wait nobody answers is due at its deadline and takes the timeout branch', async () => {
    const { host, ingest } = await deployed();
    await ingest('sign_up');
    await host.drain();
    advance(HOUR);
    expect(await host.drain()).toMatchObject([{ ended: 'complete' }]);
    expect(log).toEqual(['timed_out', 'woke']);
  });

  test('a wake that lands while a turn is deciding to park is not lost: the park is refused', async () => {
    const store = new RunStore(database.client);
    const params = {
      workflowId: 'w',
      contentHash: 'h',
      userId: 'u1',
      trigger: { event: 'x', payload: {} },
    };
    await store.create('i1', params, START, START);
    const run = await store.claim('a', START, DEFAULT_LEASE_MS);
    if (run === undefined) throw new Error('nothing claimed');
    const seen = await store.signals('i1');

    // The wake arrives between the turn reading the counter and writing its park
    expect(await store.signal('i1', START)).toBe(true);
    await store.suspend(run, { status: 'waiting', wakeAt: START + HOUR, ifSignals: seen }, START);

    expect(await store.status('i1')).toBe('queued');
    expect((await store.claim('a', START, DEFAULT_LEASE_MS))?.instanceId).toBe('i1');
  });
});

describe('a step that throws', () => {
  test('is retried after a backoff that survives the turn, and the steps before it are not run again', async () => {
    const { host, ingest } = await deployed();
    flakyFailures = 2;
    const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await ingest('flaky_start');

    expect(await host.drain()).toMatchObject([{ ended: 'suspended', wakeAt: START + 10_000 }]);
    advance(10_000);
    // The second failure waits twice as long
    expect(await host.drain()).toMatchObject([{ ended: 'suspended', wakeAt: START + 30_000 }]);
    advance(19_999);
    expect(await host.drain()).toEqual([]);
    advance(1);
    expect(await host.drain()).toMatchObject([{ ended: 'complete' }]);
    expect(log).toEqual(['first', 'flaky', 'flaky', 'flaky', 'second']);
    quiet.mockRestore();
  });

  test('out of retries, the journey fails: the run is errored and the entry failed', async () => {
    const { host, ingest } = await deployed({ retry: { limit: 2, delayMs: 1_000 } });
    flakyFailures = 99;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await ingest('doomed_start');
    for (let turn = 0; turn < 3; turn++) {
      await host.drain();
      advance(60_000);
    }
    expect(log).toEqual(['flaky', 'flaky', 'flaky']);
    expect(await runs()).toEqual([
      { status: 'errored', error: expect.stringContaining('provider unavailable') },
    ]);
    expect(await entryStatus()).toBe('failed');
  });

  test('a permanent failure is not retried at all', async () => {
    const { host, ingest } = await deployed();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await ingest('broken_start');
    expect(await host.drain()).toMatchObject([{ ended: 'errored' }]);
    expect(log).toEqual(['broken']);
    expect(await entryStatus()).toBe('failed');
  });
});

describe('leases', () => {
  test('one due run is taken by one worker', async () => {
    const { host, ingest } = await deployed();
    await ingest('order', { total: 1 });
    const turns = await Promise.all([
      host.runtime.turn(),
      host.runtime.turn(),
      host.runtime.turn(),
    ]);
    expect(turns.filter((turn) => turn !== undefined)).toHaveLength(1);
    expect(log).toEqual(['first:1']);
  });

  test('a worker that stalls loses the run to another, and what it writes afterwards is refused', async () => {
    const { host: stalled, ingest } = await deployed();
    const other = node();
    let entered!: () => void;
    let release!: () => void;
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    slow = {
      entered,
      release: () => {},
      gate: new Promise<void>((resolve) => {
        release = resolve;
      }),
    };
    await ingest('slow_start');

    // The first worker is in the middle of the action when its lease runs out
    const first = stalled.runtime.turn();
    await reached;
    expect(await other.drain()).toEqual([]);
    advance(DEFAULT_LEASE_MS + 1);

    // The second takes the run and runs the step again: steps are at least once
    slow = undefined;
    expect(await other.drain()).toMatchObject([{ ended: 'complete' }]);

    // The first comes back to life: its checkpoint is refused and its turn is dropped
    release();
    expect(await first).toMatchObject({ ended: 'abandoned' });
    expect(log).toEqual(['slowly', 'slowly']);
    expect(await runs()).toEqual([{ status: 'complete', error: null }]);
    expect(await entryStatus()).toBe('completed');
  });
});

describe('the store failing under a turn', () => {
  test('is not the journey failing: the turn throws, and the run is replayed from its checkpoints', async () => {
    const { host, ingest } = await deployed();
    await ingest('nap');
    // The connection drops as the first action's checkpoint is written
    let dropped = false;
    // oxlint-disable-next-line typescript/unbound-method -- called with its own `this` below
    const original = RunStore.prototype.checkpoint;
    const spy = vi.spyOn(RunStore.prototype, 'checkpoint').mockImplementation(async function (
      this: RunStore,
      run,
      key,
      record,
      now
    ) {
      if (!dropped && record.kind === 'do' && record.done && log.includes('first')) {
        dropped = true;
        throw Object.assign(new Error('connection terminated'), { code: '08006' });
      }
      return original.call(this, run, key, record, now);
    });

    await expect(host.runtime.turn()).rejects.toThrow('connection terminated');
    expect(dropped).toBe(true);
    // Not errored: still held by the turn that was dropped, until its lease runs out
    expect(await runs()).toEqual([{ status: 'running', error: null }]);
    expect(await entryStatus()).not.toBe('failed');
    spy.mockRestore();

    advance(DEFAULT_LEASE_MS + 1);
    expect(await host.drain()).toMatchObject([{ ended: 'suspended' }]);
    advance(HOUR);
    expect(await host.drain()).toMatchObject([{ ended: 'complete' }]);
    expect(await runs()).toEqual([{ status: 'complete', error: null }]);
  });
});

describe('the runtime port', () => {
  test('an id names one run for good, an unknown one answers InstanceNotFoundError', async () => {
    const { binding } = node().runtime;
    const params = {
      workflowId: 'w',
      contentHash: 'h',
      userId: 'u1',
      trigger: { event: 'x', payload: {} },
    };
    await binding.create({ id: 'i1', params });
    await expect(binding.create({ id: 'i1', params })).rejects.toThrow(/already exists/);
    await expect(binding.get('nope')).rejects.toBeInstanceOf(InstanceNotFoundError);
    expect(await (await binding.get('i1')).status?.()).toEqual({ status: 'running' });
  });

  test('a terminated run is never taken again, and takes no wake', async () => {
    const { host, ingest } = await deployed();
    await ingest('sign_up');
    await host.drain();
    const [{ instance_id: id }] = await database.client.query<{ instance_id: string }>(
      'SELECT instance_id FROM workflow.run'
    );
    const instance = await host.runtime.binding.get(id);
    await instance.terminate?.();
    expect(await instance.status?.()).toEqual({ status: 'terminated' });

    await instance.sendEvent({ type: 'wake' });
    advance(2 * HOUR);
    expect(await host.drain()).toEqual([]);
    expect(log).toEqual([]);
  });
});

describe('housekeeping', () => {
  test('runs that ended long ago are removed with their checkpoints; the rest stay', async () => {
    const { host, ingest } = await deployed();
    await ingest('order', { total: 1 });
    await host.drain();
    await ingest('nap', undefined, 'u2');
    await host.drain();

    advance(8 * 24 * HOUR);
    expect(await host.runtime.prune(7 * 24 * HOUR)).toBe(1);
    expect(await runs()).toEqual([{ status: 'sleeping', error: null }]);
    const steps = await database.client.query<{ n: number }>(
      'SELECT count(DISTINCT instance_id)::int AS n FROM workflow.run_step'
    );
    expect(steps[0]?.n).toBe(1);
  });

  test('erasing a user removes their runs', async () => {
    const { host, ingest } = await deployed();
    await ingest('nap');
    await host.drain();
    await database.store.requestErasure('u1', Date.now());
    await database.store.forgetUser('u1', Date.now());
    expect(await runs()).toEqual([]);
    expect(await database.client.query('SELECT 1 FROM workflow.run_step')).toEqual([]);
  });
});

describe('started', () => {
  const freePort = () =>
    new Promise<number>((resolve, reject) => {
      const probe = createServer();
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const address = probe.address();
        probe.close(() => {
          if (typeof address === 'object' && address !== null) resolve(address.port);
          else reject(new Error('no port'));
        });
      });
    });

  test('a port that is taken refuses the start, and leaves nothing running', async () => {
    vi.useRealTimers();
    const taken = createServer();
    const port = await new Promise<number>((resolve) => {
      taken.listen(0, '127.0.0.1', () => {
        const address = taken.address();
        resolve(typeof address === 'object' && address !== null ? address.port : 0);
      });
    });
    const host = node({ pollMs: 20, sweepMs: 3_600_000 });
    try {
      await expect(host.start({ port, hostname: '127.0.0.1' })).rejects.toMatchObject({
        code: 'EADDRINUSE',
      });
      // Stopped: a run made due now is taken by nobody
      expect((await post(host, '/bundle/deploy')).status).toBe(200);
      await post(host, '/ingest', { userId: 'u1', events: [{ event: 'order', payload: {} }] });
      await new Promise((resolve) => {
        setTimeout(resolve, 150);
      });
      expect(await runs()).toEqual([{ status: 'queued', error: null }]);
    } finally {
      await new Promise((resolve) => {
        taken.close(resolve);
      });
    }
  }, 20_000);

  test('a request body over the limit is answered 413 and not read', async () => {
    vi.useRealTimers();
    const port = await freePort();
    const host = node({ pollMs: 20, sweepMs: 3_600_000, maxBodyBytes: 1_000 });
    await host.start({ port, hostname: '127.0.0.1' });
    try {
      const response = await fetch(`http://127.0.0.1:${port}/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'u1', events: [], padding: 'x'.repeat(5_000) }),
      });
      expect(response.status).toBe(413);
    } finally {
      await host.stop();
    }
  }, 20_000);

  test('workers pick up what the HTTP server takes in, with nobody draining', async () => {
    vi.useRealTimers();
    const port = await freePort();
    const host = node({ pollMs: 20, sweepMs: 3_600_000 });
    await host.start({ port, hostname: '127.0.0.1' });
    try {
      const call = (path: string, body?: unknown) =>
        fetch(`http://127.0.0.1:${port}${path}`, {
          method: body === undefined && path === '/health' ? 'GET' : 'POST',
          headers: { 'content-type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      expect((await call('/health')).status).toBe(200);
      expect((await call('/bundle/deploy')).status).toBe(200);
      expect(
        (
          await call('/ingest', {
            userId: 'u1',
            events: [{ event: 'order', payload: { total: 7 } }],
          })
        ).status
      ).toBe(200);
      await vi.waitFor(() => expect(log).toEqual(['first:7']), { timeout: 5_000 });
      await vi.waitFor(
        async () => expect(await runs()).toEqual([{ status: 'complete', error: null }]),
        {
          timeout: 5_000,
        }
      );
    } finally {
      await host.stop();
    }
  }, 20_000);
});
