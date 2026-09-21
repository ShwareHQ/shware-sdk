import { D1JourneyStore } from '../store/d1';
import type { JourneyStore } from '../store/index';
import type { JourneyEnv } from './bindings';

/**
 * The default store: D1 + KV from the env's bindings. Every router function
 * and the runner fall back to it when no store is passed, so a Worker that
 * declares `DB` and `WORKFLOW_KV` needs no wiring; one on another store (say
 * PostgresJourneyStore) passes its own and may omit those bindings entirely.
 */
export function d1Store(env: JourneyEnv): JourneyStore {
  if (env.DB === undefined || env.WORKFLOW_KV === undefined) {
    throw new Error(
      'JourneyStore not configured: declare the DB and WORKFLOW_KV bindings for the default D1 store, or pass a store explicitly'
    );
  }
  return new D1JourneyStore(env.DB, env.WORKFLOW_KV);
}
