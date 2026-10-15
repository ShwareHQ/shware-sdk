import { describe, expect, test } from 'vitest';
import { semanticHash } from '../src/hash';
import { eq, flow, performed, trigger, workflow } from '../src/index';
import type { NodeIR, WorkflowIR } from '../src/ir';
import { e, gettingStarted, proTips, u } from './fixtures';

/** Every node id in a flow, depth first — what the durable steps and idempotency keys are named after. */
function ids(nodes: readonly NodeIR[]): string[] {
  return nodes.flatMap((node) => {
    const nested =
      node.type === 'branch'
        ? [...node.cases.flatMap((c) => ids(c.flow)), ...ids(node.otherwise ?? [])]
        : node.type === 'cohort'
          ? node.arms.flatMap((a) => ids(a.flow))
          : node.type === 'wait_until' && Array.isArray(node.onTimeout)
            ? ids(node.onTimeout)
            : [];
    return [node.id, ...nested];
  });
}

/** The executable IR: provenance dropped, it is the only thing allowed to differ between inline and use. */
function executable(ir: WorkflowIR): unknown {
  return JSON.parse(
    JSON.stringify(ir, (key, value: unknown) => (key === 'meta' ? undefined : value))
  );
}

const nudge = flow((w) =>
  w.branch('by plan', [eq(u.subscription_plan, 'pro'), (b) => b.email(proTips)], (b) =>
    b.email(gettingStarted)
  )
);

describe('use()', () => {
  test('compiles to the same executable IR and hash as writing the steps inline', () => {
    const inline = workflow({ id: 'w', trigger: trigger.event(e.sign_up) })
      .delay('1 hour')
      .branch('by plan', [eq(u.subscription_plan, 'pro'), (b) => b.email(proTips)], (b) =>
        b.email(gettingStarted)
      )
      .toIR();
    const used = workflow({ id: 'w', trigger: trigger.event(e.sign_up) })
      .delay('1 hour')
      .use(nudge)
      .toIR();
    expect(executable(used)).toEqual(executable(inline));
    expect(used.contentHash).toBe(inline.contentHash);
    const { contentHash: _, ...body } = used;
    expect(semanticHash(body)).toBe(used.contentHash);
  });

  test('one fragment in two places and two workflows shares no nodes and stays unchanged', () => {
    const before = JSON.stringify(nudge);
    const a = workflow({ id: 'a', trigger: trigger.event(e.sign_up) })
      .use(nudge)
      .delay('1 day')
      .use(nudge)
      .toIR();
    const b = workflow({ id: 'b', trigger: trigger.event(e.sign_up) })
      .use(nudge)
      .toIR();
    expect(ids(a.flow)).toEqual(['0', '0.c0.0', '0.o.0', '1', '2', '2.c0.0', '2.o.0']);
    expect(ids(b.flow)).toEqual(['0', '0.c0.0', '0.o.0']);
    expect(a.flow[0]).not.toBe(a.flow[2]);
    expect(JSON.stringify(nudge)).toBe(before);
  });

  test('repeated compiles are stable', () => {
    const build = () =>
      workflow({ id: 'w', trigger: trigger.event(e.sign_up) })
        .use(nudge)
        .toIR();
    expect(build()).toEqual(build());
  });

  test('empty, nested and exiting fragments', () => {
    const empty = flow((w) => w);
    const exiting = flow((w) => w.email(proTips).exit('done'));
    const nested = flow((w) => w.use(nudge).use(empty));
    const ir = workflow({ id: 'w', trigger: trigger.event(e.sign_up) })
      .use(empty)
      .use(nested)
      .waitUntil(performed(e.purchase), { timeout: '1 day', onTimeout: (w) => w.use(exiting) })
      .cohort({ a: { weight: 50, flow: (w) => w.use(nudge) }, b: { weight: 50 } }, { key: 'k' })
      .toIR();
    expect(ir.flow.map((n) => n.type)).toEqual(['branch', 'wait_until', 'cohort']);
    expect(new Set(ids(ir.flow)).size).toBe(ids(ir.flow).length);
    expect(ir.flow[1]).toMatchObject({
      onTimeout: [{ type: 'message' }, { type: 'exit', reason: 'done' }],
    });
  });

  test('an async callback is refused, at the type level and at run time', () => {
    expect(() =>
      workflow({ id: 'w', trigger: trigger.event(e.sign_up) })
        // @ts-expect-error a sub-flow callback must return the builder, not a Promise
        .use(async (w) => w.email(proTips))
    ).toThrow(/must be synchronous/);
  });
});
