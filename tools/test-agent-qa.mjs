// AIの学習ループ（worker/src/agentqa.js）の回帰テスト
import assert from "node:assert/strict";
import { applyAnswer, applicableQa, qaSystemBlock, qaToMarkdown, qaSummary, bumpStat, sumStats, QA_NO_RECORD } from "../worker/src/agentqa.js";

const inbox = [
  { id: "q1", at: 1, askedBy: "ed@x.com", askedByName: "編集A", caseId: "c1", caseName: "山岸さん密着", channel: "町工場", question: "★のセリフを撮影前にLINEで聞いて埋めていい？", akQuestion: "山岸さん密着（c1）で、#3の★を撮影前に聞き取って埋めてよいですか？ 当日引き出す前提です。", status: "open" },
  { id: "q2", at: 2, askedBy: "ed@x.com", question: "機材のレンタル代は経費？", akQuestion: "ハイスピードカメラのレンタル代を経費で出してよいですか？", status: "open" },
];
const now = Date.parse("2026-10-04T03:00:00Z"); // JST 12:00

// 回答：状態・記録・入力チェック
{
  const r = applyAnswer(inbox, "q1", { answer: "当日本人から引き出す。事前に埋めない。", scope: "全案件共通", by: "ak@x.com", now });
  assert.equal(r.item.status, "answered"); assert.equal(r.item.answeredBy, "ak@x.com");
  assert.equal(inbox[0].status, "open"); // 元の配列は変えない
  assert.equal(r.qa.date, "2026-10-04"); assert.equal(r.qa.scope, "全案件共通"); assert.equal(r.qa.channel, "町工場");
  assert.equal(r.qa.summary, "山岸さん密着（c1）で、#3の★を撮影前に聞き取って埋めてよいですか？");
  assert.equal(applyAnswer(r.inbox, "q1", { answer: "x", scope: "全案件共通" }).status, 409); // 二重回答しない
  assert.equal(applyAnswer(inbox, "q1", { answer: "  ", scope: "全案件共通" }).status, 400);
  assert.equal(applyAnswer(inbox, "q1", { answer: "x", scope: "なんでも" }).status, 400);
  assert.equal(applyAnswer(inbox, "nope", { answer: "x", scope: "全案件共通" }).status, 404);
  assert.equal(applyAnswer(inbox, "q1", { answer: "x".repeat(4001), scope: "全案件共通" }).status, 413);
  // 手がかりの無い範囲は選べない（q2 は案件もチャンネルも無い）
  assert.equal(applyAnswer(inbox, "q2", { answer: "x", scope: "この案件限定" }).status, 400);
  assert.equal(applyAnswer(inbox, "q2", { answer: "x", scope: "このチャンネル共通" }).status, 400);
  assert.equal(applyAnswer(inbox, "q1", { answer: "x", scope: "このチャンネル共通" }).item.status, "answered");
  // 「記録しない」は本人に返すだけで、AIの資料には入れない
  const r2 = applyAnswer(inbox, "q2", { answer: "今回は経費でOK", scope: QA_NO_RECORD, now });
  assert.equal(r2.qa, null); assert.equal(r2.item.status, "answered");
}

// 要約：1文目・最大48字
assert.equal(qaSummary("短い質問です。続きの文。"), "短い質問です。");
assert.equal(qaSummary("あ".repeat(60)).length, 48);

// 当てはまる回答だけをAIに渡す
{
  const qa = [
    { id: "a", date: "2026-10-04", summary: "全体", caseId: "c1", channel: "町工場", question: "q", answer: "A", scope: "全案件共通" },
    { id: "b", date: "2026-10-04", summary: "チャンネル", caseId: "c1", channel: "町工場", question: "q", answer: "B", scope: "このチャンネル共通" },
    { id: "c", date: "2026-10-04", summary: "案件", caseId: "c1", channel: "町工場", question: "q", answer: "C", scope: "この案件限定" },
  ];
  assert.deepEqual(applicableQa(qa, {}).map((e) => e.id), ["a"]);
  assert.deepEqual(applicableQa(qa, { channel: "町工場" }).map((e) => e.id), ["a", "b"]);
  assert.deepEqual(applicableQa(qa, { caseId: "c1", channel: "町工場" }).map((e) => e.id), ["a", "b", "c"]);
  assert.deepEqual(applicableQa(qa, { caseId: "c2", channel: "別" }).map((e) => e.id), ["a"]);
  assert.equal(qaSystemBlock([], {}), "");
  const blk = qaSystemBlock(qa, { caseId: "c1", channel: "町工場" });
  assert.ok(blk.includes("knowledge/qa.md の追記分"));
  assert.ok(blk.includes("**AKの回答**: C") && blk.includes("**適用範囲**: この案件限定"));
}

// qa.md と同じ形式
{
  const md = qaToMarkdown([{ date: "2026-10-04", summary: "要約", caseName: "山岸さん密着", channel: "町工場", question: "質問", answer: "回答", scope: "全案件共通" }]);
  assert.equal(md, "## 2026-10-04 要約\n**案件**: 山岸さん密着（町工場）\n**質問**: 質問\n**AKの回答**: 回答\n**適用範囲**: 全案件共通");
  assert.ok(qaToMarkdown([{ date: "d", summary: "s", question: "q", answer: "a", scope: "全案件共通" }]).includes("**案件**: （案件なし）"));
}

// 継続判断の集計
{
  let d = bumpStat(null, "回答"); d = bumpStat(d, "AKへ"); d = bumpStat(d, "回答");
  assert.deepEqual(d, { 回答: 2, AKへ: 1 });
  assert.deepEqual(sumStats([d, null, { 回答: 1, AKへ: 0 }]), { 回答: 3, AKへ: 1, total: 4, directRate: 75 });
  assert.equal(sumStats([]).directRate, null);
}

console.log("agent qa loop tests passed");
