import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { deployBundle, identifyUser, sweepSegments } from '../src/host/ingest';
import { compileBundle, eq, segment, trigger, workflow } from '../src/index';
import { makeEnv } from './fake-cloudflare';
import { plainEmail, u } from './fixtures';
import { type PgliteDatabase, pgliteDatabase, truncateAll } from './pglite';

/**
 * The pass over the segments keeps its place in the store. A sweep that runs out of time — the
 * handler a schedule calls is not given unlimited time — leaves the pass where it got to, and the
 * next sweep carries on from there instead of starting over. What a pass ends with (the seeding
 * of the segments it began with, the sizes) happens once, when it has been through every user,
 * however many sweeps that took.
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
});

const setup = () => ({ ...makeEnv(), store: database.store });

const pro = segment({ id: 'pro', condition: eq(u.subscription_plan, 'pro') });
const free = segment({ id: 'free', condition: eq(u.subscription_plan, 'free') });
const upsell = workflow({
  id: 'upsell',
  reentry: { mode: 'after_exit' },
  trigger: trigger.enters(pro),
}).email(plainEmail('upsell'));

/** `count` users on the pro plan, ids in ascending order: three pages at 1,201. */
const seedPro = (count: number) =>
  database.pg.query(
    `INSERT INTO workflow.profile (user_id, props)
     SELECT 'u' || lpad(i::text, 5, '0'), '{"subscription_plan":"pro"}'
     FROM generate_series(1, ${count}) i`
  );
const members = async (id = 'pro') => {
  const [row] = await database.client.query<{ count: number | string }>(
    'SELECT count(*) AS count FROM workflow.segment_member WHERE segment = $1',
    [id]
  );
  return Number(row.count);
};
const seeding = () => database.store.seedingSegments().then((list) => list.map(({ id }) => id));
const pass = async () => {
  const [row] = await database.client.query<{ cursor: string | null; evaluated: number }>(
    'SELECT cursor, evaluated FROM workflow.sweep_pass'
  );
  return row;
};

/** A sweep with no time for the segments: it does one page of the pass and stops. */
const onePage = (env: ReturnType<typeof setup>['env'], now?: number) =>
  sweepSegments(env, database.store, now, 0);

describe('a sweep that runs out of time is carried on by the next', () => {
  test('three sweeps of one page each go through 1,201 users once, and the pass ends in the third', async () => {
    const { env, store } = setup();
    await seedPro(1201);
    await deployBundle(env, compileBundle({ workflows: [upsell], segments: [pro] }), store);

    const first = await onePage(env);
    expect(first).toMatchObject({ evaluated: 500, started: [], finished: false, sizes: [] });
    expect(await members()).toBe(500);
    expect(await pass()).toEqual({ cursor: 'u00500', evaluated: 500 });
    // Not through everyone yet: the segment is still being seeded
    expect(await seeding()).toEqual(['pro']);

    const second = await onePage(env);
    expect(second).toMatchObject({ evaluated: 500, finished: false });
    expect(await members()).toBe(1000);
    expect(await pass()).toEqual({ cursor: 'u01000', evaluated: 1000 });
    expect(await seeding()).toEqual(['pro']);

    const third = await onePage(env);
    expect(third).toMatchObject({ evaluated: 201, started: [], finished: true });
    expect(third.sizes).toEqual([{ segment: 'pro', size: 1201 }]);
    expect(await members()).toBe(1201);
    expect(await seeding()).toEqual([]);
    // The pass is over: nothing is kept, and the next sweep begins another
    expect(await pass()).toBeUndefined();
    expect(await sweepSegments(env, store)).toMatchObject({ evaluated: 0, finished: true });
  });

  test('with time enough, one sweep is the whole pass', async () => {
    const { env, store } = setup();
    await seedPro(1201);
    await deployBundle(env, compileBundle({ workflows: [upsell], segments: [pro] }), store);
    const all = await sweepSegments(env, store);
    expect(all).toMatchObject({ evaluated: 1201, finished: true });
    expect(await pass()).toBeUndefined();
    expect(await seeding()).toEqual([]);
  });

  test('a segment deployed while a pass is under way is seeded by the next pass, not this one', async () => {
    const { env, store } = setup();
    await seedPro(1201);
    await deployBundle(env, compileBundle({ workflows: [upsell], segments: [pro] }), store);
    await onePage(env);

    // `pro` is as it was (its seeding stands); `free` is new, and the pass under way did not
    // begin with it — its first page never looked at `free` for the users it went past
    await deployBundle(env, compileBundle({ workflows: [upsell], segments: [pro, free] }), store);
    expect(await seeding()).toEqual(['free', 'pro']);
    const rest = await sweepSegments(env, store);
    expect(rest.finished).toBe(true);
    expect(await seeding()).toEqual(['free']);

    expect((await sweepSegments(env, store)).finished).toBe(true);
    expect(await seeding()).toEqual([]);
  });

  test('once the pass that seeded a segment has ended, becoming a member is entering', async () => {
    const { env, store, journey } = setup();
    await seedPro(501);
    await store.mergeProfile('zed', { subscription_plan: 'free' });
    await deployBundle(env, compileBundle({ workflows: [upsell], segments: [pro] }), store);

    await onePage(env);
    // The pass is not over: whoever turns pro now cannot be told from who was pro all along
    const early = await identifyUser(env, 'u00001x', { subscription_plan: 'pro' }, store);
    expect(early.started).toEqual([]);

    await onePage(env);
    expect(await seeding()).toEqual([]);
    const late = await identifyUser(env, 'zed', { subscription_plan: 'pro' }, store);
    expect(late.started).toHaveLength(1);
    expect(journey.created).toHaveLength(1);
  });
});

describe('two sweeps on one pass', () => {
  test('the pass moves only from where it was read: the sweep that comes back late leaves it alone', async () => {
    const { store } = setup();
    const read = await store.openSweepPass(1_000);
    expect(read).toEqual({ startedAt: 1_000, after: undefined, seeding: [], evaluated: 0 });
    // Open again: the same pass, not another
    expect(await store.openSweepPass(2_000)).toEqual(read);

    expect(await store.advanceSweepPass(read, { after: 'u1', evaluated: 3 })).toBe(true);
    // A second sweep that read the pass before that page was saved
    expect(await store.advanceSweepPass(read, { after: 'u0', evaluated: 9 })).toBe(false);
    expect(await store.finishSweepPass(read)).toBe(false);

    const moved = await store.openSweepPass(3_000);
    expect(moved).toEqual({ startedAt: 1_000, after: 'u1', seeding: [], evaluated: 3 });
    expect(await store.finishSweepPass(moved)).toBe(true);
    expect((await store.openSweepPass(4_000)).startedAt).toBe(4_000);
  });

  test('a sweep whose place was moved under it stops without ending the pass', async () => {
    const { env, store } = setup();
    await seedPro(1201);
    await deployBundle(env, compileBundle({ workflows: [upsell], segments: [pro] }), store);
    // Another sweep saves the first page while this one is still doing it
    const racing = new Proxy(store, {
      get(target, property, receiver) {
        if (property !== 'advanceSweepPass') return Reflect.get(target, property, receiver);
        return async (...args: Parameters<typeof store.advanceSweepPass>) => {
          await target.advanceSweepPass(...args);
          return target.advanceSweepPass(...args);
        };
      },
    });
    const late = await sweepSegments(env, racing);
    expect(late).toMatchObject({ evaluated: 500, finished: false, sizes: [] });
    expect(await pass()).toEqual({ cursor: 'u00500', evaluated: 500 });
    expect(await seeding()).toEqual(['pro']);
    // The pass is still there for whoever goes on with it
    expect((await sweepSegments(env, store)).finished).toBe(true);
    expect(await members()).toBe(1201);
  });
});
