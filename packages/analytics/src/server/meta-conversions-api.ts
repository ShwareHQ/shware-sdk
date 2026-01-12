import {
  AppData,
  Content,
  CustomData,
  EventRequest,
  ExtendedDeviceInfo,
  ServerEvent,
  UserData,
} from 'facebook-nodejs-business-sdk';
import type { TrackEvent, TrackTags, UserProvidedData } from '../track/types';
import { IGNORED_EVENTS } from '../third-parties/ignored-events';
import { mapFBEvent } from '../track/fbq';

const USER_ASSIGNED_COUNTRIES: string[] = ['xk'];
function normalizeCountry(input: string | undefined): string | undefined {
  const country = input?.split(/[-_]/).at(0);
  if (!country) return undefined;
  return USER_ASSIGNED_COUNTRIES.includes(country) ? undefined : country;
}

function getUserData(tags: TrackTags, data: UserProvidedData) {
  const userData = new UserData();

  // set user provided data
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

    const fbc = `fb.1.${Date.now()}.${tags.fbclid}`;
    userData.setFbc(fbc);
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  if (value) data.setValue(value);
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
  if (custom_properties) data.setCustomProperties(custom_properties);
  return data;
}

export function getServerEvent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  event: TrackEvent<any>,
  data: UserProvidedData,
  appPackageName?: string
) {
  const userData = getUserData(event.tags, data);
  const customData = getCustomData(event);
  const [_, eventName] = mapFBEvent(event.name, event.properties);
  const serverEvent = new ServerEvent()
    .setEventId(event.tags.idempotency_key ?? event.id.toString())
    .setEventName(eventName)
    .setEventTime(Math.round(Date.now() / 1000))
    .setUserData(userData)
    .setCustomData(customData);

  if (event.tags.source === 'app' && appPackageName) {
    const appData = getAppData(event.tags, appPackageName);
    serverEvent.setAppData(appData);
  }
  if (event.tags.source_url) {
    serverEvent.setEventSourceUrl(event.tags.source_url);
  }
  switch (event.tags.source) {
    case 'app':
      serverEvent.setActionSource('app');
      break;
    case 'web':
      serverEvent.setActionSource('website');
      break;
    default:
      break;
  }
  return serverEvent;
}

export async function sendEvent(
  accessToken: string,
  pixelId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  event: TrackEvent<any>,
  data: UserProvidedData = {},
  appPackageName?: string
) {
  if (IGNORED_EVENTS.includes(event.name)) return;
  const request = new EventRequest(accessToken, pixelId);
  const fbEvent = getServerEvent(event, data, appPackageName);
  request.setEvents([fbEvent]);
  return request.execute();
}

export async function sendEvents(
  accessToken: string,
  pixelId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  events: TrackEvent<any>[],
  data: UserProvidedData = {},
  appPackageName?: string
) {
  const fbEvents = events
    .filter((event) => !IGNORED_EVENTS.includes(event.name))
    .map((event) => getServerEvent(event, data, appPackageName));
  if (fbEvents.length === 0) return;
  const request = new EventRequest(accessToken, pixelId);
  request.setEvents(fbEvents);
  return request.execute();
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
