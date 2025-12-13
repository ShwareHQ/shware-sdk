/**
 * Conversions API Payload Builder: https://www.linkedin.com/developers/payload-builder
 * https://learn.microsoft.com/en-us/linkedin/marketing/conversions/conversions-overview?view=li-lms-2025-09
 */
import { createHash } from 'crypto';
import { fetch } from '@shware/utils';
import { IGNORED_EVENTS } from '../third-parties/ignored-events';
import { getFirst } from '../utils/field';
import type { TrackEvent, UserProvidedData } from '../track/types';

type UserIdType =
  | 'SHA256_EMAIL'
  | 'LINKEDIN_FIRST_PARTY_ADS_TRACKING_UUID'
  | 'ACXIOM_ID'
  | 'ORACLE_MOAT_ID';

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
    userInfo?: {
      firstName?: string;
      lastName?: string;
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

export type LinkedinConversionConfig = Record<Lowercase<string>, number>;

export async function sendEvents(
  accessToken: string,
  config: LinkedinConversionConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  events: TrackEvent<any>[],
  data: UserProvidedData = {}
) {
  const eventNames = Object.keys(config);
  const address = getFirst(data.address);
  const userIds: { idType: UserIdType; idValue: string }[] = [];
  const externalIds: [string, ...string[]] | undefined = data.user_id ? [data.user_id] : undefined;
  const userInfo =
    address && address.first_name && address.last_name
      ? {
          firstName: address.first_name,
          lastName: address.last_name,
          countryCode: address.country,
        }
      : undefined;

  if (data.email) {
    const email = getFirst(data.email);
    if (email)
      userIds.push({
        idType: 'SHA256_EMAIL',
        idValue: createHash('sha256').update(email).digest('hex'),
      });
  }

  const dto: CreateMultipleLinkedinEventsDTO = {
    elements: events
      .filter((event) => eventNames.includes(event.name) && !IGNORED_EVENTS.includes(event.name))
      .map((event) => ({
        eventId: event.id,
        conversion: `urn:lla:llaPartnerConversion:${config[event.name]}`,
        conversionHappenedAt: Date.now(),
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
      })),
  };

  if (dto.elements.length === 0) return;
  try {
    const response = await fetch('https://api.linkedin.com/rest/conversionEvents', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'LinkedIn-Version': '202509',
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
