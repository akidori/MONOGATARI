/* ===== 工程の締切リマインド＋マニュアル配信（2026-09-26 AK） =====
   Studio OS の工程（deliverable_steps）の締切を毎朝読み、ものがたりっちに登録された編集者
   （共同編集メンバー）へ知らせる。催促には、その工程に合うマニュアル（knowledge/ と構成のルール）の
   要点を添えて、マニュアルを受け身でも読んでもらえるようにする。
   ■ 通知を増やさないルール（2026-09-26 AK「通知が多いのは1番きつい」）
   - メールは1人1日1通まで（その日の分を1通にまとめる）。アプリ内通知は工程ごとに1件（段階が進んだら置き換え）
   - 前日はアプリ内だけ（メールなし）。メールは当日と超過のときだけ
   - 超過の催促は1回だけ。超過が3日を過ぎても完了にならない工程は、編集者ではなくAKに1回だけ（まとめて1通）
   - 同じ工程・同じ段階・同じ締切では2回送らない（締切が変わったら数え直す）
   - REMINDERS_MODE：off＝何もしない／preview（既定）＝誰にも送らず、送る予定の一覧をAKのアプリ内通知に1件だけ出す／on＝送る
   - 日程の正本は Studio OS（ここでは読むだけ。ものがたりっち側に日程を持たない）
   - 対象は編集者の工程だけ（Studio OS のテンプレの担当役割が Editor。役割が未設定の工程は名前で判定）
   純粋なロジックはここに置き、index.js から env と資料テキストを渡して呼ぶ（Node でテストできるように）。 */

export const STUDIO_API = "https://studio-os-5dm.pages.dev/api/v1";
const DONE = new Set(["completed", "done", "skipped"]);
const EDITOR_NAME_RE = /編集|修正|初稿|素材整理|納品/;

/* 日本時間の YYYY-MM-DD */
export const jstDate = (ms = Date.now()) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
const dayDiff = (from, to) => Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000);

export const isEditorStep = (s) => (s.defaultRole ? s.defaultRole === "Editor" : EDITOR_NAME_RE.test(s.stepName || ""));

/* 編集者への超過の催促は何日目まで送るか。これを過ぎたら編集者には送らず、AKに1回だけ知らせる
   （Studio OSの締切は最終締切からの自動逆算が多く、完了登録漏れのまま毎朝催促が飛び続けるのを防ぐ） */
export const OVERDUE_EDITOR_DAYS = 3;

/* 締切までの日数から段階を決める。対象外は null */
export function phaseOf(deadline, today) {
  if (!deadline || !/^\d{4}-\d{2}-\d{2}/.test(deadline)) return null;
  const d = dayDiff(today, deadline.slice(0, 10));
  if (d === 1) return { key: "eve", label: "明日が締切", days: 1 };
  if (d === 0) return { key: "today", label: "今日が締切", days: 0 };
  if (d < 0 && -d <= OVERDUE_EDITOR_DAYS) return { key: "over", label: `締切を${-d}日過ぎています`, days: d };
  if (d < 0) return { key: "stale", label: `締切から${-d}日たっても完了になっていません`, days: d };
  return null;
}

/* ---- マニュアルの節を取り出す ----
   「## 見出し」形式と「**A. 見出し**」形式（構成のルール）の両方に対応。見出しは前方一致。 */
export function extractSection(md, heading, maxItems = 6) {
  const lines = (md || "").split("\n");
  // 「**A. 見出し**（補足）」のように太字の後に補足が続く行も見出しとして扱う
  const isHead = (l) => /^#{1,6}\s/.test(l) || /^\*\*[^*]+\*\*/.test(l.trim());
  const headText = (l) => { const t = l.trim(); const m = t.match(/^\*\*([^*]+)\*\*/); return m ? m[1].trim() : t.replace(/^#{1,6}\s+/, "").trim(); };
  const start = lines.findIndex((l) => isHead(l) && headText(l).startsWith(heading));
  if (start < 0) return [];
  const items = [];
  for (let i = start + 1; i < lines.length && items.length < maxItems; i++) {
    const l = lines[i];
    if (isHead(l)) break;
    const m = l.match(/^\s{0,3}(?:[-*]|\d+\.)\s+(.*)$/);
    if (m) items.push(m[1].replace(/\*\*|`/g, "").trim());
  }
  return items;
}

/* 工程名 → 添えるマニュアルの節（上から順に最大2節）。AK が後から直せるよう対応表はここ1か所 */
export const STEP_GUIDES = [
  { match: /素材整理/, refs: [["manual", "必ず守るルール"], ["gen", "C. 引き出し方"]] },
  { match: /本編集|粗編|初稿/, refs: [["gen", "A. セクション5種の役割"], ["gen", "B. 脳の順番で飽きさせない設計"]] },
  { match: /最終修正|納品/, refs: [["regulation", "人が必ず確認すること"], ["regulation", "判断原則"]] },
  { match: /修正/, refs: [["manual", "必ず守るルール"], ["gen", "D. 原稿（script）の書式"]] },
];
const DOC_TITLE = { manual: "構成台本制作マニュアル", gen: "構成のルール", regulation: "公開前チェック" };

export function guidesFor(stepName, docs) {
  const g = STEP_GUIDES.find((x) => x.match.test(stepName || ""));
  const refs = g ? g.refs : [["manual", "必ず守るルール"]];
  return refs.map(([doc, heading]) => ({ source: `${DOC_TITLE[doc]}「${heading}」`, points: extractSection(docs[doc], heading) }))
    .filter((x) => x.points.length);
}

/* ---- 今日送るべきリマインドを組み立てる（副作用なし） ----
   deliverables: Studio OS の GET /deliverables?expand=detail の data
   loadCase(mgId) → { name, ownerEmail, members } | null（ものがたりっちの共同編集ドキュメント） */
const EDITOR_ROLES = new Set(["Editor", "編集"]);
export async function planReminders({ deliverables, loadCase, docs, today, memberEmailById = {}, adminEmails = [] }) {
  const out = [];
  for (const d of deliverables || []) {
    if (!d || !d.mgProjectId || d.archived || (d.productionStatus && d.productionStatus !== "active")) continue;
    const steps = (d.steps || []).filter((s) => !s.archived && !DONE.has(s.status) && isEditorStep(s));
    const due = steps.map((s) => ({ s, ph: phaseOf(s.deadline, today) })).filter((x) => x.ph);
    if (!due.length) continue;
    const kase = await loadCase(d.mgProjectId);
    if (!kase) continue;
    const owner = (kase.ownerEmail || "").toLowerCase();
    const editors = Array.from(new Set((kase.members || []).map((m) => (m || "").toLowerCase()).filter((m) => m && m.includes("@") && m !== owner)));
    // Studio OSで編集担当（assignments の Editor）が決まっていて、その人がこの案件の編集者なら、その人にだけ送る
    const assigned = Array.from(new Set((d.assignments || []).filter((a) => a && !a.archived && EDITOR_ROLES.has(a.role))
      .map((a) => (memberEmailById[a.memberId] || "").toLowerCase()).filter(Boolean)));
    const caseName = kase.name || d.title || "案件";
    // Studio OSの編集担当のメールが、ものがたりっちの案件メンバーにいない（＝その人には届かない）ことをAKに1回だけ知らせる
    // オーナー（AK）自身が編集担当のときは「届かない」ではないので除く
    const missing = assigned.filter((e) => !editors.includes(e) && e !== owner).sort();
    if (missing.length && adminEmails.length) {
      out.push({ caseId: d.mgProjectId, caseName, key: `${d.mgProjectId}:mismatch:${missing.join(",")}`, to: adminEmails, forAdmin: true, kind: "mismatch", missing });
    }
    if (!editors.length) continue; // ものがたりっちに編集者が登録されていない案件は送らない
    const narrowed = editors.filter((e) => assigned.includes(e));
    const to = narrowed.length ? narrowed : editors;
    for (const { s, ph } of due) {
      const deadline = s.deadline.slice(0, 10);
      const base = { caseId: d.mgProjectId, caseName, stepId: s.id, stepName: s.stepName, deadline, phase: ph };
      if (ph.key === "stale") {
        // 編集者にはもう送らない。AKに1回だけ（締切が変わらない限り以後は送らない）
        if (adminEmails.length) out.push({ ...base, key: `${d.mgProjectId}:${s.id}:stale:${deadline}`, to: adminEmails, editors: to, guides: [], forAdmin: true, kind: "stale" });
        continue;
      }
      // 前日はアプリ内だけ。超過は日付を含めないキー＝1回だけ
      out.push({ ...base, key: `${d.mgProjectId}:${s.id}:${ph.key}:${deadline}`, to, guides: guidesFor(s.stepName, docs), mail: ph.key !== "eve" });
    }
  }
  return out;
}

const MAX_LIST = 10; // 1通に並べる件数の上限（超えたら「ほかN件」）
const listed = (arr, fmt) => arr.slice(0, MAX_LIST).map(fmt).join("\n") + (arr.length > MAX_LIST ? `\n・ほか${arr.length - MAX_LIST}件（アプリの通知で確認できます）` : "");
const itemLine = (r) => `・${r.caseName}（${r.stepName}）…${r.phase.label}（締切 ${r.deadline}）`;

/* 編集者向け：その日の分を1通にまとめる。マニュアルの節は重複を除いて最大3つ */
export function composeDigest(items, appOrigin) {
  const first = items[0];
  const worst = items.some((r) => r.phase.key === "over") ? "締切を過ぎた工程があります" : items.some((r) => r.phase.key === "today") ? "今日が締切の工程があります" : "明日が締切の工程があります";
  const subject = items.length === 1
    ? `【ものがたりっち】${first.phase.label}：${first.caseName}（${first.stepName}）`
    : `【ものがたりっち】${worst}（${items.length}件）`;
  const seen = new Set();
  const guides = [];
  for (const r of items) for (const g of r.guides || []) if (!seen.has(g.source) && guides.length < 3) { seen.add(g.source); guides.push(g); }
  const guide = guides.length
    ? "\n\n―― この工程で押さえること ――\n" + guides.map((g) => `【${g.source}】\n` + g.points.map((p) => `・${p}`).join("\n")).join("\n\n")
    : "";
  const over = items.some((r) => r.phase.key === "over") ? "\n\n締切を過ぎている工程は、状況（いつ終わりそうか）をディレクターに教えてください。" : "";
  const links = Array.from(new Set(items.map((r) => r.caseId))).slice(0, MAX_LIST)
    .map((id) => `${(items.find((r) => r.caseId === id) || {}).caseName}：${appOrigin}/?case=${encodeURIComponent(id)}`).join("\n");
  return {
    subject,
    body: `今日お知らせする工程です。\n\n${listed(items, itemLine)}${over}\n\n案件を開く：\n${links}${guide}\n\n※締切に合わせて自動で送っています（メールは1日1通まで・同じ工程の催促は1回だけ）。締切の変更はディレクターに相談してください。\nBird Flip / ものがたりっち！`,
  };
}

/* AK向け：超過が続いている工程・届かない担当者を1通にまとめる */
export function composeAdminDigest(items, appOrigin) {
  const stale = items.filter((r) => r.kind === "stale");
  const mismatch = items.filter((r) => r.kind === "mismatch");
  const parts = [];
  if (stale.length) parts.push(`■ 締切から${OVERDUE_EDITOR_DAYS}日以上たっても完了になっていない工程（${stale.length}件）\n編集者への自動の催促は止めました。完了の登録漏れか、締切の見直しが必要かを確認してください。\n` +
    listed(stale, (r) => `・${r.caseName}（${r.stepName}）締切 ${r.deadline}・${-r.phase.days}日超過 ${appOrigin}/?case=${encodeURIComponent(r.caseId)}`));
  if (mismatch.length) parts.push(`■ リマインドが届かない編集担当（${mismatch.length}件）\nStudio OSの編集担当のメールが、ものがたりっちの案件メンバーにいません。案件に招待するか、Studio OSのメールを直してください。\n` +
    listed(mismatch, (r) => `・${r.caseName}：${r.missing.join("、")}`));
  return {
    subject: `【ものがたりっち】確認が必要な工程・担当（${items.length}件）`,
    body: parts.join("\n\n") + "\n\n※同じ内容は2回送りません。\nBird Flip / ものがたりっち！",
  };
}

/* 旧API互換（1件だけのメール） */
export const composeEmail = (r, appOrigin) => (r.forAdmin ? composeAdminDigest([r], appOrigin) : composeDigest([r], appOrigin));

export function toNotification(r, now = Date.now()) {
  return {
    id: r.key, at: now, type: "deadline", read: false,
    caseId: r.caseId, caseName: r.caseName, stepId: r.stepId, stepName: r.stepName, deadline: r.deadline,
    phase: r.phase.key, title: `${r.phase.label}：${r.stepName}`, guides: r.guides,
  };
}

/* 一覧を1件のアプリ内通知にする（AK向けのまとめ・プレビュー用）。caseId が無いので「案件を開く」は出ない */
const digestNotification = (id, title, caseName, sections, now) => ({
  id, at: now, type: "digest", read: false, caseId: null, caseName, phase: "stale", title,
  guides: sections.filter((x) => x.points.length),
});

/* アプリ内通知の保存：工程ごとに1件（同じ工程の古い段階は置き換え）、最大50件 */
async function pushNotifs(env, to, notifs) {
  const nk = "notif:" + to;
  let list = (await env.SNAPS.get(nk, "json")) || [];
  for (const n of notifs) {
    list = list.filter((x) => x.id !== n.id && !(n.stepId && x.type === "deadline" && x.caseId === n.caseId && x.stepId === n.stepId));
    list.unshift(n);
  }
  await env.SNAPS.put(nk, JSON.stringify(list.slice(0, 50)));
}

async function sendMail(env, fetchImpl, to, mail, audit) {
  if (!(env.BOT_API_URL && env.BOT_API_KEY)) return false;
  try {
    const r = await fetchImpl(env.BOT_API_URL.replace(/\/$/, "") + "/api/email/send", {
      method: "POST", headers: { "content-type": "application/json", "X-API-Key": env.BOT_API_KEY },
      body: JSON.stringify({ to, subject: mail.subject, body: mail.body, audit_target: audit }),
    });
    return !!(r && r.ok !== false);
  } catch (e) { return false; } // メール失敗でもアプリ内通知は残す
}

export const reminderMode = (env) => {
  const m = String((env && env.REMINDERS_MODE) || "").trim().toLowerCase();
  return m === "on" || m === "off" ? m : "preview";
};

/* ---- 実行（Worker の cron から呼ぶ） ---- */
export async function runDeadlineReminders(env, docs, { dryRun = false, now = Date.now(), fetchImpl = fetch, adminEmails = [] } = {}) {
  const mode = reminderMode(env);
  if (mode === "off" && !dryRun) return { ok: true, mode, skipped: "REMINDERS_MODE=off", sent: [] };
  if (!env.STUDIO_AGENT_KEY) return { ok: false, mode, reason: "STUDIO_AGENT_KEY 未設定", sent: [] };
  const headers = { authorization: "Bearer " + env.STUDIO_AGENT_KEY };
  const deliverables = [];
  for (let page = 1; page <= 10; page++) {
    const r = await fetchImpl(`${STUDIO_API}/deliverables?productionStatus=active&expand=detail&limit=200&page=${page}`, { headers });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.success === false) return { ok: false, mode, reason: "Studio OS " + r.status, sent: [] };
    deliverables.push(...(j.data || []));
    const total = (j.meta && j.meta.total) || 0;
    if (!(j.data || []).length || deliverables.length >= total) break;
  }
  const loadCase = async (id) => { try { return await env.SNAPS.get("col:" + id, "json"); } catch (e) { return null; } };
  // 編集担当の絞り込み用にStudio OSのメンバーのメールを引く（取れなければ絞り込まずに全編集者へ）
  const memberEmailById = {};
  try {
    const rm = await fetchImpl(`${STUDIO_API}/members?limit=200`, { headers });
    const jm = await rm.json().catch(() => null);
    if (rm.ok && jm && jm.success !== false) for (const m of jm.data || []) if (m.email) memberEmailById[m.id] = m.email;
  } catch (e) { /* 絞り込み無しで続行 */ }
  const today = jstDate(now);
  const plan = await planReminders({ deliverables, loadCase, docs, today, memberEmailById, adminEmails });
  const appOrigin = (env.APP_ORIGIN || "https://monogataritch.pages.dev").replace(/\/$/, "");
  // まだ送っていないものだけ
  const fresh = [];
  for (const r of plan) if (!(await env.SNAPS.get("remind:" + r.key))) fresh.push(r);
  // 宛先ごとにまとめる
  const byTo = new Map();
  for (const r of fresh) for (const to of r.to) { if (!byTo.has(to)) byTo.set(to, { editor: [], admin: [] }); byTo.get(to)[r.forAdmin ? "admin" : "editor"].push(r); }
  const mails = [];
  for (const [to, g] of byTo) {
    const mailItems = g.editor.filter((r) => r.mail);
    if (mailItems.length) mails.push({ to, ...composeDigest(mailItems, appOrigin), items: mailItems.length });
    if (g.admin.length) mails.push({ to, ...composeAdminDigest(g.admin, appOrigin), items: g.admin.length });
  }
  const summary = { ok: true, mode, today, planned: plan.length, fresh: fresh.length, mails: mails.map((m) => ({ to: m.to, subject: m.subject, items: m.items })) };
  if (dryRun) return { ...summary, sent: fresh.map((r) => ({ ...r, to: r.to })), preview: mails };

  if (mode === "preview") {
    // 誰にも送らない。送る予定だった内容をAKのアプリ内通知1件にまとめる（毎朝同じ1件を置き換え・内容が同じなら既読のまま）
    // 重複防止の記録も付けないので、on にした朝に今の状況で送り始める
    const lines = mails.map((m) => `${m.to} へ「${m.subject}」`);
    const inapp = fresh.filter((r) => !r.forAdmin && !r.mail).map((r) => `${r.to.join("、")}：${r.caseName}（${r.stepName}）${r.phase.label}`);
    const warn = [];
    if (!(env.BOT_API_URL && env.BOT_API_KEY)) warn.push("メール送信の設定（BOT_API_URL / BOT_API_KEY）がありません。on にしてもアプリ内通知だけになります");
    if (!Object.keys(memberEmailById).length) warn.push("Studio OSのメンバーのメールが読めません。編集担当に絞れず、案件の編集者全員に送ります");
    for (const to of adminEmails) {
      const prev = ((await env.SNAPS.get("notif:" + to, "json")) || []).find((x) => x.id === "remind-preview");
      const n = digestNotification("remind-preview", `お試し運転：本番なら今朝メール${mails.length}通`, "リマインドはまだ誰にも送っていません（お試し運転中。本番にするには REMINDERS_MODE を on に）", [
        { source: "送る予定だったメール（1人1日1通にまとめ済み）", points: lines.slice(0, 20) },
        { source: "アプリ内だけの通知（前日）", points: inapp.slice(0, 20) },
        { source: "設定の注意", points: warn },
      ], now);
      if (!n.guides.length) n.guides = [{ source: "今朝の結果", points: ["送る予定の通知はありませんでした"] }];
      if (prev && JSON.stringify(prev.guides) === JSON.stringify(n.guides)) n.read = prev.read;
      await pushNotifs(env, to, [n]);
    }
    return { ...summary, sent: [] };
  }

  // mode === "on"：メール（1人1通）→ アプリ内通知 → 重複防止の記録
  for (const m of mails) await sendMail(env, fetchImpl, m.to, m, "monogataritch:remind:" + today);
  for (const [to, g] of byTo) {
    const notifs = g.editor.map((r) => toNotification(r, now));
    if (g.admin.length) {
      const stale = g.admin.filter((r) => r.kind === "stale"), mis = g.admin.filter((r) => r.kind === "mismatch");
      notifs.push(digestNotification("admin:" + today, `確認が必要な工程・担当 ${g.admin.length}件`, "Studio OSの確認が必要です", [
        { source: `締切から${OVERDUE_EDITOR_DAYS}日以上たっても未完了`, points: stale.map((r) => `${r.caseName}（${r.stepName}）締切 ${r.deadline}`) },
        { source: "リマインドが届かない編集担当（案件に未招待）", points: mis.map((r) => `${r.caseName}：${r.missing.join("、")}`) },
      ], now));
    }
    await pushNotifs(env, to, notifs);
  }
  for (const r of fresh) await env.SNAPS.put("remind:" + r.key, "1", { expirationTtl: (r.forAdmin ? 180 : 30) * 86400 });
  return { ...summary, sent: fresh };
}

/* ===== 編集者のダッシュボード（2026-09-26 AK「納期と注意事項を出せば、今何をすべきか・早いのか遅れてるのか分かる」）=====
   Studio OS の案件1件 → 「今やること・自分の工程の締切・早い/遅れ・納期・工程のマニュアル」。副作用なし */
export function workForCase(d, today, docs) {
  const steps = (d.steps || []).filter((s) => s && !s.archived).sort((a, b) => (a.stepOrder || 0) - (b.stepOrder || 0));
  const notDone = steps.filter((s) => !DONE.has(s.status));
  const cur = notDone[0] || null;
  const mine = notDone.find((s) => isEditorStep(s)) || null;
  const days = mine && mine.deadline ? dayDiff(today, mine.deadline.slice(0, 10)) : null;
  const pace = !cur ? "完了" : !mine ? "担当工程なし" : days == null ? "締切未設定" : days < 0 ? "遅れ" : days === 0 ? "今日" : days <= 2 ? "もうすぐ" : "余裕";
  let action;
  if (!cur) action = "全工程が完了しています";
  else if (mine && cur.id === mine.id) action = mine.stepName + "を進める";
  else if (mine) action = cur.stepName + "待ち" + (cur.deadline ? "（" + cur.deadline.slice(5, 10).replace("-", "/") + "予定）" : "") + "。次はあなたの" + mine.stepName;
  else action = cur.stepName + "の段階です（編集の担当工程はありません）";
  return {
    caseId: d.mgProjectId, title: d.title || "",
    finalDeadline: (d.finalDeadline || "").slice(0, 10),
    current: cur ? { name: cur.stepName, deadline: (cur.deadline || "").slice(0, 10), isEditor: isEditorStep(cur) } : null,
    mine: mine ? { name: mine.stepName, deadline: (mine.deadline || "").slice(0, 10), days } : null,
    pace, action,
    guides: mine ? guidesFor(mine.stepName, docs) : [],
    // 担当と納期の一覧（管理者）用：残りの工程（役割つき）と担当の割り当て。名前への変換は呼び出し側（メンバー一覧が要る）
    steps: notDone.slice(0, 8).map((s) => ({ name: s.stepName, deadline: (s.deadline || "").slice(0, 10), role: s.defaultRole || (isEditorStep(s) ? "Editor" : null) })),
    assignments: (d.assignments || []).filter((a) => a && !a.archived && a.role).map((a) => ({ role: a.role, memberId: a.memberId })),
  };
}
