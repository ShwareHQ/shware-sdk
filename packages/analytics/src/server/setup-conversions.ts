import type {
  Environment,
  EventName,
  Platform,
  TrackEvent,
  TrackName,
  TrackProperties,
  TrackTags,
  UserProvidedData,
} from '../track/types';

// oxlint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTrackEvent = TrackEvent<any>;

/**
 * Where `setupConversions` sends events: an ad platform's conversions API, from its factory
 * (`metaConversions`, … next to each sender), or anything else the host forwards events to (a
 * CRM, its own workflows).
 *
 * `send` rejects when it fails, as the SDK's senders do; the others are sent to still. It must
 * be idempotent on `event.id`, as every ad platform deduplicates on it: an event whose delivery
 * failed somewhere is sent again to every destination, those it had reached included.
 */
export interface ConversionDestination {
  readonly send: (events: AnyTrackEvent[], data: UserProvidedData) => Promise<unknown>;
}

/**
 * A destination that sends only the events `accepts` lets through, and makes no request when none
 * is left: what each conversions API's factory (`metaConversions`, …) is built on.
 */
export function conversionDestination(
  accepts: (name: string) => boolean,
  send: (events: AnyTrackEvent[], data: UserProvidedData) => Promise<unknown>
): ConversionDestination {
  return {
    send: async (events, data) => {
      const accepted = events.filter((event) => accepts(event.name));
      if (accepted.length > 0) await send(accepted, data);
    },
  };
}

/**
 * Who a server-only event is from, as the host knows them: what the ad platforms match a client
 * event on, read from the host's own records.
 *
 * - `tags`: the user's latest session's tags (their cookies — `_fbp`, `_rdt_uuid`, … — page
 *   and user agent), with the click ids of the touch the conversion is attributed to over them.
 * - `visitor_id`, `session_id`, `platform`, `environment`: from that session. `platform` decides
 *   each platform's action source (website or app), as for a client event.
 * - `data`: the user's identity (`email`, `user_id`, …), hashed by each sender.
 */
export interface ConversionUser {
  tags: TrackTags;
  visitor_id: string;
  session_id: string;
  platform: Platform;
  environment: Environment;
  data: UserProvidedData;
}

/**
 * An event the server reports on its own, with no client behind it: a webhook's purchase,
 * renewal or refund. `id` is what the platforms deduplicate on — the transaction id, so the
 * webhook's retries and a client event under the same id are one conversion.
 */
export interface ServerEvent<T extends EventName = EventName> {
  id: string;
  name: TrackName<T>;
  /** The user it belongs to, handed to `track.resolveUser`. */
  userId: string;
  properties?: TrackProperties<T>;
  /** When it happened; now by default. */
  createdAt?: Date | string;
}

export interface ConversionsOptions {
  destinations: readonly ConversionDestination[];
  /**
   * How `track` completes and stores a server-only event; `forward` uses none of it, so a host
   * that only forwards client events leaves it out.
   */
  track?: {
    /**
     * The user behind the event, read from the host's records (see `ConversionUser`);
     * `undefined` for one the host has no session of, whose event is then dropped.
     */
    resolveUser: (userId: string) => Promise<ConversionUser | undefined>;
    /**
     * Stores the event, e.g. in the events table, before it is sent. A webhook delivered again
     * stores it again — the table's unique index makes that a no-op — and sends it again, which
     * the destinations deduplicate on its id; that is what lets a failed delivery be retried.
     */
    store?: (event: AnyTrackEvent) => Promise<unknown>;
  };
}

/**
 * The server's counterpart of `setupAnalytics({ integrations })`: every destination configured
 * once, with the same per-platform options as the browser integrations, so the conversions API
 * and the tag report the same events.
 *
 * - `forward(events, data)`: the events a client sent, as stored, on to every destination.
 * - `track(event)`: an event the server reports on its own (a webhook's), completed by
 *   `track.resolveUser`, stored with `track.store`, then forwarded.
 *
 * Failures are the caller's to handle: every destination is sent to, then `forward` rejects with
 * an `AggregateError` of those that failed (`ConversionsApiError`s, fetch errors), and `track`
 * rejects with that or with the error of `resolveUser` or `store`. A webhook handler that lets
 * it fail the request has the provider deliver it again, and the conversion is sent again.
 */
export function setupConversions(options: ConversionsOptions) {
  const { destinations, track: trackOptions } = options;

  async function forward(events: AnyTrackEvent[], data: UserProvidedData = {}) {
    if (events.length === 0) return;
    // Called inside a promise: a `send` that throws synchronously rejects there instead of
    // stopping the destinations after it.
    const settled = await Promise.allSettled(
      destinations.map((d) => Promise.resolve().then(() => d.send(events, data)))
    );
    const errors = settled.flatMap((outcome) =>
      outcome.status === 'rejected' ? [outcome.reason as unknown] : []
    );
    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        `Failed to send conversions to ${errors.length} destination(s)`
      );
    }
  }

  /**
   * Reports a server-only event; resolves with it as sent, or `undefined` for a user
   * `resolveUser` found no session of, whose event is not sent.
   */
  async function track<T extends EventName>(
    input: ServerEvent<T>
  ): Promise<TrackEvent<T> | undefined> {
    if (!trackOptions) throw new Error('setupConversions: track() needs the track option');
    const user = await trackOptions.resolveUser(input.userId);
    if (!user) return undefined;
    const createdAt = input.createdAt === undefined ? new Date() : new Date(input.createdAt);
    const event: TrackEvent<T> = {
      id: input.id,
      name: input.name,
      properties: input.properties,
      tags: user.tags,
      visitor_id: user.visitor_id,
      session_id: user.session_id,
      platform: user.platform,
      environment: user.environment,
      created_at: createdAt.toISOString(),
    };
    await trackOptions.store?.(event);
    await forward([event], user.data);
    return event;
  }

  return { forward, track };
}
