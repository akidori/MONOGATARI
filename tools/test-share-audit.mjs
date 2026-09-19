import assert from "node:assert/strict";
import { auditShareProject } from "../src/share-audit.js";

const issues = auditShareProject({ rows: [
  { id: "loc-1", kind: "location", label: "", time: "10:00", day: 1 },
  { id: "scene-1", kind: "scene", type: "インサート", label: "", script: "※メモ" },
  { id: "loc-2", kind: "location", label: "午後", time: "09:00", day: 1 },
] });

assert.deepEqual(issues.filter((issue) => !issue.soft).map((issue) => issue.category), ["ロケ漏れ", "シーン漏れ", "インサート不足", "撮影順"]);
assert.equal(auditShareProject({ rows: [{ id: "scene-2", kind: "scene", type: "VLOG", label: "朝", script: "本文" }] }).length, 0);

// ⚠ 行＝先方確定待ちなどの要確認行。撮っても意味が変わりうる内容なのでAI自動修正の対象にはしない（monogataritch.src.jsx側でcategory除外）
const warnIssues = auditShareProject({ rows: [
  { id: "scene-3", kind: "scene", type: "解説系", label: "会議シーン", script: "実際の打ち合わせ風景を撮影\n⚠ 先方調整後の日時・出席者をここに反映すること" },
] });
assert.deepEqual(warnIssues.map((issue) => issue.category), ["要確認"]);
assert.equal(warnIssues[0].soft, undefined);

console.log("share audit regression tests passed");
