// 工程の締切リマインド（worker/src/reminders.js）の回帰テスト
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { phaseOf, extractSection, guidesFor, planReminders, composeEmail, composeDigest, runDeadlineReminders, jstDate, isEditorStep, workForCase, reminderMode } from "../worker/src/reminders.js";

// 実データ・実通知には触れない。通信は下の synthetic fetchImpl だけを使う。
let unexpectedNetworkCalls = 0;
globalThis.fetch = async () => { unexpectedNetworkCalls++; throw new Error("network is forbidden in reminder tests"); };

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
assert.equal(phaseOf("2026-09-28", "2026-10-01").key, "over"); // 3日目までは編集者へ
assert.equal(phaseOf("2026-09-27", "2026-10-01").key, "stale"); // 4日目からはAKへ
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

// 計画：今の工程だけ（2026-09-29仕様）。未来の修正は締切超過でも催促しない。
const deliverables = [
  { id: "dl1", title: "A", mgProjectId: "p1", productionStatus: "active", steps: [
    { id: "s1", stepName: "撮影", defaultRole: "Camera", status: "completed", deadline: "2026-10-01", stepOrder: 1 },
    { id: "s2", stepName: "本編集", defaultRole: "Editor", status: "pending", deadline: "2026-10-02", stepOrder: 2 },
    { id: "s3", stepName: "修正", defaultRole: "Editor", status: "completed", deadline: "2026-09-30", stepOrder: 3 },
    { id: "s4", stepName: "最終修正", defaultRole: "Editor", status: "pending", deadline: "2026-09-28", stepOrder: 4 },
  ] },
  { id: "dl2", title: "B", mgProjectId: null, productionStatus: "active", steps: [{ id: "x", stepName: "本編集", defaultRole: "Editor", status: "pending", deadline: "2026-10-01" }] },
  { id: "dl3", title: "C", mgProjectId: "p3", productionStatus: "on_hold", steps: [{ id: "y", stepName: "本編集", defaultRole: "Editor", status: "pending", deadline: "2026-10-01" }] },
  { id: "dl4", title: "D", mgProjectId: "p4", productionStatus: "active", steps: [{ id: "z", stepName: "本編集", defaultRole: "Editor", status: "pending", deadline: "2026-10-01" }] },
  { id: "dl5", title: "E", mgProjectId: "p5", productionStatus: "active", steps: [{ id: "s5", stepName: "最終修正", defaultRole: "Editor", status: "pending", deadline: "2026-09-29" }] },
];
const cases = { p1: { name: "合成案件A", ownerEmail: "ak@x.com", members: ["ak@x.com", "Ed@x.com"] }, p4: { name: "編集者なし", ownerEmail: "ak@x.com", members: ["ak@x.com"] }, p5: { name: "合成案件E", ownerEmail: "ak@x.com", members: ["ak@x.com", "ed@x.com"] } };
const plan = await planReminders({ deliverables, loadCase: async (id) => cases[id] || null, docs, today: "2026-10-01" });
assert.deepEqual(plan.map((r) => `${r.stepId}:${r.phase.key}`), ["s2:eve", "s5:over"]);
assert.deepEqual(plan[0].to, ["ed@x.com"]);
assert.equal(plan[0].mail, false); // 前日はアプリ内だけ
assert.equal(plan[1].mail, true);
assert.equal(plan[1].key, "p5:s5:over:2026-09-29"); // 超過は日付を含まない＝1回だけ（締切が変われば数え直す）
const mail = composeEmail(plan[1], "https://app");
assert.ok(mail.subject.includes("締切を2日過ぎています") && mail.subject.includes("合成案件E"));
assert.ok(mail.body.includes("https://app/?case=p5"));
assert.ok(mail.body.includes("この工程で押さえること"));
// まとめメール：件数入りの件名・マニュアルは重複なし最大3節
{
  const items = [plan[1], { ...plan[1], stepId: "s5", stepName: "修正", phase: phaseOf("2026-10-01", "2026-10-01"), guides: guidesFor("修正", docs) }, { ...plan[1], stepId: "s6" }];
  const dg = composeDigest(items, "https://app");
  assert.ok(dg.subject.includes("締切を過ぎた工程があります（3件）"));
  assert.ok((dg.body.match(/【/g) || []).length <= 3);
  assert.equal((dg.body.match(/https:\/\/app\/\?case=p5/g) || []).length, 1); // 同じ案件のリンクは1回
}

// 撮影待ちなら編集者には送らない。完了/スキップ後だけ次へ進み、並び順・archivedも尊重する。
{
  const d = structuredClone(deliverables[0]);
  d.steps[0].status = "pending";
  d.steps.reverse(); // 配列順ではなく stepOrder が正本
  const options = { deliverables: [d], loadCase: async () => cases.p1, docs, today: "2026-10-01" };
  assert.deepEqual(await planReminders(options), []);
  for (const status of ["completed", "done", "skipped"]) {
    d.steps.find((s) => s.id === "s1").status = status;
    assert.deepEqual((await planReminders(options)).map((r) => r.stepId), ["s2"]);
  }
  d.steps.find((s) => s.id === "s1").status = "pending";
  d.steps.find((s) => s.id === "s1").archived = true;
  assert.deepEqual((await planReminders(options)).map((r) => r.stepId), ["s2"]);
  d.steps.find((s) => s.id === "s2").deadline = "2026-10-10";
  assert.deepEqual(await planReminders(options), []); // 先の超過工程へ飛ばさない
  d.steps.find((s) => s.id === "s2").status = "completed";
  assert.deepEqual((await planReminders(options)).map((r) => r.stepId), ["s4"]);
}

assert.equal(reminderMode({}), "preview"); // 既定はお試し運転
assert.equal(reminderMode({ REMINDERS_MODE: "ON" }), "on");
assert.equal(reminderMode({ REMINDERS_MODE: "off" }), "off");
assert.equal(reminderMode({ REMINDERS_MODE: " ADMIN " }), "admin");
assert.equal(reminderMode({ REMINDERS_MODE: "typo" }), "preview");

const mkKV = (entries = []) => {
  const kv = new Map(entries);
  return { kv, SNAPS: { get: async (k, t) => (kv.has(k) ? (t === "json" ? JSON.parse(kv.get(k)) : kv.get(k)) : null), put: async (k, v) => { kv.set(k, v); } } };
};
const mkFetch = (dls, members = [], mails = []) => async (url, opt) => {
  if (url.includes("/deliverables?")) return new Response(JSON.stringify({ success: true, data: dls, meta: { total: dls.length } }));
  if (url.includes("/members?")) return new Response(JSON.stringify({ success: true, data: members }));
  if (url.includes("/api/email/send")) { mails.push(JSON.parse(opt.body)); return new Response("{}"); }
  throw new Error("unexpected " + url);
};
const now = Date.parse("2026-09-30T23:00:00Z"); // JST 10/01 08:00

// 実行（on）：メールは1人1通・前日はアプリ内だけ・同じものは2回送らない
{
  const { kv, SNAPS } = mkKV([["col:p1", JSON.stringify(cases.p1)], ["col:p5", JSON.stringify(cases.p5)]]);
  const mails = [];
  const fetchImpl = mkFetch([deliverables[0], deliverables[4]], [], mails);
  const env = { REMINDERS_MODE: "on", STUDIO_AGENT_KEY: "k", BOT_API_URL: "https://bot", BOT_API_KEY: "b", SNAPS, APP_ORIGIN: "https://app" };
  const dry = await runDeadlineReminders(env, docs, { dryRun: true, now, fetchImpl });
  assert.equal(dry.sent.length, 2); assert.equal(dry.mails.length, 1); assert.equal(mails.length, 0);
  assert.equal([...kv.keys()].some((k) => /^(notif:|remind:)/.test(k)), false); // dryRun は保存もしない
  const r1 = await runDeadlineReminders(env, docs, { now, fetchImpl });
  assert.equal(r1.sent.length, 2); assert.equal(mails.length, 1); // 2件でもメールは1通（前日分はメールに入らない）
  assert.equal(mails[0].to, "ed@x.com");
  const notif = JSON.parse(kv.get("notif:ed@x.com"));
  assert.equal(notif.length, 2); assert.equal(notif[0].read, false);
  const r2 = await runDeadlineReminders(env, docs, { now, fetchImpl });
  assert.equal(r2.sent.length, 0); assert.equal(mails.length, 1); // 同じ日は送らない
  const r3 = await runDeadlineReminders(env, docs, { now: now + 86400000, fetchImpl });
  // 翌日：s2は当日（メール1通）、s5は同じ超過段階なので再送しない
  assert.deepEqual(r3.sent.map((r) => `${r.stepId}:${r.phase.key}`), ["s2:today"]); assert.equal(mails.length, 2);
  const n2 = JSON.parse(kv.get("notif:ed@x.com"));
  assert.equal(n2.filter((n) => n.stepId === "s2").length, 1); // 工程ごとに1件（前日→当日で置き換え）
  const rescheduled = structuredClone(deliverables[4]);
  rescheduled.steps[0].deadline = "2026-09-30";
  const r4 = await runDeadlineReminders(env, docs, { now: now + 86400000, fetchImpl: mkFetch([deliverables[0], rescheduled], [], mails) });
  assert.deepEqual(r4.sent.map((r) => r.key), ["p5:s5:over:2026-09-30"]); // 締切変更なら同じ段階でも通知を更新
  assert.equal(mails.length, 3);
  assert.equal(JSON.parse(kv.get("notif:ed@x.com")).filter((n) => n.stepId === "s5").length, 1);
  assert.equal((await runDeadlineReminders({ ...env, STUDIO_AGENT_KEY: "" }, docs, { now, fetchImpl })).ok, false);
}

// 実行（preview・既定）：誰にも送らず、AKのアプリ内通知1件だけ。off は何もしない
{
  const { kv, SNAPS } = mkKV([["col:p1", JSON.stringify(cases.p1)]]);
  const mails = [];
  const fetchImpl = mkFetch(deliverables.slice(0, 1), [], mails);
  const env = { STUDIO_AGENT_KEY: "k", SNAPS, APP_ORIGIN: "https://app" };
  const r = await runDeadlineReminders(env, docs, { now, fetchImpl, adminEmails: ["ak@x.com"] });
  assert.equal(r.mode, "preview"); assert.equal(mails.length, 0); assert.equal(kv.has("notif:ed@x.com"), false);
  let ak = JSON.parse(kv.get("notif:ak@x.com"));
  assert.equal(ak.length, 1); assert.equal(ak[0].id, "remind-preview");
  assert.ok(ak[0].guides.some((g) => g.points.some((p) => p.includes("BOT_API_URL")))); // 設定の注意も出す
  await runDeadlineReminders(env, docs, { now: now + 86400000, fetchImpl, adminEmails: ["ak@x.com"] });
  ak = JSON.parse(kv.get("notif:ak@x.com"));
  assert.equal(ak.length, 1); // 毎朝置き換え（増えない）
  assert.equal([...kv.keys()].some((k) => k.startsWith("remind:")), false); // 送信済みの記録を付けない
  await runDeadlineReminders({ ...env, BOT_API_URL: "https://bot", BOT_API_KEY: "b" }, docs, { now: now + 86400000, fetchImpl, adminEmails: ["ak@x.com"] });
  assert.equal(mails.length, 0); // メール設定があっても preview では送らない
  const beforeOff = [...kv];
  let offCalls = 0;
  const off = await runDeadlineReminders({ ...env, REMINDERS_MODE: "off" }, docs, { now, fetchImpl: async () => { offCalls++; throw new Error("off must not fetch"); }, adminEmails: ["ak@x.com"] });
  assert.equal(off.skipped, "REMINDERS_MODE=off");
  assert.equal(offCalls, 0); assert.deepEqual([...kv], beforeOff);
}

// 超過4日以上はAKへ。未招待でもStudio OSの担当へ、開ける編集者用リンクを添える（9/29仕様）。
{
  const dl = [{ id: "dl9", title: "E", mgProjectId: "p9", productionStatus: "active",
    assignments: [{ role: "Editor", memberId: "mb_2" }, { role: "Director", memberId: "mb_1" }],
    steps: [
      { id: "t1", stepName: "本編集", defaultRole: "Editor", status: "pending", deadline: "2026-09-20", stepOrder: 1 },
      { id: "t2", stepName: "修正", defaultRole: "Editor", status: "pending", deadline: "2026-10-01", stepOrder: 2 },
    ] },
    { id: "dl8", title: "F", mgProjectId: "p8", productionStatus: "active", assignments: [{ role: "Editor", memberId: "mb_3" }],
      steps: [{ id: "u1", stepName: "本編集", defaultRole: "Editor", status: "pending", deadline: "2026-10-01" }] }];
  const kc = { p9: { name: "二人編集", ownerEmail: "ak@x.com", members: ["ak@x.com", "a@x.com", "b@x.com"] }, p8: { name: "未招待", ownerEmail: "ak@x.com", members: ["ak@x.com"] } };
  const linkCalls = [];
  const shareUrl = "https://synthetic.invalid/share.html?id=test&r=synthetic-read&up=synthetic-editor";
  const openUrlFor = async (id) => { linkCalls.push(id); return shareUrl; };
  const options = { deliverables: dl, loadCase: async (id) => kc[id], docs, today: "2026-10-01", memberEmailById: { mb_2: "B@x.com", mb_3: "c@x.com" }, adminEmails: ["ak@x.com"], openUrlFor };
  const pl = await planReminders(options);
  const stale = pl.find((r) => r.stepId === "t1"), cur = pl.find((r) => r.stepId === "u1");
  assert.deepEqual(stale.to, ["ak@x.com"]); assert.equal(stale.forAdmin, true); assert.equal(stale.key, "p9:t1:stale:2026-09-20");
  assert.deepEqual(stale.editors, ["b@x.com"]);
  assert.ok(composeEmail(stale, "https://app").body.includes("自動の催促は止めました"));
  assert.equal(pl.find((r) => r.stepId === "t2"), undefined); // 先の修正にはまだ送らない
  assert.deepEqual(cur.to, ["c@x.com"]); // 未招待でも担当の編集者だけ
  assert.equal(pl.some((r) => r.kind === "mismatch"), false);
  assert.deepEqual(linkCalls, ["p8"]);
  assert.equal(cur.openUrl, shareUrl);
  assert.ok(composeDigest([cur], "https://app", "c@x.com").body.includes(shareUrl));
  assert.ok(!composeDigest([cur], "https://app", "c@x.com").body.includes("https://app/?case=p8"));
  assert.ok(composeDigest([{ ...cur, openUrl: null }], "https://app", "c@x.com").body.includes("未招待：https://app/"));
  // オーナー自身だけが担当なら催促しない。共同編集ドキュメントが未作成でもStudio OS担当は対象。
  assert.deepEqual(await planReminders({ ...options, deliverables: dl.slice(1), memberEmailById: { mb_3: "AK@x.com" } }), []);
  assert.deepEqual((await planReminders({ ...options, deliverables: dl.slice(1), loadCase: async () => null }))[0].to, ["c@x.com"]);
  const currentOnly = [{ ...dl[0], steps: dl[0].steps.slice(1) }];
  assert.deepEqual((await planReminders({ ...options, deliverables: currentOnly }))[0].to, ["b@x.com"]);
  const fallback = await planReminders({ ...options, deliverables: currentOnly, memberEmailById: {} });
  assert.deepEqual(fallback[0].to, ["a@x.com", "b@x.com"]); // 担当不明なら招待済み編集者へ
  assert.ok(composeDigest(fallback, "https://app", "a@x.com").body.includes("https://app/?case=p9"));
  assert.deepEqual(await planReminders({ ...options, deliverables: dl.slice(0, 1), adminEmails: [] }), []);
  // 実行：AKへは1通にまとめ、日をまたいでも2回目は送らない
  const { SNAPS: SN, kv: kv2 } = mkKV([["col:p9", JSON.stringify(kc.p9)], ["col:p8", JSON.stringify(kc.p8)]]);
  const sentMails = [];
  const f2 = mkFetch(dl, [{ id: "mb_2", email: "b@x.com" }, { id: "mb_3", email: "c@x.com" }], sentMails);
  const e2 = { REMINDERS_MODE: "on", STUDIO_AGENT_KEY: "k", BOT_API_URL: "https://bot", BOT_API_KEY: "b", SNAPS: SN };
  await runDeadlineReminders(e2, docs, { now, fetchImpl: f2, adminEmails: ["ak@x.com"], openUrlFor });
  assert.deepEqual(sentMails.map((m) => m.to).sort(), ["ak@x.com", "c@x.com"]);
  const akMail = sentMails.find((m) => m.to === "ak@x.com");
  assert.ok(akMail.body.includes("二人編集") && !akMail.body.includes("未招待"));
  assert.ok(sentMails.find((m) => m.to === "c@x.com").body.includes(shareUrl));
  assert.equal(kv2.has("notif:b@x.com"), false); // 超過4日以上は本人に通知しない
  assert.equal(JSON.parse(kv2.get("notif:ak@x.com")).length, 1); // AKのアプリ内通知もまとめて1件
  await runDeadlineReminders(e2, docs, { now: now + 86400000, fetchImpl: f2, adminEmails: ["ak@x.com"], openUrlFor });
  assert.equal(sentMails.filter((m) => m.to === "ak@x.com").length, 1); // 翌日もAKへは送らない
}

// 先方待ちはAKだけへ。後ろの編集が超過でも編集者に送らず、確認完了後にだけ次へ進める。
{
  const d = { id: "client-dl", title: "合成先方確認", mgProjectId: "client-case", productionStatus: "active", steps: [
    { id: "future-edit", stepName: "修正", defaultRole: "Editor", status: "pending", deadline: "2026-09-30", stepOrder: 2 },
    { id: "client-review", stepName: "確認", defaultRole: "Client", status: "pending", deadline: "2026-10-01", stepOrder: 1 },
  ] };
  const options = { deliverables: [d], loadCase: async () => cases.p1, docs, today: "2026-10-01", adminEmails: ["ak@x.com"] };
  const waiting = await planReminders(options);
  assert.equal(waiting.length, 1); assert.equal(waiting[0].kind, "client_wait"); assert.equal(waiting[0].forAdmin, true);
  assert.deepEqual(waiting[0].to, ["ak@x.com"]); assert.equal(waiting[0].key, "client-case:client-review:client:2026-10-01");
  assert.ok(composeEmail(waiting[0], "https://app").body.includes("編集者には送っていません"));
  assert.deepEqual(await planReminders({ ...options, adminEmails: [] }), []);
  assert.deepEqual(await planReminders({ ...options, today: "2026-09-30" }), []); // 先方の催促日より前は送らない
  d.steps[1].defaultRole = null; d.steps[1].stepName = "先方チェック";
  assert.equal((await planReminders(options))[0].kind, "client_wait"); // 役割未設定でも工程名で守る
  const { kv, SNAPS } = mkKV([["col:client-case", JSON.stringify(cases.p1)]]);
  const mails = [], fetchImpl = mkFetch([d], [], mails);
  const env = { REMINDERS_MODE: "on", STUDIO_AGENT_KEY: "k", BOT_API_URL: "https://bot", BOT_API_KEY: "b", SNAPS };
  await runDeadlineReminders(env, docs, { now, fetchImpl, adminEmails: ["ak@x.com"] });
  assert.deepEqual(mails.map((m) => m.to), ["ak@x.com"]); assert.equal(kv.has("notif:ed@x.com"), false);
  await runDeadlineReminders(env, docs, { now: now + 86400000, fetchImpl, adminEmails: ["ak@x.com"] });
  assert.equal(mails.length, 1); // 同じ確認待ちは翌日も再送しない
  d.steps[1].status = "completed";
  const next = await runDeadlineReminders(env, docs, { now: now + 86400000, fetchImpl, adminEmails: ["ak@x.com"] });
  assert.deepEqual(next.sent.map((r) => r.stepId), ["future-edit"]);
  assert.deepEqual(mails.map((m) => m.to), ["ak@x.com", "ed@x.com"]);
}

// admin モードはメールもアプリ内通知も編集者へ出さない。on と重複防止の記録を分離する。
{
  const { kv, SNAPS } = mkKV([["col:p1", JSON.stringify(cases.p1)], ["col:p5", JSON.stringify(cases.p5)]]);
  const mails = [], fetchImpl = mkFetch([deliverables[0], deliverables[4]], [], mails);
  const env = { REMINDERS_MODE: "admin", STUDIO_AGENT_KEY: "k", BOT_API_URL: "https://bot", BOT_API_KEY: "b", SNAPS };
  const options = { now, fetchImpl, adminEmails: ["ak@x.com"] };
  const dry = await runDeadlineReminders(env, docs, { ...options, dryRun: true });
  assert.equal(dry.sent.length, 2); assert.equal(mails.length, 0);
  assert.equal([...kv.keys()].some((k) => /^(remind:|remindak:|notif:)/.test(k)), false);
  await runDeadlineReminders(env, docs, options);
  assert.deepEqual(mails.map((m) => m.to), ["ak@x.com"]);
  assert.ok(mails[0].body.includes("ed@x.com 宛て") && mails[0].body.includes("編集者には送っていません"));
  assert.equal([...kv.keys()].filter((k) => k.startsWith("remindak:")).length, 2);
  assert.equal([...kv.keys()].some((k) => /^(remind:|notif:)/.test(k)), false);
  assert.equal((await runDeadlineReminders(env, docs, options)).sent.length, 0);
  assert.equal(mails.length, 1);
  // 本番への切替時は、AKだけが見た分を編集者の送信済み扱いにしない。
  const live = await runDeadlineReminders({ ...env, REMINDERS_MODE: "on" }, docs, options);
  assert.equal(live.sent.length, 2); assert.deepEqual(mails.map((m) => m.to), ["ak@x.com", "ed@x.com"]);
  assert.equal(JSON.parse(kv.get("notif:ed@x.com")).length, 2);
  assert.equal([...kv.keys()].filter((k) => k.startsWith("remind:")).length, 2);
}

// 編集者のダッシュボード：今やること・早い/遅れ
{
  const base = { mgProjectId: "p1", title: "山岸さん", finalDeadline: "2026-10-10" };
  const st = (id, name, role, status, deadline, order) => ({ id, stepName: name, defaultRole: role, status, deadline, stepOrder: order });
  // 撮影待ち：次は自分の本編集
  let w = workForCase({ ...base, steps: [st("a", "撮影", "Camera", "pending", "2026-10-05", 1), st("b", "本編集", "Editor", "pending", "2026-10-08", 2)] }, "2026-10-01", docs);
  assert.equal(w.pace, "余裕"); assert.ok(w.action.startsWith("撮影待ち（10/05予定）")); assert.equal(w.mine.days, 7); assert.equal(w.guides.length, 2);
  // 自分の工程・遅れ
  w = workForCase({ ...base, steps: [st("a", "撮影", "Camera", "completed", "2026-09-20", 1), st("b", "本編集", "Editor", "pending", "2026-09-29", 2)] }, "2026-10-01", docs);
  assert.equal(w.pace, "遅れ"); assert.equal(w.action, "本編集を進める"); assert.equal(w.mine.days, -2);
  // 担当と納期の一覧用：残りの工程（役割つき）と割り当て
  w = workForCase({ ...base, assignments: [{ role: "Editor", memberId: "m1" }, { role: "Director", memberId: "m2", archived: true }], steps: [st("a", "撮影", "Camera", "completed", "2026-09-20", 1), st("b", "本編集", "Editor", "pending", "2026-10-05", 2), st("c", "納品", null, "pending", "2026-10-10", 3)] }, "2026-10-01", docs);
  assert.deepEqual(w.steps, [{ name: "本編集", deadline: "2026-10-05", role: "Editor" }, { name: "納品", deadline: "2026-10-10", role: "Editor" }]);
  assert.deepEqual(w.assignments, [{ role: "Editor", memberId: "m1" }]);
  // 今日・もうすぐ・締切未設定・完了
  assert.equal(workForCase({ ...base, steps: [st("b", "本編集", "Editor", "pending", "2026-10-01", 1)] }, "2026-10-01", docs).pace, "今日");
  assert.equal(workForCase({ ...base, steps: [st("b", "本編集", "Editor", "pending", "2026-10-03", 1)] }, "2026-10-01", docs).pace, "もうすぐ");
  assert.equal(workForCase({ ...base, steps: [st("b", "本編集", "Editor", "pending", null, 1)] }, "2026-10-01", docs).pace, "締切未設定");
  assert.equal(workForCase({ ...base, steps: [st("b", "本編集", "Editor", "completed", "2026-09-01", 1)] }, "2026-10-01", docs).pace, "完了");
}

assert.equal(unexpectedNetworkCalls, 0);
console.log("deadline reminder regression tests passed (synthetic only; zero network calls)");
