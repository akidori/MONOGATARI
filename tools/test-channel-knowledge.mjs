// チャンネル別の編集ルールをAIの資料に足す（2026-10-06）の回帰テスト
import assert from "node:assert/strict";
import { channelPaths, usableNote, channelBlock, channelKnowledgeBlock, _clearChannelCache, PAGE_MAX, TOTAL_MAX } from "../worker/src/channel-knowledge.js";

// 対応表：アプリのチャンネル表記そのままで引ける。無いチャンネル・空・未分類は何も読まない
assert.deepEqual(channelPaths("スタジアム（運命の職業）"), ["Manuals/client-rules/request-sns.md"]);
assert.deepEqual(channelPaths(" オリックス "), ["Manuals/client-rules/orix.md"]);
for (const c of ["", "未分類", "日体大", "toString", "__proto__", undefined]) assert.deepEqual(channelPaths(c), [], String(c));

// draft・deprecated・置き換え済み・本文なしは渡さない
const note = (o) => ({ found: true, note: { path: "Manuals/client-rules/x.md", title: "X", status: "published", body: "本文", ...o } });
assert.ok(usableNote(note({})));
assert.ok(usableNote(note({ status: "validated" })));
for (const o of [{ status: "draft" }, { status: "deprecated" }, { superseded_by: "y" }, { body: "  " }]) assert.equal(usableNote(note(o)), null, JSON.stringify(o));
assert.equal(usableNote({ found: false }), null);

// 上限：1ページも合計も切る
const big = { path: "a", title: "A", body: "あ".repeat(PAGE_MAX + 500) };
const b1 = channelBlock("ch", [big]);
assert.ok(b1.includes("ここで省略") && b1.length < PAGE_MAX + 600);
const b2 = channelBlock("ch", [big, { ...big, path: "b" }]);
assert.ok(b2.length < TOTAL_MAX + 800, "合計の上限");
assert.equal(channelBlock("ch", []), "");

// 取得：確認済みだけ足す。失敗しても空文字で止まらない。10分キャッシュ
_clearChannelCache();
let calls = 0;
const ok = async (p) => { calls++; return { ok: true, json: async () => note({ path: p, title: "ReQuest", body: "アバンを入れる" }) }; };
const blk = await channelKnowledgeBlock("スタジアム（運命の職業）", ok, 1000);
assert.ok(blk.includes("アバンを入れる") && blk.includes("スタジアム（運命の職業）") && blk.includes("優先"));
await channelKnowledgeBlock("スタジアム（運命の職業）", ok, 2000);
assert.equal(calls, 1, "キャッシュ");
_clearChannelCache();
assert.equal(await channelKnowledgeBlock("オリックス", async () => { throw new Error("x"); }), "");
_clearChannelCache();
assert.equal(await channelKnowledgeBlock("オリックス", async () => ({ ok: true, json: async () => note({ status: "draft" }) })), "");
assert.equal(await channelKnowledgeBlock("未分類", ok), "");
console.log("channel-knowledge ok");
