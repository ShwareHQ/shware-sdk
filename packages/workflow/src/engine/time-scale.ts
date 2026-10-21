import type { ConditionIR, DurationIR, NodeIR, WorkflowIR } from '../ir';

/**
 * Debug time scale: divide every duration in a workflow's IR by a factor so a
 * journey written in days plays out in seconds — with a factor of 3600, a
 * `delay('2 days')` sleeps 48 s, a `waitUntil(..., { timeout: '3 days' })`
 * gives up after 72 s, and a goal `within: '30 days'` closes after 12 min.
 *
 * Everything that is a Duration scales together (delays, random delays, wait
 * timeouts, goal and `performed(... within)` windows inside the workflow), so
 * the journey keeps its shape, just faster. What does not scale: wall-clock
 * `timeWindow`s (they are times of day, not durations). Segment definitions
 * live in the store rather than the workflow body; `scaleSegmentWindows`
 * scales them as they are read, so a segment's `within` keeps pace too.
 *
 * The walk follows the IR's own structure — the fields that hold a Duration
 * are known — so a message prop or an event payload that happens to look like
 * one (`{ value, ms }`) is left alone. The source text is kept so the studio
 * still shows what was written.
 */
export function scaleDurations(ir: WorkflowIR, factor: number): WorkflowIR {
  if (!(factor > 0) || factor === 1) return ir;
  return {
    ...ir,
    trigger:
      ir.trigger.type === 'event'
        ? {
            ...ir.trigger,
            ...(ir.trigger.filter === undefined
              ? {}
              : { filter: scaleCondition(ir.trigger.filter, factor) }),
          }
        : ir.trigger,
    ...(ir.goal === undefined
      ? {}
      : {
          goal: {
            ...ir.goal,
            condition: scaleCondition(ir.goal.condition, factor),
            ...(ir.goal.within === undefined ? {} : { within: scale(ir.goal.within, factor) }),
          },
        }),
    ...(ir.exitWhen === undefined ? {} : { exitWhen: scaleCondition(ir.exitWhen, factor) }),
    flow: scaleFlow(ir.flow, factor),
  };
}

/** A condition with its `performed(... within)` windows divided by `factor`. */
export function scaleCondition(condition: ConditionIR, factor: number): ConditionIR {
  if (!(factor > 0) || factor === 1) return condition;
  switch (condition.type) {
    case 'and':
    case 'or':
      return {
        ...condition,
        conditions: condition.conditions.map((child) => scaleCondition(child, factor)),
      };
    case 'not':
      return { ...condition, condition: scaleCondition(condition.condition, factor) };
    case 'performed':
      return condition.within === undefined
        ? condition
        : { ...condition, within: scale(condition.within, factor) };
    default:
      return condition;
  }
}

function scaleFlow(nodes: readonly NodeIR[], factor: number): NodeIR[] {
  return nodes.map((node) => scaleNode(node, factor));
}

function scaleNode(node: NodeIR, factor: number): NodeIR {
  switch (node.type) {
    case 'delay':
      return { ...node, duration: scale(node.duration, factor) };
    case 'random_delay':
      return { ...node, min: scale(node.min, factor), max: scale(node.max, factor) };
    case 'wait_until':
      return {
        ...node,
        condition: scaleCondition(node.condition, factor),
        timeout: scale(node.timeout, factor),
        onTimeout: Array.isArray(node.onTimeout)
          ? scaleFlow(node.onTimeout, factor)
          : node.onTimeout,
      };
    case 'branch':
      return {
        ...node,
        cases: node.cases.map((branch) => ({
          ...branch,
          condition: scaleCondition(branch.condition, factor),
          flow: scaleFlow(branch.flow, factor),
        })),
        ...(node.otherwise === undefined ? {} : { otherwise: scaleFlow(node.otherwise, factor) }),
      };
    case 'filter':
      return { ...node, condition: scaleCondition(node.condition, factor) };
    case 'cohort':
      return {
        ...node,
        arms: node.arms.map((arm) => ({ ...arm, flow: scaleFlow(arm.flow, factor) })),
      };
    default:
      return node;
  }
}

function scale(duration: DurationIR, factor: number): DurationIR {
  return { value: duration.value, ms: Math.max(0, Math.round(duration.ms / factor)) };
}

/**
 * A store whose segment definitions come back scaled by `factor` — what journeyWorker reads
 * through in fast-forward, so a segment's windows (`performed(e.login, { within: '7 days' })`)
 * shrink with the journeys that reference it, and with the segment triggers it routes. Every
 * other method is the store's own.
 */
export function scaleSegmentWindows<
  S extends { getSegmentCondition(name: string): Promise<ConditionIR | undefined> },
>(store: S, factor: number): S {
  if (!(factor > 0) || factor === 1) return store;
  return new Proxy(store, {
    get(target, property) {
      if (property === 'getSegmentCondition') {
        return async (name: string) => {
          const condition = await target.getSegmentCondition(name);
          return condition === undefined ? undefined : scaleCondition(condition, factor);
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
