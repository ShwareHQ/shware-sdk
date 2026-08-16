import type { NodeIR, PropValueIR, ScalarIR, WorkflowIR } from '../ir';
import { hashToBucket } from './bucket';
import { evaluateCondition, relevantEvents } from './condition';
import type { FactSource, JourneyContext, JourneyOutcome } from './ports';
import { nextWindowStart } from './time-window';

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
 *
 * Guard semantics: goal / exitWhen are checked at journey entry and after
 * every suspension point (delay / random_delay / time_window / wait_until) —
 * the moments where wall-clock time passed and the user's state may have
 * moved. Between two synchronous nodes no meaningful time passes, so checking
 * there would only burn step budget (each checkpoint costs a state write).
 */

/**
 * Cap on wait_until re-evaluations: beyond it we treat the wait as timed out,
 * so a wake-up storm cannot exhaust the platform's step budget. Each loop
 * iteration costs a handful of steps, so 64 checks stay well inside the
 * platform step budgets while absorbing far more wake churn than 16 did.
 */
const MAX_WAIT_CHECKS = 64;

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

/** The user property holding an IANA timezone id, read when a time_window says tz: 'user'. Same convention-table status as RECIPIENT_PROPERTY. */
const TIMEZONE_PROPERTY = 'timezone';

type FlowSignal =
  | { kind: 'fall_through' }
  | { kind: 'exit'; reason?: string }
  | { kind: 'goal' }
  | { kind: 'exit_when' };

const FALL_THROUGH: FlowSignal = { kind: 'fall_through' };

export async function runJourney(ir: WorkflowIR, ctx: JourneyContext): Promise<JourneyOutcome> {
  const entry = await checkGuards('entry', ir, ctx);
  const signal = entry ?? (await runFlow(ir.flow, ir, ctx));
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
    const signal = await runNode(node, ir, ctx);
    if (signal.kind !== 'fall_through') return signal;
  }
  return FALL_THROUGH;
}

/**
 * Goal / exitWhen guards (see the header for when they run).
 *
 * The goal condition is anchored at workflow entry: a `performed` inside it
 * only counts events after the user entered, so pre-existing history cannot
 * register as a conversion. exitWhen is deliberately unanchored — "user
 * unsubscribed" should exit no matter when it happened.
 */
async function checkGuards(
  stepId: string,
  ir: WorkflowIR,
  ctx: JourneyContext
): Promise<FlowSignal | null> {
  const goal = ir.goal;
  const exitWhen = ir.exitWhen;
  if (goal === undefined && exitWhen === undefined) return null;

  const result = await ctx.step.do(`${stepId}:guard`, async () => {
    const now = Date.now();
    // Attribution window: past goal.within (measured from entry) a match no longer counts as a conversion
    const goalActive =
      goal !== undefined && (goal.within === undefined || now - ctx.enteredAtMs <= goal.within.ms);
    const goalMet =
      goalActive &&
      (await evaluateCondition(goal.condition, ctx.facts, now, { anchorMs: ctx.enteredAtMs }));
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
      return (await checkGuards(node.id, ir, ctx)) ?? FALL_THROUGH;
    }

    case 'random_delay': {
      // The random value is drawn and persisted inside the step, so replay does not re-roll it
      const ms = await ctx.step.do(`${node.id}:roll`, async () => {
        const span = node.max.ms - node.min.ms;
        return node.min.ms + Math.floor(Math.random() * Math.max(span, 0));
      });
      await ctx.step.sleep(`${node.id}:sleep`, ms);
      return (await checkGuards(node.id, ir, ctx)) ?? FALL_THROUGH;
    }

    case 'time_window': {
      const target = await ctx.step.do(`${node.id}:target`, async () => {
        const tz =
          node.tz === 'user'
            ? String((await ctx.facts.getProperty(TIMEZONE_PROPERTY)) ?? 'UTC')
            : node.tz;
        return nextWindowStart(Date.now(), node.days, node.between, tz);
      });
      if (target === null) return FALL_THROUGH; // already inside the window: no suspension, no guard
      await ctx.step.sleepUntil(`${node.id}:sleep`, target);
      return (await checkGuards(node.id, ir, ctx)) ?? FALL_THROUGH;
    }

    case 'wait_until': {
      const met = await waitUntil(node, ctx);
      // Time passed while waiting — guard before acting on the outcome (goal wins over the wait result)
      const guard = await checkGuards(node.id, ir, ctx);
      if (guard) return guard;
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
      // Deterministic bucketing, so replay needs no checkpoint. The explicit
      // experiment key (when set) keeps the assignment stable across workflow
      // versions; the structural id fallback is fine for one-off splits.
      const bucket = hashToBucket(`${ctx.userId}:${node.key ?? node.id}`);
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
  const events = await ctx.step.do(`${node.id}:events`, async () =>
    relevantEvents(node.condition, ctx.facts)
  );
  const met = await waitLoop(node, ctx, deadline, events);
  await ctx.step.unsubscribe(`${node.id}:unsubscribe`);
  return met;
}

async function waitLoop(
  node: Extract<NodeIR, { type: 'wait_until' }>,
  ctx: JourneyContext,
  deadline: number,
  events: string[]
): Promise<boolean> {
  // Anchor at the moment the wait began (deadline is checkpointed, so this is
  // replay-stable): `performed` inside the condition only counts events that
  // happen during the wait — pre-existing history must not satisfy it.
  const anchorMs = deadline - node.timeout.ms;

  for (let attempt = 0; attempt < MAX_WAIT_CHECKS; attempt++) {
    // Subscribe before the check, every attempt: one subscribe arms at least
    // one wake-up (AWS callbacks are consumed on delivery, so each attempt
    // needs a fresh arm; Cloudflare rows make the repeat call idempotent), and
    // arming first closes the race where the event lands between the check and
    // the registration.
    await ctx.step.subscribe(`${node.id}:subscribe:${attempt}`, events);

    const met = await ctx.step.do(`${node.id}:check:${attempt}`, async () =>
      evaluateCondition(node.condition, ctx.facts, Date.now(), { anchorMs })
    );
    if (met) return true;

    // Checkpointed: replay re-runs this control flow with wall-clock time far
    // ahead of the original run, so the branch must come from a persisted value.
    const remaining = await ctx.step.do(
      `${node.id}:remaining:${attempt}`,
      async () => deadline - Date.now()
    );
    // The condition was checked just above — expiring here needs no extra final check
    if (remaining <= 0) return false;

    const wake = await ctx.step.waitForWake(`${node.id}:wait:${attempt}`, remaining);
    if (wake === 'timeout') {
      // Final check after timeout: in a tight race the event may land exactly as the timer fires
      return ctx.step.do(`${node.id}:final`, async () =>
        evaluateCondition(node.condition, ctx.facts, Date.now(), { anchorMs })
      );
    }
    // Woken → back to the top of the loop to re-evaluate (at-least-once wake-up semantics)
  }
  return false; // check budget exhausted → treated as timed out (see MAX_WAIT_CHECKS)
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
