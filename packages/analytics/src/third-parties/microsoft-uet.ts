import type { UpdateVisitorDTO } from '../schema/index';
import type { EventName, TrackName, TrackProperties } from '../track/types';
import { type UETConsent, type UETQ, mapUETEvent } from '../track/uetq';
import { getFirst } from '../utils/field';
import { sha256 } from '../utils/sha256';
import { getVisitor } from '../visitor/index';

declare global {
  interface Window {
    /**
     * Defined by the UET snippet before `bat.js` loads (as a plain array), so pushes made early
     * are queued rather than lost. Undefined only where the snippet was never installed.
     */
    uetq?: UETQ;
  }
}

const metrics = ['CLS', 'FCP', 'FID', 'INP', 'LCP', 'TTFB'];

/** Drop `undefined` fields: bat.js validates every key it receives, and `undefined` is a value. */
// oxlint-disable-next-line @typescript-eslint/no-explicit-any
function clean(value: unknown): any {
  return JSON.parse(JSON.stringify(value));
}

function isLocal(): boolean {
  return window.location.host.includes('127.0.0.1') || window.location.host.includes('localhost');
}

/**
 * Forward an internal track event to the Microsoft Advertising UET tag.
 *
 * `eventId` is reused as UET's `event_id` so the browser event deduplicates against the same
 * conversion sent through the Conversions API (`sendMicrosoftEvents`). The action name is the
 * internal name on both channels — see `mapUETEvent`.
 *
 * `page_view` is not forwarded: bat.js turns that action into its page-load beacon, which the
 * snippet already fires on load and, with `enableAutoSpaTracking: true` (the setting in
 * Microsoft's generated snippet), on every history change — forwarding the SDK's own page views
 * would report each page twice. The tag owns page loads; this tracker owns everything else.
 */
export function sendUETEvent<T extends EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>,
  eventId?: string
) {
  if (typeof window === 'undefined' || !window.uetq) {
    console.warn('uetq has not been initialized');
    return;
  }
  if (metrics.includes(name) || name === 'page_view') return;
  if (isLocal()) return;

  const [action, params] = mapUETEvent(name, properties, eventId);
  window.uetq.push('event', action, clean(params));
}

/**
 * Enhanced conversions: hand the tag the visitor's email and phone so Microsoft can match a
 * conversion to an ad click without a third-party cookie. A `set` applies to every event fired
 * from the page afterwards, `pageLoad` included, and the tag fires a `pid` beacon on its own
 * when the page load already went out. Values are sent raw — the tag normalizes and SHA-256
 * hashes them in the browser (bat.js `validatePid`) before anything leaves the page.
 *
 * A setter itself, like `setGAUser`, rather than a factory like `setFBUser(pixelId)`: UET is
 * bound to its tag by the snippet and `set` addresses whichever tag drains `uetq`, so there is
 * nothing to bind first.
 */
export function setUETUser({ user_id, user_data }: UpdateVisitorDTO) {
  if (typeof window === 'undefined' || !window.uetq) {
    console.warn('uetq has not been initialized');
    return;
  }

  // A signed-in user is also the moment the ID Sync pixel can carry a `UID` — see `syncUETVisitor`.
  if (user_id) void syncUETVisitor(user_id);

  const em = getFirst(user_data?.email);
  const ph = getFirst(user_data?.phone_number);
  if (!em && !ph) return;

  window.uetq.push('set', { pid: clean({ em, ph }) });
}

/**
 * UET consent mode. Push `default` before the tag loads (the tag processes `consent` early, ahead
 * of the queued events) and `update` when the visitor decides. With `ad_storage: 'denied'` the
 * tag neither writes its cookies nor reads the `msclkid` from the URL.
 * https://help.ads.microsoft.com/#apex/ads/en/60119/1
 */
export function setUETConsent(mode: 'default' | 'update', consent: UETConsent) {
  if (typeof window === 'undefined') return;
  window.uetq ??= [] as unknown as UETQ;
  window.uetq.push('consent', mode, consent);
}

/**
 * The Conversions API's client-side ID Sync pixel: ties the visitor id sent server-side as
 * `anonymousId` to Microsoft's own identifier, so server events can be attributed across
 * contexts (view-through, audiences). Microsoft requires it for remarketing built from CAPI
 * events and recommends it for measurement quality; fire it at least once per session, ideally
 * on the first page view. A pixel rather than a fetch on purpose: Microsoft must observe the
 * browser context of the sync, which a server-side call cannot carry.
 *
 * `customerId` is the Microsoft Advertising customer id (`cid` in the UI's URLs) — not the UET
 * tag id. `visitorId` is the SDK visitor id (`getVisitor().id`), which is what
 * `sendMicrosoftEvents` sends as `anonymousId`; Microsoft requires the two to be equal.
 * `userId` is the raw signed-in user id: it is SHA-256 hashed here, exactly as the server sender
 * hashes it into `externalId`, so the pair matches as well. Hashing is asynchronous, so the
 * pixel fires once the digest resolves; where SubtleCrypto is unavailable (an insecure context)
 * the pixel goes out without `UID` rather than with a raw id.
 * https://learn.microsoft.com/en-us/advertising/guides/uet-conversion-api-integration#id-sync-and-why-it-matters
 */
/**
 * The Microsoft Advertising customer id the ID Sync pixel reports to, set once by the framework
 * `Analytics` component's `uetCustomerId` prop (or `configureUET`). Unset, nothing syncs.
 */
let uetCustomerId: string | undefined;

export function configureUET(options: { customerId?: string | number }) {
  uetCustomerId = options.customerId === undefined ? undefined : String(options.customerId);
}

/**
 * Sync the SDK visitor — the `anonymousId` of the events the server sends to the Conversions
 * API — with Microsoft, plus the user's `UID` when one is known. The `Analytics` components run
 * it on mount so every visit syncs at least once, anonymous visitors included (they are who
 * remarketing audiences are built from), and `setUETUser` runs it again on sign-in.
 */
export async function syncUETVisitor(userId?: string): Promise<void> {
  if (!uetCustomerId) return;
  try {
    const { id } = await getVisitor();
    sendUETIdSync({ customerId: uetCustomerId, visitorId: id, userId });
  } catch {
    // The visitor request failed; the next page load tries again.
  }
}

export function sendUETIdSync(options: {
  customerId: string | number;
  visitorId: string;
  /** The signed-in user's id, raw; hashed before it leaves the page. */
  userId?: string;
}) {
  if (typeof window === 'undefined' || typeof Image === 'undefined') return;
  if (isLocal()) return;

  const fire = (uid?: string) => {
    const params = new URLSearchParams({
      Red3: `BACID_${options.customerId}`,
      VID: options.visitorId,
    });
    if (uid) params.set('UID', uid);
    new Image().src = `https://c.bing.com/c.gif?${params.toString()}`;
  };

  if (!options.userId) {
    fire();
    return;
  }
  sha256(options.userId).then(fire, () => fire());
}
