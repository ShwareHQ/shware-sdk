import { describe, expect, it } from 'vitest';
import type { TrackTags } from '../track/types';
import { type TouchRule, channelGroupOf, classifyTouch } from './classify';
import { TOUCH_PRIORITY } from './vocabulary';

const at = (page_location: string, rest: TrackTags = {}): TrackTags => ({ page_location, ...rest });
const own = { ownHosts: [/(^|\.)shware\.net$/] };

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
      // A utm that comes out organic or email was paid by no one; it ranks with a referrer.
      priority:
        group.startsWith('organic_') || group === 'email'
          ? TOUCH_PRIORITY.referrer
          : TOUCH_PRIORITY.campaign,
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

  it('does not take an ad cookie for a click: it outlives the visit it came from', () => {
    const cookies = {
      _fbc: 'fb.1.1700000000000.abc',
      _gcl_aw: 'GCL.1700000000.G1',
      _gcl_gb: 'GCL.1700000000.W1',
      _uetmsclkid: '_uetdd4afcccb1c94a4cad9544dd7e5006ab',
      _rdt_cid: 'R1',
      _li_fat_id: 'L1',
      __oppref: 'O1',
      // clients older than 9.0.0
      fbc: 'fb.1.1700000000000.abc',
    };
    expect(classifyTouch(cookies)).toMatchObject({
      channel: '(direct)',
      medium: '(none)',
      priority: null,
    });
    expect(classifyTouch({ ...cookies, page_referrer: 'https://www.google.com/' })).toMatchObject({
      channel: 'google',
      medium: 'organic',
    });
    // Nor say a utm_source without a medium was paid.
    expect(classifyTouch({ ...cookies, utm_source: 'google' })).toMatchObject({
      channel: 'google',
      medium: '(not set)',
    });
  });

  it('calls a utm_source without a medium paid when an ad-only click id of its channel came along', () => {
    expect(classifyTouch({ utm_source: 'reddit', rdt_cid: 'x' })).toMatchObject({
      channel: 'reddit',
      medium: 'cpc',
      channel_group: 'paid_social',
    });
    expect(classifyTouch({ utm_source: 'reddit' })).toMatchObject({
      medium: '(not set)',
      channel_group: 'organic_social',
    });
    // Another channel's click id says nothing about this one.
    expect(classifyTouch({ utm_source: 'reddit', gclid: 'x' })).toMatchObject({
      medium: '(not set)',
      channel_group: 'organic_social',
    });
    // fbclid is on organic Meta links too, so it proves nothing.
    expect(classifyTouch({ utm_source: 'ig', fbclid: 'x' })).toMatchObject({
      channel: 'meta',
      medium: '(not set)',
    });
  });

  it('calls a declared organic medium paid when an ad-only click id of its channel proves the click', () => {
    // A Reddit ad tagged by hand as social, a Google ad tagged organic.
    expect(
      classifyTouch({ utm_source: 'reddit', utm_medium: 'social', rdt_cid: 'x' })
    ).toMatchObject({
      channel: 'reddit',
      medium: 'cpc',
      channel_group: 'paid_social',
      priority: TOUCH_PRIORITY.campaign,
    });
    expect(
      classifyTouch({ utm_source: 'google', utm_medium: 'organic', gclid: 'x' })
    ).toMatchObject({ channel: 'google', medium: 'cpc', channel_group: 'paid_search' });
    // A ChatGPT ad keeps the utm_source of ChatGPT's organic links.
    expect(classifyTouch({ utm_source: 'chatgpt.com', oppref: 'x' })).toMatchObject({
      channel: 'chatgpt',
      medium: 'cpc',
      priority: TOUCH_PRIORITY.campaign,
    });
    // A medium that is neither organic nor missing stands: the utm placed it.
    expect(classifyTouch({ utm_source: 'dv360', utm_medium: 'email', dclid: 'x' })).toMatchObject({
      medium: 'email',
      channel_group: 'email',
    });
    // fbclid is on organic Meta links too.
    expect(classifyTouch({ utm_source: 'ig', utm_medium: 'social', fbclid: 'x' })).toMatchObject({
      medium: 'social',
      channel_group: 'organic_social',
    });
  });

  it('ranks a campaign tag that calls itself organic or a referral with the referrer', () => {
    const referrer = { priority: TOUCH_PRIORITY.referrer };
    // ChatGPT's organic citations, tagged by ChatGPT.
    expect(classifyTouch({ utm_source: 'chatgpt.com' })).toMatchObject({
      channel: 'chatgpt',
      channel_group: 'organic_ai',
      ...referrer,
    });
    expect(classifyTouch({ utm_source: 'google', utm_medium: 'organic' })).toMatchObject(referrer);
    expect(classifyTouch({ utm_source: 'reddit' })).toMatchObject(referrer);
    expect(classifyTouch({ utm_source: 'partner.com', utm_medium: 'referral' })).toMatchObject(
      referrer
    );
    expect(classifyTouch({ utm_medium: 'social', fbclid: 'x' })).toMatchObject({
      channel: 'meta',
      ...referrer,
    });
    // Email reaches people an ad may have brought; it does not take the ad's credit.
    expect(classifyTouch({ utm_source: 'newsletter', utm_medium: 'email' })).toMatchObject(
      referrer
    );
    // Tags someone placed and paid for keep the campaign tier: paid, affiliate, and the unknown.
    const campaign = { priority: TOUCH_PRIORITY.campaign };
    expect(classifyTouch({ utm_source: 'meta', utm_medium: 'paid_social' })).toMatchObject(
      campaign
    );
    expect(classifyTouch({ utm_source: 'blog', utm_medium: 'affiliate' })).toMatchObject(campaign);
    expect(classifyTouch({ utm_source: 'newsletter' })).toMatchObject(campaign);
    expect(classifyTouch({ fbclid: 'x' })).toMatchObject(campaign);
    // A product rule ranks as it declares, even as a referral.
    expect(
      classifyTouch(at('https://www.shware.net/refer/ABC'), { rules: [referralLink] })
    ).toMatchObject({ channel_group: 'referral', ...campaign });
  });

  it("reads ChatGPT's and Pinterest's ad click ids as paid clicks on their channels", () => {
    expect(classifyTouch({ oppref: 'x' })).toMatchObject({
      channel: 'chatgpt',
      medium: 'cpc',
      channel_group: 'paid_other',
    });
    expect(classifyTouch({ utm_source: 'openai', oppref: 'x' })).toMatchObject({
      channel: 'chatgpt',
      medium: 'cpc',
    });
    // ChatGPT's own utm on an organic answer link stays organic AI.
    expect(classifyTouch({ utm_source: 'chatgpt.com' })).toMatchObject({
      channel: 'chatgpt',
      channel_group: 'organic_ai',
    });
    expect(classifyTouch({ epik: 'x' })).toMatchObject({
      channel: 'pinterest',
      medium: 'cpc',
      channel_group: 'paid_social',
    });
  });

  it("folds Meta's Threads placement source into meta", () => {
    expect(classifyTouch({ utm_source: 'th', utm_medium: 'paid', fbclid: 'x' })).toMatchObject({
      channel: 'meta',
      channel_group: 'paid_social',
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
      'https://open.weixin.qq.com/connect/qrconnect',
      'https://nid.naver.com/oauth2.0/authorize',
      'https://abc.supabase.co/auth/v1/callback',
      'https://www.shware.net/pricing',
      'http://localhost:3000/',
    ]) {
      expect(classifyTouch(at('https://app.shware.net/', { page_referrer }), own)).toMatchObject({
        channel: '(direct)',
        priority: null,
      });
    }
    // The search and content hosts next to those login hosts are still what they are.
    expect(
      classifyTouch(
        at('https://app.shware.net/', {
          page_referrer: 'https://search.naver.com/search.naver?query=x',
        })
      )
    ).toMatchObject({ channel: 'naver', medium: 'organic' });
    expect(
      classifyTouch(
        at('https://app.shware.net/', { page_referrer: 'https://mp.weixin.qq.com/s/abc' })
      )
    ).toMatchObject({ channel: 'mp.weixin.qq.com', medium: 'referral' });
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

describe('classifyTouch: what proves a paid click, and which tier a touch ranks in', () => {
  const campaign = { priority: TOUCH_PRIORITY.campaign };
  const referrer = { priority: TOUCH_PRIORITY.referrer };

  it('keeps a declared paid medium, never rewriting it to cpc', () => {
    expect(
      classifyTouch({ utm_source: 'reddit', utm_medium: 'paid_social', rdt_cid: 'x' })
    ).toMatchObject({ medium: 'paid_social', channel_group: 'paid_social', ...campaign });
  });

  it('takes the ad landing page of the channel as proof, like its ad-only click id', () => {
    expect(
      classifyTouch(at('/lp/reddit', { utm_source: 'reddit', utm_medium: 'social' }))
    ).toMatchObject({
      channel: 'reddit',
      medium: 'cpc',
      channel_group: 'paid_social',
      ...campaign,
    });
    expect(classifyTouch(at('/lp/google', { utm_source: 'google' }))).toMatchObject({
      medium: 'cpc',
      channel_group: 'paid_search',
      ...campaign,
    });
    // Another channel's landing page proves nothing about this one.
    expect(classifyTouch(at('/lp/meta', { utm_source: 'reddit' }))).toMatchObject({
      channel: 'reddit',
      medium: '(not set)',
      ...referrer,
    });
  });

  it('does not take an id that is on organic links too as proof', () => {
    expect(classifyTouch({ utm_source: 'x', utm_medium: 'social', twclid: 'x' })).toMatchObject({
      channel: 'x',
      medium: 'social',
      ...referrer,
    });
  });

  it('proves a click named by its click id when only utm_medium was tagged', () => {
    expect(classifyTouch({ utm_medium: 'organic', gclid: 'x' })).toMatchObject({
      channel: 'google',
      medium: 'cpc',
      channel_group: 'paid_search',
      ...campaign,
    });
  });

  it('names a session with two click ids by the first in the list, as paid', () => {
    expect(classifyTouch({ fbclid: 'x', gclid: 'y' })).toMatchObject({
      channel: 'meta',
      medium: 'cpc',
      ...campaign,
    });
  });

  it('falls through an empty utm_source to the click id', () => {
    expect(classifyTouch({ utm_source: '', gclid: 'x' })).toMatchObject({
      channel: 'google',
      medium: 'cpc',
      ...campaign,
    });
  });

  it.each([
    ['paid_other', { utm_source: 'newsletter', utm_medium: 'cpc' }, campaign],
    ['display', { utm_source: 'google', utm_medium: 'display' }, campaign],
    ['affiliate', { utm_source: 'partner-x', utm_medium: 'affiliate' }, campaign],
    ['unassigned', { utm_source: 'producthunt', utm_medium: 'launch' }, campaign],
    ['a Meta placement', { utm_source: 'fb', utm_medium: 'facebook_mobile_feed' }, campaign],
    ['organic_search', { utm_source: 'google', utm_medium: 'organic' }, referrer],
    ['organic_social', { utm_source: 'linkedin' }, referrer],
    ['organic_video', { utm_source: 'youtube' }, referrer],
    ['organic_ai', { utm_source: 'chatgpt.com' }, referrer],
    ['referral', { utm_source: 'partner.com', utm_medium: 'referral' }, referrer],
    ['email', { utm_source: 'newsletter', utm_medium: 'email' }, referrer],
  ] as const)('ranks a utm in %s in its tier', (_, tags, tier) => {
    expect(classifyTouch(tags)).toMatchObject(tier);
  });

  it('keeps the tier a product rule declares when a demoted utm names the channel', () => {
    const options = { rules: [referralLink] };
    // Shared on Facebook with a utm: the utm names it, the programme still ranks it.
    expect(
      classifyTouch(at('https://app.shware.net/refer/AB12cd', { utm_source: 'facebook' }), options)
    ).toMatchObject({
      channel: 'meta',
      channel_group: 'organic_social',
      campaign: 'AB12cd',
      ...campaign,
    });
    // A product rule that ranks itself low does not weaken a paid utm.
    const weak: TouchRule = (tags) =>
      tags.page_location?.includes('/promo')
        ? { channel: 'promo', medium: 'referral', campaign: null, priority: TOUCH_PRIORITY.claimed }
        : null;
    expect(
      classifyTouch(at('/promo', { utm_source: 'google', utm_medium: 'cpc' }), { rules: [weak] })
    ).toMatchObject({ channel: 'google', ...campaign });
    expect(
      classifyTouch(at('/promo', { utm_source: 'google', utm_medium: 'organic' }), {
        rules: [weak],
      })
    ).toMatchObject(referrer);
    // Alone, it ranks as it declares.
    expect(classifyTouch(at('/promo'), { rules: [weak] })).toMatchObject({
      channel: 'promo',
      priority: TOUCH_PRIORITY.claimed,
    });
  });

  it('ranks a touch read from the referrer as a referrer, and direct as nothing', () => {
    expect(classifyTouch({ page_referrer: 'https://news.ycombinator.com/' })).toMatchObject(
      referrer
    );
    expect(classifyTouch({})).toMatchObject({ priority: null });
  });
});

describe('classifyTouch: AI assistants (GEO) rank with organic search (SEO)', () => {
  const seo = classifyTouch({ page_referrer: 'https://www.google.com/' });

  it.each([
    ['a referrer', { page_referrer: 'https://chatgpt.com/' }, 'chatgpt'],
    ["ChatGPT's own utm", { utm_source: 'chatgpt.com' }, 'chatgpt'],
    [
      'a utm and its referrer',
      { utm_source: 'chatgpt.com', page_referrer: 'https://chatgpt.com/' },
      'chatgpt',
    ],
    ['Perplexity', { page_referrer: 'https://www.perplexity.ai/search?q=x' }, 'perplexity'],
    ['a declared ai medium', { utm_source: 'newsletter-ai', utm_medium: 'ai' }, 'newsletter-ai'],
  ] as const)(
    'reads %s as organic_ai, in the same tier as an organic search',
    (_, tags, channel) => {
      expect(classifyTouch(tags)).toMatchObject({
        channel,
        channel_group: 'organic_ai',
        priority: seo.priority,
      });
      expect(seo).toMatchObject({
        channel_group: 'organic_search',
        priority: TOUCH_PRIORITY.referrer,
      });
    }
  );

  it('keeps a ChatGPT ad apart: paid, ranked with the campaigns', () => {
    expect(classifyTouch({ utm_source: 'chatgpt.com', oppref: 'O1' })).toMatchObject({
      channel: 'chatgpt',
      medium: 'cpc',
      channel_group: 'paid_other',
      priority: TOUCH_PRIORITY.campaign,
    });
  });

  it('cannot see an AI visit that arrives with neither referrer nor utm', () => {
    // The ChatGPT app, a link copied into the browser.
    expect(classifyTouch(at('https://app.shware.net/pricing'))).toMatchObject({
      channel: '(direct)',
      priority: null,
    });
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
