---
'@shware/analytics': minor
---

On native, the link that opened the app — at launch, or bringing it back to the front — lands the visit as a web page's URL does: pass `deepLink` from `@shware/analytics/native` to `setupAnalytics({ deepLink })`, and its URL (as `page_location`) and utm go into the tags of every event until the app goes to the background, over the install referrer's utm. A session a universal link from an email or an ad starts is no longer direct. `setupAnalytics` starts its listeners (nothing runs at import); `deepLink.open(url)` hands over a link `Linking` does not see, such as a push notification's.
