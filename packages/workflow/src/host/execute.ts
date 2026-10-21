import { type Contract, ContractValidationError, checkEvent } from '../contract';
import { runJourney } from '../engine/interpreter';
import type {
  ActionInvoker,
  EngineStep,
  EventSink,
  JourneyObserver,
  JourneyOutcome,
  MessageSender,
  MessageValidator,
} from '../engine/ports';
import { scaleDurations } from '../engine/time-scale';
import { type JourneyRuntimeOptions, resolveRuntime } from '../runtime';
import { JourneyFactSource } from '../store/facts';
import type { JourneyStore } from '../store/index';
import { ingestEvent } from './ingest';
import type { JourneyEnv, JourneyParams } from './platform';

/**
 * One journey instance run to its end, on whatever durable runtime supplies the `EngineStep`:
 * the IR loaded by the hash pinned at entry, the outlets wired, the interpreter run, and the
 * ledger finalized. Cloudflare's runner and the Lambda handler both come through here; only
 * their EngineStep differs.
 */

/** Everything a run is wired to, assembled by the host. */
export interface JourneyRunParts {
  store: JourneyStore;
  /**
   * The env the emitted events are ingested with: its `JOURNEY` starts and wakes instances on
   * this runtime.
   */
  env: JourneyEnv;
  runtime: JourneyRuntimeOptions;
  messages: MessageSender;
  actions: ActionInvoker;
  contract?: Contract | undefined;
  validator?: MessageValidator | undefined;
  observer?: JourneyObserver | undefined;
}

export interface JourneyRunInput {
  instanceId: string;
  params: JourneyParams;
  /** When the trigger happened: replay-stable, never Date.now() at run time. */
  enteredAtMs: number;
  step: EngineStep;
}

/** Development aid: echo each outbound message before handing it to the real sender. */
function logging(sender: MessageSender): MessageSender {
  return {
    async send(message) {
      console.log(
        `[journey] ${message.channel} ${message.template} → ${message.recipient ?? message.userId} ${JSON.stringify(message.props)}`
      );
      return sender.send(message);
    },
  };
}

export async function executeJourney(
  input: JourneyRunInput,
  parts: JourneyRunParts
): Promise<JourneyOutcome> {
  const { instanceId, params, step } = input;
  const { workflowId, contentHash, userId } = params;
  const { store, env, observer, contract } = parts;

  const runtime = resolveRuntime({ current: parts.runtime }, 'current');

  const finished = (status: JourneyOutcome['status'] | 'failed', convertedAt?: number) =>
    observer?.finished?.({
      workflow: workflowId,
      instanceId,
      userId,
      status,
      at: Date.now(),
      ...(convertedAt === undefined ? {} : { convertedAt }),
    });

  const messages = runtime.logMessages ? logging(parts.messages) : parts.messages;

  // send_event feeds straight back into the router logic — an in-process call
  // forming the event edge between workflows. The step's identity travels as
  // the event id, so a retried emit records the occurrence once.
  // An emitted event passes the same contract check as one arriving over HTTP.
  const events: EventSink = {
    emit: async (name, payload, id) => {
      let accepted: Record<string, unknown> = payload;
      if (contract !== undefined) {
        const verdict = checkEvent(contract, name, payload);
        if (!verdict.ok) throw new ContractValidationError(name, verdict.issues);
        accepted = verdict.data;
      }
      await ingestEvent(env, { id, userId, event: name, payload: accepted }, store);
    },
  };

  let outcome: JourneyOutcome;
  try {
    // In a step: a read that fails is retried like any other, and one that keeps failing ends
    // the instance through the failure path below rather than leaving its entry 'running'.
    // Content addressing makes the IR immutable, so the checkpointed copy is the one to replay
    const stored = await step.do('$workflow:ir', async () => {
      const found = await store.getWorkflowIR(contentHash);
      if (found === undefined)
        throw new Error(`WorkflowIR not found: ${workflowId}@${contentHash}`);
      return found;
    });
    // Development runs the journey in fast-forward; the pinned hash still names the version.
    const ir = scaleDurations(stored, runtime.timeScale);
    outcome = await runJourney(ir, {
      userId,
      instanceId,
      enteredAtMs: input.enteredAtMs,
      step,
      facts: new JourneyFactSource(store, userId),
      messages,
      events,
      actions: parts.actions,
      validator: parts.validator,
      observer,
    });
  } catch (error) {
    /*
     * An error escaping run() ends the instance, and the ledger is the only
     * place anyone looks afterwards: leaving it at 'running' meant a dead
     * journey stayed indistinguishable from a waiting one, in the dashboard
     * and in the once-policy, forever.
     *
     * Subscriptions go too, as on every ordinary ending: left behind, the
     * rows would only make every later event of the user poke a dead
     * instance (one wake call to the runtime each, refused every time).
     *
     * A paused instance never gets here: a durable wait suspends the run
     * without throwing through it.
     */
    await step.do('finalize:failed', async () => {
      await store.setEntryStatus(instanceId, 'failed');
      await store.unsubscribe(instanceId);
      await finished('failed');
    });
    throw error;
  }

  await step.do('finalize', async () => {
    await store.setEntryStatus(instanceId, outcome.status);
    await store.unsubscribe(instanceId);
    await finished(outcome.status, outcome.convertedAt);
  });

  return outcome;
}
