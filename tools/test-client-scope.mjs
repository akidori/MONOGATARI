// 先方・演者用リンク（?c=）で返す中身（src/client-scope.js）の回帰テスト（Issue #37）
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clientScopeSnap } from "../src/client-scope.js";

const snap = { createdAt: 1, updatedAt: 2, project: {
  id: "p1", name: "案件", channel: "ch", format: "documentary", theme: { main: "#000", accent: "#f00" }, rate: 5,
  rows: [{ kind: "scene", label: "冒頭", script: "原稿", spine: "内部" }],
  meta: { shootDate: "2026-10-20", place: "東京", highlight: "フック", titles: ["t"], prod: { talents: [{ name: "本名" }] }, note: "内部メモ", deliverVideoUrl: "https://x", handoffGaps: [{ at: 1 }] },
  plans: [{ title: "タイトル", thumbText: "サムネ", files: [{ key: "f" }], memo: "企画メモ" }, { title: "別案" }],
  hearing: [{ items: [{ value: "取材メモ" }] }], review: { versions: [{ url: "v" }] }, files: [{ key: "k" }], assets: [{ key: "a" }],
  channelInfo: { clientNotes: "内部", concept: "c" }, manuals: [{ t: 1 }], manualsGlobal: [{ t: 1 }], shareToken: "tok", liveToken: "lt",
} };
const out = clientScopeSnap(snap);
const p = out.project;
assert.equal(out.scope, "client");
assert.deepEqual(Object.keys(p).sort(), ["channel", "format", "id", "meta", "name", "plans", "rate", "rows", "theme"].sort());
assert.deepEqual(p.meta, { shootDate: "2026-10-20", place: "東京", highlight: "フック", titles: ["t"] });
assert.deepEqual(p.plans, [{ title: "タイトル", thumbText: "サムネ" }]);
assert.equal(p.rows[0].script, "原稿");
assert.equal(p.rows[0].spine, undefined);
// 元のスナップは書き換えない
assert.equal(snap.project.hearing[0].items[0].value, "取材メモ");
// 他のタブ・内部の値が1つも残っていない
const raw = JSON.stringify(out);
for (const s of ["取材メモ", "本名", "内部メモ", "企画メモ", "https://x", "別案", "clientNotes", "tok", "\"lt\""]) assert.ok(!raw.includes(s), s + " が残っている");

// share.html は c= の時に r=/up= を送らず、構成台本と香盤表だけに絞る
const html = readFileSync(new URL("../share.html", import.meta.url), "utf8");
assert.ok(html.includes('const RQ = C ? ("?c=" + encodeURIComponent(C))'));
assert.ok(html.includes('const ALLOW_TABS = C ? ["script","kouban"]'));
assert.ok(html.includes('const UP_TOKEN = C ? ""'));
console.log("client-scope: ok");
