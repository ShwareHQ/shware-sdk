import { describe, expect, test } from 'vitest';
import { sdkLambdaApi } from '../src/aws/lambda-api';

/**
 * The default Lambda port over @aws-sdk/client-lambda: which command each call sends, and which
 * service errors mean "nothing to do" — everything else must surface, so a throttle or a missing
 * permission never passes for a wait that ended or an execution that is gone.
 */

const TARGET = 'arn:aws:lambda:us-east-1:123456789012:function:journeys:7';

function serviceError(name: string): Error {
  const error = new Error(`${name}: from the service`);
  error.name = name;
  return error;
}

/** A client that answers each command by its class name, and records what was sent. */
function fakeClient(answers: Record<string, (input: Record<string, unknown>) => unknown>) {
  const sent: { command: string; input: Record<string, unknown> }[] = [];
  const client = {
    async send(command: { constructor: { name: string }; input: unknown }) {
      const name = command.constructor.name;
      const input = command.input as Record<string, unknown>;
      sent.push({ command: name, input });
      if (!Object.hasOwn(answers, name)) throw new Error(`unexpected ${name}`);
      return answers[name](input);
    },
  };
  return { client: client as never, sent };
}

describe('sdkLambdaApi', () => {
  test('a start is an asynchronous invoke under the execution name, payload byte for byte', async () => {
    const { client, sent } = fakeClient({
      InvokeCommand: () => ({ StatusCode: 202, DurableExecutionArn: 'arn:exec' }),
    });
    const api = sdkLambdaApi({ client });
    const payload = '{"type":"$workflow.run","instanceId":"i1"}';
    expect(await api.startExecution({ target: TARGET, name: 'i1', payload })).toEqual({
      arn: 'arn:exec',
    });
    const [{ input }] = sent;
    expect(input).toMatchObject({
      FunctionName: TARGET,
      InvocationType: 'Event',
      DurableExecutionName: 'i1',
    });
    expect(new TextDecoder().decode(input.Payload as Uint8Array)).toBe(payload);
  });

  test('a function error in the invoke response fails the start', async () => {
    const { client } = fakeClient({
      InvokeCommand: () => ({
        StatusCode: 200,
        FunctionError: 'Unhandled',
        Payload: new TextEncoder().encode('{"errorMessage":"boom"}'),
      }),
    });
    await expect(
      sdkLambdaApi({ client }).startExecution({ target: TARGET, name: 'i1', payload: '{}' })
    ).rejects.toThrow(/Unhandled.*boom/);
  });

  test('a start the service refuses (another payload under the name) surfaces', async () => {
    const { client } = fakeClient({
      InvokeCommand: () => {
        throw serviceError('DurableExecutionAlreadyStartedException');
      },
    });
    await expect(
      sdkLambdaApi({ client }).startExecution({ target: TARGET, name: 'i1', payload: '{}' })
    ).rejects.toThrow(/DurableExecutionAlreadyStarted/);
  });

  test('completing a closed callback is nothing to do; any other failure is a failure', async () => {
    let failure = 'CallbackTimeoutException';
    const { client, sent } = fakeClient({
      SendDurableExecutionCallbackSuccessCommand: (input) => {
        if (input.CallbackId === 'closed') throw serviceError(failure);
        return {};
      },
    });
    const api = sdkLambdaApi({ client });
    expect(await api.completeCallback('open', '{"event":"purchase"}')).toBe(true);
    expect(new TextDecoder().decode(sent[0].input.Result as Uint8Array)).toBe(
      '{"event":"purchase"}'
    );
    expect(await api.completeCallback('closed', '{}')).toBe(false);
    failure = 'TooManyRequestsException';
    await expect(api.completeCallback('closed', '{}')).rejects.toThrow(/TooManyRequests/);
    failure = 'AccessDeniedException';
    await expect(api.completeCallback('closed', '{}')).rejects.toThrow(/AccessDenied/);
  });

  test('execution states map to the adapter vocabulary; an unknown one is undefined', async () => {
    const { client } = fakeClient({
      GetDurableExecutionCommand: (input) => {
        if (input.DurableExecutionArn === 'gone') throw serviceError('ResourceNotFoundException');
        if (input.DurableExecutionArn === 'throttled')
          throw serviceError('TooManyRequestsException');
        return { Status: input.DurableExecutionArn };
      },
    });
    const api = sdkLambdaApi({ client });
    expect(await api.executionState('RUNNING')).toBe('running');
    expect(await api.executionState('SUCCEEDED')).toBe('succeeded');
    expect(await api.executionState('FAILED')).toBe('failed');
    expect(await api.executionState('STOPPED')).toBe('stopped');
    expect(await api.executionState('TIMED_OUT')).toBe('timed_out');
    expect(await api.executionState('gone')).toBeUndefined();
    await expect(api.executionState('throttled')).rejects.toThrow(/TooManyRequests/);
  });

  test('an execution is found by name among the function version’s executions', async () => {
    const { client, sent } = fakeClient({
      ListDurableExecutionsByFunctionCommand: () => ({
        DurableExecutions: [
          { DurableExecutionName: 'i1-other', DurableExecutionArn: 'arn:other' },
          { DurableExecutionName: 'i1', DurableExecutionArn: 'arn:i1' },
        ],
      }),
    });
    const api = sdkLambdaApi({ client });
    expect(await api.findExecution(TARGET, 'i1')).toBe('arn:i1');
    expect(sent[0].input).toMatchObject({
      FunctionName: 'arn:aws:lambda:us-east-1:123456789012:function:journeys',
      Qualifier: '7',
      DurableExecutionName: 'i1',
    });
    expect(await api.findExecution(TARGET, 'missing')).toBeUndefined();
  });

  test('stopping one that is gone or already ended counts as stopped; a running one that refuses does not', async () => {
    let state = 'SUCCEEDED';
    const { client } = fakeClient({
      StopDurableExecutionCommand: (input) => {
        if (input.DurableExecutionArn === 'gone') throw serviceError('ResourceNotFoundException');
        if (input.DurableExecutionArn === 'ok') return {};
        throw serviceError('ResourceConflictException');
      },
      GetDurableExecutionCommand: () => ({ Status: state }),
    });
    const api = sdkLambdaApi({ client });
    expect(await api.stopExecution('ok')).toBe(true);
    expect(await api.stopExecution('gone')).toBe(true);
    expect(await api.stopExecution('ended')).toBe(true);
    state = 'RUNNING';
    await expect(api.stopExecution('ended')).rejects.toThrow(/ResourceConflict/);
  });
});
