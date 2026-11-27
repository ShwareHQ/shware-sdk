import { LocalDurableTestRunner, OperationStatus } from '@aws/durable-execution-sdk-js-testing';
import {
  type FunctionUrlEvent,
  type LambdaApi,
  SWEEP_EVENT_TYPE,
  journeyLambda,
} from '../../src/aws';
import { type Driver, type Host, START } from './driver';

/**
 * `journeyLambda` on the official local durable runner, as `aws.test.ts` drives it: a request
 * is a Function URL event run as an execution, and every run the host submits to the Lambda
 * control plane (`LambdaApi`, faked as there) becomes an execution of its own, on a runner of
 * its own, started at the next `settle` — an asynchronous invoke starts some time after it is
 * accepted.
 *
 * The clock is the runner's (`skipTime`), and it is not this driver's to hold:
 *
 * - a sleep and a retry's backoff end by themselves as soon as nothing else runs. A journey
 *   cannot be looked at, or acted on, in the middle of one: such scenarios are marked
 *   `cannot.aws` in the table. `advance` only makes sure the clock is at least as far on as
 *   the scenario has asked for in total.
 * - a callback's timeout (a `waitUntil` nobody answers) is kept by the runner's checkpoint
 *   server on the real clock, whatever the fake one says. `advance` waits out a timeout of a
 *   few seconds in real time; a longer one never comes, and those scenarios are `cannot.aws` too.
 */

/** The longest `advance` waited out in real time, for the sake of a callback's timeout. */
const REAL_WAIT_MS = 3_000;

interface Clock {
  now: number;
  setSystemTime(now: number): void;
}

/** The fake clock the runner installs with `skipTime`: a private static, the only way to set its time. */
function runnerClock(): Clock {
  const clock = (LocalDurableTestRunner as unknown as { fakeClock?: Clock }).fakeClock;
  if (clock === undefined) {
    throw new Error('aws driver: the local durable runner has no fake clock (skipTime is off?)');
  }
  return clock;
}

interface Execution {
  name: string;
  arn: string;
  payload: string;
  /** Absent until it is started (the next `settle`). */
  runner?: LocalDurableTestRunner;
  /** Invocations of the handler in flight. */
  active: number;
  /** A callback of it was completed and the invocation that answers has not begun. */
  woken: boolean;
  ended?: 'succeeded' | 'failed';
  stopped: boolean;
}

/** A few real milliseconds: the fake clock follows real time while nothing skips it. */
const pause = (ms = 2) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** Poll until `done`, for at most `turns` pauses. */
async function until(what: string, done: () => boolean | Promise<boolean>, turns = 5_000) {
  for (let turn = 0; !(await done()); turn++) {
    if (turn >= turns) throw new Error(`aws driver: ${what}`);
    await pause();
  }
}

export const awsDriver: Driver = {
  name: 'aws',
  async boot(database, { config, messages }): Promise<Host> {
    const clock = runnerClock();
    clock.setSystemTime(START);
    /** How far the scenario has asked the clock to move, in all. */
    let advanced = 0;
    const executions: Execution[] = [];

    function* operations(execution: Execution) {
      for (let index = 0; execution.runner !== undefined; index++) {
        const operation = execution.runner.getOperationByIndex(index);
        if (operation.getOperationData() === undefined) return;
        yield operation;
      }
    }

    const lambda: LambdaApi = {
      async startExecution({ name, payload }) {
        const arn = `arn:aws:lambda:us-east-1:1:function:f:1/durable-execution/${name}`;
        executions.push({ name, arn, payload, active: 0, woken: false, stopped: false });
        return { arn };
      },
      async completeCallback(callbackId) {
        for (const execution of executions) {
          if (execution.stopped) continue;
          for (const operation of operations(execution)) {
            if (!operation.isCallback()) continue;
            if (operation.getCallbackDetails()?.callbackId !== callbackId) continue;
            // A closed callback answers false, as the real API's refusal is read
            if (operation.getStatus() !== OperationStatus.STARTED) return false;
            await operation.sendCallbackSuccess('{}');
            execution.woken = true;
            return true;
          }
        }
        return false;
      },
      async executionState(arn) {
        const execution = executions.find((one) => one.arn === arn);
        if (execution === undefined) return undefined;
        if (execution.stopped) return 'stopped';
        return execution.ended ?? 'running';
      },
      async findExecution(_target, name) {
        return executions.find((one) => one.name === name)?.arn;
      },
      async stopExecution(arn) {
        const execution = executions.find((one) => one.arn === arn);
        if (execution === undefined) return false;
        // The local runner has no stop: a stopped execution is one this driver never starts
        // and never wakes again. It can only be asked of one that is parked on a callback
        execution.stopped = true;
        return true;
      },
    };

    const journeys = journeyLambda({
      config,
      env: { ENVIRONMENT: 'development' },
      store: () => database.store,
      messages: () => messages,
      lambda,
    });

    const call = (payload: unknown) =>
      new LocalDurableTestRunner({ handlerFunction: journeys.handler }).run({ payload });

    const start = (execution: Execution) => {
      const runner = new LocalDurableTestRunner({
        handlerFunction: async (...args) => {
          execution.active += 1;
          execution.woken = false;
          try {
            return await journeys.handler(...args);
          } finally {
            execution.active -= 1;
          }
        },
      });
      execution.runner = runner;
      void runner.run({ payload: JSON.parse(execution.payload) as unknown }).then(
        (result) => {
          execution.ended = result.getStatus() === 'SUCCEEDED' ? 'succeeded' : 'failed';
        },
        () => {
          execution.ended = 'failed';
        }
      );
    };

    /** Over, or parked on a callback nobody completed with nothing the clock will end: only a wake moves it. */
    const resting = (execution: Execution) => {
      if (execution.ended !== undefined || execution.stopped) return true;
      if (execution.runner === undefined || execution.active > 0 || execution.woken) return false;
      let open = false;
      for (const operation of operations(execution)) {
        const status = operation.getStatus();
        if (operation.isCallback()) open ||= status === OperationStatus.STARTED;
        // A sleep under way, a step waiting for its retry: the runner ends them by itself
        else if (status === OperationStatus.STARTED || status === OperationStatus.PENDING) {
          return false;
        }
      }
      return open;
    };

    /** One execution at a time, oldest first, each to its rest: the order other hosts take turns in. */
    const settle = async () => {
      for (;;) {
        await until('the executions never came to rest', () =>
          executions.every((one) => one.runner === undefined || resting(one))
        );
        const next = executions.find((one) => one.runner === undefined && !one.stopped);
        if (next === undefined) return;
        start(next);
      }
    };

    /** Callbacks armed in the registry whose deadline the clock has passed: their timeout is on its way. */
    const overdue = async () => {
      const rows = await database.client.query<{ c: number }>(
        `SELECT COUNT(*)::int AS c FROM workflow.execution
          WHERE callback_id IS NOT NULL AND deadline_at <= to_timestamp($1::double precision / 1000)`,
        [clock.now]
      );
      return rows.some((row) => row.c > 0);
    };

    return {
      async request(method, path, body) {
        const event: FunctionUrlEvent = {
          version: '2.0',
          rawPath: path,
          rawQueryString: '',
          headers: { 'content-type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body), isBase64Encoded: false }),
          requestContext: { domainName: 'abc.lambda-url.us-east-1.on.aws', http: { method } },
        };
        const result = (await call(event)).getResult() as { statusCode: number; body: string };
        return { status: result.statusCode, body: JSON.parse(result.body) as unknown };
      },
      settle,
      async advance(ms) {
        await settle();
        advanced += ms;
        if (ms <= REAL_WAIT_MS) {
          // Short enough to wait out: a callback's timeout is on the real clock
          const target = clock.now + ms;
          await until('the clock stopped', () => clock.now >= target);
          await until(
            'a callback past its deadline never timed out',
            async () => !(await overdue())
          );
        } else if (clock.now < START + advanced) {
          clock.setSystemTime(START + advanced);
        }
        await settle();
      },
      async sweep() {
        await call({ type: SWEEP_EVENT_TYPE });
      },
      async stop() {
        // Nothing of this host runs on: what is parked stays parked, and is never woken
        for (const execution of executions) execution.stopped = true;
      },
    };
  },
};
