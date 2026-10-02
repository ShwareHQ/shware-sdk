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
  ownHosts?: readonly RegExp[];
  /** The product's rules, in order; the first that names the session wins. */
  rules?: readonly TouchRule[];
}

const metaPlacements = new Set<string>(META_PLACEMENTS);
/** The groups no one paid for: a campaign rule landing in one of them ranks with a referrer. */
const ORGANIC_GROUPS = new Set<ChannelGroup>([
  'organic_search',
  'organic_social',
  'organic_video',
  'organic_ai',
  'referral',
]);
const referrerHostOf = /^https?:\/\/([^/:?#]+)/i;
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

/**
 * 1. What the campaign said: `utm_source`, with the aliases folded. It comes before the click
 * ids — unlike GA4, where a `gclid` wins over the utm unless the property sets "manual tagging
 * overrides auto-tagging": a utm is written for this link by whoever placed it, while a click id
 * can be added by someone else — Meta puts `fbclid` on organic links too, and a shared or
 * forwarded ad link keeps the click id of the ad. When the two disagree, the utm is the one that
 * was right: an Instagram profile link carrying `fbclid`, a newsletter link copied from an ad.
 * The one exception is an ad-only click id of the utm's own channel, see `classifyTouch`.
 */
function utmChannel(tags: TrackTags): string | null {
  // A source with the rest of the query glued on (`email&utm_medium=promo`, `toolify/`,
  // `x?utm_source=x`): a link built by hand or double-encoded. Keep the source.
  const source = text(tags, 'utm_source')?.toLowerCase().split(/[?&#]/)[0]?.replace(/\/+$/, '');
  if (!source) return null;
  return (SOURCE_ALIASES as Record<string, string>)[source] ?? source;
}

/**
 * 2. A click id in this page's URL — the tags never fill one from the cookie an earlier click
 * left (that is `_gcl_aw`, `_fbc`, …). Presence of the key is the signal, as it is for the pixel
 * that reads it.
 */
function clickChannel(tags: TrackTags): string | null {
  return CLICK_ID_CHANNELS.find(([key]) => key in tags)?.[1] ?? null;
}

/** The channel of the first click id in the tags that its platform puts on ad clicks only. */
function adClickChannel(tags: TrackTags): string | null {
  return CLICK_ID_CHANNELS.find(([key, , on]) => on === 'ads' && key in tags)?.[1] ?? null;
}

/** 3. A landing page reserved for one channel's ads. */
function landingChannel(tags: TrackTags): string | null {
  const location = text(tags, 'page_location');
  return location ? (AD_LANDING_PAGE.exec(location)?.[1] ?? null) : null;
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
  ownHosts: readonly RegExp[]
): { channel: string; medium: string } | null {
  const url = text(tags, 'page_referrer');
  const host = url ? referrerHostOf.exec(url)?.[1]?.toLowerCase() : undefined;
  if (!host) return null;
  if (REFERRERS_NOT_A_TOUCH.some((pattern) => pattern.test(host))) return null;
  if (ownHosts.some((pattern) => pattern.test(host))) return null;
  const site = REFERRER_SITES.find(([, , pattern]) => pattern.test(host));
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
  if (PAID_MEDIUM.test(medium)) {
    if (socialChannels.has(channel) || videoChannels.has(channel)) return 'paid_social';
    if (searchChannels.has(channel)) return 'paid_search';
    return 'paid_other';
  }
  if (medium === 'social' || socialChannels.has(channel)) return 'organic_social';
  if (medium === 'video' || videoChannels.has(channel)) return 'organic_video';
  if (medium === 'ai' || aiChannels.has(channel)) return 'organic_ai';
  if (medium === 'organic' || searchChannels.has(channel)) return 'organic_search';
  if (EMAIL_MEDIUM.test(medium) || (EMAIL_MEDIUMS as readonly string[]).includes(channel))
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
 * for direct. An ad-only click id of the channel itself (`'ads'` in `CLICK_ID_CHANNELS`) makes it
 * `cpc` when the medium was left out or puts the touch in an organic group: the click was paid
 * whatever the tag said — a Reddit ad tagged `utm_medium=social`, a ChatGPT ad keeping the
 * `utm_source=chatgpt.com` of its organic links. `campaign` is `utm_campaign`, else what a
 * product rule captured — even when the utm named the channel, so a tagged referral link keeps
 * its code. `priority` is the tier of the rule that named the channel (`TOUCH_PRIORITY`):
 * campaign touches, then the product's own as they declare, then the referrer — except that a
 * campaign rule whose touch lands in an organic group or referral (`utm_source=chatgpt.com`,
 * `utm_medium=organic`) ranks with a referrer: nobody paid for that click, and it should not take
 * the credit from an ad clicked earlier in the attribution window.
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
  const namedMedium =
    declaredMedium ??
    (utm
      ? MEDIUM_NOT_SET
      : click || landing
        ? 'cpc'
        : (product?.medium ?? referred?.medium ?? NO_MEDIUM));
  // Another channel's click id says nothing about this one (an ad link copied and shared under a
  // utm of its own), and `fbclid` is on organic Meta links too, so neither counts here.
  const medium =
    adClickChannel(tags) === channel &&
    (namedMedium === MEDIUM_NOT_SET || ORGANIC_GROUPS.has(channelGroupOf(channel, namedMedium)))
      ? 'cpc'
      : namedMedium;
  const channelGroup = channelGroupOf(channel, medium);
  const campaign = text(tags, 'utm_campaign') ?? product?.campaign ?? null;
  const priority =
    utm || click || landing
      ? ORGANIC_GROUPS.has(channelGroup)
        ? TOUCH_PRIORITY.referrer
        : TOUCH_PRIORITY.campaign
      : product
        ? product.priority
        : referred
          ? TOUCH_PRIORITY.referrer
          : null;

  return { channel, medium, channel_group: channelGroup, campaign, priority };
}
