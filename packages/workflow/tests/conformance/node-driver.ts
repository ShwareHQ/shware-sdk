import { vi } from 'vitest';
import { journeyNode } from '../../src/node/index';
import { type Driver, type Host, START } from './driver';

/**
 * The self-hosted runtime, as `node-host.test.ts` drives it: `fetch` for a request, `drain` for
 * the turns that are due, the clock faked (`Date` only). Nothing runs in the background.
 */
export const nodeDriver: Driver = {
  name: 'node',
  async boot(database, { config, messages }): Promise<Host> {
    vi.useFakeTimers({ now: START, toFake: ['Date'] });
    const host = journeyNode({
      config,
      sql: database.client,
      vars: { ENVIRONMENT: 'development' },
      messages: () => messages,
    });
    const settle = async () => {
      await host.drain();
    };
    return {
      async request(method, path, body) {
        const response = await host.fetch(
          new Request(`http://node${path}`, {
            method,
            headers: { 'content-type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          })
        );
        return { status: response.status, body: await response.json() };
      },
      settle,
      async advance(ms) {
        const target = Date.now() + ms;
        await settle();
        // One wake at a time: a retry's backoff counts from the attempt before it
        for (;;) {
          const next = await host.runtime.nextWake();
          if (next === undefined || next > target) break;
          vi.setSystemTime(Math.max(next, Date.now()));
          await settle();
          // Due and still not taken: it is not the clock it waits for
          if ((await host.runtime.nextWake()) === next) break;
        }
        vi.setSystemTime(target);
        await settle();
      },
      async sweep() {
        await host.sweep();
      },
      async stop() {
        vi.useRealTimers();
      },
    };
  },
};
