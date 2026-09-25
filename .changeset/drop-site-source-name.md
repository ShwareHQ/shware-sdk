---
'@shware/analytics': minor
---

Drop `site_source_name` from `TrackTags`, the tag schema and the web tag capture. It was read from a URL parameter of that exact name, which Meta only sets when an ad's URL parameters spell out `site_source_name={{site_source_name}}`; the working convention is `utm_source={{site_source_name}}`, which lands the same value in `utm_source`, so the separate field was never populated. The server strips the key from a payload an older client still sends.
