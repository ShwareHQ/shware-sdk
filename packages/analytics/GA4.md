# GA4 alignment

This SDK's session and engagement model is deliberately modelled on GA4, so that the numbers it
produces can be reconciled with a GA4 property running alongside it.

Google documents the _events_ it collects, but barely documents the _mechanics_ — the
Measurement Protocol page mentions `engagement_time_msec` only inside a code sample, with no
explanation of its meaning, and the automatically-collected-events page lists a set of events
carrying it that the runtime does not actually restrict itself to. What follows was read out of
`gtag.js` itself (417KB, fetched 2026-08-27 from
`https://www.googletagmanager.com/gtag/js?id=G-…`). Re-fetch and re-grep it before trusting any of
this after a Google release; the symbol names below are minified and will change.

## What GA4 actually does

### The engagement timer

```js
c(d, 'focus', () => {
  b.P = true;
});
c(d, 'blur', () => {
  b.P = false;
});
c(d, 'pageshow', () => {
  b.isActive = true;
});
c(d, 'pagehide', () => {
  b.isActive = false;
});
c(A, 'visibilitychange', () => {
  b.isVisible = !A.hidden;
});

l.Zj = function () {
  return this.P && this.isVisible && this.isActive;
}; // is the timer running
l.ei = function () {
  return (this.D && this.D.get()) || 0;
}; // current reading
l.Qs = function () {
  return this.J + this.ei();
}; // cumulative for the session
l.vu = function (a) {
  var b = this.ei();
  b > 0 && W(a, G.A.rh, b);
}; // attach to an event
l.wk = function (a) {
  if (a || this.D) ((this.J += this.ei()), (this.D = FP(this)), this.Zj() && this.D.start());
};
l.Ys = function (a) {
  W(a, G.A.rh); // two args: unsets it
  this.wk();
  this.J = 0;
}; // on session_start
```

`G.A.rh` is `engagement_time_msec`, and `nQ[G.A.rh] = "_et"` maps it onto the wire parameter.

- Time accrues only while **focused, visible and active**, all three. Lifecycle handlers stop the
  timer, apply the state change, and restart it if the page is still engaged.
- `vu` runs inside `Tt`, the pipeline every event passes through, so an event carries whatever the
  timer has accrued **since the previous event** — not the session total. `wk` runs after the send
  and restarts the timer at zero, rolling the reading into the cumulative `J`.
- The cumulative total is never sent. It exists to decide the engaged flag.
- `session_start` explicitly carries none: `Ys` unsets the parameter and zeroes the cumulative.

### The session state machine

```js
var r = Hb(Q(a.K, G.A.Ch, 30));        // session_duration, MINUTES
r = Math.min(475, r); r = Math.max(5, r);
var t = Hb(Q(a.K, G.A.Wi, 1E4));       // session_engaged_time, MILLISECONDS
var p = Math.floor(m / 1E3);           // this event's time, SECONDS

if (!u) { v = true; u = { s: String(p), o: 1, g: false, t: p, … } }
p > u.t + r * 60 && (v = true, u.s = String(p), u.o++, u.g = false);
if (v) U(a, I.H.Ne, true), d.Ys(a);
else if (d.Qs() > t || a.eventName === G.A.sc) u.g = true;
```

`u` is the `_ga_<container>` cookie: `s` session id, `o` session number, `g` engaged, `t` the last
event's timestamp. On the wire they are `sid`, `sct`, `seg`.

- The timeout is measured from **the last event and nothing else** — not from focus, not from
  visibility, not from raw interaction. Default 30 minutes, clamped to 5–475.
- A new session resets the id, increments the number, clears the engaged flag, and clears the
  engagement counters.
- The session is **engaged** once cumulative engagement passes `session_engaged_time` (10s by
  default) or a conversion event fires. Documentation adds "two or more page views" as a third leg.
- Because it lives in a cookie, a session survives a reload, spans a whole multipage visit, and is
  shared between tabs.

## Where we match

- The engagement accumulator gates on `focused && visible && active`, and the handlers accumulate
  before flipping the flag, which is equivalent to GA4's stop-change-restart.
- Session identity and the timeout clock are persisted (`config.storage`, `1.<id>.<lastEventTime>`)
  and read-modify-written per batch.
- The timeout is measured from the last event only, and from the event's own timestamp rather than
  from the moment its batch is flushed.
- A new session clears the engagement its predecessor never reported.
- `session_start` is emitted by the session machinery at the head of the batch that opened the
  session, not by a hook on mount.

## Where we deliberately differ

| GA4                                            | Us                                                             | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session_number` on every event                | not collected                                                  | GA4 counts on the client because it has no visitor-level backend to ask at collection time. `session_id` is a uuidv7, so ranking it over `visitor_id` or `user_id` answers the same question from stored events — and answers it **across devices**, which a per-device counter cannot. A client counter also resets when storage is cleared, at the same moment `visitor_id` does, so it is no more durable than the SQL.                                                                                                                                                                                                                                                                                           |
| `session_engaged` on every event               | not collected                                                  | All three legs are computable from stored events: `SUM(engagement_time_msec) > 10000`, `COUNT(*) FILTER (WHERE name = 'page_view') >= 2`, and whether any event is a conversion. Deriving it server-side also leaves the threshold unbaked — GA4 fixes it at collection time and can never re-cut history.                                                                                                                                                                                                                                                                                                                                                                                                           |
| `engagement_time_msec` on every event          | only `page_view`, `scroll`, `user_engagement`, `screen_view`   | The number of events carrying it does not change the session total — the accumulator is the same, and flushing more often only moves it in smaller pieces. The one real benefit is loss reduction, which the beacon fix addresses more cheaply. Keeping it out of the other events also keeps it out of `properties` forwarded to gtag, where `engagement_time_msec` is a reserved parameter mapped onto `_et` and would collide with GA4's own timer.                                                                                                                                                                                                                                                               |
| `user_engagement` fires after 1s of engagement | fires above 0                                                  | Our `flush()` is destructive — it zeroes the accumulator before the guard runs — so a 1s threshold would discard up to a second of real engagement per drain. GA4's timer is only reset when an event is actually sent, so its threshold costs it nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| No cap on a single stretch of engagement       | `updateAccumulator` drops a delta of `SESSION_TIMEOUT` or more | GA4 never computes a delta across a long gap, since its timer runs continuously while engaged, and it has no idle detection: a focused, visible page accrues engagement untouched. Its protection against a visitor who walks away is the session boundary, which clears pending engagement — we do that too, and it covers a visitor who leaves and generates nothing. This branch covers what that misses: a page keeping its own session alive while nobody is there, which is what a polling dashboard does. The cost is real engaged time lost in stretches longer than the timeout; GA4 avoids that with periodic `video_progress` events, which both keep the session alive and drain the timer. See TODO.md. |
| Session state in a cookie                      | in `config.storage`                                            | localStorage on the web, the SQLite-backed shim on React Native, which is where `visitor_id` already lives and needs no per-platform code. The stored format is cookie-safe, so a host that wants one session across its subdomains can supply a cookie-backed `storage` without the format changing. Safari's 7-day cap on script-writable storage applies to both, and is irrelevant to a 30-minute session either way.                                                                                                                                                                                                                                                                                            |

## Where the alternatives sit

For reference, since "just derive it from timestamps" comes up:

- **PostHog** (verified in `posthog-js@1.417`) sends `$prev_pageview_duration = (now - prev)/1000`
  on the next pageview, with `$prev_pageview_pathname`. It is **wall clock** — a tab left open in
  the background counts in full. Its session idle timeout is 1800s, clamped 60–36000.
- **Amplitude, Mixpanel, Adobe** derive session and page duration from event timestamps at query
  time. Cheap, but the dwell time of the last event of a visit is unrecoverable, so a bounce is
  always zero seconds, and background tabs count in full.
- **Matomo** sends heartbeat pings to measure visible time — accurate, at the cost of a request
  every few seconds.

Foreground gating is what separates these; it is the dominant error source in any time-on-page
metric, and it is the reason to keep the accumulator rather than let the backend subtract
timestamps.

## Known gaps

- A batch that straddles a session boundary (possible when a frozen tab holds events for a long
  time) is assigned to one session in full.
- The SDK is browser and app state held in module singletons. It can be imported on a server, but
  calling `track()` there shares one session and one visitor across every request the isolate
  serves.
