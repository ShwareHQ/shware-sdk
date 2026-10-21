import {
  DEAD_TOKEN_REASONS as APNS_DEAD_TOKEN_REASONS,
  ApnsPushSender,
  apnsKeyFromBase64,
} from '../apns';
import type { JourneyEnv } from '../cloudflare/bindings';
import { type JourneyConfig, apnsEnvironment } from '../config';
import { EmailSender, type EmailTransport } from '../email-sender';
import type { MessageSender } from '../engine/ports';
import { PermanentError } from '../engine/retry';
import {
  DEAD_TOKEN_REASONS as FCM_DEAD_TOKEN_REASONS,
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
import { DEAD_TOKEN_REASONS as WEB_PUSH_DEAD_TOKEN_REASONS, WebPushSender } from '../webpush';
import { removeDevice } from './router';
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
 * A sender built on its first message. A platform's secret is only required
 * when something is actually sent there: a journey that only emails must not
 * fail because the APNs key is missing from a local `.dev.vars`.
 */
function lazy(build: () => MessageSender): MessageSender {
  let sender: MessageSender | undefined;
  return {
    async send(message) {
      sender ??= build();
      return sender.send(message);
    },
  };
}

/**
 * The provider senders, one per `env` object and platform, for as long as the isolate lives.
 *
 * `channelsFromConfig` runs once per workflow run (every wake of every instance), while the APNs
 * provider JWT must be reused for at least 20 minutes (Apple answers a sender that re-signs on
 * every push with 429 `TooManyProviderTokenUpdates`) and the FCM access token is good for an hour.
 * Both live on the sender instance, so the sender has to outlive the run. The runtime hands the
 * same `env` object to every run in the isolate (a Worker's `env`, a Lambda's module-level
 * environment), and the keys, topics and secrets a sender is built from all come from it, so the
 * env is the natural scope: a WeakMap on it holds nothing past the isolate and never mixes two
 * deployments. Inside, the key names the platform and the config fields that shape the sender, so a
 * config change (tests, a reloaded host) builds a new one instead of reusing the old.
 *
 * What a cached sender must not capture is the run's store: the token a provider reports dead is
 * removed in `dropDeadTokens` below, per run, from the settled result.
 */
const providerSenders = new WeakMap<object, Map<string, MessageSender>>();

/** A number for each fetch implementation, so a sender built on one is not reused with another. */
const fetchIds = new WeakMap<object, number>();
let nextFetchId = 1;
function fetchId(fetchImpl: typeof fetch | undefined): string {
  if (fetchImpl === undefined) return 'global';
  let id = fetchIds.get(fetchImpl);
  if (id === undefined) {
    id = nextFetchId++;
    fetchIds.set(fetchImpl, id);
  }
  return String(id);
}

function cachedSender(env: object, key: string, build: () => MessageSender): MessageSender {
  let senders = providerSenders.get(env);
  if (senders === undefined) {
    senders = new Map();
    providerSenders.set(env, senders);
  }
  let sender = senders.get(key);
  if (sender === undefined) {
    sender = lazy(build);
    senders.set(key, sender);
  }
  return sender;
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
  } = {}
): MessageSender {
  const mode = journeyMode(env);

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
     * settled result: the provider sender is cached across runs (see `providerSenders`) and must
     * not hold this run's store.
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
      const key = JSON.stringify([
        'ios',
        apns.keyId,
        apns.teamId,
        apns.topic,
        environment,
        env.APNS_RELAY_ORIGIN ?? null,
        fetchId(apnsFetch),
      ]);
      platforms.ios = dropDeadTokens(
        cachedSender(
          env,
          key,
          () =>
            new ApnsPushSender({
              keyId: apns.keyId,
              teamId: apns.teamId,
              privateKey: apnsKeyFromBase64(requireSecret(env, 'APNS_PRIVATE_KEY_BASE64')),
              topic: apns.topic,
              environment,
              render,
              ...(env.APNS_RELAY_ORIGIN === undefined ? {} : { origin: env.APNS_RELAY_ORIGIN }),
              ...(apnsFetch === undefined ? {} : { fetch: apnsFetch }),
            })
        ),
        APNS_DEAD_TOKEN_REASONS
      );
    }
    const fcm = config.fcm;
    if (fcm !== undefined) {
      const key = JSON.stringify(['android', fcm.androidChannelId ?? null, fetchId(options.fetch)]);
      platforms.android = dropDeadTokens(
        cachedSender(
          env,
          key,
          () =>
            new FcmPushSender({
              serviceAccount: serviceAccountFromBase64(
                requireSecret(env, 'GOOGLE_APPLICATION_CREDENTIALS_BASE64')
              ),
              render,
              ...(fcm.androidChannelId === undefined
                ? {}
                : { android: { channel_id: fcm.androidChannelId } }),
              ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
            })
        ),
        FCM_DEAD_TOKEN_REASONS
      );
    }
    const webPush = config.webPush;
    if (webPush !== undefined) {
      const key = JSON.stringify(['web', webPush.subject, fetchId(options.fetch)]);
      platforms.web = dropDeadTokens(
        cachedSender(
          env,
          key,
          () =>
            new WebPushSender({
              vapid: {
                subject: webPush.subject,
                publicKey: requireSecret(env, 'VAPID_PUBLIC_KEY'),
                privateKey: requireSecret(env, 'VAPID_PRIVATE_KEY'),
              },
              render,
              ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
            })
        ),
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
