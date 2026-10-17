// ワークスペースとロールの判定（worker/src/workspace.js）と、移行SQLを作るスクリプトの回帰テスト（SaaS化 1本目）
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { can, canOnProject, pickWorkspace, isWriteBlocked, ROLES } from "../worker/src/workspace.js";
import { buildSeedSql } from "./seed-workspace.mjs";

// ロール
assert.deepEqual(ROLES, ["owner", "director", "editor"]);
assert.ok(can("owner", "workspace.manage"));
assert.ok(!can("director", "workspace.manage"));
assert.ok(can("director", "script.write"));
assert.ok(!can("editor", "script.write"));
assert.ok(can("editor", "script.read"));
assert.ok(!can("guest", "script.read"), "知らないロールは何もできない");
assert.ok(!can("owner", "no.such.action"), "知らない操作は誰もできない");

// editor は担当案件だけ工数・アップができる
const ed = { role: "editor", sub: "111" };
assert.ok(canOnProject(ed, "effort.write", { assignees: ["111"] }));
assert.ok(!canOnProject(ed, "effort.write", { assignees: ["222"] }));
assert.ok(!canOnProject(ed, "video.upload", {}));
assert.ok(canOnProject(ed, "review.comment", {}), "コメントは担当外でもできる");
assert.ok(canOnProject({ role: "director", sub: "9" }, "video.upload", {}), "director は担当外でもアップできる");
assert.ok(!canOnProject(null, "script.read", {}));

// ワークスペースの選び方
const ms = [{ workspace_id: "ws_a", role: "owner" }, { workspace_id: "ws_b", role: "editor" }];
assert.equal(pickWorkspace(ms, "ws_b").role, "editor");
assert.equal(pickWorkspace(ms, "ws_x"), null, "所属していないワークスペースは選べない");
assert.equal(pickWorkspace(ms), null, "複数所属で指定なしは選べない");
assert.equal(pickWorkspace([ms[0]]).workspace_id, "ws_a");
assert.equal(pickWorkspace([]), null);

// 緊急停止
assert.ok(!isWriteBlocked({ status: "active" }));
assert.ok(isWriteBlocked({ status: "suspended" }));
assert.ok(isWriteBlocked(null));

// 移行SQL
const sql = buildSeedSql({ id: "ws_birdflip", name: "Bird Flip", ownerSub: "1234567890", ownerEmail: "AK@Example.com", now: 1 });
assert.ok(sql.includes("INSERT OR IGNORE INTO mg_workspaces"));
assert.ok(sql.includes("'ak@example.com', 'owner'"), "メールは小文字で入れる");
assert.ok(sql.includes("WHERE workspace_id IS NULL AND sub = '1234567890'"), "埋めるのは空の行・オーナー本人の行だけ");
assert.throws(() => buildSeedSql({ id: "birdflip", name: "x", ownerSub: "12345", ownerEmail: "a@b.c" }), /ws_/);
assert.throws(() => buildSeedSql({ id: "ws_xy", name: "x", ownerSub: "1 OR 1=1", ownerEmail: "a@b.c" }), /sub/);
assert.throws(() => buildSeedSql({ id: "ws_xy", name: "x", ownerSub: "12345", ownerEmail: "a'@b.c" }), /メール/);
assert.equal(buildSeedSql({ id: "ws_xy", name: "O'Neil", ownerSub: "12345", ownerEmail: "a@b.c", now: 1 }).includes("'O''Neil'"), true, "名前の ' はエスケープ");

// 表の定義：すべて mg_ で始まり、既存の行を消す文が無い
const ddl = readFileSync(new URL("./2026-10-17_workspaces.sql", import.meta.url), "utf8");
for (const t of ["mg_workspaces", "mg_members", "mg_invites", "mg_tokens", "mg_usage"]) assert.ok(ddl.includes("CREATE TABLE IF NOT EXISTS " + t), t);
assert.ok(!/\b(DROP|DELETE|UPDATE)\b/i.test(ddl.replace(/--.*$/gm, "")), "表定義に DROP/DELETE/UPDATE を入れない");

console.log("test-workspace: ok");
