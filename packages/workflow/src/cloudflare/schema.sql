-- Journey 引擎数据面（D1）。条件求值 = 评估时现查（惰性，不做实时 segment 物化）。

CREATE TABLE IF NOT EXISTS events (
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

-- 部署产物：segment 定义（条件求值按名解析）与触发路由
CREATE TABLE IF NOT EXISTS segments (
  name      TEXT PRIMARY KEY,
  condition TEXT NOT NULL,
  hash      TEXT NOT NULL
);

-- 事件触发路由；where = 触发事件 payload 的门槛（payload-only 条件树），filter = profile 门槛
CREATE TABLE IF NOT EXISTS triggers (
  workflow  TEXT PRIMARY KEY,
  hash      TEXT NOT NULL,
  event     TEXT NOT NULL,
  "where"   TEXT,
  filter    TEXT
);
CREATE INDEX IF NOT EXISTS idx_triggers_event ON triggers (event);

-- segment-entry 触发路由
CREATE TABLE IF NOT EXISTS segment_triggers (
  workflow TEXT PRIMARY KEY,
  hash     TEXT NOT NULL,
  segment  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_segment_triggers_segment ON segment_triggers (segment);

-- 惰性维护的 segment 成员表：仅覆盖有 trigger 的 segment，在用户 ingest/identify 时
-- 重估进出转换。纯时间漂移（如"30 天未登录"到期）要等该用户下一次活动才被观察到；
-- TODO: cron 扫描时间驱动型 segment。
CREATE TABLE IF NOT EXISTS segment_members (
  segment TEXT NOT NULL,
  user_id TEXT NOT NULL,
  ts      INTEGER NOT NULL,
  PRIMARY KEY (segment, user_id)
);

-- 入流台账：once 策略 + 实例寻址 + 版本 pin 审计
CREATE TABLE IF NOT EXISTS entries (
  workflow    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  hash        TEXT NOT NULL,
  status      TEXT NOT NULL,
  ts          INTEGER NOT NULL,
  PRIMARY KEY (workflow, user_id)
);

-- wait_until 唤醒路由：wake_handle 是不透明句柄（CF=instance id；AWS=callback id）。
-- 主键让解释器每轮 wait 的重复订阅（一次 subscribe 武装一次唤醒的契约）幂等。
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id     TEXT NOT NULL,
  event       TEXT NOT NULL,
  wake_handle TEXT NOT NULL,
  ts          INTEGER NOT NULL,
  PRIMARY KEY (wake_handle, event)
);
CREATE INDEX IF NOT EXISTS idx_subs_user_event ON subscriptions (user_id, event);
