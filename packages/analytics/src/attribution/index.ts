import type { AdvertisingInfo } from '../track/types';

/**
 * The vocabulary attribution is built from, shared by every product's `touchpoint` view and by the
 * dashboards that read it. Data only, no SQL: a product turns these into its view. What stays with
 * the product is its own hostnames (referrer exclusions) and its landing-page convention.
 */

/** A session that arrived through nothing we can name. GA's spelling, so dashboards read as GA. */
export const DIRECT_CHANNEL = '(direct)';
/** The medium of a direct session. */
export const NO_MEDIUM = '(none)';
/** The medium of a tagged link that named a source but no medium. */
export const MEDIUM_NOT_SET = '(not set)';

/** The channels the rules below can name. A `utm_source` outside this list is its own channel. */
export const CHANNELS = [
  'meta',
  'google',
  'dv360',
  'microsoft',
  'tiktok',
  'reddit',
  'linkedin',
  'snapchat',
  'x',
  'kakao',
  'yandex',
  'yahoo',
  'duckduckgo',
  'baidu',
  'ecosia',
  'naver',
  'brave',
  'pinterest',
  'youtube',
] as const;

export type Channel = (typeof CHANNELS)[number];

/** GA4's default channel groups, as identifiers; a dashboard maps them to display names. */
export const CHANNEL_GROUPS = [
  'direct',
  'paid_search',
  'paid_social',
  'paid_other',
  'display',
  'organic_search',
  'organic_social',
  'organic_video',
  'referral',
  'email',
  'affiliate',
  'unassigned',
] as const;

export type ChannelGroup = (typeof CHANNEL_GROUPS)[number];

/** `utm_source` spellings that mean the same channel: Meta's `{{site_source_name}}` values and the usual synonyms. */
export const SOURCE_ALIASES = {
  fb: 'meta',
  ig: 'meta',
  an: 'meta',
  msg: 'meta',
  facebook: 'meta',
  instagram: 'meta',
  bing: 'microsoft',
  twitter: 'x',
} as const satisfies Record<string, Channel>;

/**
 * Which click id belongs to which channel, in priority order. Every key is a field this SDK
 * collects (`AdvertisingInfo`); `fbp` and `rdt_uuid` are deliberately absent — they are pixel
 * browser ids, present with or without a click.
 */
export const CLICK_ID_CHANNELS = [
  ['fbclid', 'meta'],
  ['fbc', 'meta'],
  ['gclid', 'google'],
  ['gbraid', 'google'],
  ['wbraid', 'google'],
  ['gad_source', 'google'],
  ['gad_campaignid', 'google'],
  ['dclid', 'dv360'],
  ['msclkid', 'microsoft'],
  ['ttclid', 'tiktok'],
  ['rdt_cid', 'reddit'],
  ['li_fat_id', 'linkedin'],
  ['sccid', 'snapchat'],
  ['twclid', 'x'],
  ['ko_click_id', 'kakao'],
  ['yclid', 'yandex'],
] as const satisfies readonly (readonly [keyof AdvertisingInfo, Channel])[];

/**
 * A landing page reserved for one channel's ads, for ads that lost their parameters:
 * `/lp/<channel>`, with or without host, query and hash; the capture is the channel. A product
 * that names its landing pages differently replaces this.
 */
export const AD_LANDING_PAGE = '^(?:https?://[^/]+)?/lp/([a-z]+)(?:[/?#]|$)';

export type ReferrerMedium = 'organic' | 'social' | 'video';

/**
 * Referrer hosts that name a channel, as POSIX regular expressions over the lower-cased host,
 * with the medium GA4 gives that kind of site. Anything else that refers is `referral`, kept as
 * its host.
 */
export const REFERRER_SITES = [
  ['google', 'organic', String.raw`(^|\.)google\.[a-z.]+$`],
  ['microsoft', 'organic', String.raw`(^|\.)bing\.com$`],
  ['yahoo', 'organic', String.raw`(^|\.)yahoo\.[a-z.]+$`],
  ['duckduckgo', 'organic', String.raw`(^|\.)duckduckgo\.com$`],
  ['baidu', 'organic', String.raw`(^|\.)baidu\.com$`],
  ['yandex', 'organic', String.raw`(^|\.)yandex\.[a-z.]+$`],
  ['ecosia', 'organic', String.raw`(^|\.)ecosia\.org$`],
  ['naver', 'organic', String.raw`(^|\.)naver\.com$`],
  ['brave', 'organic', String.raw`^search\.brave\.com$`],
  ['meta', 'social', String.raw`(^|\.)(facebook\.com|instagram\.com|fb\.com|threads\.net)$`],
  ['x', 'social', String.raw`(^|\.)(twitter\.com|x\.com|t\.co)$`],
  ['linkedin', 'social', String.raw`(^|\.)(linkedin\.com|lnkd\.in)$`],
  ['reddit', 'social', String.raw`(^|\.)reddit\.com$`],
  ['tiktok', 'social', String.raw`(^|\.)tiktok\.com$`],
  ['pinterest', 'social', String.raw`(^|\.)pinterest\.[a-z.]+$`],
  ['snapchat', 'social', String.raw`(^|\.)snapchat\.com$`],
  ['youtube', 'video', String.raw`(^|\.)(youtube\.com|youtu\.be)$`],
] as const satisfies readonly (readonly [Channel, ReferrerMedium, string])[];

/**
 * Referrer hosts that are navigation, not acquisition: the payment and sign-in providers a
 * visitor is bounced through and back from, and the local dev host. A product appends its own
 * hostnames — a session that starts from an internal link after the session timeout refers to
 * them. POSIX regular expressions over the lower-cased host.
 */
export const REFERRERS_NOT_A_TOUCH = [
  String.raw`^localhost(:|$)`,
  String.raw`(^|\.)stripe\.com$`,
  String.raw`^(pay|accounts)\.google\.com$`,
  String.raw`^(appleid|apps)\.apple\.com$`,
  String.raw`^play\.google\.com$`,
  String.raw`^login\.microsoftonline\.com$`,
] as const;

/** GA4's paid mediums: cpc, cpm, ppc, retargeting, paid_social, … */
export const PAID_MEDIUM = '^(.*cp.*|ppc|retargeting|paid.*)$';
export const DISPLAY_MEDIUMS = ['display', 'banner', 'expandable', 'interstitial'] as const;
export const EMAIL_MEDIUMS = ['email', 'e-mail', 'e_mail', 'e mail'] as const;

/** Where a touch came from: a tracked session, or a report by the user or staff. */
export const TOUCH_SOURCES = ['tracked', 'reported'] as const;
export type TouchSource = (typeof TOUCH_SOURCES)[number];

/**
 * How a reported touch was learned:
 * - survey: the user answered "how did you hear about us" (onboarding, checkout)
 * - promo_code: the user redeemed a code that belongs to a channel
 * - phone: a call came in on a channel's dedicated number, marked by staff or the phone system
 * - manual: staff recorded what a customer told them
 */
export const REPORTED_TOUCH_KINDS = ['survey', 'promo_code', 'phone', 'manual'] as const;
export type ReportedTouchKind = (typeof REPORTED_TOUCH_KINDS)[number];

/**
 * How much a touch is worth against another when attribution has to choose; lower wins, and the
 * latest wins among equals. Derived in the views, never stored, so renumbering is a view
 * regeneration.
 */
export const TOUCH_PRIORITY = {
  /** utm, click id, ad landing page: someone tagged that link */
  campaign: 1,
  /** a reported touch staff stand behind: a call on a channel's number, a recorded conversation */
  verified: 1,
  /** the browser said where the visitor came from; nobody chose it */
  referrer: 2,
  /** a reported touch that is the user's claim: a survey answer, a code that may have been shared */
  claimed: 3,
} as const satisfies Record<string, number>;

/** Which reported kinds are staff facts and which are the user's claims. */
export const REPORTED_TOUCH_PRIORITY = {
  phone: TOUCH_PRIORITY.verified,
  manual: TOUCH_PRIORITY.verified,
  survey: TOUCH_PRIORITY.claimed,
  promo_code: TOUCH_PRIORITY.claimed,
} as const satisfies Record<ReportedTouchKind, number>;
