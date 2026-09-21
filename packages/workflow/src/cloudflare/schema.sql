-- Journey engine data plane (D1). Conditions are evaluated by querying at
-- decision time: lazy, with no real-time segment materialisation.

-- Raw event log. Every count- and window-based condition reads this table, so a
-- duplicated row silently changes a journey's behaviour, and `id` is what stops
-- that: it is the occurrence's identity, chosen by whoever sent it, and the key
-- constraint makes a second delivery of the same occurrence a no-op. Ingest is
-- reachable from two retrying callers (a client retrying a 500, and the
-- interpreter's send_event step being retried after it already committed its
-- row), so both pass an id they can reproduce.
--
-- Only the sender knows whether two deliveries describe one occurrence or two,
-- so the engine never invents that answer: an ingest that arrives without an id
-- is given a fresh one, which is a truthful "this is its own occurrence" rather
-- than a guess.
CREATE TABLE IF NOT EXISTS events (
  id      TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  name    TEXT NOT NULL,
  ts      INTEGER NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_events_user_name_ts ON events (user_id, name, ts);

CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY,
  props   TEXT NOT NULL DEFAULT '{}'
);

-- Deploy artefacts: segment definitions (resolved by name during evaluation)
-- and the trigger routing table.
CREATE TABLE IF NOT EXISTS segments (
  name      TEXT PRIMARY KEY,
  condition TEXT NOT NULL,
  hash      TEXT NOT NULL
);

-- Event trigger routes. `where` gates on the triggering event's payload
-- (a payload-only condition tree); `filter` gates on the profile.
CREATE TABLE IF NOT EXISTS triggers (
  workflow  TEXT PRIMARY KEY,
  hash      TEXT NOT NULL,
  event     TEXT NOT NULL,
  "where"   TEXT,
  filter    TEXT
);
CREATE INDEX IF NOT EXISTS idx_triggers_event ON triggers (event);

-- Segment-entry trigger routes.
CREATE TABLE IF NOT EXISTS segment_triggers (
  workflow TEXT PRIMARY KEY,
  hash     TEXT NOT NULL,
  segment  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_segment_triggers_segment ON segment_triggers (segment);

-- Lazily maintained segment membership, covering only segments that something
-- triggers on. Transitions are re-evaluated when the user is ingested or
-- identified. Drift driven purely by the clock (an inactivity segment coming
-- true on its own) is therefore only observed on that user's next activity.
-- TODO: a cron sweep for time-driven segments.
CREATE TABLE IF NOT EXISTS segment_members (
  segment TEXT NOT NULL,
  user_id TEXT NOT NULL,
  ts      INTEGER NOT NULL,
  PRIMARY KEY (segment, user_id)
);

-- Entry ledger: the once-per-user policy, instance addressing, and the audit
-- trail of which IR version each user was pinned to.
--
-- The primary key is what makes the policy atomic, and it is also the whole
-- policy: a user who has entered cannot enter again. The one exception is a
-- row left at 'failed', which records an instance that died rather than a
-- journey the user received; the router takes such a row over so the entry can
-- be retried (see startJourney). A general re-entry policy is a separate
-- design question and deliberately not encoded here.
CREATE TABLE IF NOT EXISTS entries (
  workflow    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  hash        TEXT NOT NULL,
  status      TEXT NOT NULL,
  ts          INTEGER NOT NULL,
  PRIMARY KEY (workflow, user_id)
);

-- wait_until wake routing. `wake_handle` is an opaque handle (the instance id
-- on Cloudflare, a callback id on AWS). The primary key makes the interpreter's
-- re-subscription on every wait attempt idempotent, which its one-shot-callback
-- contract requires.
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id     TEXT NOT NULL,
  event       TEXT NOT NULL,
  wake_handle TEXT NOT NULL,
  ts          INTEGER NOT NULL,
  PRIMARY KEY (wake_handle, event)
);
CREATE INDEX IF NOT EXISTS idx_subs_user_event ON subscriptions (user_id, event);
