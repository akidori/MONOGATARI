// ものがたりっち！ 共有スナップショット発行ツール
// 使い方:
//   node tools/publish.mjs cases/xxx.project.json              … 新規発行 → 共有URLとtokenを表示
//   node tools/publish.mjs cases/xxx.project.json <prevId> <token> … 既存IDを更新（同じURL維持）
// 出力された token は控えておくこと（次回更新に必要）。

import { readFileSync } from "node:fs";

const WORKER = process.env.MG_WORKER || "https://mg-share.aki-surf89315.workers.dev";
const PAGES = process.env.MG_PAGES || "https://akidori.github.io/MONOGATARI";

const [, , file, prevId, token] = process.argv;
if (!file) {
  console.error("usage: node tools/publish.mjs <project.json> [prevId] [token]");
  process.exit(1);
}

const project = JSON.parse(readFileSync(file, "utf8"));
if (!Array.isArray(project.rows)) {
  console.error("invalid project: rows[] がありません");
  process.exit(1);
}

const body = { project };
if (prevId) body.prevId = prevId;
if (token) body.token = token;

const res = await fetch(WORKER + "/api/publish", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const data = await res.json();
if (!data.id) {
  console.error("発行失敗:", data);
  process.exit(1);
}

console.log("✅ 発行しました");
console.log("   共有URL : " + PAGES + "/share.html?id=" + data.id);
console.log("   id      : " + data.id);
console.log("   token   : " + data.token + "   ← 控えておく（次回この case を更新する時に使う）");
