import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { evaluateCondition, matchesWhere } from '../src/engine/condition';
import type { ConditionIR, ScalarIR } from '../src/ir';
import { conditionToSql } from '../src/store/condition-sql';
import { JourneyFactSource } from '../src/store/facts';
import { type PgliteDatabase, pgliteDatabase, truncateAll } from './pglite';

/**
 * The sweep trusts `conditionToSql` to leave out only those users the evaluator would agree on.
 * So each condition below runs both ways over the same rows: TRUE and FALSE must be what the
 * evaluator answers. NULL ("ask the evaluator") is always allowed by that rule, and is pinned
 * separately for what must be decided in SQL, or a sweep would look at everyone.
 */

const NOW = Date.UTC(2026, 0, 31);
const DAY = 24 * 60 * 60 * 1000;
const days = (n: number) => ({ value: `${String(n)} days`, ms: n * DAY });

let database: PgliteDatabase;

beforeAll(async () => {
  database = await pgliteDatabase();
}, 30_000);
afterAll(async () => {
  await database.close();
});
beforeEach(async () => {
  await truncateAll(database.pg);
  await seed();
});

const PROFILES: Record<string, Record<string, unknown>> = {
  number: { score: 5, plan: 'pro', email: 'a@example.com', flag: true },
  zero: { score: 0, plan: 'free', flag: false, phone: '+1' },
  decimal: { score: 0.1, plan: 'PRO' },
  numeric_string: { score: '5', plan: 'pro plan' },
  text: { score: 'abc', plan: '' },
  bool_score: { score: true, plan: 'é' },
  nested: { score: { value: 5 }, plan: ['pro'], email: { to: 'x' } },
  json_null: { score: null, plan: null, email: null },
  empty: {},
};
/** Users with events or devices only, and a profile-less one for the left join. */
const NO_PROFILE = ['events_only'];
const USERS = [...Object.keys(PROFILES), ...NO_PROFILE];

async function seed() {
  const { store, pg } = database;
  for (const [userId, props] of Object.entries(PROFILES)) {
    // Directly: the merge drops nulls, and the evaluator must cope with rows written by other means
    await pg.query(`INSERT INTO workflow.profile (user_id, props) VALUES ($1, $2::text::jsonb)`, [
      userId,
      JSON.stringify(props),
    ]);
  }
  const events: [string, string, number, unknown][] = [
    ['number', 'login', NOW - 2 * DAY, { plan: 'pro', amount: 10, tags: { source: 'ad' } }],
    ['number', 'login', NOW - 20 * DAY, { plan: 'free', amount: 3 }],
    ['number', 'login', NOW - 40 * DAY, { plan: 'pro', amount: 30 }],
    ['zero', 'login', NOW - 7 * DAY, { amount: '10', list: [1, 2], tags: null }],
    ['zero', 'buy', NOW, { amount: 0, nested: { deep: { x: 1 } } }],
    ['decimal', 'login', NOW + DAY, {}],
    ['events_only', 'login', NOW - DAY, { list: [] }],
    ['events_only', 'buy', NOW - DAY, { amount: 100, tags: { source: 'mail' } }],
    ['events_only', 'buy', NOW - 2 * DAY, { amount: 200 }],
  ];
  let id = 0;
  for (const [userId, event, ts, payload] of events) {
    await store.insertEvent({
      id: `e${String(++id)}`,
      userId,
      event,
      ts,
      payload: payload as never,
    });
  }
  await store.upsertDevice({ userId: 'number', token: 't1', platform: 'ios', at: NOW });
  await store.upsertDevice({ userId: 'zero', token: 't2', platform: 'android', at: NOW });
  // The channel-wide opt-outs, and a topic's, which leaves the channel reachable
  const optOuts: [string, string, string | null][] = [
    ['zero', 'push', null],
    ['number', 'email', null],
    ['zero', 'sms', 'promo'],
  ];
  for (const [userId, channel, topic] of optOuts) {
    await pg.query(
      `INSERT INTO workflow.suppression (user_id, channel, topic, ts)
       VALUES ($1, $2, $3, to_timestamp($4::double precision / 1000))`,
      [userId, channel, topic, NOW]
    );
  }
}

const SEGMENTS = new Map<string, ConditionIR>([
  ['pro', { type: 'property', path: 'plan', op: 'eq', value: 'pro' }],
  [
    'pro_or_active',
    {
      type: 'or',
      conditions: [
        { type: 'segment', segment: 'pro' },
        { type: 'performed', event: 'login', within: days(7) },
      ],
    },
  ],
  ['loop_a', { type: 'segment', segment: 'loop_b' }],
  ['loop_b', { type: 'segment', segment: 'loop_a' }],
]);

/** One (user, SQL verdict) per known user. */
async function sqlVerdicts(condition: ConditionIR): Promise<Map<string, boolean | null>> {
  const params: unknown[] = [];
  const sql = conditionToSql(condition, {
    tables: {
      event: 'workflow.event',
      suppression: 'workflow.suppression',
      device: 'workflow.device',
    },
    user: 'u.user_id',
    props: 'p.props',
    nowMs: NOW,
    segments: SEGMENTS,
    bind(value) {
      params.push(value);
      return `$${String(params.length)}`;
    },
  });
  const rows = await database.client.query<{ user_id: string; verdict: boolean | null }>(
    `SELECT u.user_id, (${sql}) AS verdict
     FROM (SELECT unnest($${String(params.length + 1)}::text[]) AS user_id) u
     LEFT JOIN workflow.profile p ON p.user_id = u.user_id`,
    [...params, USERS]
  );
  return new Map(rows.map((row) => [row.user_id, row.verdict]));
}

async function jsVerdict(condition: ConditionIR, userId: string): Promise<boolean | 'throws'> {
  const store = new Proxy(database.store, {
    get(target, property, receiver) {
      if (property === 'getSegmentCondition') {
        return (name: string) => Promise.resolve(SEGMENTS.get(name));
      }
      return Reflect.get(target, property, receiver);
    },
  });
  try {
    return await evaluateCondition(condition, new JourneyFactSource(store, userId), NOW);
  } catch {
    return 'throws';
  }
}

const property = (
  op: Extract<ConditionIR, { type: 'property' }>['op'],
  extra: { path?: string; value?: ScalarIR; values?: ScalarIR[] } = {}
): ConditionIR => ({ type: 'property', path: extra.path ?? 'score', op, ...extra });
const payload = (
  path: string,
  op: Extract<ConditionIR, { type: 'payload' }>['op'],
  extra: { value?: ScalarIR; values?: ScalarIR[] } = {}
): ConditionIR => ({ type: 'payload', path, op, ...extra });

const OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'not_contains'] as const;
const VALUES: ScalarIR[] = [5, 0, 0.1, -1, '5', 'abc', '', 'pro', 'é', true, false];
const LISTS: ScalarIR[][] = [
  [],
  [5],
  ['5', 5],
  [true],
  ['pro', 'free'],
  [0, 10],
  ['a', 'z'],
  [0, 'z'],
  [1],
];
const LIST_OPS = ['between', 'not_between', 'in_array', 'not_in_array'] as const;

function propertyLeaves(path: string): ConditionIR[] {
  const out: ConditionIR[] = [property('exists', { path }), property('not_exists', { path })];
  for (const op of OPS) {
    out.push(property(op, { path }));
    for (const value of VALUES) out.push(property(op, { path, value }));
  }
  for (const op of LIST_OPS) {
    out.push(property(op, { path }));
    for (const values of LISTS) out.push(property(op, { path, values }));
  }
  return out;
}

function payloadLeaves(path: string): ConditionIR[] {
  const out: ConditionIR[] = [payload(path, 'exists'), payload(path, 'not_exists')];
  for (const op of OPS) {
    for (const value of [5, 10, 'pro', '10', 'ad']) out.push(payload(path, op, { value }));
  }
  for (const op of LIST_OPS) {
    for (const values of LISTS) out.push(payload(path, op, { values }));
  }
  return out;
}

const leaves: ConditionIR[] = [
  ...['score', 'plan', 'flag', 'email', 'toString', 'userId', 'missing'].flatMap(propertyLeaves),
  ...(['email', 'sms', 'push', 'in_app', 'slack', 'discord', 'survey'] as const).map(
    (channel): ConditionIR => ({ type: 'reachable', channel })
  ),
  { type: 'performed', event: 'login' },
  { type: 'performed', event: 'nothing' },
  { type: 'performed', event: 'login', within: days(7) },
  { type: 'performed', event: 'login', within: days(30) },
  { type: 'performed', event: 'login', count: 2 },
  { type: 'performed', event: 'login', count: 3 },
  { type: 'performed', event: 'login', count: 0 },
  { type: 'performed', event: 'login', count: 1.5 },
  { type: 'performed', event: 'login', count: 2, within: days(30) },
  { type: 'segment', segment: 'pro' },
  { type: 'segment', segment: 'pro_or_active' },
];

const wheres: ConditionIR[] = [
  'plan',
  'amount',
  'tags.source',
  'tags',
  'list',
  'nested.deep.x',
  'nested.deep',
  'list.0',
  'list.length',
  'toString',
  'tags.__proto__',
].flatMap(payloadLeaves);

function expectAgreement(
  condition: ConditionIR,
  sql: boolean | null,
  js: boolean | 'throws',
  user: string
) {
  if (sql === null) return;
  expect({ user, condition, verdict: js }).toEqual({ user, condition, verdict: sql });
}

/** How many verdicts were compared, so a test that compares none cannot pass. */
async function check(conditions: ConditionIR[]): Promise<number> {
  let compared = 0;
  for (const condition of conditions) {
    const verdicts = await sqlVerdicts(condition);
    expect(verdicts.size).toBe(USERS.length);
    for (const user of USERS) {
      expectAgreement(
        condition,
        verdicts.get(user) ?? null,
        await jsVerdict(condition, user),
        user
      );
      compared += 1;
    }
  }
  return compared;
}

describe('a SQL verdict is what the evaluator answers', () => {
  test('property, reachable, performed and segment leaves', async () => {
    expect(await check(leaves)).toBeGreaterThan(0);
  }, 120_000);

  test('performed where clauses', async () => {
    const event = (where: ConditionIR): ConditionIR => ({
      type: 'performed',
      event: 'login',
      where,
    });
    expect(await check(wheres.map(event))).toBeGreaterThan(0);
    expect(
      await check(wheres.map((where) => event({ type: 'not', condition: where })))
    ).toBeGreaterThan(0);
    const counted: ConditionIR[] = wheres
      .filter((_, index) => index % 13 === 0)
      .map((where) => ({ type: 'performed', event: 'buy', where, count: 2 }));
    expect(await check(counted)).toBeGreaterThan(0);
  }, 240_000);

  test('and, or and not over a seeded random sample of everything', async () => {
    // A small LCG: reproducible, so a failure names the same condition next time
    let seed = 42;
    const next = (bound: number) => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return Math.floor((seed / 4294967296) * bound);
    };
    const leaf = () => leaves[next(leaves.length)];
    const tree = (depth: number): ConditionIR => {
      if (depth === 0) return leaf();
      const kind = next(3);
      if (kind === 0) return { type: 'not', condition: tree(depth - 1) };
      const conditions = Array.from({ length: next(4) }, () => tree(depth - 1));
      return { type: kind === 1 ? 'and' : 'or', conditions };
    };
    expect(await check(Array.from({ length: 150 }, () => tree(3)))).toBeGreaterThan(0);
  }, 120_000);

  test('where clauses agree with matchesWhere on the raw payload shapes', () => {
    // The dotted-path cases the SQL refuses to decide, stated: the evaluator reads them
    expect(matchesWhere({ list: [1, 2] }, payload('list.length', 'eq', { value: 2 }))).toBe(true);
    expect(matchesWhere({ list: [7] }, payload('list.0', 'eq', { value: 7 }))).toBe(true);
    expect(matchesWhere({}, payload('toString', 'exists'))).toBe(true);
  });
});

describe('what SQL decides on its own', () => {
  const decided = async (condition: ConditionIR) => {
    const verdicts = await sqlVerdicts(condition);
    return [...verdicts.values()].every((verdict) => verdict !== null);
  };

  test('same-type comparisons, presence, events, reachability and references', async () => {
    const certain: ConditionIR[] = [
      property('exists'),
      property('eq', { value: 5 }),
      property('ne', { value: 'abc' }),
      property('in_array', { values: [5, 'abc'] }),
      property('contains', { value: 'a' }),
      { type: 'performed', event: 'login', within: days(30) },
      { type: 'performed', event: 'login', count: 2 },
      { type: 'performed', event: 'login', where: payload('plan', 'eq', { value: 'pro' }) },
      { type: 'reachable', channel: 'email' },
      { type: 'reachable', channel: 'push' },
      { type: 'segment', segment: 'pro_or_active' },
      { type: 'not', condition: { type: 'and', conditions: [property('exists')] } },
    ];
    for (const condition of certain) expect(await decided(condition)).toBe(true);
  });

  test("a comparison across types is the evaluator's, only for the rows it concerns", async () => {
    const verdicts = await sqlVerdicts(property('gt', { value: 3 }));
    expect(verdicts.get('number')).toBe(true);
    expect(verdicts.get('zero')).toBe(false);
    expect(verdicts.get('nested')).toBe(false); // A non-scalar reads as absent
    expect(verdicts.get('events_only')).toBe(false);
    expect(verdicts.get('numeric_string')).toBeNull(); // '5' > 3 coerces
    expect(verdicts.get('bool_score')).toBeNull();
  });

  test('an unknown or self-referencing segment is left for the evaluator to report', async () => {
    for (const segment of ['missing', 'loop_a']) {
      const condition: ConditionIR = { type: 'segment', segment };
      const verdicts = await sqlVerdicts(condition);
      expect([...verdicts.values()].every((verdict) => verdict === null)).toBe(true);
      expect(await jsVerdict(condition, 'number')).toBe('throws');
    }
  });

  test('uncertainty cannot survive what already settles the answer', async () => {
    const unknown: ConditionIR = { type: 'segment', segment: 'missing' };
    const no: ConditionIR = { type: 'or', conditions: [] };
    const yes: ConditionIR = { type: 'and', conditions: [] };
    const and = await sqlVerdicts({ type: 'and', conditions: [no, unknown] });
    const or = await sqlVerdicts({ type: 'or', conditions: [yes, unknown] });
    expect(and.get('number')).toBe(false);
    expect(or.get('number')).toBe(true);
  });
});

describe('nothing from a condition reaches the statement as text', () => {
  const HOSTILE = [
    "'; DROP TABLE workflow.profile; --",
    "' OR '1'='1",
    '" OR "1"="1',
    '$1',
    '%',
    '\\',
    "') IS NOT NULL OR ('",
    '{}',
    '-- comment',
  ];

  /** What a condition compiles to, with the parameters it binds. */
  function compiled(condition: ConditionIR) {
    const params: unknown[] = [];
    const text = conditionToSql(condition, {
      tables: { event: 'e', suppression: 's', device: 'd' },
      user: 'u.user_id',
      props: 'p.props',
      nowMs: NOW,
      segments: new Map(),
      bind(value) {
        params.push(value);
        return `$${String(params.length)}`;
      },
    });
    return { text, params };
  }

  const carriers = (bad: string): ConditionIR[] => [
    property('exists', { path: bad }),
    property('eq', { value: bad }),
    property('ne', { value: bad }),
    property('gt', { value: bad }),
    property('contains', { value: bad }),
    property('in_array', { values: [bad, 'x'] }),
    property('between', { values: [bad, bad] }),
    { type: 'performed', event: bad },
    { type: 'performed', event: 'login', where: payload(bad, 'exists') },
    { type: 'performed', event: 'login', where: payload(`a.${bad}`, 'eq', { value: bad }) },
    { type: 'segment', segment: bad },
    // A channel outside the enum: only hand-built IR gets here, and it is bound all the same
    { type: 'reachable', channel: bad as never },
  ];

  test('hostile names, paths and values stay out of the text and run as plain data', async () => {
    for (const bad of HOSTILE) {
      expect(await check(carriers(bad))).toBeGreaterThan(0);
    }
    // `%`, `{}` and `$1` are in the compiler's own SQL, so only the longer ones can be sought
    for (const bad of HOSTILE.filter((value) => value.length > 3)) {
      for (const condition of carriers(bad)) {
        expect(compiled(condition).text).not.toContain(bad);
      }
    }
    const rows = await database.pg.query('SELECT 1 FROM workflow.profile');
    expect(rows.rows).toHaveLength(USERS.length - NO_PROFILE.length);
  }, 60_000);

  test('the whole candidates statement treats a hostile segment and cursor as data', async () => {
    const page = await database.store.listSegmentCandidates({
      segments: HOSTILE.map((id) => ({ id, condition: { type: 'and', conditions: [] } })),
      now: NOW,
      after: "' OR '1'='1",
      limit: 100,
    });
    // Everyone is new to every segment, under the name it was given
    expect(page.length).toBeGreaterThan(0);
    for (const candidate of page) {
      expect([...candidate.segments].sort()).toEqual([...HOSTILE].sort());
    }
    const rows = await database.pg.query('SELECT 1 FROM workflow.profile');
    expect(rows.rows.length).toBeGreaterThan(0);
  });

  test('a count or a window that is not a number cannot enter the text or fail the statement', async () => {
    const count = '1) >= 0 OR (1';
    const hostile: ConditionIR[] = [
      { type: 'performed', event: 'login', count: count as never },
      { type: 'performed', event: 'login', within: { value: 'x', ms: count as never } },
      { type: 'performed', event: 'login', within: { value: 'x', ms: Number.NaN } },
    ];
    for (const condition of hostile) {
      expect(compiled(condition).text).not.toContain(count);
      const verdicts = await sqlVerdicts(condition);
      expect([...verdicts.values()].every((verdict) => verdict === null)).toBe(true);
    }
  });

  test('NUL, which Postgres refuses, leaves the condition to the evaluator', async () => {
    const verdicts = await sqlVerdicts(property('eq', { value: 'a\u0000b' }));
    expect([...verdicts.values()].every((verdict) => verdict === null)).toBe(true);
  });
});
