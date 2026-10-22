import { Buffer } from 'node:buffer';
import {
  DEAD_TOKEN_REASONS as APNS_DEAD_TOKEN_REASONS,
  ApnsProviderToken,
  ApnsPushSender,
  apnsKeyFromBase64,
} from '../apns';
import { type JourneyConfig, apnsEnvironment } from '../config';
import { EmailSender, type EmailTransport } from '../email-sender';
import type { MessageSender } from '../engine/ports';
import { PermanentError } from '../engine/retry';
import {
  DEAD_TOKEN_REASONS as FCM_DEAD_TOKEN_REASONS,
  FcmAccessToken,
  FcmPushSender,
  serviceAccountFromBase64,
} from '../fcm';
import { registryPushRenderer } from '../push';
import { registryRenderer } from '../react-email';
import { type JourneyMode, type JourneyRuntimeOptions, resolveRuntime } from '../runtime';
import type { JourneyStore } from '../store/index';
import {
  type DiscordTemplate,
  type SlackTemplate,
  indexTemplates,
  lookupTemplate,
  renderDiscordContent,
  renderSlackContent,
} from '../templates';
import { DiscordWebhookSender, SlackWebhookSender } from '../webhooks';
import {
  VapidSigner,
  DEAD_TOKEN_REASONS as WEB_PUSH_DEAD_TOKEN_REASONS,
  WebPushSender,
} from '../webpush';
import { removeDevice } from './ingest';
import type { JourneyEnv } from './platform';
import { routeByChannel, routeByPlatform } from './senders';

/**
 * The outlets a `JourneyConfig` describes, assembled against the environment:
 * email through the host's transport (SES, Cloudflare Email, ...) with each template's addresses, iOS pushes
 * straight to APNs with the configured key (the `.p8` from
 * `APNS_PRIVATE_KEY_BASE64`), Android pushes through FCM with the service
 * account from `GOOGLE_APPLICATION_CREDENTIALS_BASE64`. A channel the config
 * leaves out is simply absent, and a journey that sends on it fails that step
 * with a message saying so — rather than the host having to spell out every
 * sender by hand.
 */

/** Which config entry applies: wrangler's `ENVIRONMENT` var, production when unset. */
export function journeyMode(env: JourneyEnv): JourneyMode {
  return env.ENVIRONMENT ?? 'production';
}

/** The runtime options for this environment's mode. */
export function runtimeFromConfig(
  config: Pick<JourneyConfig, 'runtime'> | undefined,
  env: JourneyEnv
): Required<JourneyRuntimeOptions> {
  return resolveRuntime(config?.runtime, journeyMode(env));
}

/**
 * A sender that fails every message with the reason the channel cannot deliver — for good: the
 * configuration is the same on every attempt, so the step does not retry into it.
 */
function unavailable(reason: string): MessageSender {
  return {
    async send(message) {
      throw new PermanentError(
        `cannot send '${message.template}' on ${message.channel}: ${reason}`
      );
    },
  };
}

function requireSecret(
  env: JourneyEnv,
  name:
    | 'APNS_PRIVATE_KEY_BASE64'
    | 'GOOGLE_APPLICATION_CREDENTIALS_BASE64'
    | 'VAPID_PUBLIC_KEY'
    | 'VAPID_PRIVATE_KEY'
): string {
  const value = env[name];
  if (typeof value !== 'string' || value.length === 0) {
    // Missing on this attempt, missing on the next: the deployment has to change, not the step
    throw new PermanentError(
      `${name} is not set: the environment must hold it for the configured channel`
    );
  }
  return value;
}

/**
 * The provider credentials — `ApnsProviderToken`, `FcmAccessToken`, `VapidSigner` — for as long
 * as the host lives. `channelsFromConfig` runs once per workflow run (every wake of every
 * instance) and builds the senders anew each time; what must outlive the run is the credential
 * state they hold: the APNs provider JWT must be reused for at least 20 minutes (Apple answers a
 * sender that re-signs on every push with 429 `TooManyProviderTokenUpdates`), the FCM access
 * token is good for an hour, the VAPID key import is wasted work twice.
 *
 * The cache is the host's (`createJourneyHost` makes one and hands it to every run), not the
 * run's `env`: a Lambda invocation builds a fresh env object for each run (its instance port is
 * in it), so a cache keyed on env would miss on every wake. Inside, the key names the provider,
 * the ids that identify the key and a digest of the secret — so a rotated secret or a reloaded
 * host mints a new credential instead of reusing the old, and the secret itself is in no key and
 * no log. Nothing that shapes the sender (topic, environment, relay, registry, store) is in it:
 * the sender is built per call around the shared credential.
 */
export interface ProviderCache {
  /** The credential under `key`, built on the first call and returned as is after that. */
  get<T>(key: string, build: () => T): T;
}

export function createProviderCache(): ProviderCache {
  const credentials = new Map<string, unknown>();
  return {
    get<T>(key: string, build: () => T): T {
      if (!credentials.has(key)) credentials.set(key, build());
      return credentials.get(key) as T;
    },
  };
}

/** A number for each fetch implementation, so a credential minted through one is not reused with another. */
const identities = new WeakMap<object, number>();
let nextIdentity = 1;
function identity(value: object | undefined): string {
  if (value === undefined) return 'global';
  let id = identities.get(value);
  if (id === undefined) {
    id = nextIdentity++;
    identities.set(value, id);
  }
  return String(id);
}

/** The first 8 hex of the secret's SHA-256: enough to tell a rotation apart, nothing of the secret. */
async function secretDigest(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return Buffer.from(digest.slice(0, 4)).toString('hex');
}

/**
 * A sender built on its first message, then kept for this call. `build` reads the secrets (and
 * so may throw a `PermanentError` naming the missing variable): a platform's secret is only
 * required when something is actually sent there, so a journey that only emails must not fail
 * because the APNs key is missing from a local `.dev.vars`. A build that failed is not kept.
 */
function lazy(build: () => Promise<MessageSender>): MessageSender {
  let sender: Promise<MessageSender> | undefined;
  return {
    async send(message) {
      sender ??= build().catch((error: unknown) => {
        sender = undefined;
        throw error;
      });
      return (await sender).send(message);
    },
  };
}

/** The channels slice of the config — what `channelsFromConfig` reads. */
export type ChannelsConfig = Pick<
  JourneyConfig,
  'templates' | 'email' | 'apns' | 'fcm' | 'webPush' | 'runtime'
>;

export function channelsFromConfig(
  config: ChannelsConfig,
  env: JourneyEnv,
  options: {
    /** The store a token APNs / FCM / a push service reports as gone is removed from. */
    store?: JourneyStore | undefined;
    /** Where finished emails go — the host's choice, independent of where the workflow runs. */
    email?: EmailTransport | undefined;
    fetch?: typeof fetch;
    /** APNs is HTTP/2 only: a Node host passes an HTTP/2 fetch here (its own fetch cannot). */
    apnsFetch?: typeof fetch | undefined;
    /**
     * Where the provider credentials live across runs (`createProviderCache`): the host's, made
     * once with it. Without one, this call's credentials are its own — nothing is reused.
     */
    providers?: ProviderCache | undefined;
  } = {}
): MessageSender {
  const mode = journeyMode(env);
  const providers = options.providers ?? createProviderCache();

  const email = (): MessageSender => {
    const registry = config.templates?.email;
    if (registry === undefined) return unavailable('no email templates are registered');
    const transport = options.email;
    if (transport === undefined) {
      return unavailable("no email transport is configured (the host's `email` option)");
    }
    // Each template names its own sender: there is no global one to require
    return new EmailSender({ transport, render: registryRenderer(registry, config.email) });
  };

  const push = (): MessageSender => {
    const registry = config.templates?.push;
    if (registry === undefined) return unavailable('no push templates are registered');
    const render = registryPushRenderer(registry);
    /**
     * A token the provider reports as gone is forgotten (nothing left to deliver to), waking the
     * waits that read devices, as a removal through the API does. Done here, per run, on the
     * settled result, so the credential cached across runs (see `ProviderCache`) never holds a
     * run's store.
     */
    const dropDeadTokens = (
      provider: MessageSender,
      deadTokenReasons: ReadonlySet<string>
    ): MessageSender => ({
      async send(message) {
        const result = await provider.send(message);
        if (
          result !== undefined &&
          deadTokenReasons.has(result.reason) &&
          message.device !== undefined &&
          options.store !== undefined
        ) {
          await removeDevice(env, message.device.token, options.store);
        }
        return result;
      },
    });
    const platforms: Record<string, MessageSender> = {};
    const apns = config.apns;
    if (apns !== undefined) {
      const apnsFetch = options.apnsFetch ?? options.fetch;
      const environment = apnsEnvironment(apns, mode);
      platforms.ios = dropDeadTokens(
        lazy(async () => {
          const secret = requireSecret(env, 'APNS_PRIVATE_KEY_BASE64');
          const credentials = providers.get(
            JSON.stringify(['apns', apns.keyId, apns.teamId, await secretDigest(secret)]),
            () =>
              new ApnsProviderToken({
                keyId: apns.keyId,
                teamId: apns.teamId,
                privateKey: apnsKeyFromBase64(secret),
              })
          );
          return new ApnsPushSender({
            credentials,
            topic: apns.topic,
            environment,
            render,
            ...(env.APNS_RELAY_ORIGIN === undefined ? {} : { origin: env.APNS_RELAY_ORIGIN }),
            ...(apnsFetch === undefined ? {} : { fetch: apnsFetch }),
          });
        }),
        APNS_DEAD_TOKEN_REASONS
      );
    }
    const fcm = config.fcm;
    if (fcm !== undefined) {
      platforms.android = dropDeadTokens(
        lazy(async () => {
          const secret = requireSecret(env, 'GOOGLE_APPLICATION_CREDENTIALS_BASE64');
          const serviceAccount = serviceAccountFromBase64(secret);
          // The token endpoint is called through the fetch: another fetch is another credential
          const credentials = providers.get(
            JSON.stringify([
              'fcm',
              serviceAccount.client_email,
              serviceAccount.project_id,
              identity(options.fetch),
              await secretDigest(secret),
            ]),
            () =>
              new FcmAccessToken({
                serviceAccount,
                ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
              })
          );
          return new FcmPushSender({
            credentials,
            render,
            ...(fcm.androidChannelId === undefined
              ? {}
              : { android: { channel_id: fcm.androidChannelId } }),
            ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
          });
        }),
        FCM_DEAD_TOKEN_REASONS
      );
    }
    const webPush = config.webPush;
    if (webPush !== undefined) {
      platforms.web = dropDeadTokens(
        lazy(async () => {
          const publicKey = requireSecret(env, 'VAPID_PUBLIC_KEY');
          const privateKey = requireSecret(env, 'VAPID_PRIVATE_KEY');
          const credentials = providers.get(
            JSON.stringify(['vapid', webPush.subject, publicKey, await secretDigest(privateKey)]),
            () => new VapidSigner({ subject: webPush.subject, publicKey, privateKey })
          );
          return new WebPushSender({
            credentials,
            render,
            ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
          });
        }),
        WEB_PUSH_DEAD_TOKEN_REASONS
      );
    }
    if (Object.keys(platforms).length === 0)
      return unavailable('none of apns, fcm or webPush is configured');
    return routeByPlatform(platforms);
  };

  /**
   * A webhook template's URL, read from the environment the Worker validated at startup (its
   * `env` schema): a template whose variable is unset fails the step, naming the template.
   */
  const webhookUrl = (channel: 'discord' | 'slack', template: DiscordTemplate | SlackTemplate) => {
    const url = template.webhook(env as unknown as Record<string, unknown>);
    if (typeof url !== 'string' || url === '') {
      throw new PermanentError(
        `${channel} template '${template.id}': its webhook URL is not set in the environment`
      );
    }
    return url;
  };

  const discord = (): MessageSender => {
    const registry = config.templates?.discord;
    if (registry === undefined) return unavailable('no discord templates are registered');
    const index = indexTemplates('discord', registry);
    return new DiscordWebhookSender({
      render: (id, props) => {
        const template = lookupTemplate(index, 'discord', id);
        return {
          url: webhookUrl('discord', template),
          content: renderDiscordContent(template, props),
        };
      },
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
  };

  const slack = (): MessageSender => {
    const registry = config.templates?.slack;
    if (registry === undefined) return unavailable('no slack templates are registered');
    const index = indexTemplates('slack', registry);
    return new SlackWebhookSender({
      render: (id, props) => {
        const template = lookupTemplate(index, 'slack', id);
        return { url: webhookUrl('slack', template), content: renderSlackContent(template, props) };
      },
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
  };

  return routeByChannel({ email: email(), push: push(), discord: discord(), slack: slack() });
}
