---
'@shware/analytics': minor
---

On native, the link that opened the app — at launch, or bringing it back to the front — lands the visit as a web page's URL does: `page_location` is the link, and its utm and click ids are in the tags of every event until the app goes to the background, so a session a universal link from an email or an ad starts is no longer direct. A link the system does not route through `Linking`, such as a push notification's, can be handed over with `openedWith(url)`. The web reads the same URL parameters through the shared `urlTags`.
