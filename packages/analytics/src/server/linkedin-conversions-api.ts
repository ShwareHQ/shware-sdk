/**
 * Conversions API Payload Builder: https://www.linkedin.com/developers/payload-builder
 * https://learn.microsoft.com/en-us/linkedin/marketing/conversions/conversions-overview?view=li-lms-2026-09
 */
import { createHash } from 'node:crypto';
import { fetch } from '@shware/utils';
import { IGNORED_EVENTS } from '../third-parties/ignored-events';
import type { TrackEvent, UserProvidedData } from '../track/types';
import { getFirst } from '../utils/field';

/**
 * The identifier types LinkedIn matches on, as of version 202609. `ORACLE_MOAT_ID` used to be
 * here and is no longer in the schema; the IP and Android ones are.
 */
type UserIdType =
  | 'SHA256_EMAIL'
  | 'LINKEDIN_FIRST_PARTY_ADS_TRACKING_UUID'
  | 'ACXIOM_ID'
  | 'PLAINTEXT_IP_ADDRESS'
  | 'SHA256_IP_ADDRESS'
  | 'GOOGLE_AID';

export interface CreateLinkedinEventDTO {
  /**
   * For any conversion that you want to send through multiple methods, such as Insight Tag and
   * Conversions API, you must create a conversion rule for each data source (browser and server).
   * Then, you can implement a logic to pick up the eventId from the browser and send it with the
   * corresponding event from your server. If we receive an Insight Tag event and a Conversions API
   * event from the same account with the same eventId, we discard the Conversions API event and
   * count only the Insight Tag event in campaign reporting.
   */
  eventId?: string;

  /**
   * Replace <id> with the conversion ID extracted when creating the conversion rule
   * (e.g. urn:lla:llaPartnerConversion:<id>).
   */
  conversion: `urn:lla:llaPartnerConversion:${number}`;

  /** Epoch timestamp in milliseconds at which the conversion event happened. */
  conversionHappenedAt: number;
  conversionValue: { currencyCode: string; amount: string };
  user: {
    userIds: { idType: UserIdType; idValue: string }[];
    /**
     * Probabilistic matching fields. `hashedFirstName` / `hashedLastName` arrived in 202609 and
     * are what we send; the plaintext `firstName` / `lastName` they replace are still accepted by
     * the API but are not listed here, because sending a name in the clear is not something this
     * client should make easy to reach for.
     */
    userInfo?: {
      hashedFirstName?: string;
      hashedLastName?: string;
      companyName?: string;
      countryCode?: string;
      title?: string;
    };

    /**
     * The maximum supported size of the list is 1 at the moment. If the list contains multiple
     * values, only the first value will be used.
     */
    externalIds?: [string, ...string[]];

    /**
     * This is generated when users submit the Linkedin Lead-gen form
     * (e.g. urn:li:leadGenFormResponse:<id>).
     */
    lead?: `urn:li:leadGenFormResponse:${string}`;
  };
}

export interface CreateMultipleLinkedinEventsDTO {
  elements: CreateLinkedinEventDTO[];
}

/**
 * The schema prescribes an exact normalization per field before hashing, and getting it wrong is
 * silent: LinkedIn accepts any 64-char hex digest and simply matches nobody. So these helpers are
 * the difference between attribution and nothing, not between 200 and 400.
 */
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * An email is lower-cased and stripped of whitespace before hashing. Punctuation is left alone —
 * `@` and `.` are the address.
 */
const hashEmail = (email: string) => sha256(email.toLowerCase().replace(/\s/g, ''));

/**
 * A name is lower-cased and stripped of whitespace *and punctuation* before hashing, so that
 * `O'Brien`, `o brien` and `obrien` all land on the same digest. UTF-8 is what `update` already
 * encodes with.
 *
 * The schema's wording ("lowercase with no spaces or punctuation") leaves room to read the
 * apostrophe either way, so this is checked against its own worked example rather than guessed:
 * the `hashedFirstName` / `hashedLastName` digests it prints are sha256('mary') and
 * sha256('obrien') — Mary O'Brien with the apostrophe removed, not escaped or kept.
 */
const hashName = (name: string) => sha256(name.toLowerCase().replace(/[\s\p{P}]/gu, ''));

export type LinkedinConversionConfig = Record<Lowercase<string>, number>;

export async function sendEvents(
  accessToken: string,
  config: LinkedinConversionConfig,
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  events: TrackEvent<any>[],
  data: UserProvidedData = {}
) {
  const eventNames = Object.keys(config);
  const address = getFirst(data.address);
  const userIds: { idType: UserIdType; idValue: string }[] = [];
  const externalIds: [string, ...string[]] | undefined = data.user_id ? [data.user_id] : undefined;
  const userInfo =
    address?.first_name && address.last_name
      ? {
          hashedFirstName: hashName(address.first_name),
          hashedLastName: hashName(address.last_name),
          countryCode: address.country,
        }
      : undefined;

  if (data.email) {
    const email = getFirst(data.email);
    if (email) userIds.push({ idType: 'SHA256_EMAIL', idValue: hashEmail(email) });
  }

  const dto: CreateMultipleLinkedinEventsDTO = {
    elements: events
      .filter((event) => eventNames.includes(event.name) && !IGNORED_EVENTS.includes(event.name))
      .map((event): CreateLinkedinEventDTO => ({
        eventId: event.id,
        conversion: `urn:lla:llaPartnerConversion:${config[event.name]}`,
        conversionHappenedAt: new Date(event.created_at).getTime(),
        conversionValue: {
          currencyCode: event.properties?.currency?.toUpperCase() ?? 'USD',
          amount: event.properties?.value?.toString() ?? '0',
        },
        user: {
          userIds: event.tags.li_fat_id
            ? [
                {
                  idType: 'LINKEDIN_FIRST_PARTY_ADS_TRACKING_UUID',
                  idValue: event.tags.li_fat_id,
                },
                ...userIds,
              ]
            : userIds,
          userInfo,
          externalIds,
        },
      }))
      // An element carrying no identifier at all fails validation, and LinkedIn fails the whole
      // batch when one element fails — so a single anonymous event would discard every
      // identifiable conversion sent alongside it. Dropped here instead.
      .filter(
        ({ user }) =>
          user.userIds.length > 0 || !!user.userInfo || !!user.externalIds || !!user.lead
      ),
  };

  if (dto.elements.length === 0) return;
  try {
    const response = await fetch('https://api.linkedin.com/rest/conversionEvents', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'LinkedIn-Version': '202609',
        'X-Restli-Protocol-Version': '2.0.0',
        'X-RestLi-Method': 'BATCH_CREATE',
      },
      body: JSON.stringify(dto),
    });

    if (response.ok) return;
    const { status } = response;
    const message = await response.text();
    console.error(`Failed to send LinkedIn conversion, status: ${status}, body: ${message}`);
  } catch (error) {
    console.error('Failed to send LinkedIn conversion, network error:', error);
  }
}
