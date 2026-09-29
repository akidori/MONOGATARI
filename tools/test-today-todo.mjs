import assert from "node:assert/strict";
import { autoTodos, rollover, addManual, toggle, removeManual, todoList, stepsFor, toggleStep, fmtSec } from "../src/today-todo.js";

const cases = [
  { caseId: "a", title: "森川さん", pace: "遅れ", current: { name: "本編集" }, mine: { name: "本編集", deadline: "2026-09-24", days: -5 } },
  { caseId: "b", title: "日体大", pace: "もうすぐ", current: { name: "先方チェック" }, mine: { name: "最終修正", deadline: "2026-09-30", days: 1 } }, // 待ち
  { caseId: "c", title: "青木さん", pace: "今日", current: { name: "テロップ" }, mine: { name: "テロップ", deadline: "2026-09-29", days: 0 } },
  { caseId: "d", title: "井下さん", pace: "余裕", current: { name: "本編集" }, mine: { name: "本編集", deadline: "2026-10-10", days: 11 } },
  { caseId: "e", title: "石野さん", pace: "もうすぐ", current: { name: "本編集" }, mine: { name: "本編集", deadline: "2026-10-01", days: 2 } },
];
const a = autoTodos(cases);
assert.deepEqual(a.map((x) => x.caseId), ["a", "c", "e"]);
assert.equal(a[0].badge, "遅れ・5日");
assert.equal(a[1].badge, "今日締切");
assert.equal(a[2].badge, "あと2日");
assert.equal(a[0].text, "森川さん：本編集を進める");

let s = rollover(null, "2026-09-29");
s = addManual(s, "  請求書を送る ", "m1");
s = addManual(s, "", "m2");
s = addManual(s, "サムネ確認", "m3");
assert.equal(s.manual.length, 2);
s = toggle(s, "m1");
s = toggle(s, a[0].id);
let l = todoList(s, cases);
assert.equal(l.total, 5);
assert.deepEqual(l.done.map((x) => x.id).sort(), [a[0].id, "m1"].sort());
s = toggle(s, a[0].id);
assert.equal(todoList(s, cases).done.length, 1);
// 同じ日はそのまま、翌日は未完了の手動だけ持ち越し
assert.deepEqual(rollover(s, "2026-09-29").manual, s.manual);
const next = rollover({ ...s, doneAuto: { [a[1].id]: true } }, "2026-09-30");
assert.deepEqual(next.manual.map((m) => m.id), ["m3"]);
assert.equal(next.manual[0].carried, true);
assert.deepEqual(next.doneAuto, {});
assert.equal(removeManual(next, "m3").manual.length, 0);

// 手順分け（2026-09-29）：工程の型＋構成台本のセクション
const rough = stepsFor("粗編集", ["オープニング", "工房紹介"]);
assert.deepEqual(rough.slice(0, 3).map((x) => x.title), ["素材をシーケンスにインポート", "まず00のファイルをシーケンスに並べる", "音声を同期する"]);
assert.ok(rough.some((x) => x.title === "00 オープニングの粗カット"));
assert.ok(rough.some((x) => x.title === "01 工房紹介の粗カット"));
assert.equal(fmtSec(10), "10秒");
assert.equal(fmtSec(300), "5分");
assert.ok(stepsFor("本編集", []).some((x) => x.title.includes("頭から通しで")), "セクションが無い時は通しの手順1つにまとめる");
assert.ok(stepsFor("修正対応", ["A"])[0].title.includes("指摘"));
assert.ok(stepsFor("先方チェック", []).length >= 2, "型が無い工程も分ける");

const withSec = [{ ...cases[0], sections: ["オープニング", "工房紹介"] }];
let t = rollover(null, "2026-09-29");
let item = todoList(t, withSec).open[0];
assert.equal(item.next.title, "粗カットを通しで見直す");
assert.ok(item.steps.some((x) => x.title === "00 オープニングの本編集（テンポ・BGM・SE）"));
t = toggleStep(t, item.id, 0, item.steps.length);
item = todoList(t, withSec).open[0];
assert.equal(item.stepsDone, 1);
assert.equal(item.next.title, "00 オープニングの本編集（テンポ・BGM・SE）");
// 手順のチェックは翌日も残る（工程が数日かかるため）
assert.deepEqual(rollover(t, "2026-09-30").steps[item.id], [0]);
// 全部チェックしたら親も完了、1つ外したら戻る
for (let i = 1; i < item.steps.length; i++) t = toggleStep(t, item.id, i, item.steps.length);
assert.equal(todoList(t, withSec).done.length, 1);
t = toggleStep(t, item.id, 2, item.steps.length);
assert.equal(todoList(t, withSec).done.length, 0);
assert.equal(todoList(t, withSec).open[0].next.title, item.steps[2].title);

console.log("today todo tests passed");
