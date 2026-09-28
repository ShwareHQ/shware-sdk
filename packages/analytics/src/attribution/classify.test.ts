import { describe, expect, it } from 'vitest';
import type { TrackTags } from '../track/types';
import { type TouchRule, channelGroupOf, classifyTouch } from './classify';
import { TOUCH_PRIORITY } from './vocabulary';

const at = (page_location: string, rest: TrackTags = {}): TrackTags => ({ page_location, ...rest });
const own = { ownHosts: [String.raw`(^|\.)shware\.net$`] };

/** A product's referral landing page, `/refer/<code>`: the code is the referrer's. */
const referralLink: TouchRule = (tags) => {
  const code = /^(?:https?:\/\/[^/]+)?\/refer\/([A-Za-z0-9]+)(?:[/?#]|$)/.exec(
    tags.page_location ?? ''
  )?.[1];
  return code
    ? {
        channel: 'referral_program',
        medium: 'referral',
        campaign: code,
        priority: TOUCH_PRIORITY.campaign,
      }
    : null;
};

describe('classifyTouch', () => {
  it('reads a session with nothing to say as direct', () => {
    expect(classifyTouch(at('https://app.shware.net/'))).toEqual({
      channel: '(direct)',
      medium: '(none)',
      channel_group: 'direct',
      campaign: null,
      priority: null,
    });
    expect(classifyTouch({})).toMatchObject({ channel: '(direct)', priority: null });
  });

  it.each([
    [
      { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'brand' },
      'google',
      'cpc',
      'paid_search',
      'brand',
    ],
    [{ utm_source: 'fb', utm_medium: 'paid_social' }, 'meta', 'paid_social', 'paid_social', null],
    [{ utm_source: 'Twitter' }, 'x', '(not set)', 'organic_social', null],
    [{ utm_source: 'linkedin' }, 'linkedin', '(not set)', 'organic_social', null],
    [{ utm_source: 'google ads', utm_medium: 'cpc' }, 'google', 'cpc', 'paid_search', null],
    [
      { utm_source: 'google', utm_medium: 'pmax', utm_campaign: 'pm1' },
      'google',
      'pmax',
      'paid_search',
      'pm1',
    ],
    [
      { utm_source: 'fb', utm_medium: 'facebook_mobile_feed' },
      'meta',
      'facebook_mobile_feed',
      'paid_social',
      null,
    ],
    [
      { utm_source: 'ig', utm_medium: 'Instagram_Reels' },
      'meta',
      'instagram_reels',
      'paid_social',
      null,
    ],
    [{ utm_source: 'an', utm_medium: 'an' }, 'meta', 'an', 'paid_social', null],
    [{ utm_source: 'msg', utm_medium: 'others' }, 'meta', 'others', 'paid_social', null],
    [{ utm_source: 'email', utm_medium: 'promo' }, 'email', 'promo', 'email', null],
    [
      { utm_source: 'instantly', utm_medium: 'outbound email' },
      'instantly',
      'outbound email',
      'email',
      null,
    ],
    [{ utm_source: 'chatgpt.com' }, 'chatgpt', '(not set)', 'organic_ai', null],
    [{ utm_source: 'openai' }, 'chatgpt', '(not set)', 'organic_ai', null],
    [{ utm_source: 'copilot.com' }, 'copilot', '(not set)', 'organic_ai', null],
    [{ utm_source: 'deepseek.com' }, 'deepseek', '(not set)', 'organic_ai', null],
    [
      { utm_source: 'email&utm_medium=promo&utm_campaign=welcome' },
      'email',
      '(not set)',
      'email',
      null,
    ],
    [{ utm_source: 'toolify/' }, 'toolify', '(not set)', 'unassigned', null],
    [
      { utm_source: 'aitoolhunt', utm_medium: 'undefined' },
      'aitoolhunt',
      '(not set)',
      'unassigned',
      null,
    ],
    [{ utm_source: 'newsletter', utm_medium: 'Email' }, 'newsletter', 'email', 'email', null],
    [
      { utm_source: 'partner-x', utm_medium: 'affiliate' },
      'partner-x',
      'affiliate',
      'affiliate',
      null,
    ],
    [{ utm_source: 'google', utm_medium: 'display' }, 'google', 'display', 'display', null],
  ] as const)('%o → %s / %s (%s)', (tags, channel, medium, group, campaign) => {
    expect(classifyTouch(at('https://app.shware.net/', tags as TrackTags))).toEqual({
      channel,
      medium,
      channel_group: group,
      campaign,
      priority: TOUCH_PRIORITY.campaign,
    });
  });

  it('takes a click id as a paid click on its channel, by the key alone', () => {
    expect(classifyTouch({ gclid: 'abc' })).toMatchObject({
      channel: 'google',
      medium: 'cpc',
      channel_group: 'paid_search',
      priority: 1,
    });
    expect(classifyTouch({ fbclid: '' })).toMatchObject({
      channel: 'meta',
      medium: 'cpc',
      channel_group: 'paid_social',
    });
    expect(classifyTouch({ ttclid: 'x', utm_medium: 'cpm' })).toMatchObject({
      channel: 'tiktok',
      medium: 'cpm',
    });
  });

  it('reads an ad landing page as that channel', () => {
    expect(classifyTouch(at('https://app.shware.net/lp/meta?fbclid=1'))).toMatchObject({
      channel: 'meta',
      medium: 'cpc',
    });
    expect(classifyTouch(at('/lp/tiktok'))).toMatchObject({
      channel: 'tiktok',
      channel_group: 'paid_social',
      priority: 1,
    });
    expect(classifyTouch(at('https://app.shware.net/lpx/meta'))).toMatchObject({
      channel: '(direct)',
    });
  });

  it.each([
    ['https://www.google.com/', 'google', 'organic', 'organic_search'],
    ['https://www.google.co.uk/search?q=x', 'google', 'organic', 'organic_search'],
    ['https://l.facebook.com/l.php?u=x', 'meta', 'social', 'organic_social'],
    ['https://t.co/abc', 'x', 'social', 'organic_social'],
    ['https://youtu.be/abc', 'youtube', 'video', 'organic_video'],
    ['https://chatgpt.com/', 'chatgpt', 'ai', 'organic_ai'],
    ['https://www.perplexity.ai/search?q=x', 'perplexity', 'ai', 'organic_ai'],
    ['https://gemini.google.com/app', 'gemini', 'ai', 'organic_ai'],
    ['https://copilot.microsoft.com/', 'copilot', 'ai', 'organic_ai'],
    ['https://copilot.com/chats/x', 'copilot', 'ai', 'organic_ai'],
    ['https://grok.com/', 'grok', 'ai', 'organic_ai'],
    ['https://chat.deepseek.com/', 'deepseek', 'ai', 'organic_ai'],
    ['https://www.doubao.com/chat/', 'doubao', 'ai', 'organic_ai'],
    ['https://www.kimi.com/', 'kimi', 'ai', 'organic_ai'],
    ['https://tongyi.aliyun.com/qianwen', 'qwen', 'ai', 'organic_ai'],
    ['https://yuanbao.tencent.com/chat', 'yuanbao', 'ai', 'organic_ai'],
    ['https://yiyan.baidu.com/', 'ernie', 'ai', 'organic_ai'],
    ['https://chatglm.cn/', 'zhipu', 'ai', 'organic_ai'],
    ['https://metaso.cn/', 'metaso', 'ai', 'organic_ai'],
    ['https://www.baidu.com/s?wd=x', 'baidu', 'organic', 'organic_search'],
    ['https://blog.example.com/post', 'blog.example.com', 'referral', 'referral'],
    ['https://Blog.Example.com:8443/post', 'blog.example.com', 'referral', 'referral'],
  ])('referrer %s → %s / %s', (page_referrer, channel, medium, group) => {
    expect(classifyTouch(at('https://app.shware.net/', { page_referrer }))).toEqual({
      channel,
      medium,
      channel_group: group,
      campaign: null,
      priority: TOUCH_PRIORITY.referrer,
    });
  });

  it('does not count a bounce through payment, sign-in or our own hosts as a touch', () => {
    for (const page_referrer of [
      'https://checkout.stripe.com/',
      'https://accounts.google.com/',
      'https://www.shware.net/pricing',
      'http://localhost:3000/',
    ]) {
      expect(classifyTouch(at('https://app.shware.net/', { page_referrer }), own)).toMatchObject({
        channel: '(direct)',
        priority: null,
      });
    }
    // Without the product's hosts, its own site is an ordinary referrer.
    expect(
      classifyTouch(at('https://app.shware.net/', { page_referrer: 'https://www.shware.net/' }))
    ).toMatchObject({ channel: 'www.shware.net' });
  });

  it('lets a campaign tag win over the referrer, a click id over the referrer, and a utm over a click id', () => {
    expect(
      classifyTouch({
        utm_source: 'newsletter',
        utm_medium: 'email',
        page_referrer: 'https://www.google.com/',
      })
    ).toMatchObject({ channel: 'newsletter', medium: 'email' });
    expect(classifyTouch({ gclid: 'x', page_referrer: 'https://www.google.com/' })).toMatchObject({
      channel: 'google',
      medium: 'cpc',
    });
    expect(classifyTouch({ utm_source: 'newsletter', fbclid: 'x' })).toMatchObject({
      channel: 'newsletter',
      medium: '(not set)',
    });
  });

  it('tries the product rules after the campaign rules and before the referrer', () => {
    const options = { ...own, rules: [referralLink] };
    expect(
      classifyTouch(
        at('https://app.shware.net/refer/AB12cd?x=1', { page_referrer: 'https://l.facebook.com/' }),
        options
      )
    ).toEqual({
      channel: 'referral_program',
      medium: 'referral',
      channel_group: 'referral',
      campaign: 'AB12cd',
      priority: TOUCH_PRIORITY.campaign,
    });
    // A tagged referral link: the utm names the channel, the code stays as the campaign.
    expect(
      classifyTouch(at('https://app.shware.net/refer/AB12cd', { utm_source: 'whatsapp' }), options)
    ).toMatchObject({ channel: 'whatsapp', medium: '(not set)', campaign: 'AB12cd' });
    expect(
      classifyTouch(
        at('https://app.shware.net/refer/AB12cd', { utm_source: 'google', utm_campaign: 'brand' }),
        options
      )
    ).toMatchObject({ channel: 'google', campaign: 'brand' });
    // The page that talks about the programme is not a referral link.
    expect(
      classifyTouch(
        at('https://app.shware.net/referral/', { page_referrer: 'https://www.google.com/' }),
        options
      )
    ).toMatchObject({ channel: 'google', medium: 'organic' });
  });
});

describe('channelGroupOf', () => {
  it.each([
    ['(direct)', '(none)', 'direct'],
    ['google', 'cpc', 'paid_search'],
    ['meta', 'paid_social', 'paid_social'],
    ['meta', 'cpm', 'paid_social'],
    ['newsletter', 'ppc', 'paid_other'],
    ['google', 'organic', 'organic_search'],
    ['meta', 'social', 'organic_social'],
    ['youtube', 'video', 'organic_video'],
    ['blog.example.com', 'referral', 'referral'],
    ['google', 'banner', 'display'],
    ['newsletter', 'e-mail', 'email'],
    ['partner', 'affiliate', 'affiliate'],
    ['x', '(not set)', 'organic_social'],
    ['google', '(not set)', 'organic_search'],
    ['chatgpt', '(not set)', 'organic_ai'],
    ['meta', 'facebook_stories', 'paid_social'],
    ['meta', 'audience_network_classic', 'paid_social'],
    // a hand-tagged organic post is not an ad because of how its medium is spelled
    ['meta', 'facebook_group', 'organic_social'],
    ['meta', 'instagram_bio', 'organic_social'],
    ['meta', 'whatsapp_status', 'paid_social'],
    ['meta', 'threads_feed', 'paid_social'],
    ['meta', '{{placement}}', 'paid_social'],
    ['meta', '(not set)', 'organic_social'],
    ['meta-websitekeyinfo', 'facebook_mobile_feed', 'paid_social'],
    ['copilot', '(not set)', 'organic_ai'],
    ['visiblehands.beehiiv.com', 'newsletter', 'email'],
    ['instantly', 'cold_email', 'email'],
    ['google', 'pmax', 'paid_search'],
    ['email', 'promo', 'email'],
    ['newsletter', 'email_promo', 'email'],
    ['inman', 'articles', 'unassigned'],
    ['th', 'qr', 'unassigned'],
  ] as const)('%s / %s → %s', (channel, medium, group) => {
    expect(channelGroupOf(channel, medium)).toBe(group);
  });
});
