import assert from "node:assert/strict";
import { snapshotSignature, CHANNEL_SNAP_FIELDS, SHARE_FIELDS } from "../src/snap-signature.js";

const project = { id: "p1", name: "案件", rows: [{ kind: "scene" }] };
const channel = { name: "スタジアム（運命の職業）", url: "", concept: "", target: "", purpose: "", competitors: [] };
const base = snapshotSignature(project, channel, []);

// 発行そのものが書き換える値では指紋が動かない（動くと再発行が自分を再発火してループする）
for (const f of SHARE_FIELDS) {
  assert.equal(snapshotSignature({ ...project, [f]: "x" }, channel, []), base, `${f} で指紋が動いた`);
}

// 台本の変更は当然拾う
assert.notEqual(snapshotSignature({ ...project, rows: [] }, channel, []), base);

// 事故の再現: チャンネルURLと競合チャンネルを入れたら再発行が走らなければならない
assert.notEqual(snapshotSignature(project, { ...channel, url: "https://youtube.com/@x" }, []), base, "チャンネルURLの変更を拾えていない");
assert.notEqual(snapshotSignature(project, { ...channel, competitors: [{ name: "MOSH" }] }, []), base, "競合チャンネルの変更を拾えていない");
for (const f of ["concept", "target", "purpose", "promanUrl", "manualUrl", "checklistUrl"]) {
  assert.notEqual(snapshotSignature(project, { ...channel, [f]: "v" }, []), base, `${f} の変更を拾えていない`);
}
assert.notEqual(snapshotSignature(project, { ...channel, manuals: [{ title: "t" }] }, []), base);

// 全体の決め事もスナップに同梱されるので拾う
assert.notEqual(snapshotSignature(project, channel, [{ title: "決め事" }]), base, "全体の決め事の変更を拾えていない");

// スナップに載らない値では走らせない（無駄な再発行＝KV書込を増やさない）
for (const f of ["icon", "status", "clientNotes", "shareId", "shareToken"]) {
  assert.ok(!CHANNEL_SNAP_FIELDS.includes(f));
  assert.equal(snapshotSignature(project, { ...channel, [f]: "x" }, []), base, `${f} で無駄に再発行が走る`);
}

console.log("snapshot signature regression tests passed");
