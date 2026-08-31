import type { TrackTags } from '../track/types';

/**
 * The URL an event happened on, whichever name the client that sent it used.
 *
 * `source_url` became `page_location` in 7.0.0. A backend upgrades in one deploy; the browser
 * bundles that talk to it do not — a tab opened before the deploy keeps sending the old name
 * until someone reloads it. Reading only the new one would leave every such event without an
 * `event_source_url` for Meta and a `source_url` for OpenAI, which is a measurable hit to
 * match rates for as long as the old bundles are alive.
 *
 * Transitional. Delete this, the `source_url` entries in `tagsSchema` and `PageInfo`, and
 * inline `tags.page_location` at both call sites once no client is sending the old name —
 * a month of cache lifetime is the usual bound, and stored rows can be checked for it.
 */
export function pageLocation(tags: TrackTags): string | undefined {
  return tags.page_location ?? tags.source_url;
}
