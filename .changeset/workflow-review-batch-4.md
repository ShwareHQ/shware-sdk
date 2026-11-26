---
'@shware/workflow': patch
'@shware/workflow-ui': patch
---

Fixes from the workflow review, fourth batch.

`@shware/workflow`

- An `observer` passed to `journeyWorker` / `journeyLambda` is added to the store's own instead of replacing it. The store's observer holds the claim that delivers each copy at most once; a host that passed one of its own, to hear of sends or finished journeys, silently lost that guarantee (a replayed step sent the copy again) along with the store's reporting. **What changes for you:** with a custom observer the store now records instances, copies and engagement as it does without one, emails get their tracking links and pixel when `WORKFLOW_ORIGIN` is set, and your hooks run after the store's (tracking your `messagePrepared` returns is laid over the store's). An observer that implements `messageSettled`, `messageClaimed` or `messageReleased` — `reportingObserver(...)` spread into your own object, say — decides delivery itself and is still used alone.
- Web Push: a subscription's endpoint is only sent to when it is an https URL on a browser's push service — `fcm.googleapis.com`, `android.googleapis.com`, `jmt17.google.com`, `*.push.services.mozilla.com` (and Mozilla's two stage and dev hosts), `*.notify.windows.com`, `*.push.apple.com`: the hosts of Pushpad's `known-push-services` list, which is drawn from some 200M real subscriptions. The endpoint is the registering client's word, and the host POSTed to whatever it named, `https://localhost` or an internal service included. `POST /devices` with `platform: 'web'` now answers 400 for any other endpoint (and for a token that is not a subscription as JSON); one already stored is settled undelivered (`UnlistedPushService`) at each send, without a request, and its device is kept. **If you deliver through another push service, name its host in the new `webPush.pushServices`** (`['push.example.com']`, or `'*.example.com'` for subdomains): until then its devices get nothing. `@shware/workflow/webpush` exports `PUSH_SERVICE_HOSTS`, `isPushServiceEndpoint` and `subscriptionEndpoint`, and `WebPushSender` takes `pushServices`.
- `timeWindow({ tz })` throws a `TypeError` naming the zone when it is not `'user'` or a time zone the runtime knows. A misspelled zone compiled and was read as UTC at every window.
- README: a completed Cloudflare Workflows instance's state is kept 7 days by default, up to 30 on a paid plan (it said 30).

`@shware/workflow-ui`

- Canvas: a branch whose fall-through (no `otherwise`) had an arm on the centre line — three arms, five — drew the fall-through connector through that arm's cards. It now runs down the empty arm's own column and rejoins below the arms.
- Canvas: the selected node is remembered per workflow again. It was stored under the node's id, so a reload never found it.
- The dev server also refuses to serve `.npmrc`, `.envrc`, `.netrc`, `wrangler.toml` / `wrangler.json` / `wrangler.jsonc`, `*.p12`, `*.jks` and `*.keystore`.
