// 2026-10-17 SaaS化 1本目：既存の案件を1つのワークスペースへ入れるSQLを作る（実行はしない・標準出力に出すだけ）
// 使い方:
//   node tools/seed-workspace.mjs --id ws_birdflip --name "Bird Flip" --owner-sub <Google sub> --owner-email <メール> > /tmp/seed.sql
//   cd worker && npx wrangler d1 execute birdflip_ledger --remote --file /tmp/seed.sql
// 何度流しても同じ結果（INSERT OR IGNORE・workspace_id が空の行だけ埋める）。
// 入れるのはオーナー本人の行（案件・設定）だけ。他の人の行は招待して入った時に移す。
import { pathToFileURL } from "node:url";

const ID_RE = /^ws_[a-z0-9_]{2,40}$/;
const SUB_RE = /^[0-9]{5,40}$/;
const EMAIL_RE = /^[^\s@'"]+@[^\s@'"]+\.[^\s@'"]+$/;

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

export function buildSeedSql({ id, name, ownerSub, ownerEmail, now = Date.now() }) {
  if (!ID_RE.test(id || "")) throw new Error("--id は ws_ で始まる英小文字・数字・_（例 ws_birdflip）");
  if (!name || name.length > 80) throw new Error("--name が空か長すぎます");
  if (!SUB_RE.test(ownerSub || "")) throw new Error("--owner-sub は Google の sub（数字）");
  if (!EMAIL_RE.test(ownerEmail || "")) throw new Error("--owner-email がメールアドレスの形ではありません");
  return [
    `INSERT OR IGNORE INTO mg_workspaces (id, name, plan, status, limits, created_at) VALUES (${q(id)}, ${q(name)}, 'invite', 'active', '{}', ${Number(now)});`,
    `INSERT OR IGNORE INTO mg_members (workspace_id, sub, email, role, created_at) VALUES (${q(id)}, ${q(ownerSub)}, ${q(ownerEmail.toLowerCase())}, 'owner', ${Number(now)});`,
    `UPDATE mg_kv SET workspace_id = ${q(id)} WHERE workspace_id IS NULL AND sub = ${q(ownerSub)};`,
  ].join("\n") + "\n";
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i], v = argv[i + 1];
    if (k === "--id") out.id = v;
    else if (k === "--name") out.name = v;
    else if (k === "--owner-sub") out.ownerSub = v;
    else if (k === "--owner-email") out.ownerEmail = v;
    else throw new Error("知らない引数: " + k);
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    process.stdout.write(buildSeedSql(parseArgs(process.argv.slice(2))));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
