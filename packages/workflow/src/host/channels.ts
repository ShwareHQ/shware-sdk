import { ApnsPushSender, apnsKeyFromBase64 } from '../apns';
import type { JourneyEnv } from '../cloudflare/bindings';
import { type JourneyConfig, apnsEnvironment } from '../config';
import { EmailSender, type EmailTransport } from '../email-sender';
import type { MessageSender, OutboundMessage } from '../engine/ports';
import { FcmPushSender, serviceAccountFromBase64 } from '../fcm';
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
import { WebPushSender } from '../webpush';
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

/** A sender that fails every message with the reason the channel cannot deliver. */
function unavailable(reason: string): MessageSender {
  return {
    async send(message) {
      throw new Error(`cannot send '${message.template}' on ${message.channel}: ${reason}`);
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
    throw new Error(`${name} is not set: the environment must hold it for the configured channel`);
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
    // A token the provider reports as gone is forgotten (nothing left to deliver to), waking the
    // waits that read devices, as a removal through the API does
    const onUnregistered = async (message: OutboundMessage) => {
      if (message.device !== undefined && options.store !== undefined) {
        await removeDevice(env, message.device.token, options.store);
      }
    };
    const platforms: Record<string, MessageSender> = {};
    const apns = config.apns;
    if (apns !== undefined) {
      platforms.ios = lazy(
        () =>
          new ApnsPushSender({
            keyId: apns.keyId,
            teamId: apns.teamId,
            privateKey: apnsKeyFromBase64(requireSecret(env, 'APNS_PRIVATE_KEY_BASE64')),
            topic: apns.topic,
            environment: apnsEnvironment(apns, mode),
            render,
            onUnregistered,
            ...(env.APNS_RELAY_ORIGIN === undefined ? {} : { origin: env.APNS_RELAY_ORIGIN }),
            ...((options.apnsFetch ?? options.fetch) === undefined
              ? {}
              : { fetch: options.apnsFetch ?? options.fetch }),
          })
      );
    }
    const fcm = config.fcm;
    if (fcm !== undefined) {
      platforms.android = lazy(
        () =>
          new FcmPushSender({
            serviceAccount: serviceAccountFromBase64(
              requireSecret(env, 'GOOGLE_APPLICATION_CREDENTIALS_BASE64')
            ),
            render,
            onUnregistered,
            ...(fcm.androidChannelId === undefined
              ? {}
              : { android: { channel_id: fcm.androidChannelId } }),
            ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
          })
      );
    }
    const webPush = config.webPush;
    if (webPush !== undefined) {
      platforms.web = lazy(
        () =>
          new WebPushSender({
            vapid: {
              subject: webPush.subject,
              publicKey: requireSecret(env, 'VAPID_PUBLIC_KEY'),
              privateKey: requireSecret(env, 'VAPID_PRIVATE_KEY'),
            },
            render,
            onUnregistered,
            ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
          })
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
      throw new Error(
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
