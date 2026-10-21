import type { JourneyEnv } from '../host/platform';
import { D1JourneyStore } from '../store/d1';
import type { JourneyStore } from '../store/index';

/**
 * The default store: D1 from the env's `DB` binding — tables and workflow bodies alike (see
 * ../cloudflare/schema.sql). Every router function and the runner fall back to it when no store
 * is passed, so a Worker that declares `DB` needs no wiring; one on another store (say
 * PostgresJourneyStore) passes its own and may omit the binding entirely.
 */
export function d1Store(env: JourneyEnv): JourneyStore {
  if (env.DB === undefined) {
    throw new Error(
      'JourneyStore not configured: declare the DB binding for the default D1 store, or pass a store explicitly'
    );
  }
  return new D1JourneyStore(env.DB);
}
