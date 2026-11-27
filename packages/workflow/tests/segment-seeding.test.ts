import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { deployBundle, identifyUser, ingestEvent, sweepSegments } from '../src/host/ingest';
import { and, compileBundle, eq, inArray, segment, trigger, workflow } from '../src/index';
import { makeEnv } from './fake-cloudflare';
import { plainEmail, u } from './fixtures';
import { type PgliteDatabase, pgliteDatabase, truncateAll } from './pglite';

/**
 * `trigger.enters(segment)` is about entering. A segment a deploy brings in new, or with a
 * changed condition, has no membership to tell "entered" from "was in it all along" — so until a
 * sweep has been through every user, whoever matches is recorded as a member and starts nothing.
 * What happens no longer depends on what was deployed before.
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
const paid = segment({
  id: 'pro',
  condition: inArray(u.subscription_plan, ['pro', 'business']),
});
const upsell = workflow({
  id: 'upsell',
  reentry: { mode: 'after_exit' },
  trigger: trigger.enters(pro),
}).email(plainEmail('upsell'));

const withTrigger = (...segments: (typeof pro)[]) =>
  compileBundle({ workflows: [upsell], segments });

const members = async (id = 'pro') =>
  (
    await database.client.query<{ user_id: string }>(
      'SELECT user_id FROM workflow.segment_member WHERE segment = $1 ORDER BY user_id',
      [id]
    )
  ).map((row) => row.user_id);
const owed = async () =>
  (await database.client.query('SELECT 1 FROM workflow.segment_start')).length;
const seeding = () => database.store.seedingSegments().then((list) => list.map(({ id }) => id));

describe('the people already in a segment do not enter it', () => {
  test('segment and trigger deployed together: the first sweep records them and starts nothing', async () => {
    const { env, store, journey } = setup();
    await store.mergeProfile('old1', { subscription_plan: 'pro' });
    await store.mergeProfile('old2', { subscription_plan: 'pro' });
    await store.mergeProfile('free', { subscription_plan: 'free' });
    await deployBundle(env, withTrigger(pro), store);
    expect(await seeding()).toEqual(['pro']);

    const first = await sweepSegments(env, store);
    expect(first.started).toEqual([]);
    expect(await members()).toEqual(['old1', 'old2']);
    expect(await owed()).toBe(0);
    expect(await seeding()).toEqual([]);

    // Seeded: from here on, becoming pro is entering
    const upgrade = await identifyUser(env, 'free', { subscription_plan: 'pro' }, store);
    expect(upgrade.started).toHaveLength(1);
    expect(journey.created).toHaveLength(1);
    // And the sweep finds nothing left to do for the ones it recorded
    expect((await sweepSegments(env, store)).started).toEqual([]);
  });

  test('the same when the segment was deployed and swept before its trigger existed', async () => {
    const { env, store, journey } = setup();
    await store.mergeProfile('old1', { subscription_plan: 'pro' });
    await deployBundle(env, compileBundle({ workflows: [], segments: [pro] }), store);
    await sweepSegments(env, store);
    await deployBundle(env, withTrigger(pro), store);

    expect((await sweepSegments(env, store)).started).toEqual([]);
    expect(journey.created).toEqual([]);
    expect(await members()).toEqual(['old1']);
  });

  test('before the sweep, a matching user seen on their own activity is recorded without a journey', async () => {
    const { env, store, journey } = setup();
    await store.mergeProfile('old1', { subscription_plan: 'pro' });
    await deployBundle(env, withTrigger(pro), store);

    const seen = await ingestEvent(env, { userId: 'old1', event: 'login' }, store);
    expect(seen.started).toEqual([]);
    expect(await members()).toEqual(['old1']);
    expect(await owed()).toBe(0);

    // Nothing is owed to them once the seeding ends either
    await sweepSegments(env, store);
    expect(journey.created).toEqual([]);
  });

  test('a member who leaves and qualifies again after the seeding enters', async () => {
    const { env, store } = setup();
    await store.mergeProfile('old1', { subscription_plan: 'pro' });
    await deployBundle(env, withTrigger(pro), store);
    await sweepSegments(env, store);

    await identifyUser(env, 'old1', { subscription_plan: 'free' }, store);
    expect(await members()).toEqual([]);
    const back = await identifyUser(env, 'old1', { subscription_plan: 'pro' }, store);
    expect(back.started).toHaveLength(1);
  });
});

describe('what starts a seeding over', () => {
  test('redeploying the same bundle does not: every version applies it again', async () => {
    const { env, store } = setup();
    await deployBundle(env, withTrigger(pro), store);
    const [begun] = await store.seedingSegments();
    await deployBundle(env, withTrigger(pro), store);
    expect(await store.seedingSegments()).toEqual([begun]);

    await sweepSegments(env, store);
    await deployBundle(env, withTrigger(pro), store);
    expect(await seeding()).toEqual([]);
  });

  test('a changed condition does: whoever the edit newly covers was not entering', async () => {
    const { env, store, journey } = setup();
    await store.mergeProfile('biz', { subscription_plan: 'business' });
    await deployBundle(env, withTrigger(pro), store);
    await sweepSegments(env, store);
    expect(await members()).toEqual([]);

    await deployBundle(env, withTrigger(paid), store);
    expect(await seeding()).toEqual(['pro']);
    expect((await sweepSegments(env, store)).started).toEqual([]);
    expect(await members()).toEqual(['biz']);
    expect(journey.created).toEqual([]);
    expect(await seeding()).toEqual([]);
  });

  test('so does a change in a segment it is built on, though its own definition did not move', async () => {
    const { env, store } = setup();
    const emailed = (base: typeof pro) =>
      compileBundle({
        workflows: [],
        segments: [
          base,
          segment({ id: 'pro_with_email', condition: and(base, eq(u.email, 'a@example.com')) }),
        ],
      });
    await deployBundle(env, emailed(pro), store);
    await sweepSegments(env, store);
    expect(await seeding()).toEqual([]);

    await deployBundle(env, emailed(paid), store);
    expect(await seeding()).toEqual(['pro', 'pro_with_email']);
  });

  test('a sweep ends the seeding it began with, not one a deploy started meanwhile', async () => {
    const { env, store } = setup();
    await deployBundle(env, withTrigger(pro), store);
    const begun = await store.seedingSegments();
    // A deploy lands while that sweep is still paging: another condition, another seeding
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5);
    });
    await deployBundle(env, withTrigger(paid), store);

    await store.finishSeeding(begun);
    expect(await seeding()).toEqual(['pro']);
  });
});

describe('the name', () => {
  test('trigger.segment is trigger.enters under its earlier name: the same trigger, the same hash', () => {
    const named = (t: ReturnType<typeof trigger.enters>) =>
      workflow({ id: 'upsell', reentry: { mode: 'never' }, trigger: t }).toIR();
    // oxlint-disable-next-line typescript/no-deprecated -- the alias is what is under test
    const earlier = named(trigger.segment(pro));
    expect(earlier.trigger).toEqual({ type: 'segment', segment: 'pro' });
    expect(earlier.contentHash).toBe(named(trigger.enters(pro)).contentHash);
  });
});
