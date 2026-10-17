-- 2026-10-17 SaaS化 1本目：ワークスペース（会社・チーム）とメンバー、個別トークン、利用量の表を足す
-- 設計: https://claude.ai/code/artifact/dbd0590d-c444-482b-975a-3a66204b81f1
-- birdflip_ledger は他のBird Flipの仕組みと共用なので、表はすべて mg_ で始める。
-- 足すだけで既存の行・列は変えない。Worker はまだこの表を読まない（2本目で読む）。
-- 実行（1回だけ。ALTER TABLE は2回目でエラーになる）:
--   cd worker && npx wrangler d1 execute birdflip_ledger --remote --file ../tools/2026-10-17_workspaces.sql

CREATE TABLE IF NOT EXISTS mg_workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'invite',      -- invite / team / pro
  status TEXT NOT NULL DEFAULT 'active',    -- active / suspended（緊急停止）
  limits TEXT NOT NULL DEFAULT '{}',        -- {"storageGB":50,"streamMin":1000,"aiPerDay":100}
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mg_members (
  workspace_id TEXT NOT NULL,
  sub TEXT NOT NULL,                        -- Google sub
  email TEXT NOT NULL,
  role TEXT NOT NULL,                       -- owner / director / editor
  created_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, sub)
);
CREATE INDEX IF NOT EXISTS mg_members_sub ON mg_members(sub);

CREATE TABLE IF NOT EXISTS mg_invites (
  token_hash TEXT PRIMARY KEY,              -- 招待URLのトークンはハッシュだけ保存
  workspace_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mg_tokens (
  token_hash TEXT PRIMARY KEY,              -- プラグイン・MCP用の個別トークン（値はハッシュだけ保存）
  sub TEXT NOT NULL,
  kind TEXT NOT NULL,                       -- plugin / mcp
  label TEXT,
  scope TEXT NOT NULL,                      -- read / write
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS mg_tokens_sub ON mg_tokens(sub);

CREATE TABLE IF NOT EXISTS mg_usage (
  workspace_id TEXT NOT NULL,
  day TEXT NOT NULL,                        -- YYYY-MM-DD（JST）
  metric TEXT NOT NULL,                     -- storage_bytes / stream_min / ai_calls / upload_bytes
  amount REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, day, metric)
);

ALTER TABLE mg_kv ADD COLUMN workspace_id TEXT;
CREATE INDEX IF NOT EXISTS mg_kv_workspace ON mg_kv(workspace_id);
