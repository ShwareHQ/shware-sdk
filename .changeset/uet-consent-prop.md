---
'@shware/analytics': minor
---

Add a `uetConsent` prop to the `Analytics` components that pushes the UET consent mode default inside the tag snippet, ahead of bat.js. It defaults to `{ ad_storage: 'granted' }`; pass `{ ad_storage: 'denied' }` behind a consent banner, or `false` to push no default.
