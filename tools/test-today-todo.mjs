import assert from "node:assert/strict";
import { autoTodos, rollover, addManual, toggle, removeManual, todoList, stepsFor, toggleStep, fmtSec, sectionsFromRows, restSec, linkCaseSections, loadScheduleRows } from "../src/today-todo.js";

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
assert.deepEqual(rough.slice(0, 3).map((x) => x.title), ["素材をシーケンスにインポート", "まず最初のロケのファイルをシーケンスに並べる", "音声を同期する"]);
assert.ok(rough.some((x) => x.title === "01 オープニングの粗カット"));
assert.ok(rough.some((x) => x.title === "02 工房紹介の粗カット"));
assert.equal(fmtSec(10), "10秒");
assert.equal(fmtSec(300), "約5分");
assert.equal(fmtSec(5400), "約1時間30分");
assert.equal(fmtSec(7200), "約2時間");

// 香盤表と連動（2026-10-02）：ロケ番号は香盤表のまま、ロケ名の撮影時刻は外し、目安はシーン数から
const kouban = sectionsFromRows([
  { kind: "location", label: "01｜大阪工場 13:00〜15:00" }, { kind: "scene" }, { kind: "scene" }, { kind: "scene" }, { kind: "scene" }, { kind: "scene" }, { kind: "scene" },
  { kind: "location", label: "03-B｜車内（京都へ移動中）15:10〜15:50" }, { kind: "scene" },
  { kind: "location", label: "京都本社" },
]);
assert.deepEqual(kouban, [{ no: "01", name: "大阪工場", scenes: 6 }, { no: "03-B", name: "車内（京都へ移動中）", scenes: 1 }, { no: "03", name: "京都本社", scenes: 0 }]);
const kr = stepsFor("粗編集", kouban);
const osaka = kr.find((x) => x.title === "01 大阪工場の粗カット（6シーン）");
assert.ok(osaka, "香盤表の番号とロケ名・シーン数で出る");
assert.equal(osaka.sec, 1800, "1シーン5分×6");
assert.ok(kr.some((x) => x.title === "03 京都本社の粗カット" && x.sec === 1800), "シーンが無いロケは1ロケ分の目安");
assert.equal(restSec([{ sec: 60, done: true }, { sec: 120 }, { sec: 30 }]), 150);
assert.ok(stepsFor("本編集", []).some((x) => x.title.includes("頭から通しで")), "セクションが無い時は通しの手順1つにまとめる");
assert.ok(stepsFor("修正対応", ["A"])[0].title.includes("指摘"));
assert.ok(stepsFor("先方チェック", []).length >= 2, "型が無い工程も分ける");

const withSec = [{ ...cases[0], sections: ["オープニング", "工房紹介"] }];
let t = rollover(null, "2026-09-29");
let item = todoList(t, withSec).open[0];
assert.equal(item.next.title, "粗カットを通しで見直す");
assert.ok(item.steps.some((x) => x.title === "01 オープニングの本編集（テンポ・BGM・SE）"));
t = toggleStep(t, item.id, 0, item.steps.length);
item = todoList(t, withSec).open[0];
assert.equal(item.stepsDone, 1);
assert.equal(item.next.title, "01 オープニングの本編集（テンポ・BGM・SE）");
// 手順のチェックは翌日も残る（工程が数日かかるため）
assert.deepEqual(rollover(t, "2026-09-30").steps[item.id], [0]);
// 全部チェックしたら親も完了、1つ外したら戻る
for (let i = 1; i < item.steps.length; i++) t = toggleStep(t, item.id, i, item.steps.length);
assert.equal(todoList(t, withSec).done.length, 1);
t = toggleStep(t, item.id, 2, item.steps.length);
assert.equal(todoList(t, withSec).done.length, 0);
assert.equal(todoList(t, withSec).open[0].next.title, item.steps[2].title);

// 読めた空の香盤表は正本。削除したロケをWorkerの古い情報で復活させない。
const stale = [{ ...cases[0], sections: ["古いロケ"] }];
assert.deepEqual(linkCaseSections(stale, {})[0].sections, ["古いロケ"], "未読込は既存情報を使う");
assert.deepEqual(linkCaseSections(stale, { a: [] })[0].sections, [], "空の最新データを優先");
assert.deepEqual(linkCaseSections(stale, { a: null })[0].sections, ["古いロケ"], "失敗時は既存情報を使う");
assert.deepEqual(sectionsFromRows({ bad: true }), []);
assert.doesNotThrow(() => stepsFor("本編集", { bad: true }));
assert.equal(sectionsFromRows([{ kind: "location", label: "工房" }, { kind: "note" }, { kind: "scene" }, null])[0].scenes, 1);
assert.deepEqual(sectionsFromRows([{ kind: "location", label: "13:00〜14:00 工場" }, { kind: "location", label: "3Dスタジオ" }]), [
  { no: "01", name: "工場", scenes: 0 }, { no: "02", name: "3Dスタジオ", scenes: 0 },
]);
assert.equal(todoList(addManual(rollover(null, "2026-10-02"), "手動の構成確認", "manual"), linkCaseSections(stale, { a: [] })).open.some((x) => x.id === "manual"), true, "空の香盤表でも手動TODOは残す");

// 手順の読込前に最後の作業をチェック→ロケが増えても別のロケにチェックを移さない。
let stableState = rollover(null, "2026-10-02");
const work = [{ ...cases[0], sections: [] }];
let before = todoList(stableState, work).open[0];
const exportIndex = before.steps.findIndex((st) => st.title === "書き出してスマホで確認する");
stableState = toggleStep(stableState, before.id, exportIndex, before.steps.length, before.steps);
const rows = [
  { id: "loc-a", kind: "location", label: "01｜大阪工場 13:00〜15:00" }, { kind: "scene" },
  { id: "loc-b", kind: "location", label: "02｜京都本社" }, { kind: "scene" },
];
let linked = linkCaseSections(work, { a: rows });
let after = todoList(stableState, linked).open[0];
assert.equal(after.steps.find((st) => st.title === "書き出してスマホで確認する").done, true);
assert.ok(after.steps.filter((st) => st.key.startsWith("section:")).every((st) => !st.done));
const osakaIndex = after.steps.findIndex((st) => st.key.includes("loc-a"));
stableState = toggleStep(stableState, after.id, osakaIndex, after.steps.length, after.steps);
const reordered = linkCaseSections(work, { a: [rows[2], rows[3], rows[0], rows[1]] });
after = todoList(stableState, reordered).open[0];
assert.equal(after.steps.find((st) => st.key.includes("loc-a")).done, true, "チェックはロケに追従");
assert.equal(after.steps.find((st) => st.key.includes("loc-b")).done, false);
for (let i = 0; i < after.steps.length; i++) if (!after.steps[i].done) stableState = toggleStep(stableState, after.id, i, after.steps.length, after.steps);
assert.equal(todoList(stableState, reordered).done.length, 1);
const extended = linkCaseSections(work, { a: [...rows, { id: "loc-c", kind: "location", label: "03｜追加ロケ" }] });
after = todoList(stableState, extended).open[0];
assert.ok(after.next.key.includes("loc-c"), "ロケ追加で未完了に戻り、追加分から再開");
stableState = toggle(stableState, after.id, after.done);
assert.equal(todoList(stableState, extended).done.length, 1, "親の明示的な完了操作を優先");
assert.deepEqual(rollover(stableState, "2026-10-03").stepKeys, stableState.stepKeys);

// 既存の番号ベース保存も読込前の手順と照合し、別の作業へ誤適用しない。
const legacy = { ...rollover(null, "2026-10-02"), steps: { [before.id]: [exportIndex] } };
const legacyList = todoList(legacy, linked).open[0];
assert.equal(legacyList.steps.find((st) => st.title === "書き出してスマホで確認する").done, true);
assert.ok(legacyList.steps.filter((st) => st.key.startsWith("section:")).every((st) => !st.done));
const namesOnly = [{ ...cases[0], sections: ["01｜大阪工場 13:00〜15:00", "02｜京都本社"] }];
const legacyNamed = { ...rollover(null, "2026-10-02"), steps: { [before.id]: [1] } };
assert.equal(todoList(legacyNamed, linkCaseSections(namesOnly, { a: rows })).open[0].steps[1].done, true, "旧ロケ名からキーへ移行");

// 未照合の旧チェックは消さない。空の香盤表で別手順を操作しても、ロケが戻れば再照合できる。
{
  const sourceCases = [{ ...cases[0], sections: ["01｜旧ロケ"] }];
  const locationRows = [{ id: "preserved-location", kind: "location", label: "01｜旧ロケ" }];
  const restoredCases = linkCaseSections(sourceCases, { a: locationRows });
  const emptyCases = linkCaseSections(sourceCases, { a: [] });
  let saved = { ...rollover(null, "2026-10-02"), steps: { [before.id]: [1, 99] },
    manual: [{ id: "keep-manual", text: "手動の確認", done: false }, { id: "keep-checked", text: "完了済み", done: true }] };
  const original = structuredClone(saved), sourceBefore = structuredClone(sourceCases);
  let visible = todoList(saved, emptyCases).open.find((x) => x.auto);
  assert.equal(visible.steps.some((st) => st.key.includes("preserved-location")), false, "空の香盤表ではロケを表示しない");
  const exportAt = visible.steps.findIndex((st) => st.title === "書き出してスマホで確認する");
  saved = toggleStep(saved, visible.id, exportAt, visible.steps.length, visible.steps);
  assert.deepEqual(saved.steps, original.steps, "未照合・範囲外の旧番号も保存したまま");
  assert.deepEqual(saved.manual, original.manual, "別手順の操作で手動TODOのチェックは変えない");
  assert.deepEqual(saved.stepLegacyResolved[visible.id], [], "見えていない旧チェックを照合済みにしない");
  assert.deepEqual(sourceCases, sourceBefore, "空の香盤表は表示用投影だけで元案件を変更しない");
  assert.deepEqual(locationRows, [{ id: "preserved-location", kind: "location", label: "01｜旧ロケ" }]);
  visible = todoList(saved, restoredCases).open.find((x) => x.auto);
  const locationAt = visible.steps.findIndex((st) => st.key.includes("preserved-location"));
  assert.equal(visible.steps[locationAt].done, true, "戻ったロケには未照合の旧チェックを復元");
  assert.equal(visible.steps[exportAt].done, true, "先に操作した別手順も保持");
  saved = toggleStep(saved, visible.id, locationAt, visible.steps.length, visible.steps);
  assert.equal(todoList(saved, restoredCases).open.find((x) => x.auto).steps[locationAt].done, false, "旧チェックを明示的に外せる");
  assert.deepEqual(saved.stepLegacyResolved[visible.id], [1]);
  assert.deepEqual(saved.steps, original.steps, "照合済みでも原本の旧番号は消さない");
  const nextDay = rollover(saved, "2026-10-03");
  for (const field of ["steps", "stepKeys", "stepLegacyResolved", "stepUnchecked", "stepAutoCompleted"]) {
    assert.deepEqual(nextDay[field], saved[field], field + " は日付をまたいで保持");
  }
  assert.equal(todoList(nextDay, restoredCases).open.find((x) => x.auto).steps[locationAt].done, false, "再読込・翌日も意図的な解除を復活させない");
  visible = todoList(nextDay, restoredCases).open.find((x) => x.auto);
  saved = toggleStep(nextDay, visible.id, locationAt, visible.steps.length, visible.steps);
  assert.equal(todoList(saved, restoredCases).open.find((x) => x.auto).steps[locationAt].done, true, "解除後に利用者が再チェックできる");
  assert.deepEqual(original.steps[before.id], [1, 99], "入力の原本を破壊しない");
}

// 同名ロケへの照合は曖昧なら保留。明示的に外したキーを後の一意な照合で復活させない。
{
  const sourceCases = [{ ...cases[0], sections: ["01｜同名ロケ"] }];
  const duplicateRows = [
    { id: "dup-a", kind: "location", label: "01｜同名ロケ" },
    { id: "dup-b", kind: "location", label: "01｜同名ロケ" },
  ];
  const ambiguousCases = linkCaseSections(sourceCases, { a: duplicateRows });
  let saved = { ...rollover(null, "2026-10-02"), steps: { [before.id]: [1] } };
  let visible = todoList(saved, ambiguousCases).open[0];
  assert.ok(visible.steps.filter((st) => st.key.startsWith("section:")).every((st) => !st.done), "曖昧な旧チェックを両方へ複製しない");
  const locationAt = visible.steps.findIndex((st) => st.key.includes("dup-a"));
  saved = toggleStep(saved, visible.id, locationAt, visible.steps.length, visible.steps);
  visible = todoList(saved, ambiguousCases).open[0];
  saved = toggleStep(saved, visible.id, locationAt, visible.steps.length, visible.steps);
  assert.deepEqual(saved.steps[before.id], [1]);
  assert.deepEqual(saved.stepLegacyResolved[before.id], [], "曖昧な原本は未照合として残す");
  const uniqueCases = linkCaseSections(sourceCases, { a: duplicateRows.slice(0, 1) });
  assert.equal(todoList(saved, uniqueCases).open[0].steps[locationAt].done, false, "後に一意になっても明示解除を上書きしない");
  const uniqueOtherCases = linkCaseSections(sourceCases, { a: duplicateRows.slice(1) });
  assert.equal(todoList(saved, uniqueOtherCases).open[0].steps[locationAt].done, false, "同名の別IDへ未照合の旧チェックを復活させない");
  // 旧ソース自体も同名が2つなら、現在のロケが1つでも旧番号の意味を推測しない。
  const duplicateSource = [{ ...cases[0], sections: ["01｜同名ロケ", "01｜同名ロケ"] }];
  const unresolved = { ...rollover(null, "2026-10-02"), steps: { [before.id]: [1] } };
  assert.equal(todoList(unresolved, linkCaseSections(duplicateSource, { a: duplicateRows.slice(0, 1) })).open[0].steps[locationAt].done, false);
  // 同名でも利用者がID別に付けたチェックは独立。一方の解除で他方を消さない。
  let explicit = rollover(null, "2026-10-02");
  for (const locationId of ["dup-a", "dup-b"]) {
    visible = todoList(explicit, ambiguousCases).open[0];
    const at = visible.steps.findIndex((st) => st.key.includes(locationId));
    explicit = toggleStep(explicit, visible.id, at, visible.steps.length, visible.steps);
  }
  visible = todoList(explicit, ambiguousCases).open[0];
  explicit = toggleStep(explicit, visible.id, locationAt, visible.steps.length, visible.steps);
  const distinct = todoList(explicit, ambiguousCases).open[0].steps;
  assert.equal(distinct.find((st) => st.key.includes("dup-a")).done, false);
  assert.equal(distinct.find((st) => st.key.includes("dup-b")).done, true);
}

// 読込前にロケ名キーで保存したチェックも、一意ならロケIDへ引き継ぐ。旧キーは原本として保持。
{
  let saved = rollover(null, "2026-10-02");
  let visible = todoList(saved, namesOnly).open[0];
  saved = toggleStep(saved, visible.id, 1, visible.steps.length, visible.steps);
  const originalKeys = [...saved.stepKeys[visible.id]];
  visible = todoList(saved, linkCaseSections(namesOnly, { a: rows })).open[0];
  assert.equal(visible.steps[1].done, true, "ロケ名キーからロケIDへ一意に照合");
  saved = toggleStep(saved, visible.id, 1, visible.steps.length, visible.steps);
  assert.equal(todoList(saved, linkCaseSections(namesOnly, { a: rows })).open[0].steps[1].done, false);
  assert.ok(originalKeys.every((key) => saved.stepKeys[visible.id].includes(key)), "旧キーを削除せず解除記録で抑制");
  assert.equal(todoList(saved, namesOnly).open[0].steps[1].done, false, "ID読込前の表示でも解除を維持");
}

// 照合記録のない旧キー保存は、解除か未照合か判別不能。原本を残しつつ自動復活はしない。
{
  const unknown = { ...rollover(null, "2026-10-02"), steps: { [before.id]: [1] }, stepKeys: { [before.id]: [] } };
  assert.equal(todoList(unknown, linkCaseSections(namesOnly, { a: rows })).open[0].steps[1].done, false);
  assert.deepEqual(unknown.steps[before.id], [1]);
}

// 61件目の保存でも、キー形式・旧番号形式とも別工程の履歴を消さない。
{
  let saved = rollover(null, "2026-10-02");
  for (let i = 0; i < 60; i++) {
    saved.stepKeys["old-" + i] = ["checked-" + i];
    saved.steps["old-" + i] = [i];
    saved.stepAutoCompleted["old-" + i] = true;
    saved.stepLegacyResolved["old-" + i] = [i];
    saved.stepUnchecked["old-" + i] = ["unchecked-" + i];
  }
  const original = structuredClone(saved);
  const keyed = toggleStep(saved, "new-keyed", 0, 1, [{ key: "new-step", done: false }]);
  assert.equal(Object.keys(keyed.stepKeys).length, 61);
  for (const field of ["steps", "stepKeys", "stepAutoCompleted", "stepLegacyResolved", "stepUnchecked"]) {
    for (const [id, value] of Object.entries(original[field])) assert.deepEqual(keyed[field][id], value, field + ": " + id);
  }
  const positional = toggleStep(saved, "new-positional", 0, 1);
  assert.equal(Object.keys(positional.steps).length, 61);
  for (const [id, value] of Object.entries(original.steps)) assert.deepEqual(positional.steps[id], value);
  assert.deepEqual(saved, original, "履歴を含む入力stateは変更しない");
}

// 読み込み競合：古い案件/リビジョンの遅い返答は破棄。失敗と空の成功を区別。
const results = [];
let finishOld;
const cancelOld = loadScheduleRows(["a", "a"], () => new Promise((resolve) => { finishOld = resolve; }), (id, value) => results.push({ id, value }));
await Promise.resolve();
cancelOld();
const cancelNew = loadScheduleRows(["a"], async () => [], (id, value) => results.push({ id, value }));
await new Promise((resolve) => setImmediate(resolve));
finishOld(rows);
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(results, [{ id: "a", value: [] }], "後から返った古いロケを復活させない");
cancelNew();
loadScheduleRows(["failed"], async () => { throw new Error("synthetic failure"); }, (id, value) => results.push({ id, value }));
loadScheduleRows(["malformed"], async () => ({ rows: [] }), (id, value) => results.push({ id, value }));
let calls = 0;
loadScheduleRows(["once", "once"], async () => { calls++; return null; }, () => assert.fail("null is not a loaded empty schedule"));
await new Promise((resolve) => setImmediate(resolve));
assert.equal(calls, 1);
assert.equal(results.length, 1);

console.log("today todo tests passed");
