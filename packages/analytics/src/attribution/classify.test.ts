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
    [{ utm_source: 'Twitter' }, 'x', '(not set)', 'unassigned', null],
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
    ['x', '(not set)', 'unassigned'],
    ['google', 'qr', 'unassigned'],
  ] as const)('%s / %s → %s', (channel, medium, group) => {
    expect(channelGroupOf(channel, medium)).toBe(group);
  });
});
