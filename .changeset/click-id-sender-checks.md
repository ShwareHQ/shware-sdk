---
'@shware/analytics': patch
---

Tighten which click ids the Conversions API senders pass on. A `gclid` whose `gclsrc` marks it as Search Ads 360's (`ds`, `3p.ds`) is no longer sent to Google Ads, the same gating gtag applies to `_gcl_aw` (now shared as `isGoogleAdsGclid`), so it no longer hides a valid `_gcl_aw` click either. A URL `msclkid` not in the 32-hex shape of one is ignored in favour of the `_uetmsclkid` cookie. `parseFbc` reads `fb.<index>.<time>.<fbclid>.<appendix>`, the format Meta's Parameter Builder writes, with the fbclid as the fourth segment alone, so such a cookie is recognised as the same click instead of being rewritten with a new creationTime.
