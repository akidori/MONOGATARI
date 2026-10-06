// ディレクター用の1日まとめ・ナレッジ提案（Issue #40）の回帰テスト
import assert from "node:assert/strict";
import { directorDigestText, pendingFromMarkdown } from "../worker/src/director-digest.js";
import { qaKnowledgeProposal } from "../worker/src/agentqa.js";

// 何も無い日は送らない
assert.equal(directorDigestText({ today: "2026-10-07" }), "");

const pending = pendingFromMarkdown("- ★AK確認待ち：トラックミキサーの標準設定値\n★AK確認待ち は、まだ答えが決まっていない項目です。\n★AK確認待ち：**標準の調整レイヤー**の見直し", "faq");
assert.deepEqual(pending.map((p) => p.text), ["トラックミキサーの標準設定値", "標準の調整レイヤーの見直し"]);

const text = directorDigestText({
  today: "2026-10-07", appOrigin: "https://app",
  openQuestions: [{ caseName: "森川さん", akQuestion: "BGMの音量は？", askedByName: "村越" }],
  ignored: [{ who: "a@b", count: 2, title: "森川さん 今日が締切" }],
  gaps: [{ caseName: "森川さん", missing: ["プロマネ"] }],
  pending,
});
for (const s of ["2026-10-07 のまとめ", "BGMの音量は？（村越）", "a@b：2件", "森川さん：プロマネ", "トラックミキサーの標準設定値は、どうしますか？", "https://app/"]) assert.ok(text.includes(s), s);
// 6件以上は「ほか」
const many = directorDigestText({ today: "d", openQuestions: Array.from({ length: 8 }, (_, i) => ({ question: "q" + i })) });
assert.ok(many.includes("ほか3件"));

// ナレッジ提案：案件限定・記録しないは出さない。チャンネル共通・全案件共通だけ
const qa = { id: "q_1", date: "2026-10-07", question: "BGMの音量はどれくらい？", answer: "-18dBが目安です。", scope: "全案件共通", caseName: "森川さん", channel: "" };
const prop = qaKnowledgeProposal(qa);
assert.equal(prop.type, "qa");
assert.equal(prop.domain, "Production");
assert.equal(prop.source, "monogataritch:agentq:q_1");
assert.ok(prop.body.includes("Q.\nBGMの音量はどれくらい？") && prop.body.includes("A.\n-18dBが目安です。"));
assert.equal(qaKnowledgeProposal({ ...qa, scope: "この案件限定" }), null);
assert.equal(qaKnowledgeProposal(null), null);
console.log("director-digest: ok");
