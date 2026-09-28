import type { TrackTags } from '../track/types';
import {
  AD_LANDING_PAGE,
  CLICK_ID_CHANNELS,
  type ChannelGroup,
  DIRECT_CHANNEL,
  DISPLAY_MEDIUMS,
  EMAIL_MEDIUM,
  EMAIL_MEDIUMS,
  MEDIUM_NOT_SET,
  META_PLACEMENTS,
  NO_MEDIUM,
  PAID_MEDIUM,
  REFERRERS_NOT_A_TOUCH,
  REFERRER_SITES,
  SOURCE_ALIASES,
  TOUCH_PRIORITY,
} from './vocabulary';

/** What a session's tags say about how it arrived: the touch, as the session row stores it. */
export interface Touch {
  /** The source, as GA calls it: a `Channel`, a `utm_source` outside the list, a referring host, or `(direct)`. */
  channel: string;
  /** How, as GA calls it: `utm_medium` as declared, else what the rule that named the channel implies; `(none)` for direct. */
  medium: string;
  /** GA4's default channel group of the two. */
  channel_group: ChannelGroup;
  /** `utm_campaign`, else what a product rule captured (a referral code); null when neither. */
  campaign: string | null;
  /** `TOUCH_PRIORITY` of the rule that named the channel; null for direct, which is no touch. */
  priority: number | null;
}

/** What a product rule names, when it recognises the session; the channel group is derived. */
export type ProductTouch = Omit<Touch, 'channel_group'>;

/**
 * A product's own rule: a landing page convention, a code in the URL. Tried after the campaign
 * rules (utm, click id, ad landing page) and before the referrer, so a link shared on Facebook
 * or WhatsApp is credited to what the product recognises, not to the site it was shared on.
 * Returns null when the session is not one of its.
 */
export type TouchRule = (tags: TrackTags) => ProductTouch | null;

export interface ClassifyOptions {
  /**
   * The product's own hosts, as patterns over the lower-cased referrer host: a session that
   * starts from an internal link after the session timeout refers to them, which is navigation,
   * not acquisition. The SDK adds the payment and sign-in providers (`REFERRERS_NOT_A_TOUCH`).
   */
  ownHosts?: readonly (RegExp | string)[];
  /** The product's rules, in order; the first that names the session wins. */
  rules?: readonly TouchRule[];
}

const adLandingPage = new RegExp(AD_LANDING_PAGE);
const paidMedium = new RegExp(PAID_MEDIUM);
const metaPlacements = new Set<string>(META_PLACEMENTS);
const emailMedium = new RegExp(EMAIL_MEDIUM);
const referrerHostOf = /^https?:\/\/([^/:?#]+)/i;
const notATouch = REFERRERS_NOT_A_TOUCH.map((pattern) => new RegExp(pattern));
const referrerSites = REFERRER_SITES.map(
  ([channel, medium, pattern]) => [channel, medium, new RegExp(pattern)] as const
);
const channelsBy = (medium: string) =>
  new Set<string>(REFERRER_SITES.filter(([, m]) => m === medium).map(([channel]) => channel));
const searchChannels = channelsBy('organic');
const socialChannels = channelsBy('social');
const videoChannels = channelsBy('video');
const aiChannels = channelsBy('ai');

/**
 * A tag as text; absent when missing, empty, or the strings a broken template writes
 * (`undefined`, `null`, an unexpanded `{{macro}}` other than Meta's placement, read elsewhere).
 */
function text(tags: TrackTags, key: string): string | null {
  const value = tags[key];
  if (value === undefined || value === null) return null;
  const s = String(value);
  return s === '' || s === 'undefined' || s === 'null' ? null : s;
}

/** 1. What the campaign said: `utm_source`, with the aliases folded. */
function utmChannel(tags: TrackTags): string | null {
  // A source with the rest of the query glued on (`email&utm_medium=promo`, `toolify/`,
  // `x?utm_source=x`): a link built by hand or double-encoded. Keep the source.
  const source = text(tags, 'utm_source')?.toLowerCase().split(/[?&#]/)[0]?.replace(/\/+$/, '');
  if (!source) return null;
  return (SOURCE_ALIASES as Record<string, string>)[source] ?? source;
}

/**
 * 2. A click id, possibly carried by a first-party cookie from an earlier click. Presence of the
 * key is the signal, as it is for the pixel that reads it.
 */
function clickChannel(tags: TrackTags): string | null {
  return CLICK_ID_CHANNELS.find(([key]) => key in tags)?.[1] ?? null;
}

/** 3. A landing page reserved for one channel's ads. */
function landingChannel(tags: TrackTags): string | null {
  const location = text(tags, 'page_location');
  return location ? (adLandingPage.exec(location)?.[1] ?? null) : null;
}

/** 4. The product's rules, in order. */
function productTouch(tags: TrackTags, rules: readonly TouchRule[]): ProductTouch | null {
  for (const rule of rules) {
    const touch = rule(tags);
    if (touch) return touch;
  }
  return null;
}

/**
 * 5. The referrer's host: a known search engine or social network folded to its channel, any
 * other site kept as its host, and null for no referrer or one that is no touch.
 */
function referrer(
  tags: TrackTags,
  ownHosts: readonly (RegExp | string)[]
): { channel: string; medium: string } | null {
  const url = text(tags, 'page_referrer');
  const host = url ? referrerHostOf.exec(url)?.[1]?.toLowerCase() : undefined;
  if (!host) return null;
  if (notATouch.some((pattern) => pattern.test(host))) return null;
  if (ownHosts.some((pattern) => new RegExp(pattern).test(host))) return null;
  const site = referrerSites.find(([, , pattern]) => pattern.test(host));
  return site ? { channel: site[0], medium: site[1] } : { channel: host, medium: 'referral' };
}

/**
 * GA4's default channel group of a (channel, medium) pair, with GA4's rule that the source
 * decides too: `linkedin / (not set)` is Organic Social and `email / promo` is Email, because
 * GA4 matches its site lists on the source, not only the medium. Two additions to GA4: Meta's
 * placement names as a medium are a paid Meta click (see `META_PLACEMENTS`), and the AI
 * assistants have `organic_ai`. Checked in GA4's order — paid before organic, the organic groups before
 * email, referral last — so a pair that fits two rules lands where GA4 would put it.
 */
export function channelGroupOf(channel: string, medium: string): ChannelGroup {
  if (channel === DIRECT_CHANNEL) return 'direct';
  if ((DISPLAY_MEDIUMS as readonly string[]).includes(medium)) return 'display';
  // A Meta placement as the medium is a Meta ad whatever the source was tagged as.
  if (metaPlacements.has(medium)) return 'paid_social';
  if (paidMedium.test(medium)) {
    if (socialChannels.has(channel) || videoChannels.has(channel)) return 'paid_social';
    if (searchChannels.has(channel)) return 'paid_search';
    return 'paid_other';
  }
  if (medium === 'social' || socialChannels.has(channel)) return 'organic_social';
  if (medium === 'video' || videoChannels.has(channel)) return 'organic_video';
  if (medium === 'ai' || aiChannels.has(channel)) return 'organic_ai';
  if (medium === 'organic' || searchChannels.has(channel)) return 'organic_search';
  if (emailMedium.test(medium) || (EMAIL_MEDIUMS as readonly string[]).includes(channel))
    return 'email';
  if (medium === 'affiliate') return 'affiliate';
  if (medium === 'referral') return 'referral';
  return 'unassigned';
}

/**
 * Reads the tags a session arrived with (its `session_start` tags) as one touch. Run once, when
 * the session is written; the result is stored, and the views only read it.
 *
 * The rules, in order, the first that says something naming the channel: an explicit
 * `utm_source`, a click id, an ad landing page, the product's own rules, the referrer's host;
 * `(direct)` when none does. `medium` is `utm_medium` as declared (lower-cased), else what that
 * rule implies: `(not set)` for a utm_source alone, `cpc` for a bare click id or ad landing page,
 * the product rule's own, `organic` / `social` / `video` / `referral` for a referrer, `(none)`
 * for direct. `campaign` is `utm_campaign`, else what a product rule captured — even when the
 * utm named the channel, so a tagged referral link keeps its code. `priority` is the tier of
 * the rule that named the channel (`TOUCH_PRIORITY`): campaign touches, then the product's own
 * as they declare, then the referrer.
 */
export function classifyTouch(tags: TrackTags, options: ClassifyOptions = {}): Touch {
  const utm = utmChannel(tags);
  const click = clickChannel(tags);
  const landing = landingChannel(tags);
  const product = productTouch(tags, options.rules ?? []);
  const referred = referrer(tags, options.ownHosts ?? []);

  const channel =
    utm ?? click ?? landing ?? product?.channel ?? referred?.channel ?? DIRECT_CHANNEL;
  const declaredMedium = text(tags, 'utm_medium')?.toLowerCase() ?? null;
  const medium =
    declaredMedium ??
    (utm
      ? MEDIUM_NOT_SET
      : click || landing
        ? 'cpc'
        : (product?.medium ?? referred?.medium ?? NO_MEDIUM));
  const campaign = text(tags, 'utm_campaign') ?? product?.campaign ?? null;
  const priority =
    utm || click || landing
      ? TOUCH_PRIORITY.campaign
      : product
        ? product.priority
        : referred
          ? TOUCH_PRIORITY.referrer
          : null;

  return { channel, medium, channel_group: channelGroupOf(channel, medium), campaign, priority };
}
