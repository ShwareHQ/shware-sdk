import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { deployBundle, ingestEvent } from '../src/host/ingest';
import {
  type Reentry,
  ReentryIR,
  WorkflowIR,
  compileBundle,
  trigger,
  workflow,
} from '../src/index';
import type { EntryInput, JourneyStore } from '../src/store/index';
import { makeEnv } from './fake-cloudflare';
import { allSegments, e, firstTimeRecovery, inactive30d } from './fixtures';
import { type PgliteDatabase, pgliteDatabase, truncateAll } from './pglite';

/**
 * The per-workflow re-entry policy (`workflow({ reentry })`): the compile step's validation, the
 * store's decision on the per-entry ledger for each mode, the idempotency of a redelivered
 * trigger, the segment trigger's entering edge, and what reads or deletes entries.
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

const DAY = 24 * 60 * 60 * 1000;

const entryRows = (workflow: string, userId = 'u1') =>
  database.client.query<{ instance_id: string; status: string; occurrence: string | null }>(
    `SELECT instance_id, status, occurrence FROM workflow.entry
     WHERE workflow = $1 AND user_id = $2 ORDER BY ts, instance_id`,
    [workflow, userId]
  );

/* --------------------------------- compile --------------------------------- */

describe('compiling the policy', () => {
  const base = { id: 'w', trigger: trigger.event(e.login) };
  const compile = (reentry: unknown) =>
    workflow({ ...base, reentry: reentry as Reentry })
      .email(firstTimeRecovery)
      .toIR();

  test('the IR carries the policy as written, the cooldown normalised like every duration', () => {
    expect(compile({ mode: 'never' }).reentry).toEqual({ mode: 'never' });
    expect(compile({ mode: 'concurrent' }).reentry).toEqual({ mode: 'concurrent' });
    expect(compile({ mode: 'after_exit', cooldown: '7 days' }).reentry).toEqual({
      mode: 'after_exit',
      cooldown: { value: '7 days', ms: 7 * DAY },
    });
  });

  test('the policy is part of the content hash', () => {
    expect(compile({ mode: 'never' }).contentHash).not.toBe(
      compile({ mode: 'concurrent' }).contentHash
    );
    expect(compile({ mode: 'concurrent', cooldown: '1 day' }).contentHash).not.toBe(
      compile({ mode: 'concurrent', cooldown: '2 days' }).contentHash
    );
  });

  test('a caller without the types is refused with a message naming what is allowed', () => {
    expect(() => compile(undefined)).toThrow(/`reentry` is required/);
    expect(() => compile('never')).toThrow(/`reentry` is required/);
    expect(() => compile({})).toThrow(/reentry.mode must be 'never', 'after_exit' or 'concurrent'/);
    expect(() => compile({ mode: 'anytime' })).toThrow(/got "anytime"/);
    expect(() => compile({ mode: 'never', cooldown: '1 day' })).toThrow(/takes no cooldown/);
    expect(() => compile({ mode: 'concurrent', cooldown: '0 days' })).toThrow(
      /reentry.cooldown must be positive/
    );
    expect(() => compile({ mode: 'after_exit', cooldown: 7 })).toThrow(/must be a duration/);
    expect(() => compile({ mode: 'after_exit', maxEntries: 3 })).toThrow(/got 'maxEntries'/);
  });

  test('the IR schema refuses impossible combinations, and reads an IR from before the policy', () => {
    expect(() => ReentryIR.parse({ mode: 'never', cooldown: { value: '1 day', ms: DAY } })).toThrow(
      /unrecognized_keys/
    );
    expect(() => ReentryIR.parse({ mode: 'anytime' })).toThrow(/invalid_union/);
    const ir = compile({ mode: 'never' });
    const { reentry: _, ...legacy } = ir;
    expect(WorkflowIR.parse(legacy).reentry).toBeUndefined();
  });
});

/* ------------------------------- store decision ------------------------------ */

describe('the store decides on the per-entry ledger', () => {
  const store = () => database.store;
  let n = 0;
  const entry = (reentry: EntryInput['reentry'], occurrence: string, ts: number): EntryInput => ({
    workflow: 'w',
    userId: 'u1',
    instanceId: `i-${occurrence}-${n++}`,
    hash: 'h',
    ts,
    occurrence,
    reentry,
  });
  /** The instance an entry started, ended as the runner's finalize ends it. */
  const end = async (occurrence: string, status = 'completed') => {
    const state = await store().getEntry('w', 'u1', occurrence);
    if (state === undefined) throw new Error(`no entry for ${occurrence}`);
    await store().setEntryStatus(state.instanceId, status);
  };

  test('never: a second entry is refused, whether the first still runs or ended', async () => {
    const never = { mode: 'never' } as const;
    expect(await store().enterJourney(entry(never, 'e1', 1_000))).toBe('entered');
    expect(await store().enterJourney(entry(never, 'e2', 2_000))).toBeNull();
    await end('e1');
    expect(await store().enterJourney(entry(never, 'e3', 3_000))).toBeNull();
    expect(await entryRows('w')).toHaveLength(1);
  });

  test('never: an entry that only failed is reclaimed, keeping one row', async () => {
    const never = { mode: 'never' } as const;
    expect(await store().enterJourney(entry(never, 'e1', 1_000))).toBe('entered');
    await end('e1', 'failed');
    expect(await store().enterJourney(entry(never, 'e2', 2_000))).toBe('reclaimed');
    expect(await entryRows('w')).toEqual([expect.objectContaining({ occurrence: 'e2' })]);
  });

  test('after_exit: refused while the previous instance runs, entered once it ended', async () => {
    const policy = { mode: 'after_exit' } as const;
    expect(await store().enterJourney(entry(policy, 'e1', 1_000))).toBe('entered');
    expect(await store().enterJourney(entry(policy, 'e2', 2_000))).toBeNull();
    await end('e1', 'goal');
    expect(await store().enterJourney(entry(policy, 'e3', 3_000))).toBe('entered');
    expect(await store().enterJourney(entry(policy, 'e4', 4_000))).toBeNull();
    // A failed instance is not running either
    await end('e3', 'failed');
    expect(await store().enterJourney(entry(policy, 'e5', 5_000))).toBe('entered');
    expect((await entryRows('w')).map((row) => row.occurrence)).toEqual(['e1', 'e3', 'e5']);
  });

  test('concurrent: a new entry starts while the previous one still runs', async () => {
    const policy = { mode: 'concurrent' } as const;
    expect(await store().enterJourney(entry(policy, 'e1', 1_000))).toBe('entered');
    expect(await store().enterJourney(entry(policy, 'e2', 2_000))).toBe('entered');
    expect(await store().enterJourney(entry(policy, 'e3', 2_000))).toBe('entered');
    expect(
      (await entryRows('w')).filter((row) => row.status === 'running').map((r) => r.occurrence)
    ).toEqual(['e1', 'e2', 'e3']);
  });

  test('cooldown is measured from the previous entry, not its exit', async () => {
    const policy = { mode: 'concurrent', cooldown: { value: '1 day', ms: DAY } } as const;
    expect(await store().enterJourney(entry(policy, 'e1', 0))).toBe('entered');
    // Ended right away: the exit does not restart the clock
    await end('e1');
    expect(await store().enterJourney(entry(policy, 'e2', DAY - 1))).toBeNull();
    expect(await store().enterJourney(entry(policy, 'e3', DAY))).toBe('entered');
    // Measured from that latest entry now
    expect(await store().enterJourney(entry(policy, 'e4', DAY + DAY / 2))).toBeNull();
    // An occurrence older than the latest entry (delivered out of order) is within it too
    expect(await store().enterJourney(entry(policy, 'e5', 10))).toBeNull();
  });

  test('after_exit with a cooldown: both conditions must hold', async () => {
    const policy = { mode: 'after_exit', cooldown: { value: '1 day', ms: DAY } } as const;
    expect(await store().enterJourney(entry(policy, 'e1', 0))).toBe('entered');
    // Past the cooldown, still running
    expect(await store().enterJourney(entry(policy, 'e2', 2 * DAY))).toBeNull();
    await end('e1');
    // Ended, but within the cooldown of the entry
    expect(await store().enterJourney(entry(policy, 'e3', DAY / 2))).toBeNull();
    expect(await store().enterJourney(entry(policy, 'e4', 2 * DAY))).toBe('entered');
  });

  test('a failed entry starts no cooldown', async () => {
    const policy = { mode: 'concurrent', cooldown: { value: '1 day', ms: DAY } } as const;
    expect(await store().enterJourney(entry(policy, 'e1', 0))).toBe('entered');
    await end('e1', 'failed');
    expect(await store().enterJourney(entry(policy, 'e2', 1))).toBe('entered');
  });

  test.each<EntryInput['reentry']>([
    { mode: 'never' },
    { mode: 'after_exit' },
    { mode: 'concurrent' },
    { mode: 'concurrent', cooldown: { value: '1 hour', ms: 3_600_000 } },
  ])('the same occurrence never enters twice (%o)', async (policy) => {
    expect(await store().enterJourney(entry(policy, 'e1', 1_000))).toBe('entered');
    expect(await store().enterJourney(entry(policy, 'e1', 1_000))).toBeNull();
    await end('e1');
    // Ended: still the same occurrence, still refused
    expect(await store().enterJourney(entry(policy, 'e1', 1_000))).toBeNull();
    // Failed: reclaimed, never a second row
    await end('e1', 'failed');
    expect(await store().enterJourney(entry(policy, 'e1', 1_000))).toBe('reclaimed');
    expect(await entryRows('w')).toHaveLength(1);
  });

  test('concurrent attempts are admitted as they would be one after the other', async () => {
    const policy = { mode: 'after_exit' } as const;
    const outcomes = await Promise.all(
      ['a', 'b', 'c', 'd'].map((occurrence) => store().enterJourney(entry(policy, occurrence, 1)))
    );
    expect(outcomes.filter((outcome) => outcome === 'entered')).toHaveLength(1);
  });

  test('a row from before re-entry (no occurrence) is the user’s entry, ended or running', async () => {
    await database.client.query(
      `INSERT INTO workflow.entry (workflow, user_id, instance_id, occurrence, hash, status, ts)
       VALUES ('w', 'u1', 'legacy', NULL, 'h', 'running', to_timestamp(0))`
    );
    expect(await store().enterJourney(entry({ mode: 'never' }, 'e1', 1_000))).toBeNull();
    expect(await store().enterJourney(entry({ mode: 'after_exit' }, 'e1', 1_000))).toBeNull();
    await store().setEntryStatus('legacy', 'completed');
    expect(await store().enterJourney(entry({ mode: 'never' }, 'e1', 1_000))).toBeNull();
    expect(await store().enterJourney(entry({ mode: 'after_exit' }, 'e1', 1_000))).toBe('entered');
  });

  test('the deploy guard counts the running entries, one per running instance', async () => {
    const policy = { mode: 'concurrent' } as const;
    await store().enterJourney(entry(policy, 'e1', 1));
    await store().enterJourney(entry(policy, 'e2', 2));
    await store().enterJourney(entry(policy, 'e3', 3));
    await end('e2');
    expect(await store().runningPins()).toEqual([{ workflow: 'w', contentHash: 'h', running: 2 }]);
    expect(await store().runningInstances('u1')).toHaveLength(2);
  });

  test('erasure removes every entry of the user', async () => {
    const policy = { mode: 'concurrent' } as const;
    await store().enterJourney(entry(policy, 'e1', 1));
    await store().enterJourney(entry(policy, 'e2', 2));
    await end('e1');
    await store().requestErasure('u1', 10);
    await store().forgetUser('u1', 11);
    expect(await entryRows('w')).toEqual([]);
  });
});

/* ---------------------------------- ingest ---------------------------------- */

describe('ingest under the policy', () => {
  const setup = (reentry: Reentry) => {
    const { env, journey } = makeEnv();
    const flow = workflow({ id: 'recurring', trigger: trigger.event(e.begin_checkout), reentry })
      .email(firstTimeRecovery)
      .delay('1 day');
    return { env, journey, store: database.store as JourneyStore, flow };
  };
  const checkout = (id: string, ts: number) => ({
    userId: 'u1',
    event: 'begin_checkout',
    id,
    ts,
    payload: { value: 1 },
  });

  test.each<Reentry>([{ mode: 'never' }, { mode: 'after_exit' }, { mode: 'concurrent' }])(
    'a redelivered event enters at most once (%o)',
    async (reentry) => {
      const { env, journey, store, flow } = setup(reentry);
      await deployBundle(env, compileBundle({ workflows: [flow], segments: [] }), store);
      const first = await ingestEvent(env, checkout('evt-1', 1_000), store);
      expect(first.started).toHaveLength(1);
      const again = await ingestEvent(env, checkout('evt-1', 1_000), store);
      expect(again.started).toEqual([]);
      expect(journey.created).toHaveLength(1);
      expect(await entryRows('recurring')).toHaveLength(1);
    }
  );

  test('concurrent: each new event enters, under its own instance id', async () => {
    const { env, store, flow } = setup({ mode: 'concurrent' });
    await deployBundle(env, compileBundle({ workflows: [flow], segments: [] }), store);
    const a = await ingestEvent(env, checkout('evt-1', 1_000), store);
    // The same ts: the occurrence keeps the instance ids apart
    const b = await ingestEvent(env, checkout('evt-2', 1_000), store);
    expect(a.started).toHaveLength(1);
    expect(b.started).toHaveLength(1);
    expect(a.started[0]).not.toBe(b.started[0]);
  });

  test('after_exit: the next event enters only once the previous instance ended', async () => {
    const { env, store, flow } = setup({ mode: 'after_exit', cooldown: '1 hour' });
    await deployBundle(env, compileBundle({ workflows: [flow], segments: [] }), store);
    const [first] = (await ingestEvent(env, checkout('evt-1', 1_000), store)).started;
    expect((await ingestEvent(env, checkout('evt-2', 2 * 3_600_000), store)).started).toEqual([]);
    await store.setEntryStatus(first, 'completed');
    expect((await ingestEvent(env, checkout('evt-3', 1_000 + 60_000), store)).started).toEqual([]);
    expect(
      (await ingestEvent(env, checkout('evt-4', 1_000 + 3_600_000), store)).started
    ).toHaveLength(1);
  });

  test('a segment trigger re-enters only on a fresh qualification', async () => {
    const { env, store } = setup({ mode: 'never' });
    const winback = workflow({
      id: 'winback_again',
      trigger: trigger.segment(inactive30d),
      reentry: { mode: 'after_exit' },
    }).email(firstTimeRecovery);
    await deployBundle(env, compileBundle({ workflows: [winback], segments: allSegments }), store);
    const t0 = Date.UTC(2026, 0, 1);
    const activity = (id: string, event: string, ts: number) =>
      ingestEvent(env, { userId: 'u1', event, id, ts }, store);

    // Qualifies (no login in 30 days) and enters
    const entered = await activity('a', 'begin_checkout', t0);
    expect(entered.started).toHaveLength(1);
    await store.setEntryStatus(entered.started[0], 'completed');
    // Still a member: later evaluations never enter again, though the instance ended
    expect((await activity('b', 'begin_checkout', t0 + DAY)).started).toEqual([]);
    expect(await entryRows('winback_again')).toHaveLength(1);

    // Leaves (a login), then qualifies afresh 31 days later: a new entry
    expect((await activity('c', 'login', t0 + 2 * DAY)).started).toEqual([]);
    expect(await store.isSegmentMember('inactive_30d', 'u1')).toBe(false);
    const again = await activity('d', 'begin_checkout', t0 + 33 * DAY);
    expect(again.started).toHaveLength(1);
    expect((await entryRows('winback_again')).map((row) => row.occurrence)).toEqual([
      `$segment:inactive_30d:${t0}`,
      `$segment:inactive_30d:${t0 + 33 * DAY}`,
    ]);
  });

  test('a fresh qualification the policy refuses is crossed off, not queued', async () => {
    const { env, store } = setup({ mode: 'never' });
    const once = workflow({
      id: 'winback_once',
      trigger: trigger.segment(inactive30d),
      reentry: { mode: 'after_exit' },
    }).email(firstTimeRecovery);
    await deployBundle(env, compileBundle({ workflows: [once], segments: allSegments }), store);
    const t0 = Date.UTC(2026, 0, 1);
    const activity = (id: string, event: string, ts: number) =>
      ingestEvent(env, { userId: 'u1', event, id, ts }, store);
    expect((await activity('a', 'begin_checkout', t0)).started).toHaveLength(1);
    await activity('b', 'login', t0 + DAY);
    // Re-qualifies while the first instance still runs: refused under after_exit
    expect((await activity('c', 'begin_checkout', t0 + 32 * DAY)).started).toEqual([]);
    expect(await store.pendingSegmentStarts('inactive_30d', 'u1')).toEqual([]);
    expect(await entryRows('winback_once')).toHaveLength(1);
  });
});
