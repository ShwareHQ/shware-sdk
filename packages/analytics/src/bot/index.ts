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
 * (Sogou's browser against its spider, Pinterest's in-app browser against its bot); see
 * `index.test.ts` for where to get them.
 *
 * The link above each entry is the operator's page about the bot, else its product page, else
 * its Known Agents profile (knownagents.com, formerly Dark Visitors) when the operator has none.
 *
 * Names are the operators' spelling of their user agent token. Order matters where one token
 * contains another or borrows a name: advertising and SEO tools come before the search engines
 * whose names they carry, and the more specific of Meta's, Anthropic's and Perplexity's tokens
 * come first. The long tail is left to the generic pattern, filed as `other` and named by
 * `nameOfUnknownBot`; add a bot here when it is worth its own category or name in a dashboard.
 */
export const NAMED_BOTS = [
  // advertising: before the search crawlers, AdsBot and Mediapartners carry Google's name
  // https://developers.facebook.com/docs/sharing/webmasters/web-crawlers
  ['Meta-ExternalAds', 'advertising', /meta-externalads/i],
  // https://developers.facebook.com/docs/sharing/webmasters/web-crawlers
  ['facebookcatalog', 'advertising', /facebookcatalog/i],
  // https://developers.google.com/crawling/docs/crawlers-fetchers/google-special-case-crawlers
  ['AdsBot-Google', 'advertising', /adsbot-google/i],
  // https://developers.google.com/crawling/docs/crawlers-fetchers/google-special-case-crawlers
  ['Mediapartners-Google', 'advertising', /mediapartners-google/i],
  // https://www.bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0
  ['AdIdxBot', 'advertising', /adidxbot/i],
  // https://support.google.com/adwords/answer/2404197
  ['Google-AdWords', 'advertising', /google-adwords/i],
  // https://support.google.com/google-ads/answer/6095821
  ['Google-Ads-Conversions', 'advertising', /google-ads-conversions/i],
  // https://developers.openai.com/api/docs/bots
  ['OAI-AdsBot', 'advertising', /oai-adsbot/i],
  // https://businesshelp.snapchat.com/s/article/adsbot-crawler
  ['SnapchatAds', 'advertising', /snapchatads/i],
  // https://www.taboola.com
  ['Taboolabot', 'advertising', /taboolabot/i],

  // AI assistants and agents: a person asked for this page
  // https://developers.openai.com/api/docs/bots
  ['ChatGPT-User', 'ai_assistant', /chatgpt-user/i],
  // https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler
  ['Claude-User', 'ai_assistant', /claude-user/i],
  // https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler
  ['Claude-Web', 'ai_assistant', /claude-web/i],
  // https://docs.perplexity.ai/guides/bots
  ['Perplexity-User', 'ai_assistant', /perplexity-user/i],
  // https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot
  ['DuckAssistBot', 'ai_assistant', /duckassistbot/i],
  // https://developers.facebook.com/docs/sharing/webmasters/web-crawlers
  ['Meta-ExternalFetcher', 'ai_assistant', /meta-externalfetcher/i],
  // https://docs.mistral.ai/robots
  ['MistralAI-User', 'ai_assistant', /mistralai-user/i],
  // https://knownagents.com/agents/manus-user
  ['Manus-User', 'ai_assistant', /manus-user/i],
  // https://knownagents.com/agents/shap-user
  ['Shap-User', 'ai_assistant', /shap-user/i],
  // https://quillbot.com
  ['QuillBot', 'ai_assistant', /quillbot/i],
  // https://developer.amazon.com/amazonbot
  ['Amzn-User', 'ai_assistant', /amzn-user/i],
  // https://knownagents.com/agents/amazon-qbusiness
  ['amazon-QBusiness', 'ai_assistant', /amazon-qbusiness/i],
  // https://docs.aws.amazon.com/bedrock-agentcore/
  ['Amazon-Bedrock-AgentCore-Browser', 'ai_assistant', /amazon-bedrock-agentcore/i],
  // https://developers.google.com/crawling/docs/crawlers-fetchers/google-user-triggered-fetchers
  ['Google-Agent', 'ai_assistant', /google-?agent/i],
  // https://gemini.google/overview/deep-research/
  ['Gemini-Deep-Research', 'ai_assistant', /gemini-deep-research/i],
  // https://developers.google.com/crawling/docs/crawlers-fetchers/google-user-triggered-fetchers
  ['Google-NotebookLM', 'ai_assistant', /google-notebooklm/i],
  // https://www.kimi.ai/policies/kimi-crawlers
  ['Kimi-User', 'ai_assistant', /kimi-(?:user|agent)/i],
  // https://knownagents.com/agents/tongyibot
  ['TongyiBot', 'ai_assistant', /tongyibot/i],
  // https://knownagents.com/agents/yiyanbot
  ['YiyanBot', 'ai_assistant', /yiyanbot/i],
  // https://help.kagi.com/kagi/ai/kagi-ai.html
  ['kagi-fetcher', 'ai_assistant', /kagi-fetcher/i],
  // https://devin.ai
  ['Devin', 'ai_assistant', /\bdevin\/\d/i],
  // https://knownagents.com/agents/novaact
  ['NovaAct', 'ai_assistant', /novaact/i],

  // AI search
  // https://developers.openai.com/api/docs/bots
  ['OAI-SearchBot', 'ai_search', /oai-searchbot/i],
  // https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler
  ['Claude-SearchBot', 'ai_search', /claude-searchbot/i],
  // https://docs.perplexity.ai/guides/bots
  ['PerplexityBot', 'ai_search', /perplexitybot/i],
  // https://developers.facebook.com/docs/sharing/webmasters/web-crawlers
  ['Meta-WebIndexer', 'ai_search', /meta-webindexer/i],
  // https://developer.amazon.com/amazonbot
  ['Amazonbot', 'ai_search', /amazonbot/i],
  // https://knownagents.com/agents/youbot
  ['YouBot', 'ai_search', /youbot/i],
  // https://knownagents.com/agents/phindbot
  ['PhindBot', 'ai_search', /phindbot/i],
  // https://developer.amazon.com/amazonbot
  ['Amzn-SearchBot', 'ai_search', /amzn-searchbot/i],
  // https://knownagents.com/agents/azureai-searchbot
  ['AzureAI-SearchBot', 'ai_search', /azureai-searchbot/i],
  // https://www.kimi.ai/policies/kimi-crawlers
  ['Kimi-SearchBot', 'ai_search', /kimi-searchbot/i],
  // https://docs.mistral.ai/robots
  ['MistralAI-Index', 'ai_search', /mistralai-index/i],
  // https://knownagents.com/agents/exasearchbot
  ['ExaSearchBot', 'ai_search', /exasearchbot|\bexabot/i],
  // https://knownagents.com/agents/tavilybot
  ['TavilyBot', 'ai_search', /tavilybot/i],
  // https://linkup.so/bot
  ['LinkupBot', 'ai_search', /linkupbot/i],
  // https://knownagents.com/agents/iaskspider
  ['iAskBot', 'ai_search', /iask(?:bot|spider)/i],
  ['Andibot', 'ai_search', /andibot/i],
  // https://developers.cloudflare.com/autorag
  ['Cloudflare-AutoRAG', 'ai_search', /cloudflare-autorag/i],
  // https://docs.parallel.ai/resources/crawler
  ['ShapBot', 'ai_search', /shapbot/i],

  // AI training
  // https://developers.openai.com/api/docs/bots
  ['GPTBot', 'ai_crawler', /gptbot/i],
  // https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler
  ['ClaudeBot', 'ai_crawler', /claudebot/i],
  // https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler
  ['anthropic-ai', 'ai_crawler', /anthropic-ai/i],
  // https://developers.facebook.com/docs/sharing/webmasters/web-crawlers
  ['Meta-ExternalAgent', 'ai_crawler', /meta-externalagent/i],
  // https://developers.facebook.com/docs/sharing/webmasters/web-crawlers
  ['FacebookBot', 'ai_crawler', /facebookbot/i],
  // https://knownagents.com/agents/bytespider
  ['Bytespider', 'ai_crawler', /bytespider/i],
  // https://commoncrawl.org/ccbot
  ['CCBot', 'ai_crawler', /ccbot/i],
  // https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers
  ['Google-CloudVertexBot', 'ai_crawler', /google-cloudvertexbot/i],
  // https://knownagents.com/agents/cohere-training-data-crawler
  ['cohere-ai', 'ai_crawler', /cohere-(?:ai|training-data-crawler)/i],
  // https://www.diffbot.com/docs/crawl/faq/robots-txt
  ['Diffbot', 'ai_crawler', /diffbot/i],
  // https://knownagents.com/agents/webzio-extended
  ['Omgili', 'ai_crawler', /omgili|webzio-extended/i],
  // https://imagesift.com/about
  ['ImagesiftBot', 'ai_crawler', /imagesiftbot/i],
  // https://www.timpi.io
  ['Timpibot', 'ai_crawler', /timpibot/i],
  // https://knownagents.com/agents/ai2bot
  ['AI2Bot', 'ai_crawler', /ai2bot/i],
  // https://knownagents.com/agents/pangubot
  ['PanguBot', 'ai_crawler', /pangubot/i],
  // https://knownagents.com/agents/promptingbot
  ['PromptingBot', 'ai_crawler', /promptingbot/i],
  // https://knownagents.com/agents/reflectionbot
  ['Reflectionbot', 'ai_crawler', /reflectionbot/i],
  // https://knownagents.com/agents/tiktokspider
  ['TikTokSpider', 'ai_crawler', /tiktokspider/i],
  // https://knownagents.com/agents/deepseekbot
  ['DeepSeekBot', 'ai_crawler', /deepseekbot/i],
  // https://knownagents.com/agents/doubaobot
  ['DoubaoBot', 'ai_crawler', /doubaobot/i],
  // https://knownagents.com/agents/erniebot
  ['ERNIEBot', 'ai_crawler', /erniebot/i],
  // https://knownagents.com/agents/qwenbot
  ['QwenBot', 'ai_crawler', /qwenbot/i],
  // https://www.kimi.ai/policies/kimi-crawlers
  ['KimiBot', 'ai_crawler', /kimibot/i],
  // https://knownagents.com/agents/chatglm-spider
  ['ChatGLM-Spider', 'ai_crawler', /chatglm-spider/i],
  // https://docs.mistral.ai/robots
  ['MistralAI-Training', 'ai_crawler', /mistralai-training/i],
  // https://knownagents.com/agents/yandexadditional
  ['YandexAdditional', 'ai_crawler', /yandexadditional/i],
  // https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers
  ['Google-Extended', 'ai_crawler', /google-extended/i],
  // https://docs.aws.amazon.com/kendra/latest/dg/what-is-kendra.html
  ['Amazon Kendra', 'ai_crawler', /amazon-kendra|kendrabot/i],
  // https://knownagents.com/agents/bedrockbot
  ['bedrockbot', 'ai_crawler', /bedrockbot/i],
  // https://brightdata.com/brightbot
  ['Brightbot', 'ai_crawler', /brightbot/i],
  // https://firecrawl.dev
  ['FirecrawlAgent', 'ai_crawler', /firecrawl/i],
  // https://github.com/unclecode/crawl4ai
  ['Crawl4AI', 'ai_crawler', /crawl4ai/i],
  // https://apify.com/apify/website-content-crawler
  ['ApifyBot', 'ai_crawler', /apify/i],
  // https://github.com/rom1504/img2dataset
  ['img2dataset', 'ai_crawler', /img2dataset/i],
  // https://knownagents.com/agents/laion-huggingface-processor
  ['LAION', 'ai_crawler', /laion/i],
  // https://developers.cloudflare.com/browser-rendering/
  ['Cloudflare Browser Rendering', 'ai_crawler', /cloudflarebrowserrendering/i],

  // link previews
  // https://developers.facebook.com/docs/sharing/webmasters/web-crawlers
  ['facebookexternalhit', 'link_preview', /facebookexternalhit/i],
  // https://developers.facebook.com/docs/sharing/webmasters/web-crawlers
  ['Facebot', 'link_preview', /facebot/i],
  // https://developer.x.com/en/docs/x-for-websites/cards/guides/getting-started
  ['Twitterbot', 'link_preview', /twitterbot/i],
  // https://www.linkedin.com/help/linkedin/answer/a521928
  ['LinkedInBot', 'link_preview', /linkedinbot/i],
  // https://api.slack.com/robots
  ['Slackbot', 'link_preview', /slackbot|slack-imgproxy/i],
  // https://discord.com
  ['Discordbot', 'link_preview', /discordbot/i],
  // https://core.telegram.org/bots
  ['TelegramBot', 'link_preview', /telegrambot/i],
  // https://www.whatsapp.com
  ['WhatsApp', 'link_preview', /^whatsapp\//i],
  // https://www.pinterest.com/bot.html
  ['Pinterestbot', 'link_preview', /pinterestbot|^pinterest\/0\./i],
  // https://www.reddit.com
  ['redditbot', 'link_preview', /redditbot/i],
  // https://developers.snap.com/robots
  ['Snap URL Preview', 'link_preview', /snap url preview/i],
  // https://knownagents.com/agents/skypeuripreview
  ['SkypeUriPreview', 'link_preview', /skypeuripreview/i],
  // https://www.bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0
  ['BingPreview', 'link_preview', /bingpreview|microsoftpreview/i],
  // https://iframely.com/docs/about
  ['Iframely', 'link_preview', /iframely/i],
  // https://embed.ly
  ['Embedly', 'link_preview', /embedly/i],
  // https://devtalk.kakao.com/t/scrap/33984
  ['KakaoTalk-scrap', 'link_preview', /kakaotalk-scrap/i],
  // https://vk.com/dev/Share
  ['vkShare', 'link_preview', /vkshare/i],
  // https://www.viber.com
  ['Viber', 'link_preview', /^viber\b|viber-crawler/i],
  // https://github.com/bluesky-social/indigo
  ['Bluesky Cardyb', 'link_preview', /cardyb/i],
  // https://developers.google.com/crawling/docs/crawlers-fetchers/google-user-triggered-fetchers
  ['Google-PageRenderer', 'link_preview', /google-pagerenderer/i],
  // https://vercel.com
  ['vercel-screenshot', 'link_preview', /vercel-screenshot/i],

  // SEO, marketing and page-speed tools; before the search crawlers, Lighthouse and the
  // Search Console tester borrow Google's name
  // https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers
  ['Google-InspectionTool', 'seo_tool', /google-inspectiontool/i],
  // https://developer.chrome.com/docs/lighthouse
  ['Lighthouse', 'seo_tool', /chrome-lighthouse|google page speed insights/i],
  // https://gtmetrix.com
  ['GTmetrix', 'seo_tool', /gtmetrix/i],
  // https://ahrefs.com/robot
  ['AhrefsBot', 'seo_tool', /ahrefs(?:bot|siteaudit)/i],
  // https://www.semrush.com/bot/
  ['SemrushBot', 'seo_tool', /semrush/i],
  // https://mj12bot.com
  ['MJ12bot', 'seo_tool', /mj12bot/i],
  // https://moz.com/help/moz-procedures/crawlers/dotbot
  ['DotBot', 'seo_tool', /dotbot/i],
  // https://moz.com/help/moz-procedures/crawlers/rogerbot
  ['rogerbot', 'seo_tool', /rogerbot/i],
  // https://www.screamingfrog.co.uk/seo-spider/
  ['Screaming Frog', 'seo_tool', /screaming frog/i],
  // https://serpstatbot.com
  ['SerpstatBot', 'seo_tool', /serpstatbot/i],
  // https://webmeup-crawler.com
  ['BLEXBot', 'seo_tool', /blexbot/i],
  // https://dataforseo.com/dataforseo-bot
  ['DataForSeoBot', 'seo_tool', /dataforseobot/i],
  // https://knownagents.com/agents/hubspot-crawler
  ['HubSpot', 'seo_tool', /hubspot/i],
  // https://search.google.com/structured-data/testing-tool
  ['Google-Structured-Data-Testing-Tool', 'seo_tool', /google-structured-data-testing-tool/i],
  // https://www.webpagetest.org
  ['WebPageTest', 'seo_tool', /\bptst\/\d/i],
  // https://www.dareboost.com
  ['DareBoost', 'seo_tool', /dareboost/i],
  // https://www.exensa.com/crawl
  ['Barkrowler', 'seo_tool', /barkrowler/i],
  // https://seranking.com/backlinks-crawler
  ['SE Ranking', 'seo_tool', /seranking|sebot-wa/i],
  // https://www.brightedge.com
  ['BrightEdge', 'seo_tool', /brightedge/i],
  // https://searchatlas.com
  ['SearchAtlas', 'seo_tool', /searchatlas/i],
  // https://www.siteimprove.com
  ['Siteimprove', 'seo_tool', /siteimprove/i],
  // https://www.dataprovider.com
  ['Dataprovider', 'seo_tool', /dataprovider\.com/i],
  // https://www.meltwater.com
  ['Meltwater', 'seo_tool', /meltwater/i],
  // https://awario.com/bots.html
  ['Awario', 'seo_tool', /awario/i],

  // search engines
  // https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers
  ['Googlebot', 'search_crawler', /googlebot/i],
  // https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers
  ['Storebot-Google', 'search_crawler', /storebot-google/i],
  // https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers
  ['GoogleOther', 'search_crawler', /googleother/i],
  // https://www.bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0
  ['Bingbot', 'search_crawler', /bingbot/i],
  // https://support.apple.com/en-us/119829
  ['Applebot', 'search_crawler', /applebot/i],
  // https://www.baidu.com/search/spider.html
  ['Baiduspider', 'search_crawler', /baiduspider/i],
  // https://yandex.com/support/webmaster/robot-workings/check-yandex-robots.html
  ['YandexBot', 'search_crawler', /yandex(?:\w*bot|images|metrika)/i],
  // https://duckduckgo.com/duckduckgo-help-pages/results/duckduckbot
  ['DuckDuckBot', 'search_crawler', /duckduckbot/i],
  // https://help.yahoo.com/kb/SLN22600.html
  ['Yahoo Slurp', 'search_crawler', /yahoo!?[\s/]*slurp/i],
  // https://www.sogou.com/docs/help/webmasters.htm#07
  ['Sogou', 'search_crawler', /sogou[\w\s-]*spider/i],
  // https://www.so.com/help/help_3_2.html
  ['360Spider', 'search_crawler', /360spider|haosouspider/i],
  // https://knownagents.com/agents/yisouspider
  ['YisouSpider', 'search_crawler', /yisouspider/i],
  // https://webmaster.petalsearch.com/site/petalbot
  ['PetalBot', 'search_crawler', /petalbot/i],
  // https://napoveda.seznam.cz/en/seznambot-intro/
  ['SeznamBot', 'search_crawler', /seznambot/i],
  // https://knownagents.com/agents/yeti
  ['Yeti', 'search_crawler', /\byeti\//i],
  // https://help2.line.me/linesearchbot/web/?contentId=50006055&lang=en
  ['Linespider', 'search_crawler', /linespider/i],
  // https://help.qwant.com/bot/
  ['Qwantbot', 'search_crawler', /qwant(?:bot|ify)/i],
  // https://help.coccoc.com/searchengine
  ['coccocbot', 'search_crawler', /coccocbot/i],
  // https://www.mojeek.com/bot.html
  ['MojeekBot', 'search_crawler', /mojeekbot/i],
  // https://search.brave.com/help/brave-search-crawler
  ['Bravebot', 'search_crawler', /bravebot/i],
  // https://bot.seekport.com
  ['SeekportBot', 'search_crawler', /seekport/i],
  // https://mwmbl.org
  ['mwmbl', 'search_crawler', /mwmbl/i],
  // https://archive.org/details/archive.org_bot
  ['Internet Archive', 'search_crawler', /archive\.org_bot|ia_archiver|archive-it|archiveteam/i],

  // monitoring, synthetics, security and consent scanners, service callers
  // https://www.pingdom.com
  ['Pingdom', 'monitoring', /pingdom/i],
  // https://uptimerobot.com
  ['UptimeRobot', 'monitoring', /uptimerobot/i],
  // https://www.statuscake.com
  ['StatusCake', 'monitoring', /statuscake/i],
  // https://www.site24x7.com
  ['Site24x7', 'monitoring', /site24x7/i],
  // https://betterstack.com/docs/uptime/
  ['Better Stack', 'monitoring', /better ?uptime|betterstack/i],
  // https://docs.datadoghq.com/synthetics/
  ['Datadog', 'monitoring', /datadog/i],
  // https://www.checklyhq.com/docs/
  ['Checkly', 'monitoring', /checkly/i],
  // https://docs.newrelic.com/docs/synthetics/
  ['NewRelicPinger', 'monitoring', /newrelicpinger/i],
  // https://github.com/louislam/uptime-kuma
  ['Uptime-Kuma', 'monitoring', /uptime-kuma/i],
  // https://grafana.com/docs/grafana-cloud/testing/synthetic-monitoring/
  ['Grafana Synthetic Monitoring', 'monitoring', /grafanasyntheticmonitoring/i],
  // https://docs.dynatrace.com/docs/observe/digital-experience/synthetic-monitoring
  ['Dynatrace', 'monitoring', /ruxitsynthetic|dynatrace/i],
  // https://docs.splunk.com/observability/en/synthetics/intro-synthetics.html
  ['Splunk', 'monitoring', /splunk/i],
  // https://www.catchpoint.com
  ['Catchpoint', 'monitoring', /catchpoint/i],
  // https://ghostinspector.com
  ['Ghost Inspector', 'monitoring', /ghost inspector/i],
  // https://docs.digitalocean.com/products/uptime/
  ['DigitalOcean Uptime', 'monitoring', /digitalocean uptime/i],
  // https://ohdear.app/docs/faq/what-is-the-oh-dear-checker
  ['OhDear', 'monitoring', /ohdear/i],
  // https://developers.google.com/crawling/docs/crawlers-fetchers/google-special-case-crawlers
  ['Google-Safety', 'monitoring', /google-safety/i],
  // https://www.cookiebot.com
  ['Cookiebot', 'monitoring', /cookiebot/i],
  // https://knownagents.com/agents/onetrust-cmp-scanner
  ['OneTrust', 'monitoring', /onetrust/i],
  // https://www.cookiehub.com
  ['CookieHub', 'monitoring', /cookiehub/i],
  // https://detectify.com/bot/
  ['Detectify', 'monitoring', /detectify/i],
  // https://about.censys.io
  ['CensysInspect', 'monitoring', /censysinspect/i],
  // https://www.bitsight.com
  ['BitSightBot', 'monitoring', /bitsightbot/i],
  // https://github.com/zmap/zgrab2
  ['zgrab', 'monitoring', /zgrab/i],
  // https://nmap.org/book/nse.html
  ['Nmap', 'monitoring', /nmap scripting engine/i],
  // https://docs.stripe.com/webhooks
  ['Stripe', 'monitoring', /stripe\/1\.0|stripebot|merchantsecurityscanner/i],

  // scripted browsers
  // https://developer.chrome.com/docs/chromium/headless
  ['HeadlessChrome', 'headless_browser', /headlesschrome/i],
  // https://phantomjs.org
  ['PhantomJS', 'headless_browser', /phantomjs/i],
  // https://slimerjs.org
  ['SlimerJS', 'headless_browser', /slimerjs/i],
  // https://playwright.dev
  ['Playwright', 'headless_browser', /playwright/i],
  // https://pptr.dev
  ['Puppeteer', 'headless_browser', /puppeteer/i],
  // https://www.selenium.dev
  ['Selenium', 'headless_browser', /selenium/i],
  // https://www.cypress.io
  ['Cypress', 'headless_browser', /cypress/i],
  // https://lightpanda.io
  ['Lightpanda', 'headless_browser', /lightpanda/i],
  // https://wkhtmltopdf.org
  ['wkhtmltopdf', 'headless_browser', /wkhtmltopdf/i],

  // libraries and command-line clients
  // https://curl.se
  ['curl', 'http_client', /^curl\//i],
  // https://www.gnu.org/software/wget/
  ['Wget', 'http_client', /^wget\//i],
  // https://requests.readthedocs.io
  ['python-requests', 'http_client', /python-requests/i],
  // https://docs.python.org/3/library/urllib.request.html
  ['python-urllib', 'http_client', /python-urllib/i],
  // https://docs.aiohttp.org
  ['aiohttp', 'http_client', /aiohttp/i],
  // https://www.python-httpx.org
  ['httpx', 'http_client', /python-httpx|^httpx\//i],
  // https://scrapy.org
  ['Scrapy', 'http_client', /scrapy/i],
  // https://pkg.go.dev/net/http
  ['Go-http-client', 'http_client', /go-http-client/i],
  // https://github.com/square/okhttp
  ['okhttp', 'http_client', /^okhttp\//i],
  // https://hc.apache.org/httpcomponents-client-5.5.x/
  ['Java', 'http_client', /^java\/|apache-httpclient/i],
  // https://axios-http.com
  ['axios', 'http_client', /^axios\//i],
  // https://github.com/node-fetch/node-fetch
  ['node-fetch', 'http_client', /node-fetch/i],
  // https://undici.nodejs.org
  ['undici', 'http_client', /^undici/i],
  // https://www.postman.com
  ['PostmanRuntime', 'http_client', /postmanruntime/i],
  // https://insomnia.rest
  ['insomnia', 'http_client', /^insomnia\//i],
  // https://metacpan.org/pod/LWP
  ['libwww-perl', 'http_client', /libwww-perl/i],
  // https://docs.guzzlephp.org
  ['Guzzle', 'http_client', /guzzlehttp/i],
  // https://developers.google.com/apps-script/reference/url-fetch
  ['Google-Apps-Script', 'http_client', /google-apps-script/i],
  // https://support.google.com/docs/answer/3093339
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
 * The request user agent of a page opened in Facebook's or Instagram's in-app browser when the
 * app sends the page's requests through its own network stack: `[FBAN/FB4A;FBAV/…]`,
 * `Instagram 445.0.0.34.44 (iPhone18,1; iOS 26_6_1; …) AppleWebKit/420+`. The page itself still
 * reads a browser's `navigator.userAgent`, which is why PostHog, GA4 and Matomo see a person.
 * isbot's generic pattern takes both for bots (a long token with no space, a product token that is
 * no browser's), so they are people here before it runs. Meta's ad prefetch loads only the HTML,
 * which runs no script and creates no visitor. The in-app browser's own user agent starts with
 * `Mozilla/5.0`, so the anchors leave it alone.
 */
const META_APP = /^\[FBAN\/|^Instagram \d+(?:\.\d+)+ \(/;

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
 * gives); a person in a Meta app (`META_APP`); anything the generic pattern calls automated; no
 * user agent at all.
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

  if (META_APP.test(userAgent)) return NOT_A_BOT;

  if (unknownName) return { is_bot: true, bot_name: unknownName, bot_category: 'other' };

  if (!userAgent)
    return { is_bot: true, bot_name: '(no user agent)', bot_category: 'no_user_agent' };

  return NOT_A_BOT;
}
