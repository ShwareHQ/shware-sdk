import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  DATE_TRIGGER_GRACE_MS,
  deployBundle,
  fanOutDatePage,
  sweepDateTriggers,
  sweepSegments,
} from '../src/host/ingest';
import { compileBundle, eq, performed, segment, trigger, workflow } from '../src/index';
import { makeEnv } from './fake-cloudflare';
import { e, plainEmail, u } from './fixtures';
import { type PgliteDatabase, pgliteDatabase, truncateAll } from './pglite';

/**
 * `trigger.date(at, { filter })`: once, when the time has come, a journey for every known user
 * the filter holds for at that moment. The sweep does the starting, a page at a time, with its
 * progress in the store — so it can stop anywhere and go on, and a time runs once whatever is
 * deployed around it.
 */

let database: PgliteDatabase;
beforeAll(async () => {
  database = await pgliteDatabase();
}, 30_000);
afterAll(async () => {
  await database.close();
});
beforeEach(async () => {
  await truncateAll(database.pg);
  vi.useRealTimers();
});

const setup = () => ({ ...makeEnv(), store: database.store });

/** A wall clock the deploy and the sweep both read. */
const at = (time: string) => Date.parse(`${time.replace(' ', 'T')}Z`);
const clock = (time: string) => vi.useFakeTimers({ now: at(time), toFake: ['Date'] });

const BLACK_FRIDAY = '2026-11-27 09:00:00';
const purchaser = segment({ id: 'purchaser', condition: performed(e.purchase) });
const sale = (
  time = BLACK_FRIDAY,
  filter: Parameters<typeof trigger.date>[1] = { filter: purchaser }
) =>
  workflow({
    id: 'sale',
    reentry: { mode: 'concurrent' },
    trigger: trigger.date(time, filter),
  }).email(plainEmail('sale'));
const bundle = (...workflows: ReturnType<typeof sale>[]) =>
  compileBundle({ workflows, segments: [purchaser] });

const buyer = async (userId: string, when = at('2025-01-01 00:00:00')) => {
  await database.store.insertEvent({
    id: `p-${userId}`,
    userId,
    event: 'purchase',
    ts: when,
    payload: { value: 10, currency: 'USD' },
  });
};
const run = async () =>
  (
    await database.client.query<{
      entered: number;
      done: boolean;
      skipped: string | null;
      cursor: string | null;
    }>('SELECT entered, finished_at IS NOT NULL AS done, skipped, cursor FROM workflow.date_run')
  )[0];
const entered = async () =>
  (
    await database.client.query<{ user_id: string }>(
      "SELECT user_id FROM workflow.entry WHERE workflow = 'sale' ORDER BY user_id"
    )
  ).map((row) => row.user_id);

describe('the DSL', () => {
  test('a time is written one way, and a date the calendar lacks is refused', () => {
    expect(trigger.date(BLACK_FRIDAY)).toBeDefined();
    for (const bad of [
      '2026-11-27',
      '2026-11-27T09:00:00Z',
      '2026-02-30 09:00:00',
      '2026-11-27 24:00:00',
    ]) {
      expect(() => trigger.date(bad)).toThrow(/is not a time/);
    }
  });

  test('the filter is part of the trigger; a segment it names must be in the bundle', () => {
    expect(sale().toIR().trigger).toEqual({
      type: 'date',
      at: BLACK_FRIDAY,
      filter: { type: 'segment', segment: 'purchaser' },
    });
    expect(() => compileBundle({ workflows: [sale()], segments: [] })).toThrow(/purchaser/);
  });

  test('without a filter the IR is what it was: the hash of an existing date workflow does not move', () => {
    expect(sale(BLACK_FRIDAY, {}).toIR().trigger).toEqual({
      type: 'date',
      at: BLACK_FRIDAY,
    });
  });
});

describe('when the time comes', () => {
  test('everyone the filter holds for enters, long-standing members included; nobody before the time', async () => {
    const { env, store, journey } = setup();
    await buyer('old-buyer');
    await buyer('new-buyer', at('2026-11-26 00:00:00'));
    await store.mergeProfile('browser', { email: 'b@example.com' });
    clock('2026-11-20 00:00:00');
    expect((await deployBundle(env, bundle(sale()), store)).unrouted).toEqual([]);

    // The segment was deployed long before, and swept: membership plays no part in a filter
    await sweepSegments(env, store);
    expect(journey.created).toEqual([]);
    expect(await run()).toMatchObject({ entered: 0, done: false, skipped: null });

    clock('2026-11-27 09:05:00');
    const sweep = await sweepSegments(env, store);
    expect(sweep.dates).toEqual([
      { workflow: 'sale', at: at(BLACK_FRIDAY), entered: 2, finished: true },
    ]);
    expect(await entered()).toEqual(['new-buyer', 'old-buyer']);
    expect(await run()).toMatchObject({ entered: 2, done: true, skipped: null });
    // The journey is anchored at the trigger's time, and says what started it
    expect(journey.created[0]?.params).toMatchObject({
      workflowId: 'sale',
      trigger: { event: '$date', payload: {}, ts: at(BLACK_FRIDAY) },
    });

    // Once: the next sweep has nothing to do, and a redeploy does not arm it again
    await deployBundle(env, bundle(sale()), store);
    expect((await sweepSegments(env, store)).dates).toEqual([]);
    expect(journey.created).toHaveLength(2);
  });

  test('without a filter every known user enters, and no visitor', async () => {
    const { env, store } = setup();
    await store.mergeProfile('u1', { email: 'a@example.com' });
    await buyer('u2');
    await store.mergeProfile('visitor:v1', {});
    clock('2026-11-20 00:00:00');
    await deployBundle(env, bundle(sale(BLACK_FRIDAY, {})), store);

    clock('2026-11-27 09:00:00');
    await sweepDateTriggers(env, store);
    expect(await entered()).toEqual(['u1', 'u2']);
  });

  test('a profile filter is decided per user, as a journey would decide it', async () => {
    const { env, store } = setup();
    await store.mergeProfile('pro', { subscription_plan: 'pro' });
    await store.mergeProfile('free', { subscription_plan: 'free' });
    await store.mergeProfile('none', {});
    clock('2026-11-20 00:00:00');
    await deployBundle(
      env,
      bundle(sale(BLACK_FRIDAY, { filter: eq(u.subscription_plan, 'pro') })),
      store
    );
    clock('2026-11-27 09:00:00');
    await sweepDateTriggers(env, store);
    expect(await entered()).toEqual(['pro']);
  });
});

describe('the fan-out is resumable', () => {
  test('a page at a time, the cursor in the store: stopping after any page loses nobody and repeats nobody', async () => {
    const { env, store, journey } = setup();
    for (const id of ['a', 'b', 'c', 'd', 'e']) await buyer(id);
    clock('2026-11-20 00:00:00');
    await deployBundle(env, bundle(sale()), store);
    clock('2026-11-27 09:00:00');

    const first = await fanOutDatePage(env, store, Date.now(), 2);
    expect(first).toMatchObject({ finished: false, failed: false });
    expect(first?.started).toHaveLength(2);
    expect(await run()).toMatchObject({ entered: 2, done: false, cursor: 'b' });

    // The next sweep, a quarter of an hour on, picks up where that one stopped
    clock('2026-11-27 09:15:00');
    expect((await fanOutDatePage(env, store, Date.now(), 2))?.started).toHaveLength(2);
    const last = await fanOutDatePage(env, store, Date.now(), 2);
    expect(last).toMatchObject({ finished: true });
    expect(await entered()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(journey.created).toHaveLength(5);
    expect(await fanOutDatePage(env, store, Date.now(), 2)).toBeUndefined();
  });

  test('a start that fails keeps the page: the next sweep takes it again and the ledger skips who entered', async () => {
    const { env, store, journey } = setup();
    for (const id of ['a', 'b', 'c']) await buyer(id);
    clock('2026-11-20 00:00:00');
    await deployBundle(env, bundle(sale()), store);
    clock('2026-11-27 09:00:00');
    const create = journey.create.bind(journey);
    let outage = true;
    journey.create = async (options) => {
      if (outage && options.id.includes('-b-')) throw new Error('platform unavailable');
      return create(options);
    };
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});

    const failed = await sweepDateTriggers(env, store);
    expect(failed.dates).toEqual([
      { workflow: 'sale', at: at(BLACK_FRIDAY), entered: 2, finished: false },
    ]);
    expect(await run()).toMatchObject({ done: false, cursor: null });

    outage = false;
    const retried = await sweepDateTriggers(env, store);
    expect(retried.dates).toEqual([
      { workflow: 'sale', at: at(BLACK_FRIDAY), entered: 1, finished: true },
    ]);
    expect(
      journey.created.map((created) => created.id).filter((id) => id.includes('-a-'))
    ).toHaveLength(1);
    expect(await entered()).toEqual(['a', 'b', 'c']);
    quiet.mockRestore();
  });

  test('the budget ends a sweep between pages; the rest is the next sweep’s', async () => {
    const { env, store } = setup();
    await database.pg.query(
      `INSERT INTO workflow.profile (user_id, props)
         SELECT 'u' || lpad(i::text, 4, '0'), '{}'::jsonb FROM generate_series(0, 600) AS i`
    );
    clock('2026-11-20 00:00:00');
    await deployBundle(env, bundle(sale(BLACK_FRIDAY, {})), store);
    clock('2026-11-27 09:00:00');

    // No budget at all: one page, then stop
    const first = await sweepDateTriggers(env, store, Date.now(), -1);
    expect(first.dates).toEqual([
      { workflow: 'sale', at: at(BLACK_FRIDAY), entered: 500, finished: false },
    ]);
    const second = await sweepDateTriggers(env, store);
    expect(second.dates[0]).toMatchObject({ entered: 101, finished: true });
  }, 60_000);
});

describe('a time runs once, whatever is deployed around it', () => {
  test('a time already past when the trigger is first deployed is not run', async () => {
    const { env, store, journey } = setup();
    await buyer('a');
    clock('2026-11-27 09:20:00');
    await deployBundle(env, bundle(sale()), store);
    expect(await run()).toMatchObject({ done: true, skipped: 'past' });
    expect((await sweepSegments(env, store)).dates).toEqual([]);
    expect(journey.created).toEqual([]);
  });

  test('a deploy that lands between the time and the sweep does not cancel it', async () => {
    const { env, store } = setup();
    await buyer('a');
    clock('2026-11-20 00:00:00');
    await deployBundle(env, bundle(sale()), store);
    // 09:02: a new version applies its bundle, before the 09:15 cron
    clock('2026-11-27 09:02:00');
    await deployBundle(env, bundle(sale()), store);
    clock('2026-11-27 09:15:00');
    await sweepDateTriggers(env, store);
    expect(await entered()).toEqual(['a']);
  });

  test('another time is another run; the workflow’s re-entry policy decides who enters again', async () => {
    const { env, store } = setup();
    await buyer('a');
    clock('2026-11-20 00:00:00');
    await deployBundle(env, bundle(sale()), store);
    clock('2026-11-27 09:00:00');
    await sweepDateTriggers(env, store);

    await deployBundle(env, bundle(sale('2026-12-25 09:00:00')), store);
    clock('2026-12-25 09:00:00');
    const second = await sweepDateTriggers(env, store);
    // `concurrent`: the same user, a second entry, for the second date
    expect(second.dates[0]).toMatchObject({ at: at('2026-12-25 09:00:00'), entered: 1 });
    expect(await entered()).toEqual(['a', 'a']);
  });

  test('a run no sweep picked up within a day is given up, not sent late', async () => {
    const { env, store, journey } = setup();
    await buyer('a');
    clock('2026-11-20 00:00:00');
    await deployBundle(env, bundle(sale()), store);
    vi.setSystemTime(at(BLACK_FRIDAY) + DATE_TRIGGER_GRACE_MS + 1);
    const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const late = await sweepDateTriggers(env, store);
    expect(late.dates).toEqual([
      { workflow: 'sale', at: at(BLACK_FRIDAY), entered: 0, finished: true },
    ]);
    expect(await run()).toMatchObject({ done: true, skipped: 'missed' });
    expect(journey.created).toEqual([]);
    quiet.mockRestore();
  });

  test('an erased user is passed over', async () => {
    const { env, store } = setup();
    await buyer('a');
    await buyer('gone');
    clock('2026-11-20 00:00:00');
    await deployBundle(env, bundle(sale()), store);
    await store.requestErasure('gone', Date.now());
    clock('2026-11-27 09:00:00');
    await sweepDateTriggers(env, store);
    expect(await entered()).toEqual(['a']);
  });
});
