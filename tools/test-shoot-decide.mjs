// 撮影日を決める期限の知らせ（worker/src/shoot-decide.js）の回帰テスト（Issue #39）
import assert from "node:assert/strict";
import { planShootDecide, composeShootDecide, draftFor, runShootDecideReminders } from "../worker/src/shoot-decide.js";

const today = "2026-10-07";
const proj = (o) => JSON.stringify({ name: "森川さん密着", channel: "スタジアム", meta: { prod: { shootDecideBy: today, talents: [{ name: "森川 智仁", call: "森川さん" }] } }, ...o });
const rows = [
  { proj_id: "a1", value: proj({}) },
  { proj_id: "a1", value: proj({ name: "古い行" }) },                                        // 同じ案件の古い行は見ない
  { proj_id: "b2", value: proj({ meta: { shootDate: "2026-10-20", prod: { shootDecideBy: today } } }) }, // 撮影日が決まっている
  { proj_id: "c3", value: proj({ meta: { prod: { shootDecideBy: "2026-10-08" } } }) },        // 期限が今日ではない
  { proj_id: "d4", value: "{壊れたJSON" },
  { proj_id: "e5", value: proj({ archived: true }) },
  { proj_id: null, value: proj({}) },
];
const plan = planShootDecide(rows, today);
assert.equal(plan.length, 1);
assert.equal(plan[0].caseId, "a1");
assert.equal(plan[0].caseName, "森川さん密着");
assert.ok(draftFor(plan[0]).includes("森川さんの撮影日"));
const mail = composeShootDecide(plan, "https://app");
assert.ok(mail.subject.includes("森川さん密着"));
assert.ok(mail.body.includes("https://app/?case=a1"));
assert.ok(mail.body.includes("自動では送っていません"));

// 実行：AKにだけ1回。2回目は送らない。off なら何もしない
const kv = new Map();
const sent = [];
const env = {
  REMINDERS_MODE: "admin", BOT_API_URL: "https://bot", BOT_API_KEY: "k",
  SNAPS: { get: async (k, t) => { const v = kv.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; }, put: async (k, v) => { kv.set(k, v); } },
  DB: { prepare: () => ({ bind: (d) => ({ all: async () => ({ results: d === today ? rows : [] }) }) }) },
};
const fetchImpl = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true }; };
const now = Date.parse(today + "T00:00:00+09:00") + 8 * 3600e3;
let r = await runShootDecideReminders(env, { now, fetchImpl, adminEmails: ["ak@x"] });
assert.equal(r.sent.length, 1);
assert.equal(sent.length, 1);
assert.equal(sent[0].to, "ak@x");
const notifs = JSON.parse(kv.get("notif:ak@x"));
assert.equal(notifs[0].caseId, "a1");
assert.ok(notifs[0].guides[0].points.length > 1);
r = await runShootDecideReminders(env, { now, fetchImpl, adminEmails: ["ak@x"] });
assert.equal(r.sent.length, 0);
assert.equal(sent.length, 1);
r = await runShootDecideReminders({ ...env, REMINDERS_MODE: "off" }, { now, fetchImpl, adminEmails: ["ak@x"] });
assert.equal(r.skipped, "REMINDERS_MODE=off");
console.log("shoot-decide: ok");
