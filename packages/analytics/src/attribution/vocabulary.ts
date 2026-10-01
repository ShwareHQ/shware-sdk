import type { AdvertisingInfo } from '../track/types';

/**
 * The vocabulary attribution is built from, shared by every product's `session` table and by the
 * dashboards that read it. Data for `classifyTouch` (./classify), which turns it into a channel;
 * a product's dashboards read the same names back. What stays with the product is its own hostnames
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
  'grok',
  /** and the Chinese ones — DeepSeek, 豆包, Kimi, 通义, 腾讯元宝, 文心一言, 智谱清言 */
  'deepseek',
  'doubao',
  'kimi',
  'qwen',
  'yuanbao',
  'ernie',
  'zhipu',
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
  th: 'meta',
  facebook: 'meta',
  instagram: 'meta',
  bing: 'microsoft',
  twitter: 'x',
  'google ads': 'google',
  googleads: 'google',
  adwords: 'google',
  'chatgpt.com': 'chatgpt',
  'chat.openai.com': 'chatgpt',
  openai: 'chatgpt',
  'perplexity.ai': 'perplexity',
  'claude.ai': 'claude',
  'copilot.com': 'copilot',
  'deepseek.com': 'deepseek',
  'doubao.com': 'doubao',
  'kimi.com': 'kimi',
} as const satisfies Record<string, Channel>;

/**
 * Which click id belongs to which channel, in priority order. Every key is a field this SDK
 * collects (`AdvertisingInfo`). Deliberately absent: `fbp` and `rdt_uuid`, pixel browser ids
 * present with or without a click; and `fbc`, which the SDK only ever reads from the `_fbc`
 * cookie. That cookie lives 90 days after a Meta click, so counting it named every later visit —
 * typed in, from search, from an email — a new Meta click. `fbclid` is read from the landing URL
 * only, so it is this visit's click.
 */
export const CLICK_ID_CHANNELS = [
  ['fbclid', 'meta'],
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
 * The click ids an ad platform adds to its own ad clicks and nothing else, so they can say the
 * click was paid when a `utm_source` names the channel but no `utm_medium` says how (a Reddit ad
 * tagged `utm_source=reddit` and nothing more). `fbclid` is not one: Meta decorates every outbound
 * link with it, organic posts, profile links and shares included.
 */
export const AD_CLICK_IDS = [
  'gclid',
  'gbraid',
  'wbraid',
  'gad_source',
  'gad_campaignid',
  'dclid',
  'msclkid',
  'ttclid',
  'rdt_cid',
] as const satisfies readonly (keyof AdvertisingInfo)[];

/**
 * A landing page reserved for one channel's ads, for ads that lost their parameters:
 * `/lp/<channel>`, with or without host, query and hash; the capture is the channel. A product
 * that names its landing pages differently replaces this.
 */
export const AD_LANDING_PAGE = /^(?:https?:\/\/[^/]+)?\/lp\/([a-z]+)(?:[/?#]|$)/;

export type ReferrerMedium = 'organic' | 'social' | 'video' | 'ai';

/**
 * Referrer hosts that name a channel, as regular expressions over the lower-cased host,
 * with the medium GA4 gives that kind of site. Anything else that refers is `referral`, kept as
 * its host. A country TLD is one or two labels (`google.com`, `google.co.uk`, `google.com.hk`),
 * never an open tail, so `google.com.evil.io` is not Google. In match order: the AI assistants
 * first, because `gemini.google.com`, `copilot.microsoft.com` and `yiyan.baidu.com` would
 * otherwise be Google, Microsoft and Baidu search.
 */
export const REFERRER_SITES = [
  ['chatgpt', 'ai', /(^|\.)(chatgpt\.com|chat\.openai\.com)$/],
  ['perplexity', 'ai', /(^|\.)perplexity\.ai$/],
  ['gemini', 'ai', /^gemini\.google\.com$/],
  ['claude', 'ai', /(^|\.)claude\.ai$/],
  ['copilot', 'ai', /^copilot\.microsoft\.com$|(^|\.)copilot\.com$/],
  ['grok', 'ai', /(^|\.)(grok\.com|x\.ai)$/],
  ['deepseek', 'ai', /(^|\.)deepseek\.com$/],
  ['doubao', 'ai', /(^|\.)doubao\.com$/],
  ['kimi', 'ai', /(^|\.)(kimi\.com|kimi\.moonshot\.cn|moonshot\.cn)$/],
  ['qwen', 'ai', /^tongyi\.aliyun\.com$|(^|\.)(tongyi\.com|qianwen\.com|qwen\.ai)$/],
  ['yuanbao', 'ai', /^yuanbao\.tencent\.com$/],
  ['ernie', 'ai', /^yiyan\.baidu\.com$|(^|\.)ernie\.baidu\.com$/],
  ['zhipu', 'ai', /(^|\.)(chatglm\.cn|zhipuai\.cn|bigmodel\.cn)$/],
  ['google', 'organic', /(^|\.)google\.[a-z]{2,}(\.[a-z]{2,3})?$/],
  ['microsoft', 'organic', /(^|\.)bing\.com$/],
  ['yahoo', 'organic', /(^|\.)yahoo\.[a-z]{2,}(\.[a-z]{2,3})?$/],
  ['duckduckgo', 'organic', /(^|\.)duckduckgo\.com$/],
  ['baidu', 'organic', /(^|\.)baidu\.com$/],
  ['yandex', 'organic', /(^|\.)yandex\.[a-z]{2,}(\.[a-z]{2,3})?$/],
  ['ecosia', 'organic', /(^|\.)ecosia\.org$/],
  ['naver', 'organic', /(^|\.)naver\.com$/],
  ['brave', 'organic', /^search\.brave\.com$/],
  ['meta', 'social', /(^|\.)(facebook\.com|instagram\.com|fb\.com|threads\.net)$/],
  ['x', 'social', /(^|\.)(twitter\.com|x\.com|t\.co)$/],
  ['linkedin', 'social', /(^|\.)(linkedin\.com|lnkd\.in)$/],
  ['reddit', 'social', /(^|\.)reddit\.com$/],
  ['tiktok', 'social', /(^|\.)tiktok\.com$/],
  ['pinterest', 'social', /(^|\.)pinterest\.[a-z]{2,}(\.[a-z]{2,3})?$/],
  ['snapchat', 'social', /(^|\.)snapchat\.com$/],
  ['youtube', 'video', /(^|\.)(youtube\.com|youtu\.be)$/],
] as const satisfies readonly (readonly [Channel, ReferrerMedium, RegExp])[];

/**
 * Referrer hosts that are navigation, not acquisition, when a session happens to start on the way
 * back from them: the local dev host; the payment providers a visitor is bounced through; the
 * sign-in providers whose login lives on a host of its own (Google, Apple, Microsoft, WeChat,
 * Kakao, LINE, Naver, Yahoo, Twitch, X's OAuth 1.0a endpoint); and the hosted auth services a
 * product may sit behind (Auth0, Okta, Supabase, Firebase, Clerk). A product appends its own
 * hostnames — a session that starts from an internal link after the session timeout refers to
 * them. Matched before `REFERRER_SITES`, so `nid.naver.com` and `login.yahoo.com` are not read as
 * a search. Providers whose login shares the host with their content — Facebook, X's OAuth 2.0,
 * LinkedIn, GitHub, Discord — cannot be told apart by host (referrer policies strip the path) and
 * are left as the referrers they usually are. Regular expressions over the lower-cased host.
 */
export const REFERRERS_NOT_A_TOUCH = [
  /^localhost(:|$)/,
  // payment
  /(^|\.)stripe\.com$/,
  /^pay\.google\.com$/,
  /(^|\.)paypal\.com$/,
  /(^|\.)alipay\.com$/,
  /(^|\.)paddle\.com$/,
  /(^|\.)lemonsqueezy\.com$/,
  // app stores
  /^apps\.apple\.com$/,
  /^play\.google\.com$/,
  // sign-in providers with a login host of their own
  /^accounts\.google\.com$/,
  /^appleid\.apple\.com$/,
  /^login\.(microsoftonline|live)\.com$/,
  /^open\.weixin\.qq\.com$/,
  /^(kauth|accounts)\.kakao\.com$/,
  /^access\.line\.me$/,
  /^nid\.naver\.com$/,
  /^login\.yahoo\.com$/,
  /^id\.twitch\.tv$/,
  /^api\.twitter\.com$/,
  // hosted auth services
  /(^|\.)auth0\.com$/,
  /(^|\.)okta\.com$/,
  /(^|\.)supabase\.co$/,
  /(^|\.)firebaseapp\.com$/,
  /(^|\.)clerk\.accounts\.dev$/,
] as const;

/** GA4's paid mediums — cpc, cpm, ppc, retargeting, paid_social, … — plus Performance Max. */
export const PAID_MEDIUM = /^(.*cp.*|ppc|retargeting|paid.*|pmax|performance_max)$/;
/**
 * Meta's `{{placement}}` values, lower-cased, which an ad URL template of `utm_medium={{placement}}`
 * puts in the medium. Only an ad carries one — an organic post arrives as a referrer, with no utm
 * at all — so a medium in this list is a paid Meta click whatever the source says (a template with
 * `utm_source=meta-websitekeyinfo` was seen). Listed one by one rather than matched by prefix, so
 * that a hand-tagged `instagram_stories` post cannot be mistaken for an ad only because of how it
 * is spelled … which means a placement Meta adds later shows up as unassigned until it is added
 * here. Meta's documented values plus the ones seen in the wild (`facebook_mobile_reels`,
 * `facebook_notification`, `an`), and the literal macro for a template that did not expand it.
 */
export const META_PLACEMENTS = [
  'facebook_desktop_feed',
  'facebook_mobile_feed',
  'facebook_mobile_reels',
  'facebook_reels',
  'facebook_reels_overlay',
  'facebook_right_column',
  'facebook_marketplace',
  'facebook_video_feeds',
  'facebook_stories',
  'facebook_search',
  'facebook_instream_video',
  'facebook_instant_article',
  'facebook_groups_feed',
  'facebook_profile_feed',
  'facebook_notification',
  'facebook_notifications',
  'facebook_business_explore',
  'instagram_feed',
  'instagram_stories',
  'instagram_reels',
  'instagram_reels_overlay',
  'instagram_explore',
  'instagram_explore_home',
  'instagram_search',
  'instagram_shop',
  'instagram_profile_feed',
  'instagram_profile_reels',
  'instagram_igtv',
  'messenger_inbox',
  'messenger_stories',
  'messenger_sponsored_messages',
  'threads_feed',
  'whatsapp_status',
  'audience_network_classic',
  'audience_network_rewarded_video',
  'audience_network_native_banner_and_interstitial',
  'an',
  'others',
  /** the macro itself, when Meta did not expand it (written in a field it does not substitute, or a
   * preview click): still only ever produced by a Meta ad URL, so still a paid Meta click */
  '{{placement}}',
] as const;
export const DISPLAY_MEDIUMS = ['display', 'banner', 'expandable', 'interstitial'] as const;
/** GA4's email spellings, as a source or a medium. */
export const EMAIL_MEDIUMS = ['email', 'e-mail', 'e_mail', 'e mail'] as const;
/** A medium that says email or newsletter anywhere in it: `outbound email`, `cold_email`, `newsletter`, and GA4's four. */
export const EMAIL_MEDIUM = /(^|[^a-z])(e[-_ ]?mail|newsletter)([^a-z]|$)/;

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
