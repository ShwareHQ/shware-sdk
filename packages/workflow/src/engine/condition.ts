import type { ConditionIR, ScalarIR } from '../ir';
import type { FactSource } from './ports';

/**
 * ConditionIR 求值：纯逻辑，事实经 FactSource 注入——D1 实现与测试内存
 * 实现共享同一份语义，杜绝两套求值器漂移。
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
      return actual !== undefined && actual !== null;
    case 'not_exists':
      return actual === undefined || actual === null;
    case 'eq':
      return actual === value;
    case 'ne':
      return actual !== value;
    case 'gt':
      return actual !== undefined && value !== undefined && actual > value;
    case 'lt':
      return actual !== undefined && value !== undefined && actual < value;
    case 'between': {
      const [min, max] = values ?? [];
      return (
        actual !== undefined &&
        min !== undefined &&
        max !== undefined &&
        actual >= min &&
        actual <= max
      );
    }
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

/**
 * 条件关心的事件名集合：wait_until / goal 的唤醒订阅依据。
 * segment 引用会展开（需要 FactSource 解析定义）。
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
