import type { ConditionIR, ScalarIR } from '../ir';
import type { FactSource } from './ports';

/**
 * ConditionIR evaluation: pure logic, with facts injected through FactSource,
 * so the D1 implementation and the in-memory test one share a single set of
 * semantics and cannot drift into two evaluators.
 */
export async function evaluateCondition(
  condition: ConditionIR,
  facts: FactSource,
  nowMs: number
): Promise<boolean> {
  switch (condition.type) {
    case 'and': {
      for (const child of condition.conditions) {
        if (!(await evaluateCondition(child, facts, nowMs))) return false;
      }
      return true;
    }
    case 'or': {
      for (const child of condition.conditions) {
        if (await evaluateCondition(child, facts, nowMs)) return true;
      }
      return false;
    }
    case 'not':
      return !(await evaluateCondition(condition.condition, facts, nowMs));
    case 'segment': {
      const def = await facts.getSegmentCondition(condition.segment);
      if (def === undefined) {
        throw new Error(`Unknown segment: '${condition.segment}' (bundle not deployed?)`);
      }
      return evaluateCondition(def, facts, nowMs);
    }
    case 'performed': {
      const since = condition.within !== undefined ? nowMs - condition.within.ms : undefined;
      const count = await facts.countEvents(condition.event, since);
      return count >= (condition.count ?? 1);
    }
    case 'property': {
      const actual = await facts.getProperty(condition.path);
      return compareProperty(condition, actual);
    }
  }
}

function compareProperty(
  condition: Extract<ConditionIR, { type: 'property' }>,
  actual: ScalarIR | undefined
): boolean {
  const { op, value, values } = condition;
  switch (op) {
    case 'exists':
      return actual !== undefined;
    case 'not_exists':
      return actual === undefined;
    case 'eq':
      return actual === value;
    case 'ne':
      return actual !== value;
    case 'gt':
      return actual !== undefined && value !== undefined && actual > value;
    case 'gte':
      return actual !== undefined && value !== undefined && actual >= value;
    case 'lt':
      return actual !== undefined && value !== undefined && actual < value;
    case 'lte':
      return actual !== undefined && value !== undefined && actual <= value;
    case 'between':
      return isBetween(actual, values);
    case 'not_between':
      // A missing property is outside any range, mirroring not_in_array.
      return !isBetween(actual, values);
    case 'in_array':
      return actual !== undefined && (values ?? []).includes(actual);
    case 'not_in_array':
      return actual === undefined || !(values ?? []).includes(actual);
    case 'contains':
      return typeof actual === 'string' && typeof value === 'string' && actual.includes(value);
    case 'not_contains':
      return !(typeof actual === 'string' && typeof value === 'string' && actual.includes(value));
  }
}

function isBetween(actual: ScalarIR | undefined, values: ScalarIR[] | undefined): boolean {
  if (actual === undefined || values === undefined || values.length < 2) return false;
  const [min, max] = values;
  return actual >= min && actual <= max;
}

/**
 * The set of event names a condition cares about — what wait_until and goal
 * subscribe to for wake-ups. Segment references are expanded, which is why a
 * FactSource is needed to resolve their definitions.
 */
export async function relevantEvents(condition: ConditionIR, facts: FactSource): Promise<string[]> {
  const found = new Set<string>();
  async function walk(c: ConditionIR): Promise<void> {
    switch (c.type) {
      case 'and':
      case 'or':
        for (const child of c.conditions) await walk(child);
        break;
      case 'not':
        await walk(c.condition);
        break;
      case 'performed':
        found.add(c.event);
        break;
      case 'segment': {
        const def = await facts.getSegmentCondition(c.segment);
        if (def) await walk(def);
        break;
      }
      case 'property':
        break;
    }
  }
  await walk(condition);
  return [...found];
}
