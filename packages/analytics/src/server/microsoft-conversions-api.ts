/**
 * Microsoft Advertising Conversions API (CAPI) sender — the server-side counterpart of the UET
 * tag, in the same shape as the other senders here: a pure per-event builder, a never-throws
 * `sendEvents`, the token in a header and never in a URL or a log line.
 *
 * Microsoft's recommended deployment is hybrid: keep the UET JavaScript on the page and send the
 * same conversions here too, deduplicated by (`tagId`, `eventName`, `eventId`). Both channels in
 * this SDK are fed from the same `track()` call — the browser sends the internal name as the UET
 * action with the event id as `event_id`, and this builder sends the same name as `eventName`
 * with the same id — so the pair agrees by construction.
 *
 * The token comes from the UET tag's "Use Conversions API" setup step, or from the Campaign
 * Management API's `UetTagAuthKey/Query`. Access is provisioned per customer account: an account
 * whose tag setup has no "Use Conversions API" option has to ask Microsoft Advertising support.
 *
 * https://learn.microsoft.com/en-us/advertising/guides/uet-conversion-api-integration
 */
import { createHash } from 'node:crypto';
import { chunk, fetch } from '@shware/utils';
import { formatMsclkid } from '../click-id/index';
import { IGNORED_EVENTS } from '../third-parties/ignored-events';
import type { TrackEvent, UserProvidedData } from '../track/types';
import { mapUETEvent } from '../track/uetq';
import { pageLocation } from './page-location';

const ENDPOINT = 'https://capi.uet.microsoft.com/v1';

/** The API's hard limit per request. */
const MAX_EVENTS_PER_REQUEST = 1000;

const SHA256 = /^[a-f0-9]{64}$/;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Microsoft's email normalization: trim, drop the dots and any `+alias` from the user part —
 * for EVERY domain, unlike Google's gmail-only rule — lowercase, SHA-256. A value that is
 * already a SHA-256 hex digest passes through.
 * https://learn.microsoft.com/en-us/advertising/guides/uet-conversion-api-integration#hashed-identifiers
 */
export function normalizeEmail(input: string): string {
  const email = input.trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at === -1) return email;
  const user = email.slice(0, at).replace(/\./g, '').split('+', 1)[0] ?? '';
  return `${user}@${email.slice(at + 1)}`;
}

function hashEmail(input: string | undefined): string | undefined {
  const value = input?.trim().toLowerCase();
  if (!value) return undefined;
  return SHA256.test(value) ? value : sha256(normalizeEmail(value));
}

/**
 * Phones are E.164 by the schema (`+` then 11–15 digits, the range bat.js validates too); the
 * separators bat.js tolerates are stripped, and anything else is dropped rather than guessed —
 * a number with no country code hashed under an assumed one can never match.
 */
function hashPhone(input: string | undefined): string | undefined {
  const value = input?.trim().toLowerCase();
  if (!value) return undefined;
  if (SHA256.test(value)) return value;
  const phone = value.replace(/[-() \t]/g, '');
  return /^\+\d{11,15}$/.test(phone) ? sha256(phone) : undefined;
}

export interface MicrosoftUserData {
  /** Microsoft click id, as a dashed UUID. */
  msclkid?: string;
  /** SHA-256 of the normalized email. */
  em?: string;
  /** SHA-256 of the E.164 phone number. */
  ph?: string;
  /** The SDK visitor id — what the client-side ID Sync pixel (`sendUETIdSync`) sends as `VID`. */
  anonymousId?: string;
  /** SHA-256 of the signed-in user id — what `sendUETIdSync` sends as `UID`. */
  externalId?: string;
  clientUserAgent?: string;
  clientIpAddress?: string;
  idfa?: string;
  gaid?: string;
}

export interface MicrosoftItem {
  id?: string;
  name?: string;
  price?: number;
  quantity?: number;
}

export interface MicrosoftCustomData {
  eventCategory?: string;
  eventLabel?: string;
  eventValue?: number;
  searchTerm?: string;
  transactionId?: string;
  value?: number;
  currency?: string;
  items?: MicrosoftItem[];
  itemIds?: string[];
  pageType?: string;
  ecommTotalValue?: number;
  ecommCategory?: string;
}

/** One entry of the `data` array POSTed to `/v1/{tagId}/events`. */
export interface MicrosoftEvent {
  eventType: 'custom' | 'pageLoad';
  eventId: string;
  /** The UET action; absent on `pageLoad` events. */
  eventName?: string;
  /** UNIX seconds, UTC; the API rejects anything older than 7 days. */
  eventTime: number;
  eventSourceUrl?: string;
  referrerUrl?: string;
  pageTitle?: string;
  /** `G` granted, `D` denied. Absent means granted. */
  adStorageConsent?: 'G' | 'D';
  userData: MicrosoftUserData;
  customData?: MicrosoftCustomData;
}

export interface MicrosoftConversionsOptions {
  /**
   * EEA/UK/CH consent for the whole batch. `denied` events are accepted but used for nothing —
   * no attribution, no audiences. Absent means granted, which is also the API's default.
   */
  consent?: 'granted' | 'denied';
  /**
   * Also send `page_view` events, as CAPI `pageLoad` events. Off by default because the UET
   * JavaScript already reports every page load and the two would double-count destination-URL
   * goals; turn it on for a CAPI-only site with no tag on the page.
   *
   * Not yet modelled: `pageLoadId`, which links custom events to the page load they happened on,
   * and the revenue-only custom event a `pageLoad` needs for a destination goal with variable
   * revenue. Both matter only in this CAPI-only mode.
   */
  pageLoads?: boolean;
  /** Identifies a third-party sender in Microsoft's monitoring; leave unset for a first-party build. */
  dataProvider?: string;
  /**
   * Process the valid events of a batch and report the invalid ones, instead of the API's default
   * all-or-nothing rejection. On by default — one malformed event should cost itself, not the
   * batch it travelled with.
   */
  continueOnValidationError?: boolean;
}

export interface MicrosoftValidationDetail {
  index?: number;
  propertyName?: string;
  attemptedValue?: unknown;
  errorMessage?: string;
  errorCode?: string;
  isWarning?: boolean;
}

export interface MicrosoftConversionsResponse {
  eventsReceived?: number;
  error?: { code?: string; message?: string; details?: MicrosoftValidationDetail[] };
}

function getUserData(
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  event: TrackEvent<any>,
  data: UserProvidedData
): MicrosoftUserData {
  const { tags, platform, visitor_id } = event;
  const email = Array.isArray(data.email) ? data.email[0] : data.email;
  const phone = Array.isArray(data.phone_number) ? data.phone_number[0] : data.phone_number;

  return {
    msclkid: tags.msclkid ? formatMsclkid(tags.msclkid) : undefined,
    em: hashEmail(email),
    ph: hashPhone(phone),
    // Microsoft requires this to equal the `VID` of the client-side ID Sync pixel; both sides use
    // the SDK visitor id, which every event carries and the client can always read.
    anonymousId: visitor_id || undefined,
    // Microsoft asks for an anonymized id and never a real one. SHA-256, the same digest
    // `sendUETIdSync` applies client-side, so `externalId` and the pixel's `UID` agree too.
    externalId: data.user_id ? sha256(data.user_id) : undefined,
    clientUserAgent: data.user_agent,
    clientIpAddress:
      typeof tags.ip_address === 'string' && tags.ip_address ? tags.ip_address : data.ip_address,
    idfa: platform === 'ios' ? tags.advertising_id : undefined,
    gaid: platform === 'android' ? tags.advertising_id : undefined,
  };
}

// oxlint-disable-next-line @typescript-eslint/no-explicit-any
function getCustomData(event: TrackEvent<any>): MicrosoftCustomData | undefined {
  const [, params] = mapUETEvent(event.name, event.properties);
  const customData: MicrosoftCustomData = {
    eventCategory: params.event_category,
    eventLabel: params.event_label,
    eventValue: params.event_value,
    searchTerm: params.search_term,
    transactionId: params.transaction_id,
    value: params.revenue_value,
    currency: params.currency,
    items: params.items?.map(({ id, name, price, quantity }) => ({ id, name, price, quantity })),
    itemIds: Array.isArray(params.ecomm_prodid)
      ? params.ecomm_prodid
      : params.ecomm_prodid
        ? [params.ecomm_prodid]
        : undefined,
    pageType: params.ecomm_pagetype,
    ecommTotalValue: params.ecomm_totalvalue,
    ecommCategory: params.ecomm_category,
  };
  return Object.values(customData).some((value) => value !== undefined) ? customData : undefined;
}

/**
 * Build one CAPI event. `page_view` becomes a `pageLoad` event (the caller decides whether to
 * send those, see `MicrosoftConversionsOptions.pageLoads`); everything else is a `custom` event
 * named after the track event, which is also the UET action the browser sent.
 */
export function getServerEvent(
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  event: TrackEvent<any>,
  data: UserProvidedData = {},
  consent?: 'granted' | 'denied'
): MicrosoftEvent {
  const { id, name, tags, created_at } = event;
  const isPageLoad = name === 'page_view';

  return {
    eventType: isPageLoad ? 'pageLoad' : 'custom',
    eventId: tags.idempotency_key ?? id,
    eventName: isPageLoad ? undefined : name,
    eventTime: Math.round(new Date(created_at).getTime() / 1000),
    eventSourceUrl: pageLocation(tags),
    referrerUrl: tags.page_referrer,
    pageTitle: tags.page_title,
    adStorageConsent: consent === 'granted' ? 'G' : consent === 'denied' ? 'D' : undefined,
    userData: getUserData(event, data),
    customData: isPageLoad ? undefined : getCustomData(event),
  };
}

/** Strip undefined fields so the wire payload carries only what was set. */
function compact<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Send events to `POST /v1/{tagId}/events`. Batches above the API's 1,000-event limit are split
 * into consecutive requests; one response is returned per request made. Never throws: an HTTP
 * or network failure is logged (without the token) and yields no response for that request.
 */
export async function sendEvents(
  token: string,
  tagId: string | number,
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  events: TrackEvent<any>[],
  data: UserProvidedData = {},
  options: MicrosoftConversionsOptions = {}
): Promise<MicrosoftConversionsResponse[]> {
  const { consent, pageLoads = false, dataProvider, continueOnValidationError = true } = options;

  const capiEvents = events
    .filter(
      (event) => (pageLoads && event.name === 'page_view') || !IGNORED_EVENTS.includes(event.name)
    )
    .map((event) => getServerEvent(event, data, consent))
    // A pageLoad without a URL is rejected by the API, and a page-less event has nothing to say.
    .filter((event) => event.eventType !== 'pageLoad' || event.eventSourceUrl);
  if (capiEvents.length === 0) return [];

  const responses: MicrosoftConversionsResponse[] = [];
  for (const batch of chunk(capiEvents, MAX_EVENTS_PER_REQUEST)) {
    const body = compact({ data: batch, continueOnValidationError, dataProvider });
    try {
      const response = await fetch(`${ENDPOINT}/${tagId}/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        const result = (await response.json()) as MicrosoftConversionsResponse;
        // A 200 can still carry field-level warnings (the field was removed) and, with
        // `continueOnValidationError`, skipped events. Surface them: silent partial data loss is
        // the one failure mode the caller cannot see from the status code.
        if (result.error?.details?.length) {
          console.warn(
            `Microsoft conversion accepted with validation issues: ${JSON.stringify(result.error.details)}`
          );
        }
        responses.push(result);
        continue;
      }
      const { status } = response;
      const message = await response.text();
      console.error(`Failed to send Microsoft conversion, status: ${status}, body: ${message}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to send Microsoft conversion, network error: ${message}`);
    }
  }
  return responses;
}
