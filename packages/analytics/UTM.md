# UTM tagging

How to tag ad and campaign links so that `classifyTouch` (`@shware/analytics/attribution`) and a
GA4 property running alongside it both read the click the same way: as the right channel, the
right campaign, and with ids a spend report can join on. Every platform template below was checked
against the platform's own help pages (sources at the end, read 2026-10-05).

## The convention

| Param          | Value                                                                        | Read by                                                                                          |
| -------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `utm_source`   | The channel, lower case, one spelling per channel: `meta`, `google`, `bing`… | `classifyTouch`: names the `channel` (aliases folded, see `SOURCE_ALIASES`). GA4: Session source |
| `utm_medium`   | `cpc` for every paid click                                                   | `classifyTouch` and GA4: whether the click was paid (`channel_group`)                            |
| `utm_campaign` | The campaign **id**                                                          | `classifyTouch`: the `campaign` column. GA4: Session campaign                                    |
| `utm_id`       | The campaign id, again                                                       | Stored as a tag. GA4: Session campaign ID, the key of cost data import                           |
| `utm_term`     | Ad set / ad group id; for search, the keyword id                             | Stored as a tag. GA4: Session manual term                                                        |
| `utm_content`  | The ad id (the finest level the platform has)                                | Stored as a tag. GA4: Session manual ad content                                                  |

Ids, never names:

- **Names are public.** Anyone who clicks an ad (and every ad is one click away in the platforms'
  ad libraries) reads its URL. `Q3_Prospecting_ABO` says the campaign is a test on ad-set budgets;
  `0713_UGC_vsAcme` says there is a comparison creative against a competitor, and when it shipped.
  An id says nothing.
- **Names are not keys.** They are renamed, duplicated, and copied with a ` - Copy` suffix; Meta's
  name macros even keep the name the ad had when it was first published. The ad id is unique, and
  its ad set and campaign come back from the platform's API, so the spend synced from that API
  joins on it and brings the names to the dashboards.
- `utm_campaign` carries the id rather than nothing: GA4 shows `(not set)` without it, and the
  `campaign` column groups by it.
- `utm_id` repeats it because GA4's cost data import joins on `utm_id` (with source, medium and
  date). Without it, imported spend can only be summed per source / medium, not per campaign.

Spelling: lower case, no spaces, one fixed value per channel. `classifyTouch` lower-cases
`utm_source` but keeps everything else, so `theDaily` and `the daily` are two channels. GA4's cost
import requires a single `utm_source` and a single `utm_medium` per platform, which rules out
anything that expands to several values (`{{site_source_name}}`, `{{placement}}`).

Never put a utm on an internal link. GA4 starts a new attribution from it, so the visit is credited
to the button that was clicked (`utm_source=home_hero`) instead of the channel that brought the
visitor; count clicks on internal links with an event.

## How `classifyTouch` reads a session

Run once when the session is written; the result is stored. The first rule that names a channel
wins:

1. `utm_source`, even when a click id is present. A utm is written for this link by whoever placed
   it, while a click id travels with a forwarded or shared ad link, and Meta adds `fbclid` to
   organic links too. (GA4 does the opposite: a usable `gclid` always wins, and GA4 has no setting
   to change it.)
2. A click id in the URL (never a cookie): `fbclid`, `gclid`, `gbraid`, `wbraid`, `gad_source`,
   `gad_campaignid`, `dclid`, `msclkid`, `ttclid`, `rdt_cid`, `li_fat_id`, `ScCid`, `twclid`,
   `ko_click_id`, `yclid`, `oppref`, `epik`. With no utm, the medium is `cpc`.
3. An ad landing page, `/lp/<channel>`, for ads that lost their parameters.
4. The product's own rules (a `/refer/<code>` path).
5. The referrer: search engines, social networks and AI assistants by host, any other site as
   `referral`.

`channel_group` follows GA4's default channel groups. The paid rule is GA4's, plus `pmax`, which GA4 does not take as paid (tag Performance Max `cpc`):

```
PAID_MEDIUM = /^(.*cp.*|ppc|retargeting|paid.*|pmax|performance_max)$/
```

| `utm_medium`                                                     | `channel_group`                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `cpc`, `cpm`, `ppc`, `paid…`, `retargeting`; `pmax` (not in GA4) | `paid_search` (search site), `paid_social` (social or video site), else `paid_other` |
| A Meta placement (`facebook_mobile_feed`…)                       | `paid_social` here; **Organic Social in GA4** (see below)                            |
| `display`, `banner`, `expandable`, `interstitial`                | `display`                                                                            |
| `social`                                                         | `organic_social`: posts and profile links, never ads                                 |
| `email`, `newsletter`, `e-mail`…                                 | `email`                                                                              |
| `referral`                                                       | `referral`                                                                           |
| `affiliate`                                                      | `affiliate`                                                                          |
| anything else, or none                                           | by the source's site list, else `unassigned`                                         |

A social or search source with a medium that is not paid is organic: `meta / social` is an
Instagram bio link, and so is `meta / ads` (no paid rule matches `ads`). The exception: an ad-only
click id of the source's own platform (every click id but `fbclid`, `twclid` and `ko_click_id`)
turns a missing or organic medium into `cpc`.

Where `classifyTouch` differs from GA4, on purpose:

| Case                                                | GA4                  | `classifyTouch`     |
| --------------------------------------------------- | -------------------- | ------------------- |
| `pmax`, `performance_max`                           | not paid             | `paid_search`       |
| A Meta placement as the medium                      | Organic Social       | `paid_social`       |
| Organic medium with the platform's ad-only click id | only `gclid` counts  | `cpc`               |
| `cpm`                                               | listed under Display | paid, by the source |
| utm and click id disagree                           | click id wins        | utm wins            |

GA4 groups the SDK has no counterpart for: `social-network`, `social-media`, `sm` (Organic
Social), `*video*` (Organic Video), `app` and `link` (Referral), SMS, Audio and Mobile Push. Don't
use those mediums.

A macro the platform did not expand (`{{campaign_name}}`, `__CAMPAIGN_NAME__`, `{campaignid}`) is
kept as written, so the broken template shows in the reports and gets fixed.

## Templates

Copy the template, then click one live ad and check that every macro was expanded.

### Meta (Facebook, Instagram, Messenger, Threads, Audience Network)

Ad level, **URL parameters** field.

```
utm_source=meta&utm_medium=cpc&utm_campaign={{campaign.id}}&utm_id={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}&placement={{placement}}
```

- **The placement goes in its own `placement` parameter, never in `utm_medium`.** GA4 decides paid
  by the medium alone, so `meta / facebook_mobile_feed` lands in Organic Social: a property tagged
  `utm_medium={{placement}}` shows almost all of its Meta ads there. The SDK collects `placement`
  as a tag.
- The placement's prefix is the app: `facebook_*`, `instagram_*`, `messenger_*`, `threads_*`,
  `whatsapp_*`, `audience_network_*` (and `an`). Only `others`, which Meta does not document but
  sends, names none. Group by app with the part before the first underscore.
- `utm_source` is the fixed `meta`, not `{{site_source_name}}`: GA4 knows `meta` as a social site,
  while `an` (Audience Network) may not be on its list, and cost import needs one source.
- Macros are lower case and dotted: `{{campaign.id}}`. `{{campaign_id}}` is not expanded and
  reaches the page as written.
- Collection ads on Instagram placements don't expand macros; app promotion ads have no URL
  parameters field (append to the deferred deep link). With the field left empty, Meta may add
  its own source / medium / ids, whose keys it does not document: always fill it.
- `{{media_type}}` is left out: Meta expands it for Advantage+ catalog ads only, and the SDK does
  not collect it as a tag. A product that runs catalog ads can append `&media_type={{media_type}}`
  and read it from `page_location`.
- Changing the parameters of a live ad can send its ad set back into learning: use the template on
  new ads, move old ones when convenient.

### Google Ads (Search, Display, Video, Demand Gen)

Account level **Final URL suffix**, with auto-tagging on.

```
utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_id={campaignid}&utm_term={targetid}&utm_content={creative}&network={network}&match_type={matchtype}
```

- The suffix, not the tracking template: parallel tracking runs the template in the background and
  its parameters never reach the page.
- A suffix set on a campaign or ad group replaces the account's, it is not merged. A share of
  clicks arriving with a `gclid` and no utm usually means such an override.
- `{targetid}` is the keyword id (`kwd-…`, possibly prefixed with an audience id). `{keyword}`
  puts the bought keyword in the URL, competitors' brand terms included; the search terms report in
  Google Ads has the text either way.
- `{creative}` is the ad id; its ad group comes back from the Google Ads API.
- Keep auto-tagging (`gclid`, `gbraid`, `wbraid`, `gad_*`) on: Google's own conversions need it,
  and GA4 recommends both.
- `network` is where this click was served: `g` Google search, `s` search partners, `d` Display,
  `ytv` YouTube, `vp` video partners, `gtv` Google TV, `x` Performance Max, `e` App campaigns for
  engagement. The campaign has one type, its clicks several networks (a Search campaign with
  partners or the Display expansion on), so only the click says whether it came from Google search
  or a partner site; the SDK collects it as the `network` tag, and the Google Ads API reports spend
  per network too.
- `match_type` is how the keyword matched: `e` exact, `p` phrase, `b` broad, and `a` for a click
  AI Max for Search served without any of the keywords bought, which compares the clicks AI Max
  added with the keywords' own. Google does not say what it returns where no keyword served the
  click (Display, Video, Performance Max): check a live click.
- Demand Gen does not support `{keyword}`, `{matchtype}`, `{network}`, `{targetid}` or
  `{placement}`.

### Google Ads Performance Max

Campaign or asset group level suffix.

```
utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_id={campaignid}&utm_content={assetgroupid}&network={network}
```

- `{keyword}` is blank and `{adgroupid}` unsupported in Performance Max; `{assetgroupid}` stands in
  for the ad.
- `network` is always `x` here; it is there so every Google click carries one.
- `cpc`, not `pmax`. With a usable `gclid`, GA4 takes the click from Google Ads and files it under
  Cross-network whatever the medium says; when it cannot use the `gclid`, it reads the utm alone,
  and `pmax` misses GA4's paid rule, so `google / pmax` is Organic Search. `classifyTouch` still
  reads `pmax` as paid for links already tagged that way. The campaign type comes with the
  campaign id from the Google Ads API.

### Microsoft Advertising

Account level **Final URL suffix**. Turn **off** "Add UTM tags to my destination URLs"; keep
MSCLKID auto-tagging on.

```
utm_source=bing&utm_medium=cpc&utm_campaign={CampaignId}&utm_id={CampaignId}&utm_term={OrderItemId}&utm_content={AdId}&network={Network}&match_type={MatchType}
```

- Microsoft's UTM auto-tagging writes the campaign and ad group **names**, and only checks the
  tracking template for existing UTMs, so together with a suffix it duplicates them.
- `{OrderItemId}` is the keyword id; `{Network}` is `o` (Bing, AOL, Yahoo), `s` (syndicated
  partners) or `a` (audience network), the same `network` tag; `{MatchType}` is `e`, `p` or `b`
  (an expanded match shows as `b`). Macros are case-insensitive.
- The lowest level's suffix wins and levels are not merged; a suffix cannot start with `?` or `&`.

### Microsoft Advertising Performance Max

The campaign's own Final URL suffix, so it does not inherit the account's search template.

```
utm_source=bing&utm_medium=cpc&utm_campaign={CampaignId}&utm_id={CampaignId}&utm_content={AdGroupId}&network={Network}
```

- Microsoft has no asset group macro: in Performance Max `{AdGroupId}` returns the asset group id,
  which stands in for the ad (Microsoft does not say what `{AdId}` returns there).
- No `utm_term` or `match_type`: no keyword serves a Performance Max click.
- Microsoft documents a campaign and asset group level tracking template for Performance Max, not
  where its suffix can be set: check a live click.

### TikTok

Ad level URL parameters (or Auto-attach, edited to these values).

```
utm_source=tiktok&utm_medium=cpc&utm_campaign=__CAMPAIGN_ID__&utm_id=__CAMPAIGN_ID__&utm_term=__AID__&utm_content=__CID__&placement=__PLACEMENT__
```

- `__AID__` is the **ad group** id, `__CID__` the **creative** id; upgraded Smart+ campaigns have
  the ad id as `__ADID_V2__`.
- The placement goes in its own `placement` parameter, the tag Meta's placement fills too: TikTok
  itself or Pangle, TikTok's network of other apps, whose clicks are worth comparing apart. TikTok
  gives `TikTok` and `TikTok Pangle` as examples, not a full list: check a live click.
- Never `utm_medium=__PLACEMENT__`: its values are no paid medium, so the ad reads as organic.
- Auto-attach fills source `TikTok` and medium `Paid`, capitalized, which GA4 keeps apart from
  `tiktok` / `paid`: edit them to the values above, or tag by hand.
- Values are case-sensitive, everything after `#` is dropped, a repeated key keeps the last value.

### Reddit

The ad's destination URL.

```
utm_source=reddit&utm_medium=cpc&utm_campaign={{CAMPAIGN_ID}}&utm_id={{CAMPAIGN_ID}}&utm_term={{ADGROUP_ID}}&utm_content={{AD_ID}}
```

- Reddit documents its macros for catalog ads and trackers only. Check a live click; if a plain
  image or video ad leaves them unexpanded, write the ids by hand.
- Upper case, `ADGROUP` not `AD_GROUP`. **The parameters cannot be changed once the ad is
  published.**

### LinkedIn

Account or campaign level dynamic UTM parameters.

```
utm_source=linkedin&utm_medium=cpc&utm_campaign={{CAMPAIGN_ID}}&utm_id={{CAMPAIGN_ID}}&utm_term={{AD_SET_ID}}&utm_content={{AD_ID}}
```

- Since October 2025 LinkedIn's Campaign Group is a Campaign, its Campaign an Ad Set, and a
  creative an Ad. On an account still using the old names: `{{CAMPAIGN_GROUP_ID}}`,
  `{{CAMPAIGN_ID}}`, `{{CREATIVE_ID}}`.
- LinkedIn's own example uses `utm_medium=social`: don't, it reads as organic unless the URL also
  carries `li_fat_id`.
- Conversation and Message Ads don't support dynamic parameters. Remove older static UTMs or they
  are duplicated.

### X

Each ad's URL, by hand: X documents no dynamic macros.

```
utm_source=x&utm_medium=cpc&utm_campaign=<campaign id>&utm_id=<campaign id>&utm_content=<ad id>
```

- `twclid` is not taken as proof of a paid click, so the medium must say it.

### Pinterest

Account or campaign level automatic URL parameters, edited to these values.

```
utm_source=pinterest&utm_medium=cpc&utm_campaign={campaignid}&utm_id={campaignid}&utm_term={adgroupid}&utm_content={adid}
```

- Single braces, lower case. `{adid}` is the promoted Pin id.
- A parameter already in the destination URL or the product feed wins over the automatic ones.
  Performance+ campaigns have their own toggle at ad group level.

### Snapchat

The ad's URL macros.

```
utm_source=snapchat&utm_medium=cpc&utm_campaign={{campaign.id}}&utm_id={{campaign.id}}&utm_term={{adSet.id}}&utm_content={{ad.id}}
```

- camelCase: `adSet`, not `adSquad`.
- Dynamic product ads support only the campaign and ad set ids and names, and `ad.id`.

### ChatGPT (OpenAI Ads)

Ads Manager, **Landing page query parameters** in Edit campaign (or ad group, or ad); through the
API, `landing_page_configuration.query_string_template`.

```
utm_source=chatgpt&utm_medium=cpc&utm_campaign={campaign_id}&utm_id={campaign_id}&utm_term={ad_group_id}&utm_content={ad_id}
```

- ChatGPT's organic links carry `utm_source=chatgpt.com` and no medium (`organic_ai`), so an ad
  must state its medium.
- `utm_source=openai`, OpenAI's own example, folds into `chatgpt` too.
- The macros are `{campaign_id}`, `{ad_group_id}`, `{ad_id}` and `{ad_account_id}`, filled at
  delivery time.
- Parameters from several levels are merged, the most specific winning: the ad's URL, then the ad,
  the ad group, the campaign. A parameter already in the ad's URL is never overwritten.
- OpenAI appends `oppref` to the landing page URL itself (`?oppref=gAAAAA…`), an ad-only click id
  here; don't add `click_id={oppref}`. Keep it through redirects: the pixel stores it in
  `__oppref`, and the Conversions API wants it on server-side events.

## Other channels

| Link                                | Tagging                                                          | `channel_group`  |
| ----------------------------------- | ---------------------------------------------------------------- | ---------------- |
| Product email                       | `utm_source=<sender>&utm_medium=email&utm_campaign=<message id>` | `email`          |
| A sponsored slot in a newsletter    | `utm_source=<newsletter>&utm_medium=paid_newsletter`             | `paid_other`     |
| A sponsored article                 | `utm_source=<publisher>&utm_medium=paid_article`                 | `paid_other`     |
| A banner on a publisher's site      | `utm_source=<publisher>&utm_medium=banner`                       | `display`        |
| Press coverage, a directory listing | `utm_source=<site>&utm_medium=referral`                          | `referral`       |
| A paid directory listing            | `utm_source=<site>&utm_medium=paid_listing`                      | `paid_other`     |
| Affiliates                          | `utm_source=<partner>&utm_medium=affiliate`                      | `affiliate`      |
| Own posts, profile and bio links    | `utm_source=ig&utm_medium=social&utm_content=link_in_bio`        | `organic_social` |
| A referral programme                | No utm: a `/refer/<code>` link the product's rule reads          | `referral`       |

A medium outside these (`articles`, `post`, `ads`) is `unassigned` in both the SDK and GA4.

## GA4 cost data import

GA4 imports daily cost, clicks and impressions per campaign from other ad platforms and joins them
to sessions on `utm_source`, `utm_medium`, date and `utm_id` (or `utm_campaign`), for non-Google
cost per click and return on ad spend.

- Native connectors: Meta, TikTok, Pinterest, Reddit, Snapchat (daily, with up to 24 months of
  history). Microsoft Advertising, LinkedIn, X and OpenAI: a CSV upload, SFTP, or the Google Sheets
  add-on. Google Ads links directly and joins on the `gclid`.
- The source and medium entered in the connector must equal the URL's exactly, one value each.
- Costs stop at the campaign: per ad set and per ad, join the platforms' spend to the `utm_term`
  and `utm_content` tags yourself.

## Sources

- Google Ads: [ValueTrack parameters](https://support.google.com/google-ads/answer/6305348),
  [Final URL suffix](https://support.google.com/google-ads/answer/9054021),
  [Parallel tracking](https://support.google.com/google-ads/answer/6076199),
  [gad\_\* parameters](https://support.google.com/google-ads/answer/16193746),
  [Performance Max URL options](https://support.google.com/google-ads/answer/16176749)
- GA4: [UTM parameters](https://support.google.com/analytics/answer/10917952),
  [Default channel groups](https://support.google.com/analytics/answer/9756891),
  [Auto-tagging and manual tagging](https://support.google.com/analytics/answer/15593651),
  [Import campaign data](https://support.google.com/analytics/answer/10071305),
  [Meta cost import](https://support.google.com/analytics/answer/16536051),
  [TikTok cost import](https://support.google.com/analytics/answer/16536156)
- Microsoft Advertising: [URL parameters](https://learn.microsoft.com/en-us/advertising/msa-help/hlp_ba_conc_upgradeurl_urlparameters),
  [UTM auto-tagging](https://learn.microsoft.com/en-us/advertising/msa-help/hlp_ba_conc_autotag),
  [Final URL suffix](https://learn.microsoft.com/en-us/advertising/msa-help/hlp_ba_conc_upgradeurl_finalurlsuffix)
- Meta: [Dynamic URL parameters](https://www.facebook.com/business/help/2360940870872492),
  [Add URL parameters](https://www.facebook.com/business/help/1016122818401732)
- TikTok: [UTM parameters](https://ads.tiktok.com/help/article/track-offsite-web-events-with-utm-parameters),
  [Best practices](https://ads.tiktok.com/help/article/utm-parameters-best-practices)
- Reddit: [URL parameters](https://business.reddithelp.com/s/article/URL-Parameters),
  [Third-party measurement](https://business.reddithelp.com/s/article/Set-up-third-party-measurement)
- LinkedIn: [URL tracking parameters](https://www.linkedin.com/help/lms/answer/a5968064),
  [Dynamic UTM tracking](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads-reporting/dynamic-utm-tracking)
- Pinterest: [Dynamic tracking](https://help.pinterest.com/en/business/article/third-party-and-dynamic-tracking)
- Snapchat: [URL macros](https://businesshelp.snapchat.com/s/article/add-url-macros?language=en_US)
- OpenAI: [Campaign management](https://developers.openai.com/ads/campaign-management),
  [Measure results](https://help.openai.com/en/articles/20001214-measure-results),
  [Conversion measurement](https://help.openai.com/en/articles/20001409-conversion-measurement)
- X: [Web conversions](https://docs.x.com/x-ads-api/measurement/web-conversions)
