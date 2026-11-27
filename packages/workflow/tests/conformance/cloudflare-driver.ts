import { vi } from 'vitest';
import { journeyWorker } from '../../src/cloudflare/worker';
import { WorkflowsRuntime } from './cloudflare-runtime';
import { type Driver, type Host, START } from './driver';

/**
 * `journeyWorker`, as `worker.test.ts` drives it — `fetch` and `sweep` over an env whose
 * Workflow binding is the fake — with the instances the binding creates run by the worker's
 * own `Runner` (`cloudflare-runtime.ts`). The clock is faked (`Date` only).
 */
export const cloudflareDriver: Driver = {
  name: 'cloudflare',
  async boot(database, { config, messages }): Promise<Host> {
    vi.useFakeTimers({ now: START, toFake: ['Date'] });
    const worker = journeyWorker<typeof env>({
      config,
      store: () => database.store,
      messages: () => messages,
    });
    const Runner = worker.Runner as unknown as new (
      ctx: unknown,
      env: unknown
    ) => { run(event: unknown, step: unknown): Promise<unknown> };
    const runtime: WorkflowsRuntime = new WorkflowsRuntime((event, step) =>
      new Runner({}, env).run(event, step)
    );
    const env = { JOURNEY: runtime, ENVIRONMENT: 'development' };
    return {
      async request(method, path, body) {
        const response = await worker.fetch(
          new Request(`http://worker${path}`, {
            method,
            headers: { 'content-type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          }),
          env
        );
        return { status: response.status, body: await response.json() };
      },
      settle: () => runtime.settle(),
      async advance(ms) {
        const target = Date.now() + ms;
        await runtime.settle();
        // One wake at a time: a retry's backoff counts from the attempt before it
        for (;;) {
          const next = runtime.nextWake();
          if (next === undefined || next > target) break;
          vi.setSystemTime(Math.max(next, Date.now()));
          await runtime.settle();
        }
        vi.setSystemTime(target);
        await runtime.settle();
      },
      async sweep() {
        await worker.sweep(env);
      },
      async stop() {
        vi.useRealTimers();
      },
    };
  },
};
