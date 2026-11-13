---
'@shware/security': patch
---

The redirect flow no longer forwards `error_description` to `errorUri`. The page acts on the `error` code alone, as the README has always asked, so the provider's text and the SDK's own detail (`session not found`, `redirect state mismatch`) now go to `console.warn` instead of a URL the browser keeps in its history; `error_description` is no longer a name `redirectParams` has to avoid.
