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
-- The id is per user: the key is (user_id, id), so one sender's id can never
-- block another user's event, and a producer only has to keep its ids unique
-- within a user.
--
-- Only the sender knows whether two deliveries describe one occurrence or two,
-- so the engine never invents that answer: an ingest that arrives without an id
-- is given a fresh one, which is a truthful "this is its own occurrence" rather
-- than a guess.
CREATE TABLE IF NOT EXISTS events (
  id      TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name    TEXT NOT NULL,
  ts      INTEGER NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_events_user_name_ts ON events (user_id, name, ts);

CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY,
  props   TEXT NOT NULL DEFAULT '{}'
);

-- Workflow bodies (WorkflowIR JSON), content-addressed. They live beside the
-- routes that point at them so a deploy is read-your-writes: the trigger row
-- and the body it names are in one strongly consistent database, and a route
-- never names a body another store has yet to catch up on.
CREATE TABLE IF NOT EXISTS workflow_ir (
  content_hash TEXT PRIMARY KEY,
  ir           TEXT NOT NULL
);

-- Deploy artefacts: segment definitions (resolved by id during evaluation)
-- and the trigger routing table.
-- Push devices: one row per provider token, owned by the user who registered it last.
-- user_id is null for a device whose user signed out: it stays registered until the next
-- sign-in binds it again. A database created while it was NOT NULL needs the table rebuilt.
CREATE TABLE IF NOT EXISTS devices (
  token    TEXT PRIMARY KEY,
  user_id  TEXT,
  platform TEXT NOT NULL,
  ts       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_devices_user_ts ON devices (user_id, ts);

CREATE TABLE IF NOT EXISTS segments (
  id        TEXT PRIMARY KEY,
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
-- identified, and by the scheduled sweep (journeyWorker's `scheduled`), which
-- also catches drift driven purely by the clock.
CREATE TABLE IF NOT EXISTS segment_members (
  segment TEXT NOT NULL,
  user_id TEXT NOT NULL,
  ts      INTEGER NOT NULL,
  PRIMARY KEY (segment, user_id)
);

-- Workflows a segment entry still has to start for a member: written with the
-- membership, removed as each starts, so a failed start is retried by the next
-- evaluation instead of being hidden behind the membership.
CREATE TABLE IF NOT EXISTS segment_starts (
  segment  TEXT NOT NULL,
  workflow TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  ts       INTEGER NOT NULL,
  PRIMARY KEY (segment, workflow, user_id)
);

-- Erasure tombstones (forgetUser): every write about a user is conditional on
-- no row here. While erased_at is null the user's data stays until every
-- running instance is stopped, and the scheduled sweep retries what is left;
-- once set, the data is gone and the row stays so the id is never written again.
CREATE TABLE IF NOT EXISTS erasures (
  user_id   TEXT PRIMARY KEY,
  ts        INTEGER NOT NULL,
  erased_at INTEGER
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
  -- When the runner admitted itself (admitInstance), before its first
  -- observable effect; null until then, so an erasure knows nothing of the
  -- instance has run yet.
  admitted_at INTEGER,
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
