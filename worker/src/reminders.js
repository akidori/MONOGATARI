/* ===== 工程の締切リマインド＋マニュアル配信（2026-09-26 AK） =====
   Studio OS の工程（deliverable_steps）の締切を毎朝読み、ものがたりっちに登録された編集者
   （共同編集メンバー）へ「前日・当日・超過（3日目まで）」でメールとアプリ内通知を送る。
   超過が3日を過ぎたら編集者への催促は止め、AK（管理者）に1回だけ知らせる。
   催促には、その工程に合うマニュアル（knowledge/ と構成のルール）の要点を添えて、
   マニュアルを受け身でも読んでもらえるようにする。
   - 日程の正本は Studio OS（ここでは読むだけ。ものがたりっち側に日程を持たない）
   - 対象は編集者の工程だけ（Studio OS のテンプレの担当役割が Editor。役割が未設定の工程は名前で判定）
   - 同じ工程・同じ段階・同じ日には1回しか送らない（KV で重複防止）
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
    if (!editors.length) continue; // ものがたりっちに編集者が登録されていない案件は送らない
    // Studio OSで編集担当（assignments の Editor）が決まっていて、その人がこの案件の編集者なら、その人にだけ送る
    const assigned = (d.assignments || []).filter((a) => a && !a.archived && EDITOR_ROLES.has(a.role))
      .map((a) => (memberEmailById[a.memberId] || "").toLowerCase()).filter(Boolean);
    const narrowed = editors.filter((e) => assigned.includes(e));
    const to = narrowed.length ? narrowed : editors;
    for (const { s, ph } of due) {
      const base = { caseId: d.mgProjectId, caseName: kase.name || d.title || "案件", stepId: s.id, stepName: s.stepName, deadline: s.deadline.slice(0, 10), phase: ph };
      if (ph.key === "stale") {
        // 編集者にはもう送らない。AKに1回だけ（日付を含めないキー＝以後は送らない）
        if (adminEmails.length) out.push({ ...base, key: `${d.mgProjectId}:${s.id}:stale`, to: adminEmails, editors: to, guides: [], forAdmin: true });
        continue;
      }
      out.push({ ...base, key: `${d.mgProjectId}:${s.id}:${ph.key}:${today}`, to, guides: guidesFor(s.stepName, docs) });
    }
  }
  return out;
}

export function composeEmail(r, appOrigin) {
  const url = `${appOrigin}/?case=${encodeURIComponent(r.caseId)}`;
  if (r.forAdmin) {
    return {
      subject: `【ものがたりっち】超過が続いている工程：${r.caseName}（${r.stepName}）`,
      body: `「${r.caseName}」の${r.stepName}は、締切（${r.deadline}）から${-r.phase.days}日たってもStudio OSで完了になっていません。\n\n編集者（${(r.editors || []).join("、")}）への自動の催促は${OVERDUE_EDITOR_DAYS}日で止めました。完了の登録漏れか、締切の見直しが必要かを確認してください。\n\n案件を開く：${url}\n\nBird Flip / ものがたりっち！`,
    };
  }
  const head = r.phase.key === "over"
    ? `「${r.caseName}」の${r.stepName}は、締切（${r.deadline}）を${-r.phase.days}日過ぎています。状況を教えてください。`
    : `「${r.caseName}」の${r.stepName}は、${r.phase.key === "eve" ? "明日" : "今日"}（${r.deadline}）が締切です。`;
  const guide = r.guides.length
    ? "\n\n―― この工程で押さえること ――\n" + r.guides.map((g) => `【${g.source}】\n` + g.points.map((p) => `・${p}`).join("\n")).join("\n\n")
    : "";
  return {
    subject: `【ものがたりっち】${r.phase.label}：${r.caseName}（${r.stepName}）`,
    body: `${head}\n\n案件を開く：${url}${guide}\n\n※このメールは工程の締切に合わせて自動で送っています。締切の変更はディレクターに相談してください。\nBird Flip / ものがたりっち！`,
  };
}

export function toNotification(r, now = Date.now()) {
  return {
    id: r.key, at: now, type: "deadline", read: false,
    caseId: r.caseId, caseName: r.caseName, stepName: r.stepName, deadline: r.deadline,
    phase: r.phase.key, title: `${r.phase.label}：${r.stepName}`, guides: r.guides,
  };
}

/* ---- 実行（Worker の cron から呼ぶ） ---- */
export async function runDeadlineReminders(env, docs, { dryRun = false, now = Date.now(), fetchImpl = fetch, adminEmails = [] } = {}) {
  if (!env.STUDIO_AGENT_KEY) return { ok: false, reason: "STUDIO_AGENT_KEY 未設定", sent: [] };
  const headers = { authorization: "Bearer " + env.STUDIO_AGENT_KEY };
  const deliverables = [];
  for (let page = 1; page <= 10; page++) {
    const r = await fetchImpl(`${STUDIO_API}/deliverables?productionStatus=active&expand=detail&limit=200&page=${page}`, { headers });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.success === false) return { ok: false, reason: "Studio OS " + r.status, sent: [] };
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
  const sent = [];
  for (const r of plan) {
    const dedupeKey = "remind:" + r.key;
    if (await env.SNAPS.get(dedupeKey)) continue;
    const mail = composeEmail(r, appOrigin);
    if (dryRun) { sent.push({ ...r, mail }); continue; }
    for (const to of r.to) {
      if (env.BOT_API_URL && env.BOT_API_KEY) {
        try {
          await fetchImpl(env.BOT_API_URL.replace(/\/$/, "") + "/api/email/send", {
            method: "POST", headers: { "content-type": "application/json", "X-API-Key": env.BOT_API_KEY },
            body: JSON.stringify({ to, subject: mail.subject, body: mail.body, audit_target: "monogataritch:remind:" + r.key }),
          });
        } catch (e) { /* メール失敗でもアプリ内通知は残す */ }
      }
      const nk = "notif:" + to;
      const list = (await env.SNAPS.get(nk, "json")) || [];
      if (!list.some((n) => n.id === r.key)) {
        list.unshift(toNotification(r, now));
        await env.SNAPS.put(nk, JSON.stringify(list.slice(0, 50)));
      }
    }
    await env.SNAPS.put(dedupeKey, "1", r.forAdmin ? { expirationTtl: 180 * 86400 } : { expirationTtl: 3 * 86400 });
    sent.push(r);
  }
  return { ok: true, today, planned: plan.length, sent };
}
