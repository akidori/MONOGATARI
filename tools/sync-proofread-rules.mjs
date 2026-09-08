#!/usr/bin/env node
/* Obsidian（birdflip-knowledge）の編集ルールを、校正機能が読める場所へ写す。
 *
 * 正本はObsidian側。ここは「Workerが読める写し」を作るだけで、編集はしない。
 * 2026-09-08にAK「Obsidianと連携してないの？」で判明したこと:
 *   表記統一ルール等はObsidianに実在するのに、ものがたりっちの決め事は0件、
 *   Studio OSのregulation_rulesも承認フロー系7件だけで、テキスト校正に使える
 *   ルールがどのアプリにも流れていなかった。
 *
 * 使い方（CLIだけで完結。ブラウザのセッションは要らない）:
 *   node tools/sync-proofread-rules.mjs          … wrangler で KV へ直接書く
 *   node tools/sync-proofread-rules.mjs --dry    … 送らずに中身だけ確認
 *   MG_SESSION=<mg:session> node tools/sync-proofread-rules.mjs --api  … APIから入れたい時だけ
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const VAULT = process.env.KNOWLEDGE_DIR || path.join(os.homedir(), "birdflip-knowledge");
const API = process.env.SHARE_API || "https://mg-share.aki-surf89315.workers.dev";
const DRY = process.argv.includes("--dry");

// 対象ディレクトリ。企画用の質問テンプレ（QuestionTemplate）は入れない＝文章の校正には効かないため。
const DIRS = ["Production/QA", "Production/Rule", "Studio OS/Regulations"];
// 見出し・タグに「文章を見て判定できる」語が入っているものだけを拾う。
const PICK = /表記|テロップ|フリガナ|NG|禁止|コンプラ|規定|レギュレーション|編集ルール|言い間違い|注意書き|社名/;

const readFm = (t) => {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(t);
  return m ? m[1] : "";
};
const field = (fm, k) => {
  const m = new RegExp("^" + k + ":\\s*(.+)$", "m").exec(fm);
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
};

const rules = [];
for (const dir of DIRS) {
  const abs = path.join(VAULT, dir);
  if (!fs.existsSync(abs)) continue;
  for (const f of fs.readdirSync(abs).sort()) {
    if (!f.endsWith(".md")) continue;
    const p = path.join(abs, f);
    const t = fs.readFileSync(p, "utf8");
    const fm = readFm(t);
    if (!PICK.test(fm + f)) continue;
    if (field(fm, "status") === "draft") continue;   // 下書きは配らない
    // frontmatterと「関連」以降の空リンクは落とす。プロンプトに入れて意味のある本文だけ残す。
    const body = t.slice(fm ? t.indexOf("---", 4) + 4 : 0)
      .replace(/^\s*#\s+.*\n/, "")
      .split(/\n## 関連\n/)[0]
      .replace(/\*出典:[\s\S]*$/, "")
      .trim();
    if (!body) continue;
    rules.push({ id: field(fm, "id") || f.replace(/\.md$/, ""), title: field(fm, "title") || f.replace(/\.md$/, ""), path: dir + "/" + f, body });
  }
}

const chars = rules.reduce((n, r) => n + r.body.length, 0);
console.log(`対象 ${rules.length}件 / ${chars}文字`);
for (const r of rules) console.log(`  ${String(r.body.length).padStart(5)}  ${r.title}`);
if (DRY) process.exit(0);

const doc = { rules, updatedAt: new Date().toISOString(), by: "cli" };

if (process.argv.includes("--api")) {
  // APIから入れる経路（AKのログインセッションが要る）。通常はKV直書きで十分。
  const session = process.env.MG_SESSION;
  if (!session) { console.error("--api には MG_SESSION が要ります"); process.exit(1); }
  const res = await fetch(API + "/api/proofread/rules", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + session },
    body: JSON.stringify({ rules }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.ok) { console.error("送信に失敗:", res.status, d.error || ""); process.exit(1); }
  console.log(`送信しました: ${d.count}件 / ${d.chars}文字`);
  process.exit(0);
}

// 既定: wrangler で KV へ直接書く。CIでもローカルでもブラウザ無しで回せる。
// namespace id は worker/wrangler.toml の SNAPS と同じもの。
const NS = process.env.SNAPS_NAMESPACE_ID || "dae9e99997cc4ad29722f28f4c23476f";
const tmp = path.join(os.tmpdir(), "proofread-rules-" + Date.now() + ".json");
fs.writeFileSync(tmp, JSON.stringify(doc));
const { spawnSync } = await import("node:child_process");
const r = spawnSync("npx", ["wrangler", "kv", "key", "put", "--namespace-id=" + NS, "--remote", "proofread:rules:v1", "--path=" + tmp],
  { stdio: "inherit", cwd: path.join(import.meta.dirname, "..") });
fs.unlinkSync(tmp);
if (r.status !== 0) { console.error("KVへの書き込みに失敗しました"); process.exit(1); }
console.log(`KVへ書きました: ${rules.length}件 / ${chars}文字`);
