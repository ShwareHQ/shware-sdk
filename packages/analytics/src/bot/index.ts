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
 * - advertising: works for an ad system — reviews landing pages, targets or verifies ads
 *   (Meta-ExternalAds, AdsBot-Google, Mediapartners-Google)
 * - link_preview: renders the card of a link shared in a feed or a chat (facebookexternalhit)
 * - seo_tool: SEO, marketing and page-speed tools (AhrefsBot, Lighthouse, HubSpot)
 * - monitoring: uptime checks, synthetics and service callers (Pingdom, Stripe)
 * - headless_browser: a scripted browser (HeadlessChrome, Playwright, a WebDriver session)
 * - http_client: a library or command-line client (curl, python-requests)
 * - no_user_agent: a request without a user agent, which no browser sends
 * - other: automated by every sign, but none of the above
 */
export const BOT_CATEGORIES = [
  'search_crawler',
  'ai_crawler',
  'ai_search',
  'ai_assistant',
  'advertising',
  'link_preview',
  'seo_tool',
  'monitoring',
  'headless_browser',
  'http_client',
  'no_user_agent',
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
 * Bots we can name, as `[name, category, pattern]`, tried in order; the first match wins.
 *
 * Where the list comes from (checked 2026-09-30):
 * - bowser's bot parsers (the ~25 named bots its `platform.type === 'bot'` reports), which this
 *   replaces.
 * - PostHog's `bot_definitions.py` (web analytics traffic classification), for the bots and
 *   categories an analytics product sees most.
 * - ai.robots.txt (`robots.json`), for AI crawlers, search bots, assistants and agents.
 * - The operators' own docs for the big ones: Google's crawler list, OpenAI's and Anthropic's
 *   bot pages, Meta's web crawlers, Perplexity, Bing, Apple.
 * - Bots seen in production (Meta-ExternalAds, HubSpot, Bytespider).
 * Every entry was run against the real user agents in crawler-user-agents and PostHog's
 * fixtures, and bowser's browser fixtures were run to check no browser is taken for a bot
 * (Sogou's browser against its spider, Pinterest's in-app browser against its bot).
 *
 * Names are the operators' spelling of their user agent token. Order matters where one token
 * contains another or borrows a name: advertising and SEO tools come before the search engines
 * whose names they carry, and the more specific of Meta's, Anthropic's and Perplexity's tokens
 * come first. The long tail is left to the generic pattern, filed as `other` and named by
 * `nameOfUnknownBot`; add a bot here when it is worth its own category or name in a dashboard.
 */
export const NAMED_BOTS = [
  // advertising: before the search crawlers, AdsBot and Mediapartners carry Google's name
  ['Meta-ExternalAds', 'advertising', /meta-externalads/i],
  ['facebookcatalog', 'advertising', /facebookcatalog/i],
  ['AdsBot-Google', 'advertising', /adsbot-google/i],
  ['Mediapartners-Google', 'advertising', /mediapartners-google/i],
  ['AdIdxBot', 'advertising', /adidxbot/i],
  ['Google-AdWords', 'advertising', /google-adwords/i],
  ['Google-Ads-Conversions', 'advertising', /google-ads-conversions/i],
  ['OAI-AdsBot', 'advertising', /oai-adsbot/i],
  ['SnapchatAds', 'advertising', /snapchatads/i],
  ['Taboolabot', 'advertising', /taboolabot/i],

  // AI assistants and agents: a person asked for this page
  ['ChatGPT-User', 'ai_assistant', /chatgpt-user/i],
  ['Claude-User', 'ai_assistant', /claude-user/i],
  ['Claude-Web', 'ai_assistant', /claude-web/i],
  ['Perplexity-User', 'ai_assistant', /perplexity-user/i],
  ['DuckAssistBot', 'ai_assistant', /duckassistbot/i],
  ['Meta-ExternalFetcher', 'ai_assistant', /meta-externalfetcher/i],
  ['MistralAI-User', 'ai_assistant', /mistralai-user/i],
  ['Manus-User', 'ai_assistant', /manus-user/i],
  ['Amzn-User', 'ai_assistant', /amzn-user/i],
  ['amazon-QBusiness', 'ai_assistant', /amazon-qbusiness/i],
  ['Amazon-Bedrock-AgentCore-Browser', 'ai_assistant', /amazon-bedrock-agentcore/i],
  ['Google-Agent', 'ai_assistant', /google-?agent/i],
  ['Gemini-Deep-Research', 'ai_assistant', /gemini-deep-research/i],
  ['Google-NotebookLM', 'ai_assistant', /google-notebooklm/i],
  ['Kimi-User', 'ai_assistant', /kimi-(?:user|agent)/i],
  ['TongyiBot', 'ai_assistant', /tongyibot/i],
  ['YiyanBot', 'ai_assistant', /yiyanbot/i],
  ['kagi-fetcher', 'ai_assistant', /kagi-fetcher/i],
  ['Devin', 'ai_assistant', /\bdevin\/\d/i],
  ['NovaAct', 'ai_assistant', /novaact/i],

  // AI search
  ['OAI-SearchBot', 'ai_search', /oai-searchbot/i],
  ['Claude-SearchBot', 'ai_search', /claude-searchbot/i],
  ['PerplexityBot', 'ai_search', /perplexitybot/i],
  ['Meta-WebIndexer', 'ai_search', /meta-webindexer/i],
  ['Amazonbot', 'ai_search', /amazonbot/i],
  ['YouBot', 'ai_search', /youbot/i],
  ['PhindBot', 'ai_search', /phindbot/i],
  ['Amzn-SearchBot', 'ai_search', /amzn-searchbot/i],
  ['AzureAI-SearchBot', 'ai_search', /azureai-searchbot/i],
  ['Kimi-SearchBot', 'ai_search', /kimi-searchbot/i],
  ['MistralAI-Index', 'ai_search', /mistralai-index/i],
  ['ExaSearchBot', 'ai_search', /exasearchbot|\bexabot/i],
  ['TavilyBot', 'ai_search', /tavilybot/i],
  ['LinkupBot', 'ai_search', /linkupbot/i],
  ['iAskBot', 'ai_search', /iask(?:bot|spider)/i],
  ['Andibot', 'ai_search', /andibot/i],
  ['Cloudflare-AutoRAG', 'ai_search', /cloudflare-autorag/i],

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
  ['Omgili', 'ai_crawler', /omgili|webzio-extended/i],
  ['ImagesiftBot', 'ai_crawler', /imagesiftbot/i],
  ['Timpibot', 'ai_crawler', /timpibot/i],
  ['AI2Bot', 'ai_crawler', /ai2bot/i],
  ['PanguBot', 'ai_crawler', /pangubot/i],
  ['TikTokSpider', 'ai_crawler', /tiktokspider/i],
  ['DeepSeekBot', 'ai_crawler', /deepseekbot/i],
  ['DoubaoBot', 'ai_crawler', /doubaobot/i],
  ['ERNIEBot', 'ai_crawler', /erniebot/i],
  ['QwenBot', 'ai_crawler', /qwenbot/i],
  ['KimiBot', 'ai_crawler', /kimibot/i],
  ['ChatGLM-Spider', 'ai_crawler', /chatglm-spider/i],
  ['MistralAI-Training', 'ai_crawler', /mistralai-training/i],
  ['YandexAdditional', 'ai_crawler', /yandexadditional/i],
  ['Google-Extended', 'ai_crawler', /google-extended/i],
  ['Amazon Kendra', 'ai_crawler', /amazon-kendra|kendrabot/i],
  ['bedrockbot', 'ai_crawler', /bedrockbot/i],
  ['Brightbot', 'ai_crawler', /brightbot/i],
  ['FirecrawlAgent', 'ai_crawler', /firecrawl/i],
  ['Crawl4AI', 'ai_crawler', /crawl4ai/i],
  ['ApifyBot', 'ai_crawler', /apify/i],
  ['img2dataset', 'ai_crawler', /img2dataset/i],
  ['LAION', 'ai_crawler', /laion/i],
  ['Cloudflare Browser Rendering', 'ai_crawler', /cloudflarebrowserrendering/i],

  // link previews
  ['facebookexternalhit', 'link_preview', /facebookexternalhit/i],
  ['Facebot', 'link_preview', /facebot/i],
  ['Twitterbot', 'link_preview', /twitterbot/i],
  ['LinkedInBot', 'link_preview', /linkedinbot/i],
  ['Slackbot', 'link_preview', /slackbot|slack-imgproxy/i],
  ['Discordbot', 'link_preview', /discordbot/i],
  ['TelegramBot', 'link_preview', /telegrambot/i],
  ['WhatsApp', 'link_preview', /^whatsapp\//i],
  ['Pinterestbot', 'link_preview', /pinterestbot|^pinterest\/0\./i],
  ['redditbot', 'link_preview', /redditbot/i],
  ['Snap URL Preview', 'link_preview', /snap url preview/i],
  ['SkypeUriPreview', 'link_preview', /skypeuripreview/i],
  ['BingPreview', 'link_preview', /bingpreview|microsoftpreview/i],
  ['Iframely', 'link_preview', /iframely/i],
  ['Embedly', 'link_preview', /embedly/i],
  ['KakaoTalk-scrap', 'link_preview', /kakaotalk-scrap/i],
  ['vkShare', 'link_preview', /vkshare/i],
  ['Viber', 'link_preview', /^viber\b|viber-crawler/i],
  ['Bluesky Cardyb', 'link_preview', /cardyb/i],
  ['Google-PageRenderer', 'link_preview', /google-pagerenderer/i],
  ['vercel-screenshot', 'link_preview', /vercel-screenshot/i],

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
  ['Google-Structured-Data-Testing-Tool', 'seo_tool', /google-structured-data-testing-tool/i],
  ['WebPageTest', 'seo_tool', /\bptst\/\d/i],
  ['DareBoost', 'seo_tool', /dareboost/i],
  ['Barkrowler', 'seo_tool', /barkrowler/i],
  ['SE Ranking', 'seo_tool', /seranking|sebot-wa/i],
  ['BrightEdge', 'seo_tool', /brightedge/i],
  ['SearchAtlas', 'seo_tool', /searchatlas/i],
  ['Siteimprove', 'seo_tool', /siteimprove/i],
  ['Dataprovider', 'seo_tool', /dataprovider\.com/i],
  ['Meltwater', 'seo_tool', /meltwater/i],
  ['Awario', 'seo_tool', /awario/i],

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
  ['Sogou', 'search_crawler', /sogou[\w\s-]*spider/i],
  ['360Spider', 'search_crawler', /360spider|haosouspider/i],
  ['YisouSpider', 'search_crawler', /yisouspider/i],
  ['PetalBot', 'search_crawler', /petalbot/i],
  ['SeznamBot', 'search_crawler', /seznambot/i],
  ['Yeti', 'search_crawler', /\byeti\//i],
  ['Linespider', 'search_crawler', /linespider/i],
  ['Qwantbot', 'search_crawler', /qwant(?:bot|ify)/i],
  ['coccocbot', 'search_crawler', /coccocbot/i],
  ['MojeekBot', 'search_crawler', /mojeekbot/i],
  ['Bravebot', 'search_crawler', /bravebot/i],
  ['SeekportBot', 'search_crawler', /seekport/i],
  ['mwmbl', 'search_crawler', /mwmbl/i],
  ['Internet Archive', 'search_crawler', /archive\.org_bot|ia_archiver|archive-it|archiveteam/i],

  // monitoring, synthetics, security and consent scanners, service callers
  ['Pingdom', 'monitoring', /pingdom/i],
  ['UptimeRobot', 'monitoring', /uptimerobot/i],
  ['StatusCake', 'monitoring', /statuscake/i],
  ['Site24x7', 'monitoring', /site24x7/i],
  ['Better Stack', 'monitoring', /better ?uptime|betterstack/i],
  ['Datadog', 'monitoring', /datadog/i],
  ['Checkly', 'monitoring', /checkly/i],
  ['NewRelicPinger', 'monitoring', /newrelicpinger/i],
  ['Uptime-Kuma', 'monitoring', /uptime-kuma/i],
  ['Grafana Synthetic Monitoring', 'monitoring', /grafanasyntheticmonitoring/i],
  ['Dynatrace', 'monitoring', /ruxitsynthetic|dynatrace/i],
  ['Splunk', 'monitoring', /splunk/i],
  ['Catchpoint', 'monitoring', /catchpoint/i],
  ['Ghost Inspector', 'monitoring', /ghost inspector/i],
  ['DigitalOcean Uptime', 'monitoring', /digitalocean uptime/i],
  ['OhDear', 'monitoring', /ohdear/i],
  ['Google-Safety', 'monitoring', /google-safety/i],
  ['Cookiebot', 'monitoring', /cookiebot/i],
  ['OneTrust', 'monitoring', /onetrust/i],
  ['CookieHub', 'monitoring', /cookiehub/i],
  ['Detectify', 'monitoring', /detectify/i],
  ['CensysInspect', 'monitoring', /censysinspect/i],
  ['BitSightBot', 'monitoring', /bitsightbot/i],
  ['zgrab', 'monitoring', /zgrab/i],
  ['Nmap', 'monitoring', /nmap scripting engine/i],
  ['Stripe', 'monitoring', /stripe\/1\.0|stripebot|merchantsecurityscanner/i],

  // scripted browsers
  ['HeadlessChrome', 'headless_browser', /headlesschrome/i],
  ['PhantomJS', 'headless_browser', /phantomjs/i],
  ['SlimerJS', 'headless_browser', /slimerjs/i],
  ['Playwright', 'headless_browser', /playwright/i],
  ['Puppeteer', 'headless_browser', /puppeteer/i],
  ['Selenium', 'headless_browser', /selenium/i],
  ['Cypress', 'headless_browser', /cypress/i],
  ['Lightpanda', 'headless_browser', /lightpanda/i],
  ['wkhtmltopdf', 'headless_browser', /wkhtmltopdf/i],

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
  ['Google-Apps-Script', 'http_client', /google-apps-script/i],
  ['GoogleDocs', 'http_client', /googledocs/i],
] as const satisfies readonly (readonly [string, BotCategory, RegExp])[];

const botishToken =
  /\b([\w.-]*?(?:bot|crawler|spider|scraper|fetcher|agent|preview|checker|monitor)[\w-]*)\b/i;
const botishWord = /^(?:bot|crawler|spider|scraper|fetcher|agent|preview|checker|monitor)$/i;
const compatibleToken = /compatible;\s*([a-z][\w.-]*(?: [a-z][\w.-]*)?)/i;
const productTokens = /([a-z][\w.-]*)\/\d/gi;
const browserToken =
  /^(?:mozilla|applewebkit|khtml|gecko|chrome|chromium|safari|version|mobile|firefox|edg|edge|opr|msie|trident)$/i;

/**
 * A name for a bot that is not in the named table, from the first of: a token that sounds like
 * one (`Bytespider`, `ABEvalBot`), the name after `compatible;` (`Google-Read-Aloud`), a product
 * token that is not a browser's (`Barkrowler/0.5`), what the generic pattern matched. URLs and
 * email addresses are dropped first, as nearly every crawler links its docs.
 */
export function nameOfUnknownBot(userAgent: string, matched: string): string {
  const text = userAgent
    .replace(/\+?https?:\/\/\S+/gi, ' ')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, ' ');

  const botish = botishToken.exec(text)?.[1];
  if (botish && !botishWord.test(botish)) return botish.slice(0, 64);

  const compatible = compatibleToken.exec(text)?.[1];
  if (compatible && !browserToken.test(compatible)) return compatible.slice(0, 64);

  for (const [, product] of text.matchAll(productTokens)) {
    if (!browserToken.test(product)) return product.slice(0, 64);
  }

  return matched.replace(/^\W+|\W+$/g, '').slice(0, 64) || 'unknown';
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

  const generic = userAgent ? GENERIC_BOT.exec(userAgent) : null;
  const unknownName = generic ? nameOfUnknownBot(userAgent, generic[0]) : null;

  // A scripted browser that says so in its user agent takes that name, else it is just WebDriver.
  if (tags.webdriver === true) {
    return { is_bot: true, bot_name: unknownName ?? 'WebDriver', bot_category: 'headless_browser' };
  }

  if (unknownName) return { is_bot: true, bot_name: unknownName, bot_category: 'other' };

  if (!userAgent)
    return { is_bot: true, bot_name: '(no user agent)', bot_category: 'no_user_agent' };

  return NOT_A_BOT;
}
