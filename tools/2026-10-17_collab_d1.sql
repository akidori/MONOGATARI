-- 共同編集の保存先を KV から D1 へ（SaaS化 2本目・2026-10-17）
-- 本番D1（birdflip_ledger）で Worker のデプロイ前に1回だけ実行する:
--   cd worker && npx wrangler d1 execute birdflip_ledger --remote --file ../tools/2026-10-17_collab_d1.sql
-- 未実行のまま Worker を出しても壊れない（collab-store.js が表の有無を見て、無ければ今まで通り KV に書く）。
-- 何度実行しても同じ結果になる。既存の共同編集は、最初に読まれた時に KV から自動で写る。

CREATE TABLE IF NOT EXISTS mg_collab (
  id          TEXT PRIMARY KEY,   -- 案件ID（mg_kv の proj_id と同じ）
  owner_sub   TEXT NOT NULL,      -- 案件の中身はこの人の mg_kv 行（monogataritch-proj-<id>）
  owner_email TEXT NOT NULL,
  name        TEXT,
  channel     TEXT,
  updated_at  TEXT NOT NULL       -- ISO。保存の競合検知（baseUpdatedAt）に使う
);

CREATE TABLE IF NOT EXISTS mg_collab_members (
  collab_id TEXT NOT NULL,
  email     TEXT NOT NULL,        -- 小文字
  added_at  TEXT,
  PRIMARY KEY (collab_id, email)
);
CREATE INDEX IF NOT EXISTS mg_collab_members_email ON mg_collab_members(email);
