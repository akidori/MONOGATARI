import assert from "node:assert/strict";
import { auditShareProject } from "../src/share-audit.js";

const issues = auditShareProject({ rows: [
  { id: "loc-1", kind: "location", label: "", time: "10:00", day: 1 },
  { id: "scene-1", kind: "scene", type: "インサート", label: "", script: "※メモ" },
  { id: "loc-2", kind: "location", label: "午後", time: "09:00", day: 1 },
] });

assert.deepEqual(issues.filter((issue) => !issue.soft).map((issue) => issue.category), ["ロケ漏れ", "シーン漏れ", "インサート不足", "撮影順"]);
assert.equal(auditShareProject({ rows: [{ id: "scene-2", kind: "scene", type: "VLOG", label: "朝", script: "本文" }] }).length, 0);

console.log("share audit regression tests passed");
