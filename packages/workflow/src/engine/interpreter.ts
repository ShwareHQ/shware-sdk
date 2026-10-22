import type { NodeIR, PropValueIR, ScalarIR, WorkflowIR } from '../ir';
import { hashToBucket } from './bucket';
import { evaluateCondition, relevantEvents } from './condition';
import type {
  FactSource,
  JourneyContext,
  JourneyOutcome,
  OutboundMessage,
  PushDevice,
} from './ports';
import { RECIPIENT_PROPERTY } from './recipient';
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
 * Cap on wait_until re-evaluations, so a wake-up storm cannot exhaust the platform's step
 * budget. Each loop iteration costs a handful of steps, so 64 checks stay well inside the
 * platform step budgets while absorbing far more wake churn than 16 did. Past the cap the wait
 * is not given up: it sleeps to its deadline and checks once more there (see waitLoop) — the
 * answer is still right at the deadline, it just stops being event-driven in between.
 */
const MAX_WAIT_CHECKS = 64;

/** The user property holding an IANA timezone id, read when a time_window says tz: 'user'. Same convention-table status as RECIPIENT_PROPERTY. */
const TIMEZONE_PROPERTY = 'timezone';

type FlowSignal =
  | { kind: 'fall_through' }
  | { kind: 'exit'; reason?: string }
  | { kind: 'goal' }
  | { kind: 'exit_when' };

const FALL_THROUGH: FlowSignal = { kind: 'fall_through' };

/**
 * Whether and when the instance converted — a fact of its own, apart from how it ends: with
 * `exitOnMatch: false` a conversion lets the flow go on, and the instance still ends `completed`
 * (or `exited`, `exit_when`) carrying it. Set only from checkpointed step results, so a replay
 * rebuilds the same state.
 */
interface GoalState {
  convertedAt?: number;
}

const goalStates = new WeakMap<JourneyContext, GoalState>();

function goalState(ctx: JourneyContext): GoalState {
  let state = goalStates.get(ctx);
  if (state === undefined) {
    state = {};
    goalStates.set(ctx, state);
  }
  return state;
}

/** When the goal's attribution window closes, measured from entry; none without `within`. */
function goalDeadline(ir: WorkflowIR, ctx: JourneyContext): number | undefined {
  return ir.goal?.within === undefined ? undefined : ctx.enteredAtMs + ir.goal.within.ms;
}

/**
 * Whether the goal holds for events inside its window: after entry, and not after the window
 * closed — an instance resumed past the deadline must not count a purchase made after it. The
 * conversion time is when the check saw it, capped at the deadline.
 */
async function goalReached(
  ir: WorkflowIR,
  ctx: JourneyContext,
  now: number
): Promise<{ at: number } | null> {
  const goal = ir.goal;
  if (goal === undefined) return null;
  const deadline = goalDeadline(ir, ctx);
  const met = await evaluateCondition(goal.condition, ctx.facts, now, {
    anchorMs: ctx.enteredAtMs,
    ...(deadline === undefined ? {} : { untilMs: deadline }),
  });
  return met ? { at: deadline === undefined ? now : Math.min(now, deadline) } : null;
}

export async function runJourney(ir: WorkflowIR, ctx: JourneyContext): Promise<JourneyOutcome> {
  await started(ir, ctx);
  const entry = await checkGuards('entry', ir, ctx);
  let signal = entry ?? (await runFlow(ir.flow, ir, ctx));
  // The flow is done but the conversion window is not: keep watching it (see awaitTail)
  if (signal.kind === 'fall_through') signal = (await awaitTail(ir, ctx)) ?? FALL_THROUGH;
  const { convertedAt } = goalState(ctx);
  const converted = convertedAt === undefined ? {} : { convertedAt };
  switch (signal.kind) {
    case 'fall_through':
      return { status: 'completed', ...converted };
    case 'exit':
      return signal.reason !== undefined
        ? { status: 'exited', reason: signal.reason, ...converted }
        : { status: 'exited', ...converted };
    case 'goal':
      return { status: 'goal', ...converted };
    case 'exit_when':
      return { status: 'exit_when', ...converted };
  }
}

async function runFlow(nodes: NodeIR[], ir: WorkflowIR, ctx: JourneyContext): Promise<FlowSignal> {
  for (const node of nodes) {
    await reached(node, ir, ctx);
    const signal = await runNode(node, ir, ctx);
    if (signal.kind !== 'fall_through') return signal;
  }
  return FALL_THROUGH;
}

/**
 * Tell the observer the instance entered — before the entry guards, which can end it before the
 * first node: an instance is counted from its entry, not from its first node.
 */
async function started(ir: WorkflowIR, ctx: JourneyContext): Promise<void> {
  const observer = ctx.observer;
  if (observer?.started === undefined) return;
  await ctx.step.do('entry:started', async () => {
    await observer.started?.({
      workflow: ir.id,
      instanceId: ctx.instanceId,
      userId: ctx.userId,
      at: ctx.enteredAtMs,
    });
  });
}

/**
 * Tell the observer the instance is at `node`. A step of its own, so a replay does not report
 * the nodes it passes on the way back again, and the arrival time stays the first one.
 */
async function reached(node: NodeIR, ir: WorkflowIR, ctx: JourneyContext): Promise<void> {
  const observer = ctx.observer;
  if (observer?.nodeReached === undefined) return;
  await ctx.step.do(`${node.id}:reached`, async () => {
    await observer.nodeReached?.({
      workflow: ir.id,
      instanceId: ctx.instanceId,
      userId: ctx.userId,
      nodeId: node.id,
      at: Date.now(),
    });
  });
}

/**
 * One copy out through the host's sender, with the observer on both sides: it may attach
 * tracking before, and hears how the transport took the copy after. A send that throws is
 * not reported — the step retries it, and reports when it settles. A report that fails after
 * the send is logged, never thrown: the step would retry and the transport — a webhook, a web
 * push, with no idempotency key of its own — would deliver the copy again.
 */
async function deliver(message: OutboundMessage, ctx: JourneyContext): Promise<void> {
  const observer = ctx.observer;
  // A replayed step whose copy an earlier run already settled: the transport took it once
  if (await observer?.messageSettled?.(message)) return;
  const tracking = await observer?.messagePrepared?.(message);
  const copy = tracking === undefined ? message : { ...message, tracking };
  const result = await ctx.messages.send(copy);
  try {
    await observer?.messageSent?.(copy, result ?? { delivered: true });
  } catch (error) {
    console.error(`[workflow] reporting ${copy.idempotencyKey} as sent failed`, error);
  }
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

  const state = goalState(ctx);
  const result = await ctx.step.do(`${stepId}:guard`, async () => {
    const now = Date.now();
    // Already converted (exitOnMatch: false): the conversion stands, no need to look again
    const goalHit =
      goal !== undefined && state.convertedAt === undefined
        ? await goalReached(ir, ctx, now)
        : null;
    const exitMet = exitWhen !== undefined && (await evaluateCondition(exitWhen, ctx.facts, now));
    return { goalAt: goalHit?.at ?? null, exitMet };
  });

  if (result.goalAt !== null) {
    state.convertedAt ??= result.goalAt;
    if (goal?.exitOnMatch ?? true) return { kind: 'goal' };
  }
  if (result.exitMet) return { kind: 'exit_when' };
  return null;
}

/**
 * The host's template check, with the instance and node added to the message:
 * a refused message must point at the journey that produced it. The error
 * keeps its class (and `name`), so adapters can stop retrying it.
 */
function validate(
  node: Extract<NodeIR, { type: 'message' }>,
  props: Record<string, ScalarIR | undefined>,
  ctx: JourneyContext
): Record<string, ScalarIR | undefined> {
  if (ctx.validator === undefined) return props;
  try {
    return ctx.validator.validate({ channel: node.channel, template: node.template, props });
  } catch (error) {
    if (error instanceof Error) {
      error.message = `[${ctx.instanceId} ${node.id}] ${error.message}`;
    }
    throw error;
  }
}

type PushPlan = { props: Record<string, ScalarIR | undefined>; devices: PushDevice[] };

/**
 * A push goes to devices, not to a profile address: one copy per device the
 * host's directory lists (or only the most recent, `devices: 'latest'`). Each
 * copy's idempotency key carries its token, so a retried step that already
 * reached some devices re-sends to the rest and the senders drop the repeats —
 * keyed by token rather than position, because the list can change between
 * attempts. A user with no device is skipped, not failed: being unreachable is
 * a state of the user, and `reachable('push')` is how a journey branches on it.
 */
/**
 * A push: one step settles what goes out and to which devices, then each device gets a step of
 * its own — a failure on one device retries that device alone, and the copies already delivered
 * are not sent again (APNs and FCM carry the idempotency key but do not de-duplicate on it).
 */
async function sendPush(
  node: Extract<NodeIR, { type: 'message' }>,
  ir: WorkflowIR,
  ctx: JourneyContext
): Promise<void> {
  const plan = await ctx.step.do<PushPlan | null>(`${node.id}:send`, async () => {
    const props = validate(node, await resolveValues(node.props, ctx.facts), ctx);
    if (await ctx.facts.isSuppressed?.(node.channel)) return null;
    const listed = await ctx.facts.listDevices();
    const devices = node.devices === 'latest' ? listed.slice(0, 1) : listed;
    return { props, devices };
  });
  // null: the channel is opted out
  if (plan === null) return;
  if (plan.devices.length === 0) {
    console.log(`[journey] push ${node.template} skipped: no device for user ${ctx.userId}`);
    return;
  }
  for (const [index, device] of plan.devices.entries()) {
    await ctx.step.do(`${node.id}:send:${index}`, async () => {
      await deliver(
        {
          workflow: ir.id,
          instanceId: ctx.instanceId,
          nodeId: node.id,
          channel: 'push',
          template: node.template,
          props: plan.props,
          userId: ctx.userId,
          recipient: device.token,
          device,
          idempotencyKey: `${ctx.instanceId}:${node.id}:${device.token}`,
        },
        ctx
      );
    });
  }
}

async function runNode(node: NodeIR, ir: WorkflowIR, ctx: JourneyContext): Promise<FlowSignal> {
  switch (node.type) {
    case 'message': {
      if (node.channel === 'push') {
        await sendPush(node, ir, ctx);
        return FALL_THROUGH;
      }
      await ctx.step.do(`${node.id}:send`, async () => {
        const props = validate(node, await resolveValues(node.props, ctx.facts), ctx);
        // An opted-out channel (an email unsubscribe) is skipped, like a push with no device
        if (await ctx.facts.isSuppressed?.(node.channel)) return;
        const recipientPath = RECIPIENT_PROPERTY[node.channel];
        const recipient =
          recipientPath === undefined ? undefined : await ctx.facts.getProperty(recipientPath);
        await deliver(
          {
            workflow: ir.id,
            instanceId: ctx.instanceId,
            nodeId: node.id,
            channel: node.channel,
            template: node.template,
            props,
            userId: ctx.userId,
            recipient: recipient === undefined ? undefined : String(recipient),
            idempotencyKey: `${ctx.instanceId}:${node.id}`,
          },
          ctx
        );
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
      // The remaining time is checkpointed: a replay must not recompute it from a later clock
      // (the target has passed by then, and a negative sleep is an error on some runtimes)
      const ms = await ctx.step.do(`${node.id}:remaining`, async () => target - Date.now());
      if (ms > 0) await ctx.step.sleep(`${node.id}:sleep`, ms);
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
      // Deterministic bucketing, so replay needs no checkpoint. An explicit
      // experiment key is global on purpose: two workflows naming the same
      // experiment bucket a user identically. The fallback is namespaced by the
      // workflow, because structural ids ('2', '1.c0.0') repeat across
      // workflows and a bare one would put a user in the same arm of every
      // unrelated split at that position.
      const bucket = hashToBucket(`${ctx.userId}:${node.key ?? `${ir.id}:${node.id}`}`);
      // Integer basis points on both sides (the DSL guarantees weights sit on
      // the 0.01% grid), so no float ever meets the comparison.
      let cumulative = 0;
      for (const arm of node.arms) {
        cumulative += Math.round(arm.weight * 100);
        if (bucket < cumulative) return runFlow(arm.flow, ir, ctx);
      }
      return FALL_THROUGH;
    }

    case 'exit':
      return node.reason !== undefined ? { kind: 'exit', reason: node.reason } : { kind: 'exit' };

    case 'send_event': {
      await ctx.step.do(`${node.id}:emit`, async () => {
        const payload = await resolveValues(node.payload, ctx.facts);
        try {
          await ctx.events.emit(node.event, payload, `${ctx.instanceId}:${node.id}`);
        } catch (error) {
          // A refused event must point at the journey that emitted it
          if (error instanceof Error)
            error.message = `[${ctx.instanceId} ${node.id}] ${error.message}`;
          throw error;
        }
      });
      return FALL_THROUGH;
    }

    case 'action': {
      // Custom code runs inside step.do: retried on throw, checkpointed on success
      const invoker = ctx.actions;
      if (invoker === undefined) {
        throw new Error(
          `action '${node.action}': this runtime has no ActionInvoker configured — register the action on the adapter (see engine/actions.ts)`
        );
      }
      await ctx.step.do(`${node.id}:run`, async () => {
        const args = await resolveValues(node.args, ctx.facts);
        await invoker.invoke({
          action: node.action,
          args,
          userId: ctx.userId,
          idempotencyKey: `${ctx.instanceId}:${node.id}`,
        });
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
  // Anchor at the moment the wait began (deadline is checkpointed, so this is
  // replay-stable): `performed` inside the condition only counts events that
  // happen during the wait — pre-existing history must not satisfy it.
  const anchorMs = deadline - node.timeout.ms;
  const met = await waitLoop(node.id, ctx, deadline, events, async (now) =>
    (await evaluateCondition(node.condition, ctx.facts, now, { anchorMs })) ? true : null
  );
  await ctx.step.unsubscribe(`${node.id}:unsubscribe`);
  return met === true;
}

/**
 * The conversion window outlives the flow: a journey whose steps are done while its goal's
 * `within` is still open keeps watching until the window closes — the purchase that follows the
 * last offer email is that email's conversion, and ending the instance at the email would report
 * it as a plain completion. `exitWhen` still applies while it waits. Nothing to wait for without
 * a window, or once the instance has converted.
 */
async function awaitTail(ir: WorkflowIR, ctx: JourneyContext): Promise<FlowSignal | null> {
  const deadline = goalDeadline(ir, ctx);
  const goal = ir.goal;
  if (goal === undefined || deadline === undefined) return null;
  const state = goalState(ctx);
  if (state.convertedAt !== undefined) return null;
  const open = await ctx.step.do('goal:open', async () => deadline > Date.now());
  if (!open) return null;
  const exitWhen = ir.exitWhen;
  const events = await ctx.step.do('goal:events', async () => [
    ...new Set([
      ...(await relevantEvents(goal.condition, ctx.facts)),
      ...(exitWhen === undefined ? [] : await relevantEvents(exitWhen, ctx.facts)),
    ]),
  ]);
  const hit = await waitLoop('goal', ctx, deadline, events, async (now) => {
    const reached = await goalReached(ir, ctx, now);
    if (reached !== null) return { kind: 'goal' as const, at: reached.at };
    if (exitWhen !== undefined && (await evaluateCondition(exitWhen, ctx.facts, now))) {
      return { kind: 'exit_when' as const, at: now };
    }
    return null;
  });
  await ctx.step.unsubscribe('goal:unsubscribe');
  if (hit === null) return null;
  if (hit.kind === 'goal') {
    state.convertedAt ??= hit.at;
    return { kind: 'goal' };
  }
  return { kind: 'exit_when' };
}

/**
 * Wait until `check` finds something or the deadline passes: subscribe, check, sleep until a
 * relevant event wakes the instance or time runs out. `check` runs inside a step, so its result
 * must be serializable; null means "not yet". Null from here means the deadline passed with
 * nothing found — never a failure, and never a wait given up on early.
 */
async function waitLoop<R>(
  id: string,
  ctx: JourneyContext,
  deadline: number,
  events: string[],
  check: (now: number) => Promise<R | null>
): Promise<R | null> {
  for (let attempt = 0; attempt < MAX_WAIT_CHECKS; attempt++) {
    // Subscribe before the check, every attempt: one subscribe arms at least
    // one wake-up (AWS callbacks are consumed on delivery, so each attempt
    // needs a fresh arm; Cloudflare rows make the repeat call idempotent), and
    // arming first closes the race where the event lands between the check and
    // the registration.
    await ctx.step.subscribe(`${id}:subscribe:${attempt}`, events, { deadlineMs: deadline });

    const met = await ctx.step.do(`${id}:check:${attempt}`, async () => check(Date.now()));
    if (met !== null) return met;

    // Checkpointed: replay re-runs this control flow with wall-clock time far
    // ahead of the original run, so the branch must come from a persisted value.
    const remaining = await ctx.step.do(
      `${id}:remaining:${attempt}`,
      async () => deadline - Date.now()
    );
    // The condition was checked just above — expiring here needs no extra final check
    if (remaining <= 0) return null;

    const wake = await ctx.step.waitForWake(`${id}:wait:${attempt}`, {
      timeoutMs: remaining,
      deadlineMs: deadline,
    });
    // Final check after timeout: in a tight race the event may land exactly as the timer fires
    if (wake === 'timeout') return finalCheck(id, ctx, check);
    // Woken → back to the top of the loop to re-evaluate (at-least-once wake-up semantics)
  }
  // Check budget exhausted (see MAX_WAIT_CHECKS). Not a timeout: the wait keeps its deadline,
  // only the wake-ups are given up — sleep to the deadline, then check once more there. The
  // subscription rows stay until the caller's unsubscribe; a wake landing meanwhile is dropped
  // by the runtime (nothing is parked on it), which is the point.
  console.warn(
    `[journey] ${ctx.instanceId} ${id}: ${MAX_WAIT_CHECKS} wake-ups without the condition holding — sleeping to the deadline`
  );
  const budgetRemaining = await ctx.step.do(
    `${id}:budget:remaining`,
    async () => deadline - Date.now()
  );
  if (budgetRemaining > 0) await ctx.step.sleep(`${id}:budget:sleep`, budgetRemaining);
  return finalCheck(id, ctx, check);
}

/** The check once the deadline is reached — one step for all the ways of getting there. */
async function finalCheck<R>(
  id: string,
  ctx: JourneyContext,
  check: (now: number) => Promise<R | null>
): Promise<R | null> {
  return ctx.step.do(`${id}:final`, async () => check(Date.now()));
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
