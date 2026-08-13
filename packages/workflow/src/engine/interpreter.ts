import type { NodeIR, PropValueIR, ScalarIR, WorkflowIR } from '../ir';
import { evaluateCondition, relevantEvents } from './condition';
import type { FactSource, JourneyContext, JourneyOutcome } from './ports';

/**
 * IR interpreter: the execution core for one user's journey instance.
 *
 * Pure logic — it imports nothing platform-specific; every external effect
 * arrives through the JourneyContext ports, and durable semantics
 * (checkpoint/replay) are the EngineStep adapter's job.
 *
 * Step naming: an IR node id *is* the step name (derived from the structural
 * path, so it is deterministic and unique). When one node needs several steps,
 * a suffix is appended (`${id}:guard`, `${id}:check:${n}`).
 */

/** Cap on wait_until re-evaluations: beyond it we treat the wait as timed out, so a subscription storm cannot exhaust the step budget. */
const MAX_WAIT_CHECKS = 16;

/**
 * Channel → the user property holding its recipient address. The engine
 * resolves it before sending, which keeps senders stateless.
 * TODO: let the app override this table (today it is a convention, with
 * UserPropertyBase guaranteeing `email` exists).
 */
const RECIPIENT_PROPERTY: Record<string, string | undefined> = {
  email: 'email',
  sms: 'phone',
  push: 'push_token',
  slack: 'slack_user_id',
  survey: 'email',
  in_app: undefined,
};

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
    // Node-boundary guards: goal / exitWhen (MVP semantics — checked after waking, before running)
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
        const recipientPath = RECIPIENT_PROPERTY[node.channel];
        const recipient =
          recipientPath === undefined ? undefined : await ctx.facts.getProperty(recipientPath);
        await ctx.messages.send({
          channel: node.channel,
          template: node.template,
          props,
          userId: ctx.userId,
          recipient: recipient === undefined ? undefined : String(recipient),
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
      // The random value is drawn and persisted inside the step, so replay does not re-roll it
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
        for (const [i, branchCase] of node.cases.entries()) {
          if (await evaluateCondition(branchCase.condition, ctx.facts, now)) {
            return i;
          }
        }
        return -1; // no match → default arm, or simply continue
      });
      const flow = matched >= 0 ? node.cases[matched]?.flow : node.otherwise;
      if (flow === undefined) return FALL_THROUGH;
      const signal = await runFlow(flow, ir, ctx);
      // Structural rejoin: once an arm falls through, execution resumes after the branch
      return signal;
    }

    case 'filter': {
      const pass = await ctx.step.do(`${node.id}:eval`, async () =>
        evaluateCondition(node.condition, ctx.facts, Date.now())
      );
      return pass ? FALL_THROUGH : { kind: 'exit', reason: node.reason ?? `${node.id}:filtered` };
    }

    case 'cohort': {
      // Deterministic bucketing: the same user always lands in the same arm at the same node, so replay needs no checkpoint
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
    // Check once up front: the condition may already hold, which also covers the registration race on platforms without buffering
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
      // Final check after timeout: in a tight race the event may land exactly as the timer fires
      return ctx.step.do(`${node.id}:final`, async () =>
        evaluateCondition(node.condition, ctx.facts, Date.now())
      );
    }
    // Woken → back to the top of the loop to re-evaluate (at-least-once wake-up semantics)
  }
  return false;
}

async function resolveValues(
  values: Record<string, PropValueIR>,
  facts: FactSource
): Promise<Record<string, ScalarIR | undefined>> {
  const resolved: Record<string, ScalarIR | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    resolved[key] = typeof value === 'object' ? await facts.getProperty(value.path) : value;
  }
  return resolved;
}

/** FNV-1a 32 → [0, 100): cohort bucketing. */
function hashToBucket(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 100;
}

/**
 * Start of the next time window (UTC; timezone support is a later topic).
 * Returns null when we are already inside the window and need not wait.
 */
function nextWindowStart(nowMs: number, days: readonly string[], startHHmm: string): number | null {
  const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const [hh = 9, mm = 0] = startHHmm.split(':').map(Number);
  const now = new Date(nowMs);

  for (let offset = 0; offset < 8; offset++) {
    const candidate = new Date(nowMs + offset * 86_400_000);
    const dayKey = DAY_KEYS[candidate.getUTCDay()];
    if (!days.includes(dayKey)) continue;
    const start = Date.UTC(
      candidate.getUTCFullYear(),
      candidate.getUTCMonth(),
      candidate.getUTCDate(),
      hh,
      mm
    );
    if (start > nowMs) return start;
    // Today's window has already opened: treat as inside it (the closing edge is left to the timezone topic)
    if (offset === 0 && dayKey === DAY_KEYS[now.getUTCDay()]) return null;
  }
  return null;
}
