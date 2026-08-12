import { describe, expect, test } from 'vitest';
import {
  and,
  between,
  compileBundle,
  contains,
  eq,
  exists,
  type flow,
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
  templates,
  trigger,
  workflow,
} from '../src/index';
import { BundleIR } from '../src/ir';
import { activeSubscriber, e, gettingStarted, limitedTimeOffer, purchaser, u } from './fixtures';

/** Compile a single-node flow and return that node's IR. */
function nodeOf(build: (w: Parameters<Parameters<typeof flow>[0]>[0]) => unknown) {
  const ir = workflow('probe', { trigger: trigger.event(e.login) });
  build(ir);
  return ir.toIR().flow[0];
}

/** Compile a condition by planting it in a filter node. */
function conditionOf(condition: Parameters<typeof not>[0]) {
  const node = workflow('probe', { trigger: trigger.event(e.login) })
    .filter(condition)
    .toIR().flow[0];
  if (node.type !== 'filter') throw new Error('expected filter node');
  return node.condition;
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
    const ir = workflow('t', {
      trigger: trigger.event(e.sign_up, { filter: exists(u.email) }),
    }).toIR();
    expect(ir.trigger).toEqual({
      type: 'event',
      event: 'sign_up',
      filter: { type: 'property', path: 'email', op: 'exists' },
    });
  });

  test('segment, date and webhook triggers', () => {
    expect(workflow('a', { trigger: trigger.segment(purchaser) }).toIR().trigger).toEqual({
      type: 'segment',
      segment: 'purchaser',
    });
    expect(workflow('b', { trigger: trigger.date('2026-12-25 09:00:00') }).toIR().trigger).toEqual({
      type: 'date',
      at: '2026-12-25 09:00:00',
    });
    expect(workflow('c', { trigger: trigger.webhook() }).toIR().trigger).toEqual({
      type: 'webhook',
    });
  });
});

describe('flow nodes', () => {
  test('randomized delay compiles min and max', () => {
    expect(nodeOf((w) => w.delay({ min: '1 hour', max: '4 hours' }))).toEqual({
      id: '0',
      type: 'random_delay',
      min: { value: '1 hour', ms: 3_600_000 },
      max: { value: '4 hours', ms: 14_400_000 },
    });
  });

  test('time window defaults to every day in the user timezone', () => {
    expect(nodeOf((w) => w.timeWindow({ between: ['09:00', '17:00'] }))).toEqual({
      id: '0',
      type: 'time_window',
      days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
      between: ['09:00', '17:00'],
      tz: 'user',
    });
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
    const ir = workflow('nested', { trigger: trigger.event(e.login) })
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
    expect(node).toEqual({
      id: '0',
      type: 'cohort',
      arms: [{ name: 'control', weight: 100, flow: [] }],
    });
  });

  test('sendEvent payload resolves refs and literals', () => {
    const node = nodeOf((w) => w.sendEvent(e.purchase, { value: 1, currency: 'USD' }));
    expect(node).toEqual({
      id: '0',
      type: 'send_event',
      event: 'purchase',
      payload: { value: 1, currency: 'USD' },
    });
  });
});

describe('workflow options', () => {
  test('goal full form keeps window and exitOnMatch', () => {
    const ir = workflow('g', {
      trigger: trigger.event(e.login),
      goal: { condition: purchaser, within: '30 days', exitOnMatch: false },
      exitWhen: notExists(u.email),
    }).toIR();

    expect(ir.goal).toEqual({
      condition: { type: 'segment', segment: 'purchaser' },
      within: { value: '30 days', ms: 2_592_000_000 },
      exitOnMatch: false,
    });
    expect(ir.exitWhen).toEqual({ type: 'property', path: 'email', op: 'not_exists' });
  });
});

describe('bundle compilation', () => {
  test('segments carry their definition and hash; templates form a manifest', () => {
    const tt = templates<{ hello: { default: (p: { name: string }) => unknown } }>();
    const hello = tt.email('hello');
    const wf = workflow('w', { trigger: trigger.event(e.login) }).email(hello, { name: 'x' });

    const bundle = compileBundle({
      workflows: [wf],
      segments: [purchaser],
      templates: [hello, limitedTimeOffer],
    });

    expect(() => BundleIR.parse(bundle)).not.toThrow();
    expect(bundle.segments[0]).toMatchObject({
      name: 'purchaser',
      condition: { type: 'performed', event: 'purchase' },
    });
    expect(bundle.segments[0]?.contentHash).toBeTruthy();
    expect(bundle.templates.map((t) => t.key)).toEqual(['hello', 'n2_limited_time_offer']);
  });

  test('segment names must be unique within a bundle', () => {
    const twin = segment('purchaser', performed(e.login));
    expect(() => compileBundle({ workflows: [], segments: [purchaser, twin] })).toThrow(
      /duplicate segment/i
    );
  });
});
