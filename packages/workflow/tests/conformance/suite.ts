import { afterAll, afterEach, beforeAll, beforeEach, test, vi } from 'vitest';
import { type PgliteDatabase, pgliteDatabase, truncateAll } from '../pglite';
import type { Driver, Host } from './driver';
import { config, probe, sender } from './journeys';
import { scenarios } from './scenarios';
import { World } from './world';

/**
 * One set of journeys on every host: the scenarios of `scenarios.ts`, run by each host's driver
 * over the same config, the same outlets and the same Postgres (PGlite), and held to the same
 * results. What differs between hosts is in the scenario table, never here.
 */

/**
 * The suite for one host. Each host has a test file of its own (`node.test.ts`,
 * `cloudflare.test.ts`, `aws.test.ts`) and so a process of its own: the hosts' harnesses fake
 * the clock in different ways, and nothing one leaves behind reaches another.
 */
export function conformance(driver: Driver): void {
  let database: PgliteDatabase;
  beforeAll(async () => {
    database = await pgliteDatabase();
  }, 30_000);
  afterAll(async () => {
    await database.close();
  });

  let host: Host;
  let world: World;

  beforeEach(async () => {
    await truncateAll(database.pg);
    probe.reset();
    // The engine logs every retry, refusal and failed journey: the scenarios provoke them
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation(() => {});
    }
    host = await driver.boot(database, { config, messages: sender });
    world = new World(driver.name, host, database);
    await world.deploy();
  });
  afterEach(async () => {
    await host.stop();
    vi.restoreAllMocks();
  });

  for (const scenario of scenarios) {
    const unable = scenario.cannot?.[driver.name];
    const differs = scenario.diverges?.[driver.name];
    // Skipped with its reason in the title, or expected to fail for as long as the host differs
    const [run, note] =
      unable !== undefined
        ? [test.skip, ` [${driver.name} cannot: ${unable}]`]
        : differs !== undefined
          ? [test.fails, ` [${driver.name} diverges: ${differs}]`]
          : [test, ''];
    // oxlint-disable-next-line vitest/expect-expect, vitest/valid-title -- the scenario holds the assertions and the name
    run(`${scenario.name}${note}`, () => scenario.run(world));
  }
}
