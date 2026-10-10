import { ApnsPushSender, apnsKeyFromBase64 } from '../apns';
import { type JourneyConfig, apnsEnvironment } from '../config';
import type { MessageSender } from '../engine/ports';
import { FcmPushSender, serviceAccountFromBase64 } from '../fcm';
import { type PushRegistryModule, registryPushRenderer } from '../push';
import { type EmailRegistryModule, registryRenderer } from '../react-email';
import { type JourneyMode, type JourneyRuntimeOptions, resolveRuntime } from '../runtime';
import type { JourneyStore } from '../store/index';
import type { JourneyEnv } from './bindings';
import { CfEmailSender, routeByChannel, routeByPlatform } from './senders';

/**
 * The outlets a `JourneyConfig` describes, assembled against the environment:
 * email through the `EMAIL` binding with the configured addresses, iOS pushes
 * straight to APNs with the configured key (the `.p8` from
 * `APNS_PRIVATE_KEY_BASE64`), Android pushes through FCM with the service
 * account from `GOOGLE_APPLICATION_CREDENTIALS_BASE64`. A channel the config
 * leaves out is simply absent, and a journey that sends on it fails that step
 * with a message saying so — rather than the host having to spell out every
 * sender by hand.
 */

export interface ChannelRegistries {
  /** The email registry (`src/emails/index.ts`): react-email components keyed by template. */
  emails?: Record<string, EmailRegistryModule>;
  /** The push registry (`src/pushes/index.ts`). */
  pushes?: Record<string, PushRegistryModule>;
}

/** Which config entry applies: wrangler's `ENVIRONMENT` var, production when unset. */
export function journeyMode(env: JourneyEnv): JourneyMode {
  return env.ENVIRONMENT ?? 'production';
}

/** The runtime options for this environment's mode. */
export function runtimeFromConfig(
  config: JourneyConfig | undefined,
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
  name: 'APNS_PRIVATE_KEY_BASE64' | 'GOOGLE_APPLICATION_CREDENTIALS_BASE64'
): string {
  const value = env[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} is not set: the environment must hold it for the configured channel`);
  }
  return value;
}

export function channelsFromConfig(
  config: JourneyConfig | undefined,
  env: JourneyEnv,
  store: JourneyStore,
  registries: ChannelRegistries,
  fetchImpl?: typeof fetch
): MessageSender {
  const mode = journeyMode(env);

  const email = (): MessageSender => {
    if (registries.emails === undefined) return unavailable('no email registry was given');
    if (env.EMAIL === undefined) return unavailable('no EMAIL (send_email) binding');
    if (config?.emails?.from === undefined) return unavailable('emails.from is not configured');
    return new CfEmailSender({
      binding: env.EMAIL,
      from: config.emails.from,
      ...(config.emails.replyTo === undefined ? {} : { replyTo: config.emails.replyTo }),
      render: registryRenderer(registries.emails),
      profile: store,
    });
  };

  const push = (): MessageSender => {
    if (registries.pushes === undefined) return unavailable('no push registry was given');
    const render = registryPushRenderer(registries.pushes);
    const platforms: Record<string, MessageSender> = {};
    if (config?.apns !== undefined) {
      platforms.ios = new ApnsPushSender({
        keyId: config.apns.keyId,
        teamId: config.apns.teamId,
        privateKey: apnsKeyFromBase64(requireSecret(env, 'APNS_PRIVATE_KEY_BASE64')),
        topic: config.apns.topic,
        environment: apnsEnvironment(config.apns, mode),
        render,
        ...(env.APNS_RELAY_ORIGIN === undefined ? {} : { origin: env.APNS_RELAY_ORIGIN }),
        ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
      });
    }
    if (config?.fcm !== undefined) {
      platforms.android = new FcmPushSender({
        serviceAccount: serviceAccountFromBase64(
          requireSecret(env, 'GOOGLE_APPLICATION_CREDENTIALS_BASE64')
        ),
        render,
        ...(config.fcm.androidChannelId === undefined
          ? {}
          : { android: { channel_id: config.fcm.androidChannelId } }),
        ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
      });
    }
    if (Object.keys(platforms).length === 0)
      return unavailable('neither apns nor fcm is configured');
    return routeByPlatform(platforms, store);
  };

  return routeByChannel({ email: email(), push: push() });
}
