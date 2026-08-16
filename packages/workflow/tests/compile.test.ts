import { describe, expect, test } from 'vitest';
import {
  type Duration,
  compileBundle,
  eq,
  flow,
  performed,
  template,
  trigger,
  workflow,
} from '../src/index';
import { WorkflowIR } from '../src/ir';
import {
  activeSubscriber,
  allWorkflows,
  checkoutRecovery,
  e,
  purchaser,
  reengagement,
  winback,
} from './fixtures';

describe('compile: workflow -> IR', () => {
  test('checkoutRecovery compiles to the expected tree', () => {
    const ir = checkoutRecovery.toIR();

    expect(ir.name).toBe('checkout_recovery');
    expect(ir.trigger).toEqual({ type: 'event', event: 'begin_checkout' });
    expect(ir.goal).toEqual({
      condition: { type: 'segment', segment: 'purchaser' },
      exitOnMatch: true,
    });

    expect(ir.flow[0]).toMatchObject({
      id: '0',
      type: 'delay',
      duration: { value: '1 hour', ms: 3_600_000 },
    });

    const branch = ir.flow[1];
    if (branch.type !== 'branch') throw new Error('expected branch node');
    expect(branch.label).toBe('subscriber_split');
    expect(branch.cases).toHaveLength(1);
    expect(branch.cases[0]?.condition).toEqual({ type: 'segment', segment: 'active_subscriber' });
    expect(branch.cases[0]?.flow[0]).toMatchObject({
      id: '1.c0.0',
      type: 'message',
      channel: 'email',
      template: 'u1_upgrade_recovery',
      props: { plan: { type: 'user_property', path: 'subscription_plan' } },
    });
    expect(branch.otherwise?.map((n) => n.id)).toEqual(['1.o.0', '1.o.1', '1.o.2']);
  });

  test('compiled IR passes the authoritative zod schema', () => {
    for (const builder of allWorkflows) {
      expect(() => WorkflowIR.parse(builder.toIR())).not.toThrow();
    }
  });

  test('contentHash is deterministic and content-addressed', () => {
    expect(checkoutRecovery.toIR().contentHash).toBe(checkoutRecovery.toIR().contentHash);
    const hashes = allWorkflows.map((builder) => builder.toIR().contentHash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  test('winback: multi-arm branch with in-arm exit compiles', () => {
    const ir = winback.toIR();
    const branch = ir.flow.find((n) => n.type === 'branch');
    if (branch?.type !== 'branch') throw new Error('expected branch node');
    expect(branch.cases).toHaveLength(2);
    // the business arm ends with exit (no rejoin)
    expect(branch.cases[0]?.flow.at(-1)).toMatchObject({ type: 'exit', reason: 'handed_to_cs' });
    expect(branch.otherwise).toHaveLength(1);
  });

  test('reengagement: segment trigger and cohort arm ids', () => {
    const ir = reengagement.toIR();
    expect(ir.trigger).toEqual({ type: 'segment', segment: 'inactive_30d' });
    const cohortHost = ir.flow.at(-1);
    if (cohortHost?.type !== 'branch') throw new Error('expected trailing branch node');
    const cohort = cohortHost.cases[0].flow[0];
    if (cohort.type !== 'cohort') throw new Error('expected cohort node');
    expect(cohort.arms.map((a) => a.name)).toEqual(['control', 'coupon']);
    expect(cohort.arms[1]?.flow[0]?.id).toBe(`${cohort.id}.coupon.0`);
  });

  test('goal shorthand condition expands with exitOnMatch: true', () => {
    const ir = workflow('g', { trigger: trigger.event(e.login), goal: purchaser }).toIR();
    expect(ir.goal?.exitOnMatch).toBe(true);
  });

  test('rejects invalid duration at build time', () => {
    expect(() => flow((w) => w.delay('1 huor' as Duration))).toThrow(/Invalid duration/);
  });

  test('rejects cohort weights not summing to 100', () => {
    expect(() => flow((w) => w.cohort({ a: { weight: 60 }, b: { weight: 60 } }))).toThrow(
      /sum to 100/
    );
  });

  test('accepts fractional cohort weights despite float error', () => {
    expect(() =>
      flow((w) => w.cohort({ a: { weight: 33.3 }, b: { weight: 33.3 }, c: { weight: 33.4 } }))
    ).not.toThrow();
  });

  test('rejects malformed or inverted time windows at build time', () => {
    expect(() => flow((w) => w.timeWindow({ between: ['9:00', '17:00'] }))).toThrow(
      /Invalid time of day/
    );
    expect(() => flow((w) => w.timeWindow({ between: ['25:00', '26:00'] }))).toThrow(
      /Invalid time of day/
    );
    expect(() => flow((w) => w.timeWindow({ between: ['17:00', '09:00'] }))).toThrow(
      /overnight windows/
    );
  });

  test('rejects misplaced default branch arm', () => {
    const noop = flow((w) => w);
    expect(() => flow((w) => w.branch(noop, [activeSubscriber, noop]))).toThrow(/must be the last/);
  });

  test('template content component is accepted and P is inferred from it', () => {
    const offer = template.email('offer', (_props: { coupon: string }) => null);
    const ir = workflow('t', { trigger: trigger.event(e.login) })
      .email(offer, { coupon: 'X' })
      .toIR();
    expect(ir.flow[0]).toMatchObject({ type: 'message', template: 'offer' });
  });
});

describe('compileBundle guards', () => {
  test('a workflow referencing a segment missing from the bundle fails to compile', () => {
    // checkoutRecovery's goal references the 'purchaser' segment
    expect(() => compileBundle({ workflows: [checkoutRecovery] })).toThrow(
      /references segment 'purchaser'/
    );
  });

  test('a segment-trigger reference must resolve too', () => {
    expect(() => compileBundle({ workflows: [reengagement], segments: [purchaser] })).toThrow(
      /references segment/
    );
  });

  test('duplicate template keys fail to compile', () => {
    const a = template.email('offer');
    const b = template.sms('offer');
    expect(() => compileBundle({ workflows: [], templates: [a, b] })).toThrow(/duplicate template/);
  });

  test('a payload predicate outside a where clause fails to compile', () => {
    // Both ref kinds produce Condition, so this type-checks — the bundle catches it
    const leaked = workflow('leaked', { trigger: trigger.event(e.sign_up) }).filter(
      performed(e.sign_up, { where: (p) => eq(p.method, 'google') }) // fine
    );
    expect(() => compileBundle({ workflows: [leaked] })).not.toThrow();

    const escaped = workflow('escaped', {
      trigger: trigger.event(e.sign_up),
    }).filter(payloadPredicateOutsideWhere());
    expect(() => compileBundle({ workflows: [escaped] })).toThrow(/outside a where clause/);
  });

  test('a where clause may not contain profile facts', () => {
    const wf = workflow('bad_where', {
      // the callback's return type is just Condition, so a profile predicate type-checks
      trigger: trigger.event(e.sign_up, { where: () => performed(e.purchase) }),
    });
    expect(() => compileBundle({ workflows: [wf] })).toThrow(/where clause may only contain/);
  });
});

/** A payload predicate smuggled into profile context — representable (both ref kinds produce Condition), so the compiler must reject it. */
function payloadPredicateOutsideWhere() {
  let captured: ReturnType<typeof eq> | undefined;
  trigger.event(e.sign_up, {
    where: (p) => {
      captured = eq(p.method, 'google');
      return captured;
    },
  });
  if (captured === undefined) throw new Error('where callback did not run');
  return captured;
}
