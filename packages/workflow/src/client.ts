import type * as core from 'zod/v4/core';
import type { Contract, ContractIssue, ProfilePatch, Topic } from './contract';
import type { BatchResult, JourneyBatch } from './host/batch';
import {
  type DeployResult,
  type MessageSubscriptions,
  SUBSCRIPTION_CHANNELS,
  type Subscriptions,
  type SubscriptionsPatch,
} from './host/ingest';
import type { ProfileProps } from './store';

/**
 * `@shware/workflow/client` — the producer side of the ingest API, for the
 * service that knows what users do (an api server, a webhook handler). Plain
 * fetch, no dependencies; errors carry the status and body so a caller can
 * log them without failing the request that triggered the report.
 */

export interface JourneyClientOptions<C extends Contract | undefined = undefined> {
  /**
   * The shared `defineContract(...)`: types `ingest` (the event name picks the payload type, the
   * profile patch is the contract's), and checks both before anything is sent.
   */
  contract?: C;
  /** The journey Worker's origin, e.g. `https://workflow.example.com`. */
  origin: string;
  /** Its API_TOKEN, sent as a bearer; omit against an open local instance. */
  token?: string;
  /** Fetch implementation (defaults to the global one). */
  fetch?: typeof fetch;
}

export class JourneyClientError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
    readonly body: string
  ) {
    super(`journey ${path} failed: ${status} ${body}`);
    this.name = 'JourneyClientError';
  }
}

/** A payload or profile patch the contract refuses — raised before the request, with the field paths. */
export class JourneyValidationError extends Error {
  constructor(
    readonly path: string,
    readonly event: string | undefined,
    readonly issues: ContractIssue[]
  ) {
    super(
      `journey ${path}${event === undefined ? '' : ` '${event}'`} refused by the contract: ${issues
        .map((i) => `${i.path || '(root)'} ${i.message}`)
        .join('; ')}`
    );
    this.name = 'JourneyValidationError';
  }
}

type EventsOf<C> = C extends Contract<infer E> ? E : never;
type IdentifyProps<C> = [C] extends [undefined]
  ? ProfileProps
  : C extends Contract<Record<string, core.$ZodObject>, infer P>
    ? ProfilePatch<P>
    : never;

/** The topics the client's contract declares; any string without a contract. */
export type ClientTopic<C> = [C] extends [undefined] ? string : Topic<C>;

export type { BatchEvent, BatchResult, JourneyBatch } from './host/batch';
export type {
  ChannelSubscriptions,
  ChannelSubscriptionsPatch,
  MessageOrigin,
  MessageSubscriptions,
  SubscriptionChannel,
  Subscriptions,
  SubscriptionsPatch,
} from './host/ingest';

/** One event of a batch: with a contract, the name picks the payload type. */
export type BatchEventInput<C> = [C] extends [undefined]
  ? { event: string; payload?: Record<string, unknown>; id?: string; ts?: number }
  : {
      [K in keyof EventsOf<C> & string]: {
        event: K;
        payload: core.input<EventsOf<C>[K]>;
        id?: string;
        ts?: number;
      };
    }[keyof EventsOf<C> & string];

/**
 * Who a report or device is about: a signed-in user, or a visitor before sign-in (a stable id for
 * one client, renewed when a user signs out). Naming both says this visitor is this user: what the
 * engine knows of the visitor moves to the user, once.
 */
export type JourneyIdentity =
  | { userId: string; visitorId?: string | undefined }
  | { userId?: undefined; visitorId: string };

/** What the profile now says and what they just did, as one report. */
export type BatchInput<C> = JourneyIdentity & {
  /** Merged before the first event: a journey the events start finds this recipient. */
  profile?: IdentifyProps<C>;
  events?: readonly BatchEventInput<C>[];
};

/**
 * The batch as it travels: checked against the contract, with the time and the event ids and
 * timestamps fixed here, so every redelivery is the same report.
 */
function prepareBatch<C extends Contract | undefined>(
  contract: C,
  input: BatchInput<C>
): JourneyBatch {
  const { userId, visitorId, profile, events } = input as {
    userId?: string;
    visitorId?: string;
    profile?: ProfileProps;
    events?: readonly {
      event: string;
      payload?: Record<string, unknown>;
      id?: string;
      ts?: number;
    }[];
  };
  if (contract !== undefined) {
    if (profile !== undefined) {
      const result = contract.parseProfilePatch(profile);
      if (!result.ok) throw new JourneyValidationError('/ingest', undefined, result.issues);
    }
    for (const { event, payload } of events ?? []) {
      const result = contract.parseEvent(event, payload ?? {});
      if (!result.ok) throw new JourneyValidationError('/ingest', event, result.issues);
    }
  }
  const now = Date.now();
  return {
    ...(userId === undefined ? {} : { userId }),
    ...(visitorId === undefined ? {} : { visitorId }),
    ...(profile === undefined ? {} : { profile, at: now }),
    ...(events === undefined
      ? {}
      : {
          events: events.map((e) => ({
            event: e.event,
            payload: e.payload ?? {},
            id: e.id ?? crypto.randomUUID(),
            ts: e.ts ?? now,
          })),
        }),
  };
}

/** The producer side of a queue (the subset of a Cloudflare Queues binding used). */
export interface JourneyQueueBinding {
  send(body: JourneyBatch): Promise<unknown>;
}

export interface JourneyQueueOptions<C extends Contract | undefined = undefined> {
  /** The shared `defineContract(...)`: types `ingest` and checks each batch before it is sent. */
  contract?: C;
  /** The queue `journeyWorker`'s `queue` handler consumes. */
  queue: JourneyQueueBinding;
}

/**
 * `JourneyClient.ingest` through a queue, for a producer that must not lose a report and must not
 * wait for the engine: once `ingest` resolves the batch is durable, and the consumer retries it
 * until it is applied. Delivery is at least once and in no guaranteed order: the batch is the unit
 * that stays in order and event ids and property times absorb the rest. A rejected `ingest` was
 * not queued; the caller decides (a 5xx so its client retries, say).
 */
export class JourneyQueue<C extends Contract | undefined = undefined> {
  constructor(private readonly options: JourneyQueueOptions<C>) {}

  async ingest(input: BatchInput<C>): Promise<void> {
    await this.options.queue.send(prepareBatch(this.options.contract as C, input));
  }
}

export class JourneyClient<C extends Contract | undefined = undefined> {
  constructor(private readonly options: JourneyClientOptions<C>) {}

  /**
   * The one way in: a profile and the events it belongs to, as one batch. A visitor who signed in
   * merges first, then the profile, then the events in order, so a journey cannot start without
   * its recipient. A caller that retries should pass each event's `id`: the Worker stores one
   * occurrence per id. `ts` defaults to now. `JourneyQueue` is the same report through a queue.
   */
  async ingest(input: BatchInput<C>): Promise<BatchResult> {
    return this.post<BatchResult>('/ingest', prepareBatch(this.options.contract as C, input));
  }

  /**
   * A push token registered for whoever holds the device now (call it on every registration): a
   * token moves to the latest owner, and a `deviceId` seen with a new token replaces the old one.
   * The engine keeps devices itself — pushes go to them, a token APNs / FCM reports as gone is
   * dropped — and journeys waiting on `reachable('push')` wake. Naming both ids merges the visitor,
   * as `ingest` does.
   */
  registerDevice(
    device: JourneyIdentity & {
      deviceId?: string;
      token: string;
      platform: 'ios' | 'android' | 'web';
    }
  ): Promise<{ ok: true; woke: number }> {
    return this.post('/devices', device);
  }

  /**
   * A journey push tapped open: the `message_id` the push carried, reported for the user who
   * tapped it. Recorded as a human open on the copy (an email's opens are tracked by the Worker).
   */
  messageOpened(userId: string, messageId: string): Promise<{ ok: true; recorded: boolean }> {
    return this.post('/messages/opened', { userId, messageId });
  }

  /**
   * A deleted account: the engine records the erasure, stops the user's running journeys, then
   * erases everything it keeps about them (profile, devices, events, reporting). Once this
   * resolves the request is durable: `erased: false` means an instance would not stop yet, and
   * the Worker's scheduled sweep finishes the job.
   */
  forgetUser(userId: string): Promise<{ ok: true; erased: boolean; pending: string[] }> {
    return this.post('/users/forget', { userId });
  }

  /** `forgetUser` for a visitor who never signed in. */
  forgetVisitor(visitorId: string): Promise<{ ok: true; erased: boolean; pending: string[] }> {
    return this.post('/users/forget', { visitorId });
  }

  /** The user signed out on that device: the token stays registered, bound to nobody. */
  unbindDevice(token: string): Promise<{ ok: true; woke: number }> {
    return this.post('/devices/unbind', { token });
  }

  /** Forget a push token for good (an uninstall the app learned of, a token it replaced). */
  removeDevice(token: string): Promise<{ ok: true; woke: number }> {
    return this.post('/devices/remove', { token });
  }

  /**
   * Where the user stands, topic × channel: for `email` and for `push`, `all` (false once they
   * opted out of the whole channel) and each declared topic (false once they opted out of it on
   * that channel) — the engine's record, which a preference page shows as it is. The two are
   * independent flags: a topic answers its own opt-out even while `all` is false, so `all: false`
   * masks every topic however they read (nothing is sent on the channel until it is true again).
   * Rejects with a 410 for an erased user.
   */
  getSubscriptions(userId: string): Promise<Subscriptions<ClientTopic<C>>> {
    return this.request('GET', subscriptionsPath(userId));
  }

  /**
   * Set subscriptions: only what the patch names changes, per channel (`{ email: { topics: {
   * newsletter: false } } }` opts out of one topic's emails, `{ push: { all: false } }` of every
   * push — the in-app opt-out App Store Review Guideline 4.5.4 asks for). `all: true` clears the
   * channel-wide opt-out only: a topic opted out on its own stays off until the patch names it,
   * so a preference page's "subscribe to all" sends `all: true` plus every topic `true`. Answers
   * the subscriptions as they now stand. With a contract, a topic it does not declare is refused
   * here, before the request; the engine refuses it too.
   */
  setSubscriptions(
    userId: string,
    patch: SubscriptionsPatch<ClientTopic<C>>
  ): Promise<Subscriptions<ClientTopic<C>>> {
    const refused = this.undeclaredTopics(patch);
    if (refused !== undefined) return Promise.reject(refused);
    return this.request('PUT', subscriptionsPath(userId), patch);
  }

  /**
   * `getSubscriptions` for the recipient of one copy, by the message id an email's preferences
   * link carries (`email.preferencesUrl?m=<message id>`): how a preference page works without a
   * sign-in. The answer adds `message: { channel, topic }`, the copy the page was opened from,
   * so it can highlight that topic. Rejects with a 404 for an id that names no copy — never
   * sent, or erased with its user — and for a transactional one; the page should show the link
   * as expired. The message id is the capability, so the app proxies this behind its own API
   * and rate-limits it.
   */
  getSubscriptionsByMessage(messageId: string): Promise<MessageSubscriptions<ClientTopic<C>>> {
    return this.request('GET', subscriptionsByMessagePath(messageId));
  }

  /** `setSubscriptions` for the recipient of one copy; the patch and the answer are those of `getSubscriptionsByMessage`. */
  setSubscriptionsByMessage(
    messageId: string,
    patch: SubscriptionsPatch<ClientTopic<C>>
  ): Promise<MessageSubscriptions<ClientTopic<C>>> {
    const refused = this.undeclaredTopics(patch);
    if (refused !== undefined) return Promise.reject(refused);
    return this.request('PUT', subscriptionsByMessagePath(messageId), patch);
  }

  /** With a contract, the refusal of a patch naming a topic it does not declare; undefined when the patch is fine. */
  private undeclaredTopics(
    patch: SubscriptionsPatch<ClientTopic<C>>
  ): JourneyValidationError | undefined {
    const contract = this.options.contract;
    if (contract === undefined) return undefined;
    const issues: ContractIssue[] = [];
    for (const channel of SUBSCRIPTION_CHANNELS) {
      for (const topic of Object.keys(patch[channel]?.topics ?? {})) {
        // `includes`, not the predicate: narrowing `string` by a `topic is string` leaves `never`
        if (contract.topics.includes(topic)) continue;
        issues.push({ path: `${channel}.topics.${topic}`, message: 'not a declared topic' });
      }
    }
    return issues.length > 0
      ? new JourneyValidationError('/subscriptions', undefined, issues)
      : undefined;
  }

  /** Deploy a compiled bundle (BundleIR). */
  deploy(bundle: unknown): Promise<DeployResult> {
    return this.post<DeployResult>('/deploy', bundle);
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.options.token !== undefined) headers.authorization = `Bearer ${this.options.token}`;
    const doFetch = this.options.fetch ?? fetch;
    const response = await doFetch(`${this.options.origin.replace(/\/$/, '')}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new JourneyClientError(path, response.status, await response.text());
    return (await response.json()) as T;
  }
}

const subscriptionsPath = (userId: string) => `/subscriptions/${encodeURIComponent(userId)}`;
const subscriptionsByMessagePath = (messageId: string) =>
  `/subscriptions/by-message/${encodeURIComponent(messageId)}`;
