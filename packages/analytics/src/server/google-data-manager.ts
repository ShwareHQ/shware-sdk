/**
 * Google Ads conversion sender over the Data Manager API (`events:ingest`) — Google's
 * counterpart to Meta's Conversions API, and the mandated successor to the Google Ads API's
 * `UploadClickConversions`, which stopped accepting new adopters on 2026-06-15. Same shape as
 * the other senders here: a pure per-event builder, a never-throws `sendEvents`, credentials
 * in headers and never in a URL or a log line.
 *
 * Google's recommended deployment is *hybrid* ("boost your tag with additional data sources"):
 * this upload attaches to the SAME conversion action the gtag tag reports to, matched by
 * `transactionId` — a matched pair collapses into one conversion with the server data winning,
 * an unmatched upload is a recovered conversion. Both channels here are fed from the same
 * `track()` call, so the ids agree by construction. `transactionId` is therefore required in
 * that mode; this sender always sends one (the event id when there is no natural order id).
 *
 * Auth is a plain OAuth2 access token with the `datamanager` scope — no Google Ads developer
 * token, no API Center approval. The caller exchanges its stored refresh token for the access
 * token (one POST to oauth2.googleapis.com) and refreshes it however it likes; this module
 * stays out of the OAuth business, exactly as it stays out of Meta's.
 *
 * https://developers.google.com/data-manager/api/reference/rest/v1/events/ingest
 * https://developers.google.com/data-manager/api/devguides/events/google-ads/offline/upgrade/field-mappings
 */
import { createHash } from 'node:crypto';
import { fetch } from '@shware/utils';
import { IGNORED_EVENTS } from '../third-parties/ignored-events';
import type { TrackEvent, UserProvidedData } from '../track/types';
import { resolveActionSource } from './action-source';

const ENDPOINT = 'https://datamanager.googleapis.com/v1/events:ingest';

/**
 * Event name → conversion action id, mirroring `LinkedinConversionConfig`: only configured
 * events upload, everything else is skipped silently. In the hybrid setup this is the id of
 * the SAME conversion action the gtag tag reports to.
 */
export type GoogleAdsConversionConfig = Record<Lowercase<string>, number | string>;

export interface GoogleAdsAuth {
  /** OAuth2 access token with the `datamanager` scope. Short-lived; the caller refreshes it. */
  accessToken: string;
  /** The Google Ads account the conversion actions live in. Dashes are tolerated: '123-456-7890'. */
  operatingAccountId: string;
  /** The manager account the OAuth user accesses through, when access is delegated. */
  loginAccountId?: string;
}

/**
 * EEA/UK/CH consent, applied request-wide. Google drops EEA conversions without granted
 * `adUserData` from bidding, so a host with consent signals should pass them.
 */
export interface GoogleAdsConsent {
  adUserData?: 'CONSENT_GRANTED' | 'CONSENT_DENIED' | 'CONSENT_STATUS_UNSPECIFIED';
  adPersonalization?: 'CONSENT_GRANTED' | 'CONSENT_DENIED' | 'CONSENT_STATUS_UNSPECIFIED';
}

export interface GoogleAdsConversionsOptions {
  /** Validates the payload server-side without recording conversions. */
  validateOnly?: boolean;
  consent?: GoogleAdsConsent;
}

/**
 * Google's email normalization is Meta's minus one wrinkle: for @gmail.com/@googlemail.com the
 * username's dots and everything from '+' on are removed; for every other domain they are kept.
 * https://developers.google.com/data-manager/api/devguides/format-data
 */
export function normalizeEmail(input: string): string {
  const email = input.trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at === -1) return email;
  let username = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    username = username.replace(/\./g, '').split('+', 1)[0] ?? '';
  }
  return `${username}@${domain}`;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function normalizeCurrency(input: unknown): string {
  if (typeof input !== 'string') return 'USD';
  const currency = input.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : 'USD';
}

/** At most 10 userIdentifiers per event, per the API's hard limit. */
const MAX_USER_IDENTIFIERS = 10;

/** Hashes are hex strings, declared by `encoding: 'HEX'` on the request. */
function getUserIdentifiers(data: UserProvidedData): Record<string, string>[] {
  const identifiers: Record<string, string>[] = [];
  const emails = Array.isArray(data.email) ? data.email : data.email ? [data.email] : [];
  for (const email of emails) {
    identifiers.push({ emailAddress: sha256(normalizeEmail(email)) });
  }
  const phones = Array.isArray(data.phone_number)
    ? data.phone_number
    : data.phone_number
      ? [data.phone_number]
      : [];
  for (const phone of phones) {
    // Phones are already E.164 by the schema ('+' then digits); hash after a defensive trim.
    identifiers.push({ phoneNumber: sha256(phone.trim()) });
  }
  return identifiers.slice(0, MAX_USER_IDENTIFIERS);
}

/** One entry of the `events` array. Field names are the REST (camelCase) spellings. */
export interface DataManagerEvent {
  destinationReferences: string[];
  transactionId: string;
  /** RFC 3339 — `created_at` as stored, unlike the legacy API's bespoke format. */
  eventTimestamp: string;
  eventSource: 'WEB' | 'APP' | 'OTHER';
  conversionValue: number;
  currency: string;
  adIdentifiers?: { gclid?: string; gbraid?: string; wbraid?: string };
  userData?: { userIdentifiers: Record<string, string>[] };
}

/**
 * Builds one Event, or undefined when no conversion action is configured for the event's name.
 * At most one click identifier is sent, gclid first: it is the deterministic per-click id,
 * where gbraid/wbraid are the aggregate iOS ones, and Google documents preferring it. Unlike
 * the legacy upload, an event with no click id at all is still worth sending when it carries
 * user identifiers — that is the enhanced-conversions match path.
 */
export function getDataManagerEvent(
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  event: TrackEvent<any>,
  config: GoogleAdsConversionConfig,
  data: UserProvidedData = {}
): DataManagerEvent | undefined {
  const action = config[event.name as Lowercase<string>];
  if (!action) return undefined;

  const source = resolveActionSource(event.platform);
  const dmEvent: DataManagerEvent = {
    destinationReferences: [String(action)],
    // The hybrid-mode match key against the gtag tag's transaction_id: same track() call feeds
    // both channels, so they agree by construction for purchase-shaped events. The event id
    // covers conversions with no natural order id — but the gtag tracker only sends a
    // transaction_id when the properties carry one, so on a HYBRID action a non-purchase event
    // reported by both channels never matches and counts twice. Attach such events to a
    // standalone (API-only) conversion action instead.
    transactionId:
      typeof event.properties?.transaction_id === 'string'
        ? event.properties.transaction_id
        : event.id,
    eventTimestamp: new Date(event.created_at).toISOString(),
    eventSource: source === 'app' ? 'APP' : source === 'web' ? 'WEB' : 'OTHER',
    // Both mandatory, like the LinkedIn sender's defaults: 0 USD is Google's own convention
    // for value-less goals. The API has no partial-failure mode, so a malformed currency would
    // cost the whole batch — anything that isn't a 3-letter code falls back instead.
    conversionValue: typeof event.properties?.value === 'number' ? event.properties.value : 0,
    currency: normalizeCurrency(event.properties?.currency),
  };

  const { gclid, gbraid, wbraid } = event.tags;
  if (gclid) dmEvent.adIdentifiers = { gclid };
  else if (gbraid) dmEvent.adIdentifiers = { gbraid };
  else if (wbraid) dmEvent.adIdentifiers = { wbraid };

  const userIdentifiers = getUserIdentifiers(data);
  if (userIdentifiers.length > 0) dmEvent.userData = { userIdentifiers };

  // With neither a click id nor an identifier Google has nothing to match on; skip.
  if (!dmEvent.adIdentifiers && !dmEvent.userData) return undefined;

  return dmEvent;
}

export interface DataManagerResponse {
  requestId?: string;
}

/** The API takes at most 2000 events per request. */
const MAX_EVENTS_PER_REQUEST = 2000;

/**
 * Uploads the configured conversions from a batch of events. Never throws: an unusable event
 * is skipped and a failed request is logged and swallowed, like every other sender here. The
 * Data Manager API has no partial-failure mode — a rejected request costs the whole batch, so
 * the builder is strict about only emitting events the API can accept. A batch beyond the
 * 2000-event request cap goes out as sequential requests; the first response is returned.
 */
export async function sendEvents(
  auth: GoogleAdsAuth,
  config: GoogleAdsConversionConfig,
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  events: TrackEvent<any>[],
  data: UserProvidedData = {},
  options: GoogleAdsConversionsOptions = {}
): Promise<DataManagerResponse | undefined> {
  const dmEvents = events
    .filter((event) => !IGNORED_EVENTS.includes(event.name))
    .map((event) => getDataManagerEvent(event, config, data))
    .filter((dmEvent): dmEvent is DataManagerEvent => dmEvent !== undefined);
  if (dmEvents.length === 0) return undefined;

  const operatingAccount = {
    accountType: 'GOOGLE_ADS',
    accountId: auth.operatingAccountId.replace(/-/g, ''),
  };
  // One destination per conversion action present in the batch; each event points at its own
  // through destinationReferences, so mixed-action batches go out as one request.
  const loginAccount = auth.loginAccountId
    ? { accountType: 'GOOGLE_ADS', accountId: auth.loginAccountId.replace(/-/g, '') }
    : undefined;
  const actions = Array.from(new Set(dmEvents.flatMap((dmEvent) => dmEvent.destinationReferences)));
  const destinations = actions.map((action) => {
    const destination: Record<string, unknown> = {
      reference: action,
      operatingAccount,
      productDestinationId: action,
    };
    if (loginAccount) destination.loginAccount = loginAccount;
    return destination;
  });

  let firstResponse: DataManagerResponse | undefined;
  for (let offset = 0; offset < dmEvents.length; offset += MAX_EVENTS_PER_REQUEST) {
    const chunk = dmEvents.slice(offset, offset + MAX_EVENTS_PER_REQUEST);
    const body: Record<string, unknown> = {
      destinations,
      events: chunk,
      validateOnly: options.validateOnly ?? false,
    };
    if (chunk.some((dmEvent) => dmEvent.userData)) {
      body.encoding = 'HEX';
    }
    if (options.consent) {
      body.consent = options.consent;
    }

    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${auth.accessToken}`,
        },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        firstResponse ??= (await response.json()) as DataManagerResponse;
        continue;
      }
      const { status } = response;
      const message = await response.text();
      console.error(`Failed to send Google Ads conversions, status: ${status}, body: ${message}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to send Google Ads conversions, network error: ${message}`);
    }
  }
  return firstResponse;
}
