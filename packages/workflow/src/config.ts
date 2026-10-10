import type { JourneyMode, JourneyRuntimeConfig } from './runtime';

/**
 * `workflow.config.ts` — the project's journey configuration, typed and
 * committed with the code. Everything a host needs to assemble its channels
 * lives here, flat, one field per transport; the studio reads the same file
 * for its own settings (title, address book).
 *
 * Secrets are the one thing that stay out: a `.p8`, a service account, the
 * ingest bearer. The host reads them from its environment under fixed names
 * (see `JourneyEnv`), so the config can say *which* key without carrying it.
 */

/** An address as the transports take it: bare, or with a display name. */
export type EmailAddress = string | { email: string; name?: string };

/** `Name <email>`, or the bare address. */
export function formatEmailAddress(address: EmailAddress): string {
  if (typeof address === 'string') return address;
  return address.name === undefined ? address.email : `${address.name} <${address.email}>`;
}

export interface EmailConfig {
  /** Sender of every journey email. */
  from?: EmailAddress;
  replyTo?: EmailAddress;
  /**
   * Sender identities the studio's from / reply-to pickers list, e.g. 'Acme
   * <hello@acme.io>'. Defaults to `from` and `replyTo`; "add address" in the
   * studio writes back here.
   */
  addresses?: string[];
}

/** Token-based APNs, the `.p8` auth key; the key itself is `APNS_PRIVATE_KEY_BASE64` in the environment. */
export interface ApnsConfig {
  /** The app's bundle id (`apns-topic`). */
  topic: string;
  /** The key's 10-character id. */
  keyId: string;
  /** The Apple Developer team id. */
  teamId: string;
  /**
   * Which APNs host each mode's device tokens belong to: `sandbox` for builds
   * signed with `aps-environment: development` (Xcode, the simulator),
   * `production` for App Store and TestFlight builds. Unlisted modes default
   * to `production` for the production mode and `sandbox` for every other.
   */
  environment?: Partial<Record<JourneyMode, 'sandbox' | 'production'>>;
}

/** FCM HTTP v1 for Android; the service account is `GOOGLE_APPLICATION_CREDENTIALS_BASE64` in the environment. */
export interface FcmConfig {
  /** Android notification channel the pushes land in (`android.notification.channel_id`). */
  androidChannelId?: string;
}

export interface JourneyConfig {
  /** How the engine behaves per mode (`development`, `production`, …): time scale, message logging. */
  runtime?: JourneyRuntimeConfig;
  emails?: EmailConfig;
  apns?: ApnsConfig;
  fcm?: FcmConfig;
}

/** The APNs environment for `mode`: the configured one, else production only for production. */
export function apnsEnvironment(config: ApnsConfig, mode: JourneyMode): 'sandbox' | 'production' {
  return config.environment?.[mode] ?? (mode === 'production' ? 'production' : 'sandbox');
}

/** The studio's address book: the configured list, else whatever `from` / `replyTo` name. */
export function emailAddresses(config: EmailConfig | undefined): string[] {
  if (config?.addresses !== undefined) return config.addresses;
  const listed: string[] = [];
  if (config?.from !== undefined) listed.push(formatEmailAddress(config.from));
  if (config?.replyTo !== undefined) listed.push(formatEmailAddress(config.replyTo));
  return listed;
}
