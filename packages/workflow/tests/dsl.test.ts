import { describe, expect, test } from 'vitest';
import { stripMeta } from '../src/hash';
import {
  action,
  and,
  between,
  compileBundle,
  contains,
  eq,
  event,
  exists,
  flow,
  gt,
  gte,
  inArray,
  lt,
  lte,
  ne,
  not,
  notBetween,
  notContains,
  notExists,
  notInArray,
  or,
  performed,
  segment,
  trigger,
  workflow,
} from '../src/index';
import { BundleIR, type ConditionIR, type NodeIR } from '../src/ir';
import {
  activeSubscriber,
  e,
  gettingStarted,
  limitedTimeOffer,
  namedEmail,
  purchaser,
  u,
} from './fixtures';

/** Compile a single-node flow and return that node's IR. */
function nodeOf(build: (w: Parameters<Parameters<typeof flow>[0]>[0]) => unknown) {
  const ir = workflow({ id: 'probe', trigger: trigger.event(e.login) });
  build(ir);
  return ir.toIR().flow[0];
}

/** Compile a condition by planting it in a filter node. */
/**
 * The condition's semantics, with provenance stripped: `meta.loc` records where
 * the predicate was written, which is exactly what a semantics assertion should
 * not depend on — and is dropped before hashing for the same reason.
 */
function conditionOf(condition: Parameters<typeof not>[0]) {
  const node = workflow({ id: 'probe', trigger: trigger.event(e.login) })
    .filter(condition)
    .toIR().flow[0];
  if (node.type !== 'filter') throw new Error('expected filter node');
  return stripMeta(node.condition) as ConditionIR;
}

describe('predicates compile to condition IR', () => {
  test('scalar comparisons carry the value', () => {
    expect(conditionOf(eq(u.subscription_status, 'active'))).toEqual({
      type: 'property',
      path: 'subscription_status',
      op: 'eq',
      value: 'active',
    });
    expect(conditionOf(ne(u.subscription_plan, 'free'))).toMatchObject({ op: 'ne', value: 'free' });
    expect(conditionOf(gt(u.docs_count, 10))).toMatchObject({ op: 'gt', value: 10 });
    expect(conditionOf(gte(u.docs_count, 10))).toMatchObject({ op: 'gte', value: 10 });
    expect(conditionOf(lt(u.docs_count, 5))).toMatchObject({ op: 'lt', value: 5 });
    expect(conditionOf(lte(u.docs_count, 5))).toMatchObject({ op: 'lte', value: 5 });
  });

  test('range and set operators carry values arrays', () => {
    expect(conditionOf(between(u.docs_count, 1, 9))).toMatchObject({
      op: 'between',
      values: [1, 9],
    });
    expect(conditionOf(notBetween(u.docs_count, 1, 9))).toMatchObject({
      op: 'not_between',
      values: [1, 9],
    });
    expect(conditionOf(inArray(u.subscription_plan, ['pro', 'business']))).toMatchObject({
      op: 'in_array',
      values: ['pro', 'business'],
    });
    expect(conditionOf(notInArray(u.subscription_plan, ['free']))).toMatchObject({
      op: 'not_in_array',
      values: ['free'],
    });
  });

  test('existence and substring operators', () => {
    expect(conditionOf(exists(u.email))).toEqual({ type: 'property', path: 'email', op: 'exists' });
    expect(conditionOf(notExists(u.email))).toMatchObject({ op: 'not_exists' });
    expect(conditionOf(contains(u.email, '@corp.'))).toMatchObject({
      op: 'contains',
      value: '@corp.',
    });
    expect(conditionOf(notContains(u.email, '+spam'))).toMatchObject({ op: 'not_contains' });
  });

  test('performed where compiles payload predicates with dotted paths', () => {
    expect(
      conditionOf(performed(e.sign_up, (p) => eq(p.method, 'google'), { within: '7 days' }))
    ).toEqual({
      type: 'performed',
      event: 'sign_up',
      where: { type: 'payload', path: 'method', op: 'eq', value: 'google' },
      within: { value: '7 days', ms: 604_800_000 },
    });

    // nested payload objects become dotted paths, combinators nest as usual
    interface DeepEvent {
      login: { platform: 'web' | 'ios'; tags: { utm_source: string } };
    }
    const de = event<DeepEvent>();
    expect(
      conditionOf(
        performed(de.login, (p) => and(eq(p.platform, 'web'), eq(p.tags.utm_source, 'meta')))
      )
    ).toEqual({
      type: 'performed',
      event: 'login',
      where: {
        type: 'and',
        conditions: [
          { type: 'payload', path: 'platform', op: 'eq', value: 'web' },
          { type: 'payload', path: 'tags.utm_source', op: 'eq', value: 'meta' },
        ],
      },
    });
  });

  test('performed carries window and count', () => {
    expect(conditionOf(performed(e.purchase, { within: '30 days', count: 2 }))).toEqual({
      type: 'performed',
      event: 'purchase',
      within: { value: '30 days', ms: 2_592_000_000 },
      count: 2,
    });
    expect(conditionOf(performed(e.login))).toEqual({ type: 'performed', event: 'login' });
  });

  test('combinators nest arbitrarily', () => {
    const condition = conditionOf(
      or(and(eq(u.subscription_status, 'active'), not(performed(e.login))), gt(u.docs_count, 100))
    );
    expect(condition).toEqual({
      type: 'or',
      conditions: [
        {
          type: 'and',
          conditions: [
            { type: 'property', path: 'subscription_status', op: 'eq', value: 'active' },
            { type: 'not', condition: { type: 'performed', event: 'login' } },
          ],
        },
        { type: 'property', path: 'docs_count', op: 'gt', value: 100 },
      ],
    });
  });

  test('a segment used as a condition compiles to a by-name reference', () => {
    expect(conditionOf(activeSubscriber)).toEqual({
      type: 'segment',
      segment: 'active_subscriber',
    });
  });
});

describe('reference tables', () => {
  test('property access produces serializable refs', () => {
    expect({ ...u.email }).toEqual({ type: 'user_property', path: 'email' });
    expect({ ...e.login }).toEqual({ type: 'event_ref', name: 'login' });
  });
});

describe('triggers', () => {
  test('event trigger with an entry filter', () => {
    const ir = workflow({
      id: 't',
      trigger: trigger.event(e.sign_up, { filter: exists(u.email) }),
    }).toIR();
    expect(stripMeta(ir.trigger)).toEqual({
      type: 'event',
      event: 'sign_up',
      filter: { type: 'property', path: 'email', op: 'exists' },
    });
  });

  test('event trigger with a payload where gate', () => {
    expect(
      stripMeta(
        workflow({
          id: 'w',
          trigger: trigger.event(e.sign_up, (p) => eq(p.method, 'google')),
        }).toIR().trigger
      )
    ).toEqual({
      type: 'event',
      event: 'sign_up',
      where: { type: 'payload', path: 'method', op: 'eq', value: 'google' },
    });
  });

  test('segment, date and webhook triggers', () => {
    expect(workflow({ id: 'a', trigger: trigger.segment(purchaser) }).toIR().trigger).toEqual({
      type: 'segment',
      segment: 'purchaser',
    });
    expect(
      workflow({ id: 'b', trigger: trigger.date('2026-12-25 09:00:00') }).toIR().trigger
    ).toEqual({
      type: 'date',
      at: '2026-12-25 09:00:00',
    });
    expect(workflow({ id: 'c', trigger: trigger.webhook() }).toIR().trigger).toEqual({
      type: 'webhook',
    });
  });
});

describe('flow nodes', () => {
  test('randomized delay compiles min and max', () => {
    expect(nodeOf((w) => w.delay({ min: '1 hour', max: '4 hours' }))).toMatchObject({
      id: '0',
      type: 'random_delay',
      min: { value: '1 hour', ms: 3_600_000 },
      max: { value: '4 hours', ms: 14_400_000 },
    });
  });

  test('time window defaults to every day in the user timezone', () => {
    expect(nodeOf((w) => w.timeWindow({ between: ['09:00', '17:00'] }))).toMatchObject({
      id: '0',
      type: 'time_window',
      days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
      between: ['09:00', '17:00'],
      tz: 'user',
    });
  });

  test('cohort compiles the explicit experiment key', () => {
    expect(
      nodeOf((w) => w.cohort({ a: { weight: 50 }, b: { weight: 50 } }, { key: 'exp_coupon' }))
    ).toMatchObject({ type: 'cohort', key: 'exp_coupon' });
  });

  test('run compiles identity only: action name and args — never the code, and no code hash', () => {
    const sync = action<{ plan: string }>('sync_crm', async () => {});
    const node = nodeOf((w) => w.run(sync, { plan: u.subscription_plan }));
    expect(node).toEqual({
      id: '0',
      type: 'action',
      action: 'sync_crm',
      args: { plan: { type: 'user_property', path: 'subscription_plan' } },
      meta: expect.anything(),
    });
    expect(node).not.toHaveProperty('codeHash');
    expect(JSON.stringify(node)).not.toContain('=>');
  });

  test('action() records no hash of its source: the printed handler depends on the bundler', () => {
    // Two toolchains print one function differently (minification, helpers), so a hash of
    // handler.toString() reported a "changed" action on every build. Identity is the ref.
    const a = action('a', async () => {});
    expect(Object.keys(a).sort()).toEqual(['handler', 'name']);
  });

  test('waitUntil defaults onTimeout to continue', () => {
    expect(nodeOf((w) => w.waitUntil(purchaser, { timeout: '3 days' }))).toMatchObject({
      type: 'wait_until',
      timeout: { ms: 259_200_000 },
      onTimeout: 'continue',
    });
  });

  test('waitUntil timeout sub-flow gets .t node ids', () => {
    const node = nodeOf((w) =>
      w.waitUntil(purchaser, {
        timeout: '3 days',
        onTimeout: (t) => t.email(gettingStarted).exit('gave_up'),
      })
    );
    if (node.type !== 'wait_until' || !Array.isArray(node.onTimeout)) {
      throw new Error('expected wait_until with a timeout flow');
    }
    expect(node.onTimeout.map((n) => n.id)).toEqual(['0.t.0', '0.t.1']);
    expect(node.onTimeout[1]).toMatchObject({ type: 'exit', reason: 'gave_up' });
  });

  test('nested branches derive nested structural ids', () => {
    const ir = workflow({ id: 'nested', trigger: trigger.event(e.login) })
      .branch([activeSubscriber, (w) => w.branch([purchaser, (x) => x.email(gettingStarted)])])
      .toIR();
    const outer = ir.flow[0];
    if (outer.type !== 'branch') throw new Error('expected branch');
    const inner = outer.cases[0].flow[0];
    if (inner.type !== 'branch') throw new Error('expected nested branch');
    expect(inner.id).toBe('0.c0.0');
    expect(inner.cases[0].flow[0].id).toBe('0.c0.0.c0.0');
  });

  test('a branch without a default arm omits otherwise', () => {
    const node = nodeOf((w) => w.branch([purchaser, (x) => x.exit()]));
    if (node.type !== 'branch') throw new Error('expected branch');
    expect(node.otherwise).toBeUndefined();
  });

  test('a cohort arm without a flow compiles to an empty flow', () => {
    const node = nodeOf((w) => w.cohort({ control: { weight: 100 } }));
    expect(node).toMatchObject({
      id: '0',
      type: 'cohort',
      arms: [{ name: 'control', weight: 100, flow: [] }],
    });
  });

  test('sendEvent payload resolves refs and literals', () => {
    const node = nodeOf((w) => w.sendEvent(e.purchase, { value: 1, currency: 'USD' }));
    expect(node).toMatchObject({
      id: '0',
      type: 'send_event',
      event: 'purchase',
      payload: { value: 1, currency: 'USD' },
    });
  });
});

describe('workflow options', () => {
  test('goal full form keeps window and exitOnMatch', () => {
    const ir = workflow({
      id: 'g',
      trigger: trigger.event(e.login),
      goal: { condition: purchaser, within: '30 days', exitOnMatch: false },
      exitWhen: notExists(u.email),
    }).toIR();

    expect(stripMeta(ir.goal)).toEqual({
      condition: { type: 'segment', segment: 'purchaser' },
      within: { value: '30 days', ms: 2_592_000_000 },
      exitOnMatch: false,
    });
    expect(stripMeta(ir.exitWhen)).toEqual({
      type: 'property',
      path: 'email',
      op: 'not_exists',
    });
  });
});

describe('bundle compilation', () => {
  test('segments carry their definition and hash; templates form a manifest', () => {
    const hello = namedEmail('hello');
    const wf = workflow({ id: 'w', trigger: trigger.event(e.login) }).email(hello, { name: 'x' });

    const bundle = compileBundle({
      workflows: [wf],
      segments: [purchaser],
      templates: [hello, limitedTimeOffer],
    });

    expect(() => BundleIR.parse(bundle)).not.toThrow();
    expect(bundle.segments[0]).toMatchObject({
      id: 'purchaser',
      condition: { type: 'performed', event: 'purchase' },
    });
    expect(bundle.segments[0]?.contentHash).toBeTruthy();
    expect(bundle.templates.map((t) => t.key)).toEqual(['hello', 'n2_limited_time_offer']);
  });

  test('segment({ id, condition }) labels are optional metadata, outside the hash', () => {
    const bare = segment({ id: 'vip', condition: performed(e.purchase) });
    const labeled = segment({
      id: 'vip',
      name: 'VIP',
      description: 'Bought at least once',
      condition: performed(e.purchase),
    });
    expect(bare.id).toBe('vip');
    const plain = compileBundle({ workflows: [], segments: [bare] }).segments.at(0);
    const named = compileBundle({ workflows: [], segments: [labeled] }).segments.at(0);
    expect(plain).toBeDefined();
    expect(named).toBeDefined();
    if (!plain || !named) throw new Error('Both segments must be compiled');
    expect(plain.meta?.name).toBeUndefined();
    expect(plain.meta?.description).toBeUndefined();
    expect(named.meta).toMatchObject({ name: 'VIP', description: 'Bought at least once' });
    expect(named.id).toBe('vip');
    expect(named.contentHash).toBe(plain.contentHash);
  });

  test('segment names must be unique within a bundle', () => {
    const twin = segment({ id: 'purchaser', condition: performed(e.login) });
    expect(() => compileBundle({ workflows: [], segments: [purchaser, twin] })).toThrow(
      /duplicate segment/i
    );
  });

  test('the bundle carries the subscription topics it is given, or none', () => {
    const topical = compileBundle({ workflows: [], subscriptions: { topics: ['promotions'] } });
    expect(topical.subscriptions).toEqual({ topics: ['promotions'] });
    expect(compileBundle({ workflows: [] }).subscriptions).toEqual({ topics: [] });
    // A bundle from before topics existed still parses
    const { subscriptions: _dropped, ...before } = topical;
    expect(() => BundleIR.parse(before)).not.toThrow();
  });

  test('actions form a manifest of names', () => {
    const sync = action('sync_crm', async () => {});
    const wf = workflow({ id: 'w', trigger: trigger.event(e.login) }).run(sync);
    const bundle = compileBundle({ workflows: [wf], actions: [sync] });
    expect(() => BundleIR.parse(bundle)).not.toThrow();
    expect(bundle.actions).toEqual([{ irVersion: 2, name: 'sync_crm' }]);
  });

  test('an action a workflow runs must be in the bundle, even inside a branch arm', () => {
    const sync = action('sync_crm', async () => {});
    const wf = workflow({ id: 'w', trigger: trigger.event(e.login) }).branch([
      activeSubscriber,
      (w) => w.run(sync),
    ]);
    expect(() => compileBundle({ workflows: [wf], segments: [activeSubscriber] })).toThrow(
      /runs action 'sync_crm' that is not in the bundle/
    );
  });

  test('two same-named actions cannot share one identity, even with identical source', () => {
    // Identity is the ref, not the printed source: two definitions whose handlers
    // happen to print the same are still two implementations behind one name.
    const used = action('sync_crm', async () => {});
    const listed = action('sync_crm', async () => {});
    const wf = workflow({ id: 'w', trigger: trigger.event(e.login) }).run(used);
    expect(() => compileBundle({ workflows: [wf], actions: [listed] })).toThrow(
      /not the definition listed in 'actions'/
    );
  });

  test('an action is found inside branch arms, cohort arms, timeout flows and fragments', () => {
    const listed = action('sync_crm', async () => {});
    const other = action('sync_crm', async () => {});
    const fragment = flow((w) => w.run(other));
    const inBranch = workflow({ id: 'w', trigger: trigger.event(e.login) }).branch([
      activeSubscriber,
      fragment,
    ]);
    const inCohort = workflow({ id: 'w', trigger: trigger.event(e.login) }).cohort({
      a: { weight: 50, flow: (w) => w.run(other) },
      b: { weight: 50 },
    });
    const inTimeout = workflow({ id: 'w', trigger: trigger.event(e.login) }).waitUntil(purchaser, {
      timeout: '1 day',
      onTimeout: (w) => w.run(other),
    });
    for (const wf of [inBranch, inCohort, inTimeout]) {
      expect(() =>
        compileBundle({
          workflows: [wf],
          segments: [activeSubscriber, purchaser],
          actions: [listed],
        })
      ).toThrow(/not the definition listed in 'actions'/);
    }
  });

  test('two same-named actions inside one workflow are caught whichever runs last', () => {
    // Only one of the two can be the bundled implementation; the other node
    // would run against code that never matched it, so the order they appear
    // in must not decide whether it compiles.
    const listed = action('sync_crm', async () => {});
    const other = action('sync_crm', async () => {});
    const listedLast = workflow({ id: 'w', trigger: trigger.event(e.login) })
      .run(other)
      .run(listed);
    const listedFirst = workflow({ id: 'w', trigger: trigger.event(e.login) })
      .run(listed)
      .run(other);

    expect(() => compileBundle({ workflows: [listedLast], actions: [listed] })).toThrow(
      /not the definition listed in 'actions'/
    );
    expect(() => compileBundle({ workflows: [listedFirst], actions: [listed] })).toThrow(
      /not the definition listed in 'actions'/
    );
  });

  test('segments that reference each other in a cycle fail to compile with the path', () => {
    const a = segment({ id: 'a', condition: not(performed(e.login)) });
    const b = segment({ id: 'b', condition: a });
    const c = segment({ id: 'c', condition: and(b, performed(e.login)) });
    // a → b → c → a is not a valid definition of any of them
    (a as unknown as { definition: ConditionIR }).definition = { type: 'segment', segment: 'c' };
    expect(() => compileBundle({ workflows: [], segments: [a, b, c] })).toThrow(
      /cycle: a → c → b → a|cycle: b → a → c → b|cycle: c → b → a → c/
    );
    // A segment referencing itself is the shortest cycle
    const self = segment({ id: 'self', condition: performed(e.login) });
    (self as unknown as { definition: ConditionIR }).definition = {
      type: 'segment',
      segment: 'self',
    };
    expect(() => compileBundle({ workflows: [], segments: [self] })).toThrow(/cycle: self → self/);
    // A diamond (two paths to one segment) is not a cycle
    const leaf = segment({ id: 'leaf', condition: performed(e.login) });
    const left = segment({ id: 'left', condition: leaf });
    const right = segment({ id: 'right', condition: leaf });
    const top = segment({ id: 'top', condition: and(left, right) });
    expect(() =>
      compileBundle({ workflows: [], segments: [top, left, right, leaf] })
    ).not.toThrow();
  });
});

describe('node ids are unique', () => {
  /*
   * A node id is the durable step name (`step.do('{id}:send')`), the message
   * idempotency key and the cohort bucket seed. Two nodes under one id share a
   * checkpoint and a send-suppression key, so the compiler must never emit one.
   */
  test('a fragment reused in two arms gets one id per placement', () => {
    const fragment = flow((w) => w.email(gettingStarted));
    const ir = workflow({ id: 'reused', trigger: trigger.event(e.login) })
      .branch(
        [eq(u.subscription_plan, 'pro'), fragment],
        [eq(u.subscription_plan, 'free'), fragment]
      )
      .toIR();

    const branch = ir.flow[0];
    if (branch.type !== 'branch') throw new Error('expected branch');
    expect(branch.cases[0].flow[0].id).toBe('0.c0.0');
    expect(branch.cases[1].flow[0].id).toBe('0.c1.0');
  });

  test('a fragment reused in sequence is compiled once per placement', () => {
    const fragment = flow((w) => w.email(gettingStarted).delay('1 day'));
    const ir = workflow({ id: 'twice', trigger: trigger.event(e.login) })
      .branch([eq(u.subscription_plan, 'pro'), fragment], fragment)
      .toIR();

    const branch = ir.flow[0];
    if (branch.type !== 'branch') throw new Error('expected branch');
    expect(branch.cases[0].flow.map((n) => n.id)).toEqual(['0.c0.0', '0.c0.1']);
    expect(branch.otherwise?.map((n) => n.id)).toEqual(['0.o.0', '0.o.1']);
  });

  test('toIR rejects a tree that places one node object twice', () => {
    // The DSL's own aliasing path is closed (fragments are copied per
    // placement); this reaches past it to prove the assertion is a real net,
    // because what it guards is silent — the second id write simply wins.
    const wf = workflow({ id: 'aliased', trigger: trigger.event(e.login) }).email(gettingStarted);
    const nodes = (wf as unknown as { nodes: NodeIR[] }).nodes;
    nodes.push(nodes[0]);

    expect(() => wf.toIR()).toThrow(/node id '0' is used twice|used twice/);
  });
});

describe('payload refs do not shadow author field names', () => {
  /*
   * A payload ref doubles as the table of its sub-fields, so every string key
   * it answered itself shadowed a field of that name: `p.path` handed back the
   * ref's own dotted path, and the predicate compiled to a *profile* condition
   * on a property called 'path' — a mistake that only surfaced later, as a zod
   * error far from the line that caused it.
   */
  test('payload fields named `path` and `type` compile to payload predicates', () => {
    interface ShadowEvent {
      page_view: { path: string; type: 'page' | 'modal' };
    }
    const se = event<ShadowEvent>();

    expect(
      conditionOf(performed(se.page_view, (p) => and(eq(p.path, '/pricing'), eq(p.type, 'page'))))
    ).toEqual({
      type: 'performed',
      event: 'page_view',
      where: {
        type: 'and',
        conditions: [
          { type: 'payload', path: 'path', op: 'eq', value: '/pricing' },
          { type: 'payload', path: 'type', op: 'eq', value: 'page' },
        ],
      },
    });
  });

  test('nested payload fields named `path` keep their dotted path', () => {
    interface ShadowEvent {
      page_view: { route: { path: string } };
    }
    const se = event<ShadowEvent>();
    expect(conditionOf(performed(se.page_view, (p) => eq(p.route.path, '/pricing')))).toEqual({
      type: 'performed',
      event: 'page_view',
      where: { type: 'payload', path: 'route.path', op: 'eq', value: '/pricing' },
    });
  });
});
