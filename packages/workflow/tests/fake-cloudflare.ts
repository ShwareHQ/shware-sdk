import { cloudflareJourneyBinding } from '../src/cloudflare/bindings';
import type { JourneyEnv, WorkflowBindingLike, WorkflowInstanceLike } from '../src/host/platform';

/**
 * An in-memory Workflow binding, so the host is tested through the same structural interface
 * the real binding satisfies. The store is Postgres on PGlite (`pglite.ts`).
 */

/**
 * The Workflow binding as Cloudflare offers it: `get` of an unknown id fails with Cloudflare's
 * own error, which `cloudflareJourneyBinding` maps to the port's `InstanceNotFoundError`.
 */
export class FakeJourney implements WorkflowBindingLike {
  readonly created: { id: string; params: unknown }[] = [];
  readonly wakes: { id: string; type: string }[] = [];
  /** Handles that .get() resolves for (a created instance, or one registered by a test). */
  readonly known = new Set<string>();
  /** Handles whose sendEvent fails (simulating a transient delivery failure). */
  readonly failingSends = new Set<string>();

  async create(options: { id: string; params: unknown }): Promise<WorkflowInstanceLike> {
    this.created.push(options);
    this.known.add(options.id);
    return this.instance(options.id);
  }

  async get(id: string): Promise<WorkflowInstanceLike> {
    if (!this.known.has(id)) throw new Error('instance.not_found');
    return this.instance(id);
  }

  private instance(id: string): WorkflowInstanceLike {
    return {
      id,
      sendEvent: async (event: { type: string }) => {
        if (this.failingSends.has(id)) throw new Error('send failed');
        this.wakes.push({ id, type: event.type });
      },
    };
  }
}

export function makeEnv(overrides?: Partial<JourneyEnv>): {
  env: JourneyEnv;
  journey: FakeJourney;
} {
  const journey = new FakeJourney();
  // Through the Cloudflare adapter, as journeyWorker hands the binding to the host
  const env: JourneyEnv = { JOURNEY: cloudflareJourneyBinding(journey), ...overrides };
  return { env, journey };
}
