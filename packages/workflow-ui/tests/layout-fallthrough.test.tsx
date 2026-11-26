import { event, performed, trigger, workflow } from '@shware/workflow';
import { describe, expect, test } from 'vitest';
import { CARD_SIZE, layout } from '../src/components/layout';
import { lanePath } from '../src/components/workflow-canvas';

const e = event<{
  sign_up: Record<string, never>;
  login: Record<string, never>;
  purchase: Record<string, never>;
  done: Record<string, never>;
}>();

const base = () =>
  workflow({ id: 'w', reentry: { mode: 'never' }, trigger: trigger.event(e.sign_up) });

/** The branch's fall-through edge, with the cards of the arms it has to get past. */
function fallThrough(ir: ReturnType<ReturnType<typeof base>['toIR']>) {
  const { nodes, edges } = layout(ir);
  const branch = nodes.find((node) => node.data.icon === 'branch');
  const edge = edges.find((candidate) => candidate.label === 'else');
  const target = nodes.find((node) => node.id === edge?.target);
  if (branch === undefined || edge === undefined || target === undefined) {
    throw new Error('the branch, its fall-through edge or the rejoin is missing');
  }
  const arms = nodes.filter(
    (node) => node.position.y > branch.position.y && node.position.y < target.position.y
  );
  return { branch, edge, target, arms, centre: branch.position.x + CARD_SIZE.w / 2 };
}

describe('a branch with no otherwise arm', () => {
  test('two cases: the fall-through runs down its own column, clear of the middle arm', () => {
    const ir = base()
      .branch(
        [performed(e.login), (w) => w.delay('1 day').delay('2 days')],
        [performed(e.purchase), (w) => w.delay('3 days')]
      )
      .sendEvent(e.done, {})
      .toIR();
    const { edge, arms, centre } = fallThrough(ir);
    // Three columns (two cases and the empty else): the middle arm sits on the centre line
    expect(
      arms.some((card) => card.position.x < centre && centre < card.position.x + CARD_SIZE.w)
    ).toBe(true);
    const lane = edge.data?.lane;
    expect(lane).toBeDefined();
    // The lane is the else column, to the right of every arm's card
    for (const card of arms) expect(lane).toBeGreaterThan(card.position.x + CARD_SIZE.w);
    expect(edge.data?.anchor).toBe('source');
  });

  test('one case: the centre line is free between the two columns, so it stays straight', () => {
    const ir = base()
      .branch([performed(e.login), (w) => w.delay('1 day')])
      .sendEvent(e.done, {})
      .toIR();
    const { edge, arms, centre } = fallThrough(ir);
    expect(
      arms.some((card) => card.position.x < centre && centre < card.position.x + CARD_SIZE.w)
    ).toBe(false);
    expect(edge.data).toEqual({ anchor: 'source' });
  });

  test('the lane connector leaves the centre before the arms and returns below them', () => {
    // Source at (0, 0), target at (0, 400), the lane 752 to the right, the fork turning at 28
    const path = lanePath(0, 0, 0, 400, 752, 28);
    const points = [...path.matchAll(/L (-?[\d.]+) (-?[\d.]+)/g)].map(([, x, y]) => ({
      x: Number(x),
      y: Number(y),
    }));
    // Down the centre only above the fork and below the rejoin; in between, down the lane
    const onCentre = points.filter((point) => point.x === 0).map((point) => point.y);
    expect(onCentre.every((y) => y <= 28 || y >= 400 - 36)).toBe(true);
    expect(points.filter((point) => point.x === 752).map((point) => point.y)).toEqual([348]);
    expect(points.at(-1)).toEqual({ x: 0, y: 400 });
  });
});
