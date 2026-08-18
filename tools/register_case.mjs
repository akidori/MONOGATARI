// ものがたりっち！ 共有スナップ→アプリ案件 登録ツール
//
// 背景（2026-07-29 森川さん事故の再発防止）:
//   tools/publish.mjs やAPI直叩きで発行した台本は snap:<shareId> にしか存在せず、
//   所有者のクラウド保存(D1 mg_kv)と案件インデックスに入らない＝アプリのサイドバーに出ない。
//   その手動復旧手順（KV読み→proj書き→index追記）を1コマンドに自動化したもの。
//
// 使い方:
//   node tools/register_case.mjs <shareId>                 … AKの口座(既定sub)に登録
//   node tools/register_case.mjs <shareId> --sub <googleSub> --id <projId8桁>
//
// 必要条件: worker/wrangler.toml が読める場所で実行（KV/D1へは wrangler 経由でアクセス）

import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WRANGLER = join(ROOT, "node_modules", ".bin", "wrangler");
const KV_NS = "dae9e99997cc4ad29722f28f4c23476f"; // SNAPS
const D1_DB = "birdflip_ledger";
const DEFAULT_SUB = "116526345618127689413";       // AK

const args = process.argv.slice(2);
const shareId = args[0];
if (!shareId || shareId.startsWith("--")) {
  console.error("usage: node tools/register_case.mjs <shareId> [--sub <googleSub>] [--id <projId>]");
  process.exit(1);
}
const opt = (name, dflt) => { const i = args.indexOf("--" + name); return i >= 0 ? args[i + 1] : dflt; };
const sub = opt("sub", DEFAULT_SUB);
const projId = opt("id", Math.random().toString(36).slice(2, 10));

const kvGet = (key) => {
  try {
    return execFileSync(WRANGLER, ["kv", "key", "get", key, "--namespace-id", KV_NS, "--remote"],
      { cwd: join(ROOT, "worker"), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (e) { return null; }
};
const d1 = (sql) => {
  const tmp = join(ROOT, "tools", ".register_tmp.sql");
  writeFileSync(tmp, sql);
  try {
    const out = execFileSync(WRANGLER, ["d1", "execute", D1_DB, "--remote", "--json", "--file", tmp],
      { cwd: join(ROOT, "worker"), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return JSON.parse(out);
  } finally { rmSync(tmp, { force: true }); }
};
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

// 1) 共有スナップと更新トークンを読む
const rawSnap = kvGet("snap:" + shareId);
if (!rawSnap) { console.error("snap:" + shareId + " が見つかりません"); process.exit(1); }
const snap = JSON.parse(rawSnap);
const project = snap.project || snap;
const token = (kvGet("tok:" + shareId) || "").trim();

// 2) 案件本体を組む（shareId/shareToken を入れる＝アプリからの再発行で共有URLが変わらない）
project.id = projId;
project.shareId = shareId;
if (token) project.shareToken = token;
project.updatedAt = Date.now();
if (!project.createdAt) project.createdAt = Date.now();
const name = project.name || "取込案件";
const channel = project.channel || "未分類";
const value = JSON.stringify(project);

// 3) D1 mg_kv へ本体を書く
d1(
  "INSERT INTO mg_kv (sub,key,value,proj_id,case_id,name,channel,bytes,updated_at) VALUES (" +
  [q(sub), q("monogataritch-proj-" + projId), q(value), q(projId), "NULL", q(name), q(channel), String(value.length), String(Date.now())].join(",") +
  ") ON CONFLICT(sub,key) DO UPDATE SET value=excluded.value,name=excluded.name,channel=excluded.channel,bytes=excluded.bytes,updated_at=excluded.updated_at;"
);

// 4) 案件インデックスへ1行追記（read-modify-write）
const idxRes = d1("SELECT value FROM mg_kv WHERE sub=" + q(sub) + " AND key='monogataritch-index-v1';");
let index = [];
try { index = JSON.parse(idxRes[0].results[0].value) || []; } catch (e) {}
if (!index.some((e) => e && e.id === projId)) {
  index.push({ id: projId, name, channel, createdAt: project.createdAt });
  const iv = JSON.stringify(index);
  d1(
    "INSERT INTO mg_kv (sub,key,value,bytes,updated_at) VALUES (" +
    [q(sub), "'monogataritch-index-v1'", q(iv), String(iv.length), String(Date.now())].join(",") +
    ") ON CONFLICT(sub,key) DO UPDATE SET value=excluded.value,bytes=excluded.bytes,updated_at=excluded.updated_at;"
  );
}

console.log("✅ 登録しました");
console.log("   案件ID  : " + projId + "（" + name + " / " + channel + "）");
console.log("   共有ID  : " + shareId + (token ? "（token保持＝再発行で共有URL不変）" : "（⚠️tok未取得）"));
console.log("   アプリをリロードするとサイドバーに出ます");
