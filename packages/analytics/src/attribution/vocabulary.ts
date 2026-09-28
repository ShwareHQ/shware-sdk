import type { AdvertisingInfo } from '../track/types';

/**
 * The vocabulary attribution is built from, shared by every product's `session` table and by the
 * dashboards that read it. Data only: `classifyTouch` (./classify) turns it into a channel, and a
 * product's dashboards read the same names back. What stays with the product is its own hostnames
 * (referrer exclusions) and its landing-page conventions.
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
  /** AI assistants that send people to sites: ChatGPT tags its links `utm_source=chatgpt.com`, the
   * others show as a referrer. Their own channel group, `organic_ai`, since GA4's default groups
   * would file them under Referral / Unassigned and the question "how much does AI bring" comes up. */
  'chatgpt',
  'perplexity',
  'gemini',
  'claude',
  'copilot',
  /** the product's own referral programme: the session came through a member's link or code.
   * How a product recognises one (a `/refer/<code>` path, a code at sign-up) is its own rule. Not
   * `referral`: that word is the channel group of any outside site, and a channel of the same name
   * would be impossible to tell apart in queries. */
  'referral_program',
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
  /** not in GA4's default grouping: sessions an AI assistant sent, by referrer or by ChatGPT's utm */
  'organic_ai',
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
  'google ads': 'google',
  googleads: 'google',
  adwords: 'google',
  'chatgpt.com': 'chatgpt',
  'chat.openai.com': 'chatgpt',
  'perplexity.ai': 'perplexity',
  'claude.ai': 'claude',
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

export type ReferrerMedium = 'organic' | 'social' | 'video' | 'ai';

/**
 * Referrer hosts that name a channel, as POSIX regular expressions over the lower-cased host,
 * with the medium GA4 gives that kind of site. Anything else that refers is `referral`, kept as
 * its host. A country TLD is one or two labels (`google.com`, `google.co.uk`, `google.com.hk`),
 * never an open tail, so `google.com.evil.io` is not Google. In match order: the AI assistants
 * first, because `gemini.google.com` and `copilot.microsoft.com` would otherwise be Google and
 * Microsoft search.
 */
export const REFERRER_SITES = [
  ['chatgpt', 'ai', String.raw`(^|\.)(chatgpt\.com|chat\.openai\.com)$`],
  ['perplexity', 'ai', String.raw`(^|\.)perplexity\.ai$`],
  ['gemini', 'ai', String.raw`^gemini\.google\.com$`],
  ['claude', 'ai', String.raw`(^|\.)claude\.ai$`],
  ['copilot', 'ai', String.raw`^copilot\.microsoft\.com$`],
  ['google', 'organic', String.raw`(^|\.)google\.[a-z]{2,}(\.[a-z]{2,3})?$`],
  ['microsoft', 'organic', String.raw`(^|\.)bing\.com$`],
  ['yahoo', 'organic', String.raw`(^|\.)yahoo\.[a-z]{2,}(\.[a-z]{2,3})?$`],
  ['duckduckgo', 'organic', String.raw`(^|\.)duckduckgo\.com$`],
  ['baidu', 'organic', String.raw`(^|\.)baidu\.com$`],
  ['yandex', 'organic', String.raw`(^|\.)yandex\.[a-z]{2,}(\.[a-z]{2,3})?$`],
  ['ecosia', 'organic', String.raw`(^|\.)ecosia\.org$`],
  ['naver', 'organic', String.raw`(^|\.)naver\.com$`],
  ['brave', 'organic', String.raw`^search\.brave\.com$`],
  ['meta', 'social', String.raw`(^|\.)(facebook\.com|instagram\.com|fb\.com|threads\.net)$`],
  ['x', 'social', String.raw`(^|\.)(twitter\.com|x\.com|t\.co)$`],
  ['linkedin', 'social', String.raw`(^|\.)(linkedin\.com|lnkd\.in)$`],
  ['reddit', 'social', String.raw`(^|\.)reddit\.com$`],
  ['tiktok', 'social', String.raw`(^|\.)tiktok\.com$`],
  ['pinterest', 'social', String.raw`(^|\.)pinterest\.[a-z]{2,}(\.[a-z]{2,3})?$`],
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

/** GA4's paid mediums — cpc, cpm, ppc, retargeting, paid_social, … — plus Performance Max. */
export const PAID_MEDIUM = '^(.*cp.*|ppc|retargeting|paid.*|pmax|performance_max)$';
/**
 * Meta's `{{placement}}` values, which an ad URL template of `utm_medium={{placement}}` puts in
 * the medium: facebook_mobile_feed, instagram_reels, facebook_right_column, messenger_inbox,
 * audience_network / an, others, … Only an ad carries one — an organic post arrives as a
 * referrer, with no utm at all — so a medium like this on a `meta` session is a paid click. A
 * prefix match, so a placement Meta adds later is still paid.
 */
export const META_PLACEMENT_MEDIUM =
  '^(facebook|instagram|messenger|threads|audience_network|an|others)(_|$)';
export const DISPLAY_MEDIUMS = ['display', 'banner', 'expandable', 'interstitial'] as const;
/** GA4's email spellings, as a source or a medium. */
export const EMAIL_MEDIUMS = ['email', 'e-mail', 'e_mail', 'e mail'] as const;
/** A medium that says email anywhere in it: `outbound email`, `email_promo`, and GA4's four. */
export const EMAIL_MEDIUM = '(^|[^a-z])e[-_ ]?mail([^a-z]|$)';

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
 * How much a touch is worth against another when attribution has to choose between sessions;
 * lower wins, and the latest wins among equals. Stored on the session when it is classified, so
 * renumbering means reclassifying.
 *
 * This ranks touches against each other. Within one session the rules that name its channel have
 * their own order — `utm_source`, then a click id, then the ad landing page, then the referrer —
 * and the first that says something wins; the session's priority is then the tier of that rule.
 * So two sessions tagged with utm and gclid respectively are equal here (both `campaign`) and the
 * later one is credited, while one session carrying both is named by its utm.
 */
export const TOUCH_PRIORITY = {
  /** utm, click id, ad landing page: someone tagged that link (in that order within a session) */
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
