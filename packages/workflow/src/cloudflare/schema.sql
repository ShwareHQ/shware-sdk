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

-- 部署产物：segment 定义（条件求值按名解析）与事件触发路由
CREATE TABLE IF NOT EXISTS segments (
  name      TEXT PRIMARY KEY,
  condition TEXT NOT NULL,
  hash      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS triggers (
  workflow TEXT PRIMARY KEY,
  hash     TEXT NOT NULL,
  event    TEXT NOT NULL,
  filter   TEXT
);
CREATE INDEX IF NOT EXISTS idx_triggers_event ON triggers (event);

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

-- wait_until 唤醒路由：wake_handle 是不透明句柄（CF=instance id；AWS 换 callback token）
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id     TEXT NOT NULL,
  event       TEXT NOT NULL,
  wake_handle TEXT NOT NULL,
  ts          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subs_user_event ON subscriptions (user_id, event);
