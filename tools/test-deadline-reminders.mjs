// 工程の締切リマインド（worker/src/reminders.js）の回帰テスト
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { phaseOf, extractSection, guidesFor, planReminders, composeEmail, runDeadlineReminders, jstDate, isEditorStep } from "../worker/src/reminders.js";

const root = new URL("..", import.meta.url).pathname;
const docs = {
  manual: readFileSync(root + "knowledge/SCRIPT_PRODUCTION_MANUAL_V1.md", "utf8"),
  regulation: readFileSync(root + "knowledge/OBSIDIAN_PUBLISH_REGULATION_V1.md", "utf8"),
  gen: readFileSync(root + "tools/SCRIPT_GEN_PROMPT.md", "utf8"),
};

// 段階
assert.equal(phaseOf("2026-10-02", "2026-10-01").key, "eve");
assert.equal(phaseOf("2026-10-01", "2026-10-01").key, "today");
assert.equal(phaseOf("2026-09-29", "2026-10-01").days, -2);
assert.equal(phaseOf("2026-10-05", "2026-10-01"), null);
assert.equal(phaseOf("", "2026-10-01"), null);
assert.equal(jstDate(Date.parse("2026-09-30T23:30:00Z")), "2026-10-01"); // UTC23:30 = JST翌8:30

// 編集者の工程か
assert.equal(isEditorStep({ stepName: "本編集", defaultRole: "Editor" }), true);
assert.equal(isEditorStep({ stepName: "撮影", defaultRole: "Camera" }), false);
assert.equal(isEditorStep({ stepName: "初稿", defaultRole: null }), true);
assert.equal(isEditorStep({ stepName: "構成", defaultRole: null }), false);

// マニュアルの節（## 見出し／**A. 見出し** の両方）
assert.ok(extractSection(docs.manual, "必ず守るルール").some((p) => p.includes("1秒5文字")) || extractSection(docs.manual, "必ず守るルール", 10).some((p) => p.includes("1秒5文字")));
assert.ok(extractSection(docs.gen, "B. 脳の順番で飽きさせない設計").length >= 3);
assert.ok(extractSection(docs.regulation, "判断原則").some((p) => p.includes("サムネ")));
const g = guidesFor("本編集", docs);
assert.equal(g.length, 2);
assert.ok(g[0].source.includes("構成のルール"));
assert.ok(guidesFor("最終修正", docs)[0].source.includes("公開前チェック"));
assert.ok(guidesFor("修正", docs)[0].source.includes("構成台本制作マニュアル"));

// 計画：編集者の工程だけ・オーナーは除く・紐付け無し/編集者無しは飛ばす
const deliverables = [
  { id: "dl1", title: "A", mgProjectId: "p1", productionStatus: "active", steps: [
    { id: "s1", stepName: "撮影", defaultRole: "Camera", status: "pending", deadline: "2026-10-01" },
    { id: "s2", stepName: "本編集", defaultRole: "Editor", status: "pending", deadline: "2026-10-02" },
    { id: "s3", stepName: "修正", defaultRole: "Editor", status: "completed", deadline: "2026-09-30" },
    { id: "s4", stepName: "最終修正", defaultRole: "Editor", status: "pending", deadline: "2026-09-28" },
  ] },
  { id: "dl2", title: "B", mgProjectId: null, productionStatus: "active", steps: [{ id: "x", stepName: "本編集", defaultRole: "Editor", status: "pending", deadline: "2026-10-01" }] },
  { id: "dl3", title: "C", mgProjectId: "p3", productionStatus: "on_hold", steps: [{ id: "y", stepName: "本編集", defaultRole: "Editor", status: "pending", deadline: "2026-10-01" }] },
  { id: "dl4", title: "D", mgProjectId: "p4", productionStatus: "active", steps: [{ id: "z", stepName: "本編集", defaultRole: "Editor", status: "pending", deadline: "2026-10-01" }] },
];
const cases = { p1: { name: "山岸さん密着", ownerEmail: "ak@x.com", members: ["ak@x.com", "Ed@x.com"] }, p4: { name: "編集者なし", ownerEmail: "ak@x.com", members: ["ak@x.com"] } };
const plan = await planReminders({ deliverables, loadCase: async (id) => cases[id] || null, docs, today: "2026-10-01" });
assert.deepEqual(plan.map((r) => `${r.stepId}:${r.phase.key}`), ["s2:eve", "s4:over"]);
assert.deepEqual(plan[0].to, ["ed@x.com"]);
const mail = composeEmail(plan[1], "https://app");
assert.ok(mail.subject.includes("締切を3日過ぎています") && mail.subject.includes("山岸さん密着"));
assert.ok(mail.body.includes("https://app/?case=p1"));
assert.ok(mail.body.includes("この工程で押さえること"));

// 実行：メール送信・通知保存・同じ日の二重送信なし
const kv = new Map();
kv.set("col:p1", JSON.stringify(cases.p1));
const SNAPS = {
  get: async (k, t) => (kv.has(k) ? (t === "json" ? JSON.parse(kv.get(k)) : kv.get(k)) : null),
  put: async (k, v) => { kv.set(k, v); },
};
const mails = [];
const fetchImpl = async (url, opt) => {
  if (url.includes("/deliverables?")) return new Response(JSON.stringify({ success: true, data: deliverables.slice(0, 1), meta: { total: 1 } }));
  if (url.includes("/api/email/send")) { mails.push(JSON.parse(opt.body)); return new Response("{}"); }
  throw new Error("unexpected " + url);
};
const env = { STUDIO_AGENT_KEY: "k", BOT_API_URL: "https://bot", BOT_API_KEY: "b", SNAPS, APP_ORIGIN: "https://app" };
const now = Date.parse("2026-09-30T23:00:00Z"); // JST 10/01 08:00
const dry = await runDeadlineReminders(env, docs, { dryRun: true, now, fetchImpl });
assert.equal(dry.sent.length, 2); assert.equal(mails.length, 0);
const r1 = await runDeadlineReminders(env, docs, { now, fetchImpl });
assert.equal(r1.sent.length, 2); assert.equal(mails.length, 2);
assert.equal(mails[0].to, "ed@x.com");
const notif = JSON.parse(kv.get("notif:ed@x.com"));
assert.equal(notif.length, 2); assert.equal(notif[0].read, false);
const r2 = await runDeadlineReminders(env, docs, { now, fetchImpl });
assert.equal(r2.sent.length, 0); assert.equal(mails.length, 2); // 同じ日は送らない
const r3 = await runDeadlineReminders({ ...env, STUDIO_AGENT_KEY: "" }, docs, { now, fetchImpl });
assert.equal(r3.ok, false);

console.log("deadline reminder regression tests passed");
