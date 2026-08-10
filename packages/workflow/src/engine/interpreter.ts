import type { NodeIR, PropValueIR, ScalarIR, WorkflowIR } from '../ir';
import { evaluateCondition, relevantEvents } from './condition';
import type { FactSource, JourneyContext, JourneyOutcome } from './ports';

/**
 * IR 解释器：单个用户旅程实例的执行核心。
 *
 * 纯逻辑——不 import 任何运行时平台的东西，全部外部效应经 JourneyContext
 * 端口注入；durable 语义（checkpoint/replay）由 EngineStep 适配器承担。
 *
 * step 命名规则：IR 节点 id 就是 step 名（结构路径派生，天然确定且唯一），
 * 一个节点多个 step 时加后缀（`${id}:guard`、`${id}:check:${n}`）。
 */

/** wait_until 的候选事件重评估上限：超过按超时处理（防订阅风暴耗尽步数）。 */
const MAX_WAIT_CHECKS = 16;

type FlowSignal =
  | { kind: 'fall_through' }
  | { kind: 'exit'; reason?: string }
  | { kind: 'goal' }
  | { kind: 'exit_when' };

const FALL_THROUGH: FlowSignal = { kind: 'fall_through' };

export async function runJourney(ir: WorkflowIR, ctx: JourneyContext): Promise<JourneyOutcome> {
  const signal = await runFlow(ir.flow, ir, ctx);
  switch (signal.kind) {
    case 'fall_through':
      return { status: 'completed' };
    case 'exit':
      return signal.reason !== undefined
        ? { status: 'exited', reason: signal.reason }
        : { status: 'exited' };
    case 'goal':
      return { status: 'goal' };
    case 'exit_when':
      return { status: 'exit_when' };
  }
}

async function runFlow(nodes: NodeIR[], ir: WorkflowIR, ctx: JourneyContext): Promise<FlowSignal> {
  for (const node of nodes) {
    // 节点边界守卫：goal / exitWhen（MVP 语义：睡醒后、执行前检查）
    const guard = await checkGuards(node.id, ir, ctx);
    if (guard) return guard;

    const signal = await runNode(node, ir, ctx);
    if (signal.kind !== 'fall_through') return signal;
  }
  return FALL_THROUGH;
}

async function checkGuards(
  nodeId: string,
  ir: WorkflowIR,
  ctx: JourneyContext
): Promise<FlowSignal | null> {
  const goal = ir.goal;
  const exitWhen = ir.exitWhen;
  if (goal === undefined && exitWhen === undefined) return null;

  const result = await ctx.step.do(`${nodeId}:guard`, async () => {
    const now = Date.now();
    const goalMet = goal !== undefined && (await evaluateCondition(goal.condition, ctx.facts, now));
    const exitMet = exitWhen !== undefined && (await evaluateCondition(exitWhen, ctx.facts, now));
    return { goalMet, exitMet };
  });

  if (result.goalMet && (goal?.exitOnMatch ?? true)) return { kind: 'goal' };
  if (result.exitMet) return { kind: 'exit_when' };
  return null;
}

async function runNode(node: NodeIR, ir: WorkflowIR, ctx: JourneyContext): Promise<FlowSignal> {
  switch (node.type) {
    case 'message': {
      await ctx.step.do(`${node.id}:send`, async () => {
        const props = await resolveValues(node.props, ctx.facts);
        await ctx.messages.send({
          channel: node.channel,
          template: node.template,
          props,
          userId: ctx.userId,
          idempotencyKey: `${ctx.instanceId}:${node.id}`,
        });
      });
      return FALL_THROUGH;
    }

    case 'delay': {
      await ctx.step.sleep(node.id, node.duration.ms);
      return FALL_THROUGH;
    }

    case 'random_delay': {
      // 随机值在 step 内产生并持久化：replay 时不重掷
      const ms = await ctx.step.do(`${node.id}:roll`, async () => {
        const span = node.max.ms - node.min.ms;
        return node.min.ms + Math.floor(Math.random() * Math.max(span, 0));
      });
      await ctx.step.sleep(`${node.id}:sleep`, ms);
      return FALL_THROUGH;
    }

    case 'time_window': {
      const target = await ctx.step.do(`${node.id}:target`, async () =>
        nextWindowStart(Date.now(), node.days, node.between[0])
      );
      if (target !== null) await ctx.step.sleepUntil(`${node.id}:sleep`, target);
      return FALL_THROUGH;
    }

    case 'wait_until': {
      const met = await waitUntil(node, ctx);
      if (met) return FALL_THROUGH;
      const onTimeout = node.onTimeout;
      if (onTimeout === 'continue') return FALL_THROUGH;
      if (onTimeout === 'exit') return { kind: 'exit', reason: `${node.id}:timeout` };
      return runFlow(onTimeout, ir, ctx);
    }

    case 'branch': {
      const matched = await ctx.step.do(`${node.id}:eval`, async () => {
        const now = Date.now();
        for (let i = 0; i < node.cases.length; i++) {
          const branchCase = node.cases[i];
          if (branchCase && (await evaluateCondition(branchCase.condition, ctx.facts, now))) {
            return i;
          }
        }
        return -1; // 无命中 → 默认分支 / 直接继续
      });
      const flow = matched >= 0 ? node.cases[matched]?.flow : node.otherwise;
      if (flow === undefined) return FALL_THROUGH;
      const signal = await runFlow(flow, ir, ctx);
      // 结构化合流：臂 fall through 后继续 branch 之后的节点
      return signal;
    }

    case 'filter': {
      const pass = await ctx.step.do(`${node.id}:eval`, async () =>
        evaluateCondition(node.condition, ctx.facts, Date.now())
      );
      return pass ? FALL_THROUGH : { kind: 'exit', reason: node.reason ?? `${node.id}:filtered` };
    }

    case 'cohort': {
      // 确定性分桶：同一用户在同一节点永远进同一臂，replay 无需持久化
      const bucket = hashToBucket(`${ctx.userId}:${node.id}`);
      let cumulative = 0;
      for (const arm of node.arms) {
        cumulative += arm.weight;
        if (bucket < cumulative) return runFlow(arm.flow, ir, ctx);
      }
      return FALL_THROUGH;
    }

    case 'exit':
      return node.reason !== undefined ? { kind: 'exit', reason: node.reason } : { kind: 'exit' };

    case 'send_event': {
      await ctx.step.do(`${node.id}:emit`, async () => {
        const payload = await resolveValues(node.payload, ctx.facts);
        await ctx.events.emit(node.event, payload);
      });
      return FALL_THROUGH;
    }
  }
}

async function waitUntil(
  node: Extract<NodeIR, { type: 'wait_until' }>,
  ctx: JourneyContext
): Promise<boolean> {
  const deadline = await ctx.step.do(
    `${node.id}:deadline`,
    async () => Date.now() + node.timeout.ms
  );

  for (let attempt = 0; attempt < MAX_WAIT_CHECKS; attempt++) {
    // 先查一次：进入等待前条件可能已满足（也覆盖无缓冲平台的登记竞态）
    const met = await ctx.step.do(`${node.id}:check:${attempt}`, async () =>
      evaluateCondition(node.condition, ctx.facts, Date.now())
    );
    if (met) return true;

    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;

    const events = await ctx.step.do(`${node.id}:events:${attempt}`, async () =>
      relevantEvents(node.condition, ctx.facts)
    );
    const wake = await ctx.step.waitForEvent(`${node.id}:wait:${attempt}`, {
      events,
      timeoutMs: remaining,
    });
    if (wake === 'timeout') {
      // 超时后终检：极限竞态下事件可能在超时瞬间落库
      return ctx.step.do(`${node.id}:final`, async () =>
        evaluateCondition(node.condition, ctx.facts, Date.now())
      );
    }
    // 被唤醒 → 回到循环头重评估（至少一次唤醒语义）
  }
  return false;
}

async function resolveValues(
  values: Record<string, PropValueIR>,
  facts: FactSource
): Promise<Record<string, ScalarIR | undefined>> {
  const resolved: Record<string, ScalarIR | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    resolved[key] =
      typeof value === 'object' && value !== null ? await facts.getProperty(value.path) : value;
  }
  return resolved;
}

/** FNV-1a 32 → [0, 100)：cohort 分桶。 */
function hashToBucket(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 100;
}

/**
 * 下一个时间窗口起点（UTC；tz 支持是后续课题）。
 * 返回 null 表示当前已在窗口内、无需等待。
 */
function nextWindowStart(nowMs: number, days: readonly string[], startHHmm: string): number | null {
  const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const [hh = 9, mm = 0] = startHHmm.split(':').map(Number);
  const now = new Date(nowMs);

  for (let offset = 0; offset < 8; offset++) {
    const candidate = new Date(nowMs + offset * 86_400_000);
    const dayKey = DAY_KEYS[candidate.getUTCDay()];
    if (dayKey === undefined || !days.includes(dayKey)) continue;
    const start = Date.UTC(
      candidate.getUTCFullYear(),
      candidate.getUTCMonth(),
      candidate.getUTCDate(),
      hh,
      mm
    );
    if (start > nowMs) return start;
    // 今天窗口已开始：视为在窗口内（结束边界的精确处理留给 tz 课题）
    if (offset === 0 && dayKey === DAY_KEYS[now.getUTCDay()]) return null;
  }
  return null;
}
