import { describe, expect, test } from 'vitest';
import { compileBundle, eq, plan, segment, trigger, workflow } from '../src/index';
import {
  activeSubscriber,
  checkoutRecovery,
  e,
  gettingStarted,
  inactive30d,
  proTips,
  purchaser,
  reengagement,
  u,
  winback,
} from './fixtures';

const base = () =>
  workflow('checkout_recovery', {
    trigger: trigger.event(e.begin_checkout),
    goal: purchaser,
    description: 'Recover abandoned checkouts',
  })
    .delay('1 hour')
    .branch([activeSubscriber, (w) => w.email(proTips)], (w) => w.email(gettingStarted));

const bundleOf = (...builders: ReturnType<typeof base>[]) =>
  compileBundle({ workflows: builders, segments: [purchaser, activeSubscriber] });

describe('metadata is excluded from contentHash', () => {
  test('changing the description keeps contentHash stable', () => {
    const before = base().toIR();
    const after = workflow('checkout_recovery', {
      trigger: trigger.event(e.begin_checkout),
      goal: purchaser,
      description: 'A completely different description',
      tags: ['revenue'],
      owner: 'growth@example.com',
    })
      .delay('1 hour')
      .branch([activeSubscriber, (w) => w.email(proTips)], (w) => w.email(gettingStarted))
      .toIR();

    expect(after.contentHash).toBe(before.contentHash);
    expect(after.meta).toMatchObject({
      description: 'A completely different description',
      tags: ['revenue'],
      owner: 'growth@example.com',
    });
  });

  test('changing a branch label keeps contentHash stable', () => {
    const labelled = workflow('checkout_recovery', {
      trigger: trigger.event(e.begin_checkout),
      goal: purchaser,
      description: 'Recover abandoned checkouts',
    })
      .delay('1 hour')
      .branch('subscriber_split', [activeSubscriber, (w) => w.email(proTips)], (w) =>
        w.email(gettingStarted)
      )
      .toIR();

    expect(labelled.contentHash).toBe(base().toIR().contentHash);
  });

  test('changing execution semantics does change contentHash', () => {
    const longer = workflow('checkout_recovery', {
      trigger: trigger.event(e.begin_checkout),
      goal: purchaser,
    })
      .delay('2 hours')
      .branch([activeSubscriber, (w) => w.email(proTips)], (w) => w.email(gettingStarted))
      .toIR();

    expect(longer.contentHash).not.toBe(base().toIR().contentHash);
  });

  test('cohort arm names stay in the hash (they form node ids)', () => {
    const build = (armName: string) =>
      workflow('ab', { trigger: trigger.event(e.sign_up) })
        .cohort({ control: { weight: 50 }, [armName]: { weight: 50 } })
        .toIR();

    expect(build('variant').contentHash).not.toBe(build('treatment').contentHash);
  });
});

describe('plan', () => {
  test('first deploy reports everything as added', () => {
    const result = plan(bundleOf(base()));

    expect(result.hasChanges).toBe(true);
    expect(result.workflows).toHaveLength(1);
    expect(result.workflows[0]).toMatchObject({ name: 'checkout_recovery', status: 'added' });
    expect(result.segments.map((s) => s.status)).toEqual(['added', 'added']);
  });

  test('identical bundles report no changes', () => {
    const result = plan(bundleOf(base()), bundleOf(base()));

    expect(result.hasChanges).toBe(false);
    expect(result.workflows[0]?.status).toBe('unchanged');
  });

  test('description-only edit is metadata_only and not a change', () => {
    const deployed = bundleOf(base());
    const edited = workflow('checkout_recovery', {
      trigger: trigger.event(e.begin_checkout),
      goal: purchaser,
      description: 'Reworded for the growth review',
    })
      .delay('1 hour')
      .branch([activeSubscriber, (w) => w.email(proTips)], (w) => w.email(gettingStarted));

    const result = plan(bundleOf(edited), deployed);

    expect(result.workflows[0]?.status).toBe('metadata_only');
    expect(result.hasChanges).toBe(false);
  });

  test('semantic edit reports changed nodes and fields', () => {
    const deployed = bundleOf(base());
    const edited = workflow('checkout_recovery', {
      trigger: trigger.event(e.sign_up), // trigger changed
      goal: purchaser,
    })
      .delay('3 days') // node 0 changed
      .branch([activeSubscriber, (w) => w.email(proTips)], (w) => w.email(gettingStarted));

    const result = plan(bundleOf(edited), deployed);
    const change = result.workflows[0];

    expect(change.status).toBe('changed');
    expect(change.fields).toEqual(['trigger']);
    expect(change.nodes).toEqual([{ id: '0', status: 'changed', type: 'delay' }]);
    expect(change.before).not.toBe(change.after);
    expect(result.hasChanges).toBe(true);
  });

  test('removed workflow is reported with its deployed hash', () => {
    const result = plan(compileBundle({ workflows: [] }), bundleOf(base()));

    expect(result.workflows[0]).toMatchObject({ name: 'checkout_recovery', status: 'removed' });
    expect(result.workflows[0]?.before).toBeDefined();
    expect(result.hasChanges).toBe(true);
  });

  test('segment condition edit is reported as changed', () => {
    const other = segment('purchaser', eq(u.subscription_status, 'active'));
    const result = plan(
      compileBundle({ workflows: [base()], segments: [other, activeSubscriber] }),
      bundleOf(base())
    );

    const changed = result.segments.find((s) => s.name === 'purchaser');
    expect(changed?.status).toBe('changed');
  });

  test("editing a branch case's condition is visible on the branch node itself", () => {
    const deployed = bundleOf(base());
    const edited = workflow('checkout_recovery', {
      trigger: trigger.event(e.begin_checkout),
      goal: purchaser,
      description: 'Recover abandoned checkouts',
    })
      .delay('1 hour')
      // same arms and flows, different case condition
      .branch([eq(u.subscription_status, 'active'), (w) => w.email(proTips)], (w) =>
        w.email(gettingStarted)
      );

    const result = plan(bundleOf(edited), deployed);
    const change = result.workflows[0];

    expect(change.status).toBe('changed');
    expect(change.nodes).toEqual([{ id: '1', status: 'changed', type: 'branch' }]);
  });

  test('reweighting a cohort is visible on the cohort node itself', () => {
    const ab = (control: number) =>
      workflow('ab', { trigger: trigger.event(e.sign_up) }).cohort({
        control: { weight: control },
        variant: { weight: 100 - control },
      });

    const result = plan(
      compileBundle({ workflows: [ab(90)] }),
      compileBundle({ workflows: [ab(50)] })
    );
    const change = result.workflows[0];

    expect(change.status).toBe('changed');
    expect(change.nodes).toEqual([{ id: '0', status: 'changed', type: 'cohort' }]);
  });
});

describe('plan smoke test across a realistic bundle', () => {
  test('reports added / removed / unchanged', () => {
    const segments = [purchaser, activeSubscriber, inactive30d];
    const deployed = compileBundle({ workflows: [checkoutRecovery, winback], segments });
    const local = compileBundle({ workflows: [checkoutRecovery, reengagement], segments });

    const result = plan(local, deployed);
    const byName = Object.fromEntries(result.workflows.map((w) => [w.name, w.status]));

    expect(byName).toEqual({
      checkout_recovery: 'unchanged',
      reengagement: 'added',
      winback: 'removed',
    });
    expect(result.hasChanges).toBe(true);
  });
});
