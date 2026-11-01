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
 * `send` rejects when it fails, as the SDK's senders do: `setupConversions` logs the failure,
 * with the events' ids, and still sends to the others.
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
 * renewal or refund. `id` is the transaction id: `track.store` keeps a redelivered webhook from
 * being reported twice, and the platforms pair it with a browser event under the same id.
 */
export interface ServerEvent<T extends EventName = EventName> {
  id: string;
  name: TrackName<T>;
  /** The user it belongs to, handed to `track.resolveUser`. */
  userId: string;
  properties?: TrackProperties<T>;
  /** When it happened, as an ISO 8601 string. */
  createdAt: string;
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
     * Stores the event, e.g. in the events table, returning whether it was new: `track` sends
     * only an event it stored, so a webhook delivered again (its handler failed on something
     * else) is not reported twice — not every platform deduplicates a server event sent twice.
     * Without it, every `track` sends.
     */
    store?: (event: AnyTrackEvent) => Promise<boolean>;
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
 * Neither throws, so reporting a conversion can never fail the request it runs in — a payment
 * webhook least of all, which its provider would then deliver again and again. A failure is
 * logged with the ids of the events it lost, for them to be found and sent later: a missed
 * conversion costs less than a duplicate one, or a webhook that keeps failing.
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
    const ids = events.map((event) => event.id).join(', ');
    settled.forEach((outcome) => {
      if (outcome.status === 'rejected') {
        console.error(`Conversions not sent, events: ${ids}`, outcome.reason);
      }
    });
  }

  /**
   * Reports a server-only event; resolves with it as sent, or `undefined` when it was not: a
   * user with no session, an event `store` had already stored, or a failure, which is logged.
   */
  async function track<T extends EventName>(
    input: ServerEvent<T>
  ): Promise<TrackEvent<T> | undefined> {
    if (!trackOptions) {
      console.error('setupConversions: track() needs the track option');
      return undefined;
    }
    const { resolveUser, store } = trackOptions;
    try {
      const user = await resolveUser(input.userId);
      if (!user) {
        console.warn(`Conversion not reported, event: ${input.id}: no session for ${input.userId}`);
        return undefined;
      }
      const event: TrackEvent<T> = {
        id: input.id,
        name: input.name,
        properties: input.properties,
        tags: user.tags,
        visitor_id: user.visitor_id,
        session_id: user.session_id,
        platform: user.platform,
        environment: user.environment,
        created_at: input.createdAt,
      };
      if (store && !(await store(event))) return undefined;
      await forward([event], user.data);
      return event;
    } catch (e: unknown) {
      console.error(`Conversion not reported, event: ${input.id}`, e);
      return undefined;
    }
  }

  return { forward, track };
}
