// 台本チェック（src/script-check.js）の回帰テスト
import assert from "node:assert/strict";
import { mechanicalCheck, spokenChars, cutCount, reviewScore, mechanicalText, CRITERIA, SECTION_TYPES } from "../src/script-check.js";

// 読み上げ文字数：映像指示・▶︎・★取材・（補足）は数えない、◼ は外す
assert.equal(spokenChars("（工場外観）\n◼ 何年目ですか？\n20年です（笑いながら）\n▶︎「つかみ」（狙い）\n★取材：父のこと"), "何年目ですか？20年です".length);
assert.equal(spokenChars("<b>あいう</b>"), 3);
assert.equal(cutCount("（外観）\n（作業風景）\nセリフ"), 2);

const mk = (rows, extra = {}) => ({ rate: 5, rows, ...extra });
const scene = (o) => ({ kind: "scene", id: o.id || Math.random().toString(36).slice(2), ...o });
// 5種に無い type・空の type は high
{
  const r = mechanicalCheck(mk([scene({ type: "インタビュー", sec: 60, script: "あ".repeat(300) }), scene({ type: "", sec: 10 })]));
  assert.equal(r.items.filter((i) => i.level === "high").length, 2);
  assert.equal(r.items[0].scene, 1);
}
// 秒数の目安・文字数（±2割）・インサート
{
  const rows = [
    scene({ id: "a", type: "インサート", sec: 5, script: "（外観）\n（出社）\n（打ち合わせ）" }), // OK
    scene({ id: "b", type: "インサート", sec: 8, script: "（外観）\nおはようございます" }),       // 秒数・セリフ・カット数
    scene({ id: "c", type: "訴求", sec: 180, script: "あ".repeat(900) }),                     // OK（900字＝180×5）
    scene({ id: "d", type: "VLOG", sec: 30, script: "あ".repeat(100) }),                      // 150字の-2割未満
    scene({ id: "e", type: "解説系", sec: 60, script: "あ".repeat(300), role: "peak" }),       // OK
  ];
  const r = mechanicalCheck(mk(rows));
  const at = (n) => r.items.filter((i) => i.scene === n).map((i) => i.msg);
  assert.deepEqual(at(1), []);
  assert.equal(at(2).length, 3);
  assert.ok(at(2)[0].includes("3〜5秒") && at(2)[1].includes("映像のみ") && at(2)[2].includes("1カット"));
  assert.deepEqual(at(3), []);
  assert.ok(at(4)[0].includes("150字") && at(4)[0].includes("100字") && at(4)[0].includes("水増ししない"));
  assert.deepEqual(at(5), []);
  assert.equal(r.items.find((i) => i.scene === 2).rowId, "b");
  assert.ok(r.items.some((i) => i.msg.includes("ダイジェスト候補・CV"))); // peak だけ付いている
  assert.equal(r.stats.scenes, 5); assert.equal(r.stats.totalSec, 283);
}
// 訴求が無い・★の数・目標尺
{
  const r = mechanicalCheck(mk([scene({ type: "VLOG", sec: 30, script: "★こんにちは" + "あ".repeat(149) })], { meta: { prod: { targetMin: "18" } } }));
  assert.ok(r.items.some((i) => i.msg.includes("訴求のシーンがありません")));
  assert.ok(r.items.some((i) => i.msg.includes("目標の18分")));
  assert.equal(r.stats.stars, 1);
  assert.ok(mechanicalText(r).includes("★1箇所"));
}
// トーク形式は対象外・字/秒の設定を使う
assert.equal(mechanicalCheck({ format: "talk", rows: [] }).supported, false);
assert.equal(mechanicalCheck(mk([scene({ type: "解説系", sec: 60, script: "あ".repeat(360) })], { rate: 6 })).items.filter((i) => i.scene === 1).length, 0);

// 点数：各0〜2点を10点満点に
assert.equal(reviewScore([{ score: 2 }, { score: 1 }, { score: 2 }, { score: 1 }]), 7.5);
assert.equal(reviewScore([]), null);
assert.equal(reviewScore([{ score: 2 }, { score: null }, { score: 1 }]), 7.5); // 判断材料なし（null）は平均から外す
// 秒数の合計の表示：分は切り捨て（90秒＝1分30秒）
assert.ok(mechanicalText(mechanicalCheck({ rate: 5, rows: [{ kind: "scene", type: "訴求", sec: 90, script: "あ".repeat(450) }] })).includes("1分30秒"));
assert.equal(CRITERIA.length, 8); assert.equal(SECTION_TYPES.length, 5);

console.log("script check tests passed");
