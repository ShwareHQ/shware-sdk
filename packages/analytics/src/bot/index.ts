import type { TrackTags } from '../track/types';
import { GENERIC_BOT } from './generic';

/**
 * What kind of automated visitor a bot is, as the analytics tools that report bots separately
 * group them (PostHog's traffic categories, Cloudflare's verified bot categories, Matomo's
 * DeviceDetector). Stored next to the name so dashboards can group without re-deriving:
 *
 * - search_crawler: indexes pages for a search engine (Googlebot, Bingbot, Baiduspider)
 * - ai_crawler: collects content to train models (GPTBot, ClaudeBot, Meta-ExternalAgent)
 * - ai_search: indexes pages for an AI search product (OAI-SearchBot, PerplexityBot)
 * - ai_assistant: fetches a page because a person asked an assistant to (ChatGPT-User)
 * - ad_review: checks ad landing pages (Meta-ExternalAds, AdsBot-Google)
 * - link_preview: renders the card of a link shared in a feed or a chat (facebookexternalhit)
 * - seo_tool: SEO, marketing and page-speed tools (AhrefsBot, Lighthouse, HubSpot)
 * - monitoring: uptime checks, synthetics and service callers (Pingdom, Stripe)
 * - headless: a scripted browser (HeadlessChrome, Playwright, a WebDriver session)
 * - http_client: a library or command-line client (curl, python-requests)
 * - other: automated by every sign, but none of the above
 */
export const BOT_CATEGORIES = [
  'search_crawler',
  'ai_crawler',
  'ai_search',
  'ai_assistant',
  'ad_review',
  'link_preview',
  'seo_tool',
  'monitoring',
  'headless',
  'http_client',
  'other',
] as const;

export type BotCategory = (typeof BOT_CATEGORIES)[number];

/**
 * The verdict, shaped like the columns a product stores it in (`is_bot`, `bot_name`,
 * `bot_category`). A person is `{ is_bot: false, bot_name: null, bot_category: null }`.
 */
export type Bot =
  | { is_bot: true; bot_name: string; bot_category: BotCategory }
  | { is_bot: false; bot_name: null; bot_category: null };

export const NOT_A_BOT: Bot = { is_bot: false, bot_name: null, bot_category: null };

/**
 * Bots we can name, as `[name, category, pattern]`, tried in order. Names are the operators'
 * own spelling of their user agent token. The list starts from bowser's bots (which are named
 * but few) and the ones seen in production that bowser misses, and follows each operator's
 * published user agents. More specific tokens come first where one contains another's prefix
 * (Meta's agents, Anthropic's, Perplexity's). Anything automated that is not here is caught by
 * the generic pattern and filed as `other`.
 */
export const NAMED_BOTS = [
  // ad review: before the search crawlers, AdsBot and Mediapartners carry Google's name
  ['Meta-ExternalAds', 'ad_review', /meta-externalads/i],
  ['facebookcatalog', 'ad_review', /facebookcatalog/i],
  ['AdsBot-Google', 'ad_review', /adsbot-google/i],
  ['Mediapartners-Google', 'ad_review', /mediapartners-google/i],
  ['AdIdxBot', 'ad_review', /adidxbot/i],
  ['Google-Adwords-Instant', 'ad_review', /google-adwords-instant/i],

  // AI assistants: a person asked for this page
  ['ChatGPT-User', 'ai_assistant', /chatgpt-user/i],
  ['Claude-User', 'ai_assistant', /claude-user/i],
  ['Claude-Web', 'ai_assistant', /claude-web/i],
  ['Perplexity-User', 'ai_assistant', /perplexity-user/i],
  ['DuckAssistBot', 'ai_assistant', /duckassistbot/i],
  ['Meta-ExternalFetcher', 'ai_assistant', /meta-externalfetcher/i],
  ['MistralAI-User', 'ai_assistant', /mistralai-user/i],
  ['Manus-User', 'ai_assistant', /manus-user/i],

  // AI search
  ['OAI-SearchBot', 'ai_search', /oai-searchbot/i],
  ['Claude-SearchBot', 'ai_search', /claude-searchbot/i],
  ['PerplexityBot', 'ai_search', /perplexitybot/i],
  ['Meta-WebIndexer', 'ai_search', /meta-webindexer/i],
  ['Amazonbot', 'ai_search', /amazonbot/i],
  ['YouBot', 'ai_search', /youbot/i],
  ['PhindBot', 'ai_search', /phindbot/i],

  // AI training
  ['GPTBot', 'ai_crawler', /gptbot/i],
  ['ClaudeBot', 'ai_crawler', /claudebot/i],
  ['anthropic-ai', 'ai_crawler', /anthropic-ai/i],
  ['Meta-ExternalAgent', 'ai_crawler', /meta-externalagent/i],
  ['FacebookBot', 'ai_crawler', /facebookbot/i],
  ['Bytespider', 'ai_crawler', /bytespider/i],
  ['CCBot', 'ai_crawler', /ccbot/i],
  ['Google-CloudVertexBot', 'ai_crawler', /google-cloudvertexbot/i],
  ['cohere-ai', 'ai_crawler', /cohere-(?:ai|training-data-crawler)/i],
  ['Diffbot', 'ai_crawler', /diffbot/i],
  ['Omgilibot', 'ai_crawler', /omgilibot|webzio-extended/i],
  ['ImagesiftBot', 'ai_crawler', /imagesiftbot/i],
  ['Timpibot', 'ai_crawler', /timpibot/i],
  ['AI2Bot', 'ai_crawler', /ai2bot/i],
  ['PanguBot', 'ai_crawler', /pangubot/i],

  // link previews
  ['facebookexternalhit', 'link_preview', /facebookexternalhit/i],
  ['Facebot', 'link_preview', /facebot/i],
  ['Twitterbot', 'link_preview', /twitterbot/i],
  ['LinkedInBot', 'link_preview', /linkedinbot/i],
  ['Slackbot', 'link_preview', /slackbot|slack-imgproxy/i],
  ['Discordbot', 'link_preview', /discordbot/i],
  ['TelegramBot', 'link_preview', /telegrambot/i],
  ['WhatsApp', 'link_preview', /^whatsapp\//i],
  ['Pinterestbot', 'link_preview', /pinterestbot/i],
  ['redditbot', 'link_preview', /redditbot/i],
  ['Snap URL Preview', 'link_preview', /snap url preview/i],
  ['SkypeUriPreview', 'link_preview', /skypeuripreview/i],
  ['BingPreview', 'link_preview', /bingpreview|microsoftpreview/i],
  ['Iframely', 'link_preview', /iframely/i],
  ['Embedly', 'link_preview', /embedly/i],
  ['KakaoTalk-scrap', 'link_preview', /kakaotalk-scrap/i],
  ['vkShare', 'link_preview', /vkshare/i],

  // SEO, marketing and page-speed tools; before the search crawlers, Lighthouse and the
  // Search Console tester borrow Google's name
  ['Google-InspectionTool', 'seo_tool', /google-inspectiontool/i],
  ['Lighthouse', 'seo_tool', /chrome-lighthouse|google page speed insights/i],
  ['GTmetrix', 'seo_tool', /gtmetrix/i],
  ['AhrefsBot', 'seo_tool', /ahrefs(?:bot|siteaudit)/i],
  ['SemrushBot', 'seo_tool', /semrush/i],
  ['MJ12bot', 'seo_tool', /mj12bot/i],
  ['DotBot', 'seo_tool', /dotbot/i],
  ['rogerbot', 'seo_tool', /rogerbot/i],
  ['Screaming Frog', 'seo_tool', /screaming frog/i],
  ['SerpstatBot', 'seo_tool', /serpstatbot/i],
  ['BLEXBot', 'seo_tool', /blexbot/i],
  ['DataForSeoBot', 'seo_tool', /dataforseobot/i],
  ['HubSpot', 'seo_tool', /hubspot/i],

  // search engines
  ['Googlebot', 'search_crawler', /googlebot/i],
  ['Storebot-Google', 'search_crawler', /storebot-google/i],
  ['GoogleOther', 'search_crawler', /googleother/i],
  ['Bingbot', 'search_crawler', /bingbot/i],
  ['Applebot', 'search_crawler', /applebot/i],
  ['Baiduspider', 'search_crawler', /baiduspider/i],
  ['YandexBot', 'search_crawler', /yandex(?:\w*bot|images|metrika)/i],
  ['DuckDuckBot', 'search_crawler', /duckduckbot/i],
  ['Yahoo Slurp', 'search_crawler', /yahoo!?[\s/]*slurp/i],
  ['Sogou', 'search_crawler', /sogou/i],
  ['360Spider', 'search_crawler', /360spider|haosouspider/i],
  ['YisouSpider', 'search_crawler', /yisouspider/i],
  ['PetalBot', 'search_crawler', /petalbot/i],
  ['SeznamBot', 'search_crawler', /seznambot/i],
  ['Yeti', 'search_crawler', /\byeti\//i],
  ['Linespider', 'search_crawler', /linespider/i],
  ['Qwantbot', 'search_crawler', /qwant(?:bot|ify)/i],
  ['coccocbot', 'search_crawler', /coccocbot/i],
  ['MojeekBot', 'search_crawler', /mojeekbot/i],

  // monitoring and service callers
  ['Pingdom', 'monitoring', /pingdom/i],
  ['UptimeRobot', 'monitoring', /uptimerobot/i],
  ['StatusCake', 'monitoring', /statuscake/i],
  ['Site24x7', 'monitoring', /site24x7/i],
  ['Better Stack', 'monitoring', /better ?uptime|betterstack/i],
  ['Datadog Synthetics', 'monitoring', /datadogsynthetics/i],
  ['Checkly', 'monitoring', /checkly/i],
  ['NewRelicPinger', 'monitoring', /newrelicpinger/i],
  ['Uptime-Kuma', 'monitoring', /uptime-kuma/i],
  ['Stripe', 'monitoring', /stripe\/1\.0|stripebot/i],

  // scripted browsers
  ['HeadlessChrome', 'headless', /headlesschrome/i],
  ['PhantomJS', 'headless', /phantomjs/i],
  ['SlimerJS', 'headless', /slimerjs/i],
  ['Playwright', 'headless', /playwright/i],
  ['Puppeteer', 'headless', /puppeteer/i],
  ['Selenium', 'headless', /selenium/i],
  ['Cypress', 'headless', /cypress/i],

  // libraries and command-line clients
  ['curl', 'http_client', /^curl\//i],
  ['Wget', 'http_client', /^wget\//i],
  ['python-requests', 'http_client', /python-requests/i],
  ['python-urllib', 'http_client', /python-urllib/i],
  ['aiohttp', 'http_client', /aiohttp/i],
  ['httpx', 'http_client', /python-httpx|^httpx\//i],
  ['Scrapy', 'http_client', /scrapy/i],
  ['Go-http-client', 'http_client', /go-http-client/i],
  ['okhttp', 'http_client', /^okhttp\//i],
  ['Java', 'http_client', /^java\/|apache-httpclient/i],
  ['axios', 'http_client', /^axios\//i],
  ['node-fetch', 'http_client', /node-fetch/i],
  ['undici', 'http_client', /^undici/i],
  ['PostmanRuntime', 'http_client', /postmanruntime/i],
  ['insomnia', 'http_client', /^insomnia\//i],
  ['libwww-perl', 'http_client', /libwww-perl/i],
  ['Guzzle', 'http_client', /guzzlehttp/i],
] as const satisfies readonly (readonly [string, BotCategory, RegExp])[];

const productToken = /^([\w.-]+)\//;
const botishToken =
  /\b([\w.-]*?(?:bot|crawler|spider|scraper|fetcher|agent|preview|checker|monitor)[\w-]*)\b/i;

/**
 * A name for a bot that is not in the named table: the token that sounds like one
 * (`Bytespider`, `ABEvalBot`), else the product at the head of the user agent, else what the
 * generic pattern matched. URLs are dropped first, as nearly every crawler links its docs.
 */
export function nameOfUnknownBot(userAgent: string, matched: string): string {
  const withoutUrls = userAgent.replace(/\+?https?:\/\/\S+/gi, ' ');
  const botish = botishToken.exec(withoutUrls)?.[1];
  if (botish && botish.length >= 3) return botish.slice(0, 64);
  const product = productToken.exec(withoutUrls.trim())?.[1];
  if (product && !/^mozilla$/i.test(product)) return product.slice(0, 64);
  return matched.trim().slice(0, 64) || 'unknown';
}

/**
 * Whether a web visitor is a bot, which one, and what kind. Run on the server when the visitor
 * is created, with the tags it was created with: the user agent is the request's header
 * (`tags.user_agent`, which the server writes), not anything the client says about itself, so
 * the verdict can be recomputed from stored tags when the rules change.
 *
 * Call it for web visitors only: a native app's requests carry an HTTP library's user agent
 * (CFNetwork, okhttp) that would read as a bot, and no crawler runs the app.
 *
 * In order: a bot we can name; a browser driven by WebDriver (`tags.webdriver`, which the SDK
 * sets from `navigator.webdriver`, the one sign a scripted browser with a normal user agent
 * gives); anything the generic pattern calls automated; no user agent at all.
 */
export function botOf(tags: TrackTags): Bot {
  const userAgent = typeof tags.user_agent === 'string' ? tags.user_agent.trim() : '';

  for (const [name, category, pattern] of NAMED_BOTS) {
    if (pattern.test(userAgent)) return { is_bot: true, bot_name: name, bot_category: category };
  }

  if (tags.webdriver === true) {
    return { is_bot: true, bot_name: 'WebDriver', bot_category: 'headless' };
  }

  const generic = userAgent ? GENERIC_BOT.exec(userAgent) : null;
  if (generic) {
    return {
      is_bot: true,
      bot_name: nameOfUnknownBot(userAgent, generic[0]),
      bot_category: 'other',
    };
  }

  if (!userAgent) return { is_bot: true, bot_name: '(no user agent)', bot_category: 'other' };

  return NOT_A_BOT;
}
