/**
 * The cases here are picked from larger sets of real user agents. Run `botOf` over the full sets
 * when the named table or the vendored isbot patterns change, and add a case here for anything it
 * gets wrong:
 *
 * - crawler-user-agents: ~1,500 bot patterns, each with real user agents (`instances`)
 *   https://raw.githubusercontent.com/monperrus/crawler-user-agents/master/crawler-user-agents.json
 * - PostHog's bot definitions and the user agents its tests classify
 *   https://github.com/PostHog/posthog/blob/master/products/web_analytics/backend/hogql_queries/bot_definitions.py
 *   https://github.com/PostHog/posthog/blob/master/products/web_analytics/backend/hogql_queries/bot_ua_fixtures.py
 * - ai.robots.txt: AI crawlers, assistants and agents by token, with their operators
 *   https://raw.githubusercontent.com/ai-robots-txt/ai.robots.txt/main/robots.json
 * - bowser's acceptance fixtures: real browsers (and a few bots), to catch browsers taken for bots
 *   https://raw.githubusercontent.com/bowser-js/bowser/master/test/acceptance/useragentstrings.yml
 * - isbot's fixtures, the source of the generic pattern
 *   https://github.com/omrilotan/isbot/tree/main/fixtures
 */
import { describe, expect, it } from 'vitest';
import { BOT_CATEGORIES, NAMED_BOTS, NOT_A_BOT, botOf, nameOfUnknownBot } from './index';

const web = (user_agent: string, extra: Record<string, unknown> = {}) =>
  botOf({ user_agent, ...extra });

describe('botOf: people', () => {
  it.each([
    [
      'Chrome on Windows',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    ],
    [
      'Safari on iPhone',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
    ],
    [
      'Firefox on macOS',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:139.0) Gecko/20100101 Firefox/139.0',
    ],
    [
      'Edge',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 Edg/145.0.0.0',
    ],
    [
      'Samsung Internet',
      'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
    ],
    [
      'Facebook in-app',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22F76 [FBAN/FBIOS;FBAV/512.0.0.43.109;FBBV/735127489;FBDV/iPhone15,3;FBMD/iPhone;FBSN/iOS;FBSV/18.5;FBSS/3;FBCR/;FBID/phone;FBLC/en_US;FBOP/80]',
    ],
    [
      'Instagram in-app',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/127.0.6533.103 Mobile Safari/537.36 Instagram 343.0.0.33.101 Android (34/14; 420dpi; 1080x2400; Google/google; Pixel 8; shiba; shiba; en_US; 628014231)',
    ],
    [
      'WeChat in-app',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.50(0x1800322b) NetType/WIFI Language/zh_CN',
    ],
    [
      'TikTok in-app',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_36.5.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/en Region/US ByteFullLocale/en isDarkMode/0 WKWebView/1 BytedanceWebview/d8a21c6',
    ],
    [
      'Google app',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/370.0.765409498 Mobile/15E148 Safari/604.1',
    ],
    [
      'LinkedIn in-app',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.30.1',
    ],
    [
      'Pinterest in-app',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [Pinterest/iOS]',
    ],
    [
      'Snapchat in-app',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Snapchat/13.50.0.43 (like Safari/8621.2.5.10.8, panda)',
    ],
    [
      'Sogou browser',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 12_4_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 SogouMobileBrowser/5.22.1',
    ],
  ])('%s is a person', (_, userAgent) => {
    expect(web(userAgent)).toEqual(NOT_A_BOT);
  });

  it('calls an HTTP library a bot, which is why native visitors are not judged', () => {
    expect(web('okhttp/4.12.0')).toMatchObject({ bot_name: 'okhttp', bot_category: 'http_client' });
  });
});

describe('botOf: named bots', () => {
  it.each([
    [
      'meta-externalads/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)',
      'Meta-ExternalAds',
      'advertising',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 (compatible; meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler))',
      'Meta-ExternalAgent',
      'ai_crawler',
    ],
    [
      'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Googlebot',
      'search_crawler',
    ],
    [
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/145.0.0.0 Safari/537.36',
      'Bingbot',
      'search_crawler',
    ],
    ['AdsBot-Google (+http://www.google.com/adsbot.html)', 'AdsBot-Google', 'advertising'],
    [
      'Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)',
      'Bytespider',
      'ai_crawler',
    ],
    [
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/150.0.0.0 Safari/537.36',
      'HeadlessChrome',
      'headless_browser',
    ],
    [
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot',
      'OAI-SearchBot',
      'ai_search',
    ],
    [
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
      'ChatGPT-User',
      'ai_assistant',
    ],
    [
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
      'ClaudeBot',
      'ai_crawler',
    ],
    [
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)',
      'Claude-User',
      'ai_assistant',
    ],
    [
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; HubSpot Crawler; +https://www.hubspot.com) Chrome/139.0.0.0 Safari/537.36',
      'HubSpot',
      'seo_tool',
    ],
    [
      'Sogou web spider/4.0(+http://www.sogou.com/docs/help/webmasters.htm#07)',
      'Sogou',
      'search_crawler',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Chrome-Lighthouse',
      'Lighthouse',
      'seo_tool',
    ],
    [
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'facebookexternalhit',
      'link_preview',
    ],
    ['WhatsApp/2.23.20.0', 'WhatsApp', 'link_preview'],
    [
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; OAI-AdsBot/1.0; +https://openai.com/adsbot)',
      'OAI-AdsBot',
      'advertising',
    ],
    [
      'Mozilla/5.0 (compatible; DeepSeekBot/1.0; +https://www.deepseek.com/bot)',
      'DeepSeekBot',
      'ai_crawler',
    ],
    [
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko; compatible; Google-Agent)',
      'Google-Agent',
      'ai_assistant',
    ],
    ['Pinterest/0.2 (+http://www.pinterest.com/bot.html)', 'Pinterestbot', 'link_preview'],
    ['curl/8.4.0', 'curl', 'http_client'],
    ['python-requests/2.32.3', 'python-requests', 'http_client'],
  ] as const)('%s → %s (%s)', (userAgent, name, category) => {
    expect(web(userAgent)).toEqual({ is_bot: true, bot_name: name, bot_category: category });
  });

  it('keeps the table consistent', () => {
    const names = NAMED_BOTS.map(([name]) => name);
    expect(new Set(names).size).toBe(names.length);
    for (const [, category] of NAMED_BOTS) expect(BOT_CATEGORIES).toContain(category);
  });
});

describe('botOf: the long tail and other signals', () => {
  it('files an unknown bot under other, named after the token that sounds like one', () => {
    expect(
      web(
        'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ABEvalBot/0.1) Version/11.1.2 Safari/605.1.15'
      )
    ).toEqual({ is_bot: true, bot_name: 'ABEvalBot', bot_category: 'other' });
    expect(web('SomeFetcher/2.3')).toEqual({
      is_bot: true,
      bot_name: 'SomeFetcher',
      bot_category: 'other',
    });
  });

  it('takes a WebDriver session for a scripted browser even with a normal user agent', () => {
    const chrome =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';
    expect(web(chrome, { webdriver: true })).toEqual({
      is_bot: true,
      bot_name: 'WebDriver',
      bot_category: 'headless_browser',
    });
    expect(web(`${chrome} ScraperKit/2.1`, { webdriver: true })).toEqual({
      is_bot: true,
      bot_name: 'ScraperKit',
      bot_category: 'headless_browser',
    });
    expect(web(chrome, { webdriver: false })).toEqual(NOT_A_BOT);
  });

  it('calls a web visitor without a user agent a bot', () => {
    expect(botOf({})).toEqual({
      is_bot: true,
      bot_name: '(no user agent)',
      bot_category: 'no_user_agent',
    });
  });

  it('names unknown bots from their user agent', () => {
    expect(
      nameOfUnknownBot(
        'Mozilla/5.0 (compatible; FooCrawler/1.0; +https://foo.example/crawler)',
        'crawl'
      )
    ).toBe('FooCrawler');
    expect(nameOfUnknownBot('Thumbor/7.0', 'thumbor/')).toBe('Thumbor');
    expect(
      nameOfUnknownBot(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/41.0.2272.118 Safari/537.36 (compatible; Google-Read-Aloud; +https://developers.google.com/search/docs/crawling-indexing/read-aloud-user-agent)',
        'google'
      )
    ).toBe('Google-Read-Aloud');
    expect(nameOfUnknownBot('Mozilla/5.0 (compatible; Kangaroo Bot/1.0)', 'bot')).toBe(
      'Kangaroo Bot'
    );
    expect(nameOfUnknownBot('Mozilla/5.0 (compatible)', 'x')).toBe('x');
  });
});
