import {
  AppData,
  Content,
  CustomData,
  EventRequest,
  ExtendedDeviceInfo,
  ServerEvent,
  UserData,
} from 'facebook-nodejs-business-sdk';
import { formatFbc } from '../click-id/index';
import { IGNORED_EVENTS } from '../third-parties/ignored-events';
import { mapFBEvent } from '../track/fbq';
import type { TrackEvent, TrackTags, UserProvidedData } from '../track/types';
import { type EventActionSource, resolveActionSource } from './action-source';

const USER_ASSIGNED_COUNTRIES: string[] = ['xk'];
function normalizeCountry(input: string | undefined): string | undefined {
  const country = input?.split(/[-_]/).at(0)?.toLowerCase();
  if (!country) return undefined;
  return USER_ASSIGNED_COUNTRIES.includes(country) ? undefined : country;
}

function getUserData(tags: TrackTags, data: UserProvidedData, eventTimeMs: number) {
  const userData = new UserData();

  // set user-provided data
  if (data.email) {
    if (Array.isArray(data.email)) {
      userData.setEmails(data.email);
    } else {
      userData.setEmail(data.email);
    }
  }
  if (data.phone_number) {
    if (Array.isArray(data.phone_number)) {
      userData.setPhones(data.phone_number);
    } else {
      userData.setPhone(data.phone_number);
    }
  }
  if (data.gender) {
    if (data.gender === 'female') {
      userData.setGender('f');
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- user-provided data may carry values outside the declared union at runtime
    } else if (data.gender === 'male') {
      userData.setGender('m');
    }
  }
  if (data.address) {
    if (Array.isArray(data.address)) {
      const firstNames = data.address.map((a) => a.first_name).filter(Boolean);
      const lastNames = data.address.map((a) => a.last_name).filter(Boolean);
      const cities = data.address.map((a) => a.city).filter(Boolean);
      const states = data.address.map((a) => a.region).filter(Boolean);
      const postalCodes = data.address.map((a) => a.postal_code).filter(Boolean);
      const countries = data.address.map((a) => normalizeCountry(a.country)).filter(Boolean);

      userData.setFirstNames(firstNames as string[]);
      userData.setLastNames(lastNames as string[]);
      userData.setCities(cities as string[]);
      userData.setStates(states as string[]);
      userData.setZips(postalCodes as string[]);
      userData.setCountries(countries as string[]);
    } else {
      if (data.address.first_name) {
        userData.setFirstName(data.address.first_name);
        userData.setF5First(data.address.first_name.slice(0, 5));
      }
      if (data.address.last_name) {
        userData.setLastName(data.address.last_name);
        userData.setF5Last(data.address.last_name.slice(0, 5));
      }
      if (data.address.city) userData.setCity(data.address.city);
      if (data.address.region) userData.setState(data.address.region);
      if (data.address.postal_code) userData.setZip(data.address.postal_code);
      if (data.address.country) {
        const country = normalizeCountry(data.address.country);
        if (country) userData.setCountry(country);
      }
    }
  }
  if (data.birthday) {
    userData.setDoby(data.birthday.year.toString());
    userData.setDobm(data.birthday.month.toString());
    userData.setDobd(data.birthday.day.toString());
  }
  if (data.user_id && data.user_id.length !== 0) {
    userData.setExternalId(data.user_id);
  }
  if (data.ip_address) {
    userData.setClientIpAddress(data.ip_address);
  }
  if (data.user_agent) {
    userData.setClientUserAgent(data.user_agent);
  }
  if (data.fb_login_id) {
    userData.setFbLoginId(data.fb_login_id);
  }
  if (data.fb_page_id) {
    userData.setPageId(data.fb_page_id);
  }

  // set tags info
  if (tags.fbc) {
    userData.setFbc(tags.fbc);
  } else if (tags.fbclid) {
    // ref: https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/fbp-and-fbc#2--format-clickid
    // The formatted ClickID value must be of the form `version.subdomainIndex.creationTime.<fbclid>`, where:
    // - version is always this prefix: fb
    // - subdomainIndex is which domain the cookie is defined on ('com' = 0, 'example.com' = 1, 'www.example.com' = 2)
    // - creationTime is the UNIX time since epoch in milliseconds when the _fbc was stored. If you don't save the _fbc cookie, use the timestamp when you first observed or received this fbclid value
    // - <fbclid> is the value for the fbclid query parameter in the page URL.

    // "the timestamp when you first observed or received this fbclid value" — the event's own
    // time is the closest thing the server has to that, and it does not move when a queued or
    // retried batch finally goes out.
    userData.setFbc(formatFbc(tags.fbclid, eventTimeMs));
  }

  if (tags.fbp) {
    userData.setFbp(tags.fbp);
  }
  if (tags.advertising_id) {
    userData.setMadid(tags.advertising_id);
  }
  if (tags.ip_address && typeof tags.ip_address === 'string') {
    userData.setClientIpAddress(tags.ip_address);
  }

  return userData;
}

function getAppData(tags: TrackTags, appPackageName: string) {
  const extinfo = new ExtendedDeviceInfo();
  if (tags.os_name) {
    if (tags.os_name === 'iOS' || tags.os_name === 'iPadOS') {
      extinfo.setExtInfoVersion('i2');
    } else if (tags.os_name === 'Android') {
      extinfo.setExtInfoVersion('a2');
    }
  }
  extinfo.setAppPackageName(appPackageName);
  const shortVersion = tags.release?.split('.').at(0);
  if (shortVersion) {
    extinfo.setShortVersion(shortVersion);
  }
  if (tags.release) {
    extinfo.setLongVersion(tags.release);
  }
  if (tags.os_version) {
    extinfo.setOsVersion(tags.os_version);
  }
  if (tags.device_model_id) {
    extinfo.setDeviceModelName(tags.device_model_id);
  }
  if (tags.language) {
    extinfo.setLocale(tags.language);
  }
  if (tags.screen_width) {
    extinfo.setScreenWidth(tags.screen_width);
  }
  if (tags.screen_height) {
    extinfo.setScreenHeight(tags.screen_height);
  }
  if (tags.device_pixel_ratio) {
    extinfo.setScreenDensity(tags.device_pixel_ratio.toString());
  }

  const appData = new AppData();
  appData.setExtinfo(extinfo);
  if (tags.install_referrer) {
    appData.setInstallReferrer(tags.install_referrer);
  }
  if (tags.advertising_id) {
    appData.setAdvertiserTrackingEnabled(true);
  }
  if (tags.install_referrer) {
    appData.setInstallReferrer(tags.install_referrer);
  }

  return appData;
}

// oxlint-disable-next-line @typescript-eslint/no-explicit-any
function getCustomData({ name, properties }: TrackEvent<any>) {
  const data = new CustomData();
  const [_, _name, fbEventProperties] = mapFBEvent(name, properties);
  const {
    value,
    currency,
    content_name,
    content_category,
    content_ids,
    contents,
    content_type,
    // order_id,
    predicted_ltv,
    num_items,
    search_string,
    status,
    // item_number,
    delivery_category,
    ...custom_properties
  } = fbEventProperties;
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- custom event properties may carry `value: null` at runtime despite the declared type
  if (value !== undefined && value !== null) data.setValue(value);
  if (currency) data.setCurrency(currency);
  if (content_name) data.setContentName(content_name);
  if (content_category) data.setContentCategory(content_category);
  if (content_ids) data.setContentIds(content_ids);
  if (contents)
    data.setContents(
      contents.map((c) => {
        const result = new Content().setId(c.id).setQuantity(c.quantity);
        if (c.item_price) result.setItemPrice(c.item_price);
        if (c.title) result.setTitle(c.title);
        if (c.description) result.setDescription(c.description);
        if (c.brand) result.setBrand(c.brand);
        if (c.category) result.setCategory(c.category);
        if (c.delivery_category) result.setDeliveryCategory(c.delivery_category);
        return result;
      })
    );
  if (content_type) data.setContentType(content_type);
  // if (order_id) data.setOrderId(order_id);
  if (predicted_ltv) data.setPredictedLtv(predicted_ltv);
  if (num_items) data.setNumItems(num_items);
  if (search_string) data.setSearchString(search_string);
  if (status) data.setStatus(status.toString());
  // if (item_number) data.setItemNumber(item_number);
  if (delivery_category) data.setDeliveryCategory(delivery_category);
  data.setCustomProperties(custom_properties);
  return data;
}

export function getServerEvent(
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  event: TrackEvent<any>,
  data: UserProvidedData,
  appPackageName?: string,
  actionSource?: EventActionSource
) {
  const eventTimeMs = new Date(event.created_at).getTime();
  const userData = getUserData(event.tags, data, eventTimeMs);
  const customData = getCustomData(event);
  const [_, eventName] = mapFBEvent(event.name, event.properties);
  const serverEvent = new ServerEvent()
    .setEventId(event.tags.idempotency_key ?? event.id)
    .setEventName(eventName)
    .setEventTime(Math.round(eventTimeMs / 1000))
    .setUserData(userData)
    .setCustomData(customData);

  const source = resolveActionSource(event.platform, actionSource);
  if (source === 'app' && appPackageName) {
    const appData = getAppData(event.tags, appPackageName);
    serverEvent.setAppData(appData);
  }
  if (event.tags.page_location) {
    serverEvent.setEventSourceUrl(event.tags.page_location);
  }
  switch (source) {
    case 'app':
      serverEvent.setActionSource('app');
      break;
    case 'web':
      serverEvent.setActionSource('website');
      break;
    default:
      // `action_source` is required on a server event, so both an offline conversion and an
      // undeterminable platform still have to send something. Meta has no generic offline
      // value: 'physical_store' and 'system_generated' are narrower claims only the caller can
      // make, so everything left lands in Meta's own catch-all.
      serverEvent.setActionSource('other');
      break;
  }
  return serverEvent;
}

/**
 * The shape `FacebookRequestError` exposes: `status` and `response` are the HTTP status and the
 * parsed error body, and both are null when the request never received a response.
 */
type MetaRequestError = { status?: number | null; message?: string; response?: unknown };

/**
 * Meta's SDK rejects on API errors, where every other conversion sender here logs and resolves.
 * Keep the failure inside this module, so one rejected batch cannot fail the caller's request.
 * Never log the error itself: it also carries the access token, in both `url` and `data`.
 */
function logError(error: unknown) {
  const { status, message, response } = (error ?? {}) as MetaRequestError;
  if (typeof status !== 'number') {
    console.error(`Failed to send Meta conversion, network error: ${message ?? String(error)}`);
    return;
  }
  console.error(
    `Failed to send Meta conversion, status: ${status}, body: ${JSON.stringify(response)}`
  );
}

export async function sendEvent(
  accessToken: string,
  pixelId: string,
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  event: TrackEvent<any>,
  data: UserProvidedData = {},
  appPackageName?: string,
  actionSource?: EventActionSource
) {
  if (IGNORED_EVENTS.includes(event.name)) return undefined;
  const request = new EventRequest(accessToken, pixelId);
  const fbEvent = getServerEvent(event, data, appPackageName, actionSource);
  request.setEvents([fbEvent]);
  try {
    return await request.execute();
  } catch (error) {
    logError(error);
    return undefined;
  }
}

export async function sendEvents(
  accessToken: string,
  pixelId: string,
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  events: TrackEvent<any>[],
  data: UserProvidedData = {},
  appPackageName?: string,
  actionSource?: EventActionSource
) {
  const fbEvents = events
    .filter((event) => !IGNORED_EVENTS.includes(event.name))
    .map((event) => getServerEvent(event, data, appPackageName, actionSource));
  if (fbEvents.length === 0) return undefined;
  const request = new EventRequest(accessToken, pixelId);
  request.setEvents(fbEvents);
  try {
    return await request.execute();
  } catch (error) {
    logError(error);
    return undefined;
  }
}

export async function sendTestEvent(accessToken: string, pixelId: string, testEventCode: string) {
  const extinfo = new ExtendedDeviceInfo()
    .setExtInfoVersion('a2')
    .setAppPackageName('com.some.app')
    .setShortVersion('771')
    .setLongVersion('Version 7.7.1')
    .setOsVersion('10.1.1')
    .setDeviceModelName('OnePlus6')
    .setLocale('en_US')
    .setTimezoneAbbreviation('GMT-1')
    .setCarrier('TMobile')
    .setScreenWidth(1920)
    .setScreenHeight(1080)
    .setScreenDensity('2.00')
    .setCpuCoreCount(2)
    .setTotalDiskSpaceGb(128)
    .setFreeDiskSpaceGb(8)
    .setDeviceTimeZone('USA/New York');

  const userData = new UserData().setEmail('test@example.com');
  const appData = new AppData().setExtinfo(extinfo);
  const event = new ServerEvent()
    .setEventId(Math.round(Math.random() * 1000_000).toString())
    .setEventName('TestEvent')
    .setEventTime(Math.round(Date.now() / 1000))
    .setUserData(userData)
    .setAppData(appData)
    .setActionSource('app');

  const request = new EventRequest(accessToken, pixelId);
  request.setTestEventCode(testEventCode);
  request.setEvents([event]);
  return request.execute();
}
