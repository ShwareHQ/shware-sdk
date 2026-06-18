# TODO

## Per-destination event filtering (GA vs ad pixels)

**Status:** deferred — design agreed, not implemented.

### Problem

Third-party dispatch in `src/track/index.ts` applies a single global gate
(`IGNORED_EVENTS`) uniformly to every tracker:

```js
if (... || IGNORED_EVENTS.includes(name)) continue;
config.thirdPartyTrackers.forEach((tracker) => tracker(name, properties, eventId));
```

`thirdPartyTrackers` is an opaque function array
(`[sendGAEvent, sendFBEvent, sendRedditEvent, sendOpenAIEvent]`), so the dispatch
layer can't apply per-vendor policy.

We need engagement events (e.g. `view_promotion`, `select_promotion`, `select_item`,
`scroll`, `video_*`, `file_download`, `form_*`) to **still reach GA** (they are
GA-native analytics events) but **NOT** the ad pixels (FB / Reddit / OpenAI), where
they are noise with no marketing value and cost volume / rate limits / data-sharing
surface.

Note: `IGNORED_EVENTS` is really a GA-centric denylist (prevents re-sending GA
auto-collected events back to GA, e.g. `page_view`/`scroll`/`session_start`); it just
happens to be applied to all vendors today.

### Candidate approaches (not yet decided)

#### Option A — self-filtering per tracker

- Move the current `IGNORED_EVENTS` (metrics + GA auto-collected) into `sendGAEvent`.
  GA then keeps receiving `view_promotion` etc.
- Add a shared `NON_AD_EVENTS` **denylist** (engagement / non-marketing events) used by
  `sendFBEvent` / `sendRedditEvent` / `sendOpenAIEvent` — they early-return on a match.
  Use a denylist (not a standard-event allowlist) so legitimate **custom business
  conversions** still pass through to the ad pixels.
- Drop the global `IGNORED_EVENTS` gate in `track/index.ts`; dispatch becomes a plain
  broadcast and each tracker self-filters (matches the existing `metrics` / localhost
  guards already in each pixel). The `enableThirdPartyTracking` global switch stays.

Rough shape:

```
GA_IGNORED_EVENTS  (= current IGNORED_EVENTS)   → used by sendGAEvent
NON_AD_EVENTS      (engagement events)          → shared by the 3 ad pixels
```

- Pros: matches the existing per-pixel self-filtering pattern; no change to the `setup`
  Options API; each vendor's policy evolves independently; GA's "don't echo my
  auto-collected events" logic lives with GA.
- Cons: filtering policy is spread across the tracker files rather than centralized;
  every event calls every tracker fn that then early-returns (negligible cost).

#### Option B — per-tracker policy metadata in the registry

Attach policy to each tracker entry and have dispatch consult it:

```ts
thirdPartyTrackers: [
  { track: sendGAEvent, deny: GA_IGNORED_EVENTS },
  { track: sendFBEvent, deny: NON_AD_EVENTS },
  { track: sendOpenAIEvent, deny: NON_AD_EVENTS },
];
```

- Pros: policy is centralized and declarative; host app can configure per vendor
  (different integrations can differ).
- Cons: changes the `setup` Options API (`thirdPartyTrackers` shape); host app must
  wire the policy for each vendor; heavier than A.

**Decision: TBD** — neither option agreed yet.

### Open questions before implementing

1. Are mid-funnel events (`search`, `view_item`, `view_item_list`) marketing-relevant
   (used to build ad audiences)? If not, add them to `NON_AD_EVENTS`.
2. Should the 3 ad pixels share one `NON_AD_EVENTS` set, or allow per-vendor
   differences? Shared is simplest.
