import type * as LambdaSdk from '@aws-sdk/client-lambda';

/**
 * The Lambda control-plane calls the adapter makes, as a port: starting an execution of this
 * function, completing a wake callback, and looking at or stopping an execution. The default
 * goes through `@aws-sdk/client-lambda` (loaded on first use); tests pass a fake.
 */

/** A durable execution's state as the adapter reads it. */
export type ExecutionState = 'running' | 'succeeded' | 'failed' | 'stopped' | 'timed_out';

export interface LambdaApi {
  /**
   * Asynchronous (`Event`) invoke of a qualified function ARN under a durable execution name:
   * idempotent — the same name and payload return the execution already started.
   */
  startExecution(input: {
    target: string;
    name: string;
    payload: string;
  }): Promise<{ arn?: string | undefined }>;
  /**
   * Complete a callback. `false` when it is already closed (completed, or timed out): the wait
   * it belonged to has moved on, which a wake-up treats as nothing to do.
   */
  completeCallback(callbackId: string, result: string): Promise<boolean>;
  /** The execution's state; undefined when the platform no longer knows it. */
  executionState(arn: string): Promise<ExecutionState | undefined>;
  /** The ARN of the execution started under `name`, if there is one. */
  findExecution(target: string, name: string): Promise<string | undefined>;
  /** Stop an execution for good; `true` also when it had already ended. */
  stopExecution(arn: string): Promise<boolean>;
}

const STATES: Record<string, ExecutionState> = {
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  STOPPED: 'stopped',
  TIMED_OUT: 'timed_out',
};

function errorName(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null
    ? String((error as { name?: unknown }).name)
    : undefined;
}

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder();

type Sdk = typeof LambdaSdk;

/** The default port, over `@aws-sdk/client-lambda` with the execution role's credentials. */
export function sdkLambdaApi(
  options: {
    region?: string;
    /** A configured client (endpoint, retries) instead of the default one. */
    client?: Pick<InstanceType<Sdk['LambdaClient']>, 'send'>;
  } = {}
): LambdaApi {
  let loaded:
    | Promise<{ sdk: Sdk; client: Pick<InstanceType<Sdk['LambdaClient']>, 'send'> }>
    | undefined;
  const load = () =>
    (loaded ??= import('@aws-sdk/client-lambda').then((sdk) => ({
      sdk,
      client:
        options.client ??
        new sdk.LambdaClient(options.region === undefined ? {} : { region: options.region }),
    })));

  const executionState = async (arn: string): Promise<ExecutionState | undefined> => {
    const { sdk, client } = await load();
    try {
      const response = await client.send(
        new sdk.GetDurableExecutionCommand({ DurableExecutionArn: arn })
      );
      return response.Status === undefined ? undefined : STATES[response.Status];
    } catch (error) {
      if (errorName(error) === 'ResourceNotFoundException') return undefined;
      throw error;
    }
  };

  return {
    executionState,

    async startExecution({ target, name, payload }) {
      const { sdk, client } = await load();
      const response = await client.send(
        new sdk.InvokeCommand({
          FunctionName: target,
          InvocationType: 'Event',
          DurableExecutionName: name,
          Payload: utf8.encode(payload),
        })
      );
      if (response.FunctionError !== undefined) {
        const detail = response.Payload === undefined ? '' : fromUtf8.decode(response.Payload);
        throw new Error(`starting ${name} failed: ${response.FunctionError} ${detail}`.trim());
      }
      return { arn: response.DurableExecutionArn };
    },

    async completeCallback(callbackId, result) {
      const { sdk, client } = await load();
      try {
        await client.send(
          new sdk.SendDurableExecutionCallbackSuccessCommand({
            CallbackId: callbackId,
            Result: utf8.encode(result),
          })
        );
        return true;
      } catch (error) {
        // "expired, or already closed": the wait moved on. Anything else (throttling, a
        // permission) is a real failure — it must not pass for a wait that ended
        if (errorName(error) === 'CallbackTimeoutException') return false;
        throw error;
      }
    },

    async findExecution(target, name) {
      const { sdk, client } = await load();
      // The name is unique per function; the version is part of the target ARN
      const qualifier = target.split(':').at(7);
      const functionName = target.split(':').slice(0, 7).join(':');
      const response = await client.send(
        new sdk.ListDurableExecutionsByFunctionCommand({
          FunctionName: functionName,
          ...(qualifier === undefined ? {} : { Qualifier: qualifier }),
          DurableExecutionName: name,
          MaxItems: 10,
        })
      );
      const match = response.DurableExecutions?.find(
        (execution) => execution.DurableExecutionName === name
      );
      return match?.DurableExecutionArn;
    },

    async stopExecution(arn) {
      const { sdk, client } = await load();
      try {
        await client.send(new sdk.StopDurableExecutionCommand({ DurableExecutionArn: arn }));
        return true;
      } catch (error) {
        if (errorName(error) === 'ResourceNotFoundException') return true;
        // Stopping one that already ended is refused: it will not run again either way
        const state = await executionState(arn).catch(() => undefined);
        if (state !== undefined && state !== 'running') return true;
        throw error;
      }
    },
  };
}
