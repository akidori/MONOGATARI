import assert from "node:assert/strict";
import { handoffMissing, addHandoffGap } from "../src/handoff-check.js";

const full = { url: "https://youtube.com/@x", concept: "c", target: "t", competitors: [{ name: "MOSH" }], promanUrl: "", manualUrl: "https://m" };
const meta = { prod: { promanUrl: "https://drive/x" } };

// そろっていれば空
assert.deepEqual(handoffMissing(meta, full, []), []);
// 何も無い・形が崩れていても落ちずに6項目を返す
assert.deepEqual(handoffMissing(undefined, undefined, undefined), ["チャンネルURL", "コンセプト・世界観", "ターゲット", "競合チャンネル", "プロマネ", "マニュアル"]);
assert.equal(handoffMissing({ prod: "x" }, { competitors: "x", manuals: "x" }, null).length, 6);
// プロマネは案件に無くてもチャンネル共通URLで足りる
assert.deepEqual(handoffMissing({}, { ...full, promanUrl: "https://ch" }, []), []);
// マニュアルは決め事・スタジオ共通の決め事でも足りる
assert.deepEqual(handoffMissing(meta, { ...full, manualUrl: "", manuals: [{ t: 1 }] }, []), []);
assert.deepEqual(handoffMissing(meta, { ...full, manualUrl: "" }, [{ t: 1 }]), []);
assert.deepEqual(handoffMissing(meta, { ...full, manualUrl: "  " }, []), ["マニュアル"]);
// 空の競合カードは数えない
assert.deepEqual(handoffMissing(meta, { ...full, competitors: [{ name: " ", url: "" }] }, []), ["競合チャンネル"]);

// 記録は新しい順・最大20件
let m = {};
for (let i = 0; i < 25; i++) m = { handoffGaps: addHandoffGap(m, { at: i, by: "a@b", missing: ["プロマネ"] }) };
assert.equal(m.handoffGaps.length, 20);
assert.equal(m.handoffGaps[0].at, 24);
assert.equal(m.handoffGaps[0].kind, "editor");
console.log("handoff-check: ok");
