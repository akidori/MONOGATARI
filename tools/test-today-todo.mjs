import assert from "node:assert/strict";
import { autoTodos, rollover, addManual, toggle, removeManual, todoList } from "../src/today-todo.js";

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

console.log("today todo tests passed");
