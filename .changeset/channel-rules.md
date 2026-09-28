---
'@shware/analytics': minor
---

`@shware/analytics/attribution`: the channel rules learn what a year of edensign sessions left unassigned. `channelGroupOf` now applies GA4's source rules as well as its medium rules — `linkedin / (not set)` is `organic_social`, `google / (not set)` is `organic_search`, `email / promo` is `email` — and any medium that says email (`outbound email`) is email. Meta's `{{placement}}` values as a medium on a `meta` session (`facebook_mobile_feed`, `instagram_reels`, `an`, `others`, …; `META_PLACEMENT_MEDIUM`) and `pmax` are paid. `google ads` / `googleads` / `adwords` fold to `google`. The AI assistants get a channel group of their own, `organic_ai`: `chatgpt`, `perplexity`, `gemini`, `claude`, `copilot`, by referrer or by ChatGPT's own `utm_source=chatgpt.com`, with `gemini.google.com` and `copilot.microsoft.com` no longer read as Google and Microsoft search. Products re-run their reclassification to apply this to history.
