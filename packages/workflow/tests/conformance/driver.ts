import type { MessageSender } from '../../src/engine/ports';
import type { JourneyConfig } from '../../src/index';
import type { PgliteDatabase } from '../pglite';

/**
 * What a scenario needs from a host, and nothing a host does differently from another: the
 * HTTP API every host serves, the clock, the turns that are due, and the scheduled sweep. A
 * driver per host (`node-driver.ts`, `cloudflare-driver.ts`, `aws-driver.ts`) puts the host's
 * existing test harness behind it; the scenarios (`scenarios.ts`) only ever see this.
 */

export type HostName = 'node' | 'cloudflare' | 'aws';

/** Every scenario starts here: a Tuesday, 09:00 UTC. */
export const START = Date.parse('2026-12-01T09:00:00Z');

export interface HostOptions {
  config: JourneyConfig;
  /** The one outlet every copy goes to, whatever the host. */
  messages: MessageSender;
}

export interface Reply {
  status: number;
  body: unknown;
}

/** One deployed host over the shared database, its clock at `START`. */
export interface Host {
  /** A request to the host's HTTP API, as its own entry point takes it. */
  request(method: string, path: string, body?: unknown): Promise<Reply>;
  /** Run every instance that has something to do now, until none has. */
  settle(): Promise<void>;
  /** Move the clock on by `ms`, running what comes due on the way at the time it is due. */
  advance(ms: number): Promise<void>;
  /** The scheduled sweep, through the host's own cron entry. Does not settle. */
  sweep(): Promise<void>;
  stop(): Promise<void>;
}

export interface Driver {
  name: HostName;
  /** Once per file, before any host is booted. */
  setup?(): Promise<void>;
  teardown?(): Promise<void>;
  /** A fresh host: the database is empty, the bundle is not deployed yet. */
  boot(database: PgliteDatabase, options: HostOptions): Promise<Host>;
}
