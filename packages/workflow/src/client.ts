import type * as core from 'zod/v4/core';
import type { Contract, ContractIssue, ProfilePatch, Topic } from './contract';
import {
  type DeployResult,
  type IdentifyResult,
  type IngestResult,
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
   * The shared `defineContract(...)`: types `track` (the event name picks the
   * payload type) and `identify`, and checks both before anything is sent.
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
/** Event names: the contract's, or any string without one. */
export type ClientEventName<C> = [C] extends [undefined] ? string : keyof EventsOf<C> & string;
type TrackArgs<C, K> = [C] extends [undefined]
  ? [payload?: Record<string, unknown>, options?: TrackOptions]
  : K extends keyof EventsOf<C>
    ? [payload: core.input<EventsOf<C>[K]>, options?: TrackOptions]
    : never;
type IdentifyProps<C> = [C] extends [undefined]
  ? ProfileProps
  : C extends Contract<Record<string, core.$ZodObject>, infer P>
    ? ProfilePatch<P>
    : never;

/** The topics the client's contract declares; any string without a contract. */
export type ClientTopic<C> = [C] extends [undefined] ? string : Topic<C>;

export type {
  ChannelSubscriptions,
  ChannelSubscriptionsPatch,
  SubscriptionChannel,
  Subscriptions,
  SubscriptionsPatch,
} from './host/ingest';

export interface TrackOptions {
  /** The occurrence's identity: a retry with the same id is recorded once. */
  id?: string;
  /** When it happened (epoch ms); the Worker's clock when omitted. */
  ts?: number;
}

export class JourneyClient<C extends Contract | undefined = undefined> {
  constructor(private readonly options: JourneyClientOptions<C>) {}

  /** Merge profile properties (`null` clears one). Every property a journey reads must be identified before the event that starts it. */
  identify(userId: string, props: IdentifyProps<C>): Promise<IdentifyResult> {
    const contract = this.options.contract;
    if (contract !== undefined) {
      const result = contract.parseProfilePatch(props);
      if (!result.ok)
        return Promise.reject(new JourneyValidationError('/identify', undefined, result.issues));
    }
    return this.post<IdentifyResult>('/identify', { userId, props });
  }

  /**
   * Record an event; the Worker starts every journey whose trigger matches it
   * and wakes waits on it. A caller that retries should pass the same `id`
   * each time: the Worker stores one occurrence per id, so a retry after a
   * timeout cannot double-count the event. `ts` defaults to the Worker's clock.
   */
  track<K extends ClientEventName<C>>(
    userId: string,
    event: K,
    ...args: TrackArgs<C, K>
  ): Promise<IngestResult> {
    const [payload = {}, options = {}] = args as [Record<string, unknown>?, TrackOptions?];
    const contract = this.options.contract;
    if (contract !== undefined) {
      const result = contract.parseEvent(event, payload);
      if (!result.ok)
        return Promise.reject(new JourneyValidationError('/events', event, result.issues));
    }
    return this.post<IngestResult>('/events', {
      userId,
      event,
      payload,
      ...(options.id === undefined ? {} : { id: options.id }),
      ...(options.ts === undefined ? {} : { ts: options.ts }),
    });
  }

  /**
   * A push token the app registered for the user (call it on every registration: a token moves
   * to the latest user). The engine keeps devices itself — pushes go to them, a token APNs / FCM
   * reports as gone is dropped — and journeys waiting on `reachable('push')` wake.
   */
  registerDevice(
    userId: string,
    device: { token: string; platform: 'ios' | 'android' | 'web'; ts?: number }
  ): Promise<{ ok: true; woke: number }> {
    const { token, platform, ts } = device;
    return this.post('/devices', {
      userId,
      token,
      platform,
      ...(ts === undefined ? {} : { ts }),
    });
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
    const contract = this.options.contract;
    if (contract !== undefined) {
      const issues: ContractIssue[] = [];
      for (const channel of SUBSCRIPTION_CHANNELS) {
        for (const topic of Object.keys(patch[channel]?.topics ?? {})) {
          // `includes`, not the predicate: narrowing `string` by a `topic is string` leaves `never`
          if (contract.topics.includes(topic)) continue;
          issues.push({ path: `${channel}.topics.${topic}`, message: 'not a declared topic' });
        }
      }
      if (issues.length > 0) {
        return Promise.reject(new JourneyValidationError('/subscriptions', undefined, issues));
      }
    }
    return this.request('PUT', subscriptionsPath(userId), patch);
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
