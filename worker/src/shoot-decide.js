/* ===== 撮影日を決める期限の知らせ（2026-10-06 AK、Issue #39） =====
   新規案件ウィザード／概要タブで撮影日が未定の時に入れる「いつまでに決めるか」（meta.prod.shootDecideBy）の日の朝に、
   AKへ知らせる（アプリ内通知＋メール）。先方への文面は下書きを添えるだけで、先方には自動で送らない（AKが確認して送る）。
   Studio OS には予約しない（AK決定 2026-10-06：毎朝8時の知らせに載せる）。
   案件はクラウド保存（D1 mg_kv）から読む。同じ案件・同じ期限では1回だけ。REMINDERS_MODE=off なら何もしない。
   純粋なロジック（planShootDecide / composeShootDecide）は Node でテストできるように env を触らない。 */
import { jstDate, pushNotifs, sendMail, reminderMode } from "./reminders.js";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const str = (x) => (x == null ? "" : String(x)).trim();

/* rows: [{ proj_id, value(JSON文字列 or オブジェクト) }]（新しい順）→ 今日が期限で撮影日が未定の案件 */
export function planShootDecide(rows, today) {
  const seen = new Set();
  const out = [];
  for (const row of rows || []) {
    if (!row || !row.proj_id || seen.has(row.proj_id)) continue;
    seen.add(row.proj_id); // 同じ案件の行が複数あれば最新だけを見る
    let p = row.value;
    if (typeof p === "string") { try { p = JSON.parse(p); } catch (e) { continue; } }
    if (!p || typeof p !== "object" || p.archived || p.trashedAt) continue;
    const meta = p.meta && typeof p.meta === "object" ? p.meta : {};
    const prod = meta.prod && typeof meta.prod === "object" ? meta.prod : {};
    const by = str(prod.shootDecideBy);
    if (!YMD.test(by) || by !== today) continue;
    if (str(meta.shootDate)) continue; // もう撮影日が入っていれば知らせない
    const talents = (Array.isArray(prod.talents) ? prod.talents : []).map((t) => str(t && (t.call || t.name))).filter(Boolean);
    out.push({ caseId: row.proj_id, caseName: str(p.name) || "案件", channel: str(p.channel), decideBy: by, talents });
  }
  return out;
}

/* 先方への文面の下書き（AKが直して送る前提。敬語・短く） */
export function draftFor(item) {
  const who = item.talents.length ? item.talents.join("・") + "の" : "";
  return `お世話になっております。Bird Flipです。\n「${item.caseName}」の${who}撮影日について、ご都合はいかがでしょうか。\n候補の日をいくつかお知らせいただけましたら、こちらで調整いたします。\nどうぞよろしくお願いいたします。`;
}

export function composeShootDecide(items, appOrigin) {
  const lines = items.map((r) => `・${r.caseName}${r.channel ? "（" + r.channel + "）" : ""} 期限 ${r.decideBy}\n  ${appOrigin}/?case=${encodeURIComponent(r.caseId)}`).join("\n");
  const drafts = items.map((r) => `■ ${r.caseName}\n${draftFor(r)}`).join("\n\n");
  return {
    subject: items.length === 1 ? `【ものがたりっち】今日が撮影日を決める期限です：${items[0].caseName}` : `【ものがたりっち】今日が撮影日を決める期限の案件（${items.length}件）`,
    body: `撮影日がまだ決まっていない案件です。先方への確認をお願いします。\n\n${lines}\n\n―― 先方への文面の下書き（自動では送っていません）――\n\n${drafts}\n\n※同じ案件・同じ期限では1回だけ送ります。\nBird Flip / ものがたりっち！`,
  };
}

export async function runShootDecideReminders(env, { now = Date.now(), fetchImpl = fetch, adminEmails = [], dryRun = false } = {}) {
  if (reminderMode(env) === "off" && !dryRun) return { ok: true, skipped: "REMINDERS_MODE=off", sent: [] };
  if (!env.DB || !adminEmails.length) return { ok: false, reason: "DB または ADMIN_EMAILS が未設定", sent: [] };
  const today = jstDate(now);
  let rows = [];
  try {
    const r = await env.DB.prepare(
      "SELECT proj_id, value FROM mg_kv WHERE proj_id IS NOT NULL AND json_valid(value) AND json_extract(value,'$.meta.prod.shootDecideBy') = ? ORDER BY updated_at DESC"
    ).bind(today).all();
    rows = (r && r.results) || [];
  } catch (e) { return { ok: false, reason: "D1: " + (e.message || e), sent: [] }; }
  const plan = planShootDecide(rows, today);
  const fresh = [];
  for (const it of plan) if (!(await env.SNAPS.get("shootdec:" + it.caseId + ":" + it.decideBy))) fresh.push(it);
  if (dryRun || !fresh.length) return { ok: true, today, planned: plan.length, sent: [], fresh };
  const appOrigin = (env.APP_ORIGIN || "https://monogataritch.pages.dev").replace(/\/$/, "");
  const mail = composeShootDecide(fresh, appOrigin);
  for (const to of adminEmails) {
    // アプリ内通知は案件ごとに1件（「案件を開く」で飛べるよう caseId を持たせる）。下書きは通知の中にも入れる
    await pushNotifs(env, to, fresh.map((r) => ({
      id: "shootdec:" + r.caseId + ":" + r.decideBy, at: now, type: "digest", read: false, caseId: r.caseId, caseName: r.caseName, phase: "today",
      title: "今日が撮影日を決める期限です", guides: [{ source: "先方への文面の下書き（自動では送っていません）", points: draftFor(r).split("\n") }],
    })));
    await sendMail(env, fetchImpl, to, mail, "monogataritch:shoot-decide:" + today);
  }
  for (const r of fresh) await env.SNAPS.put("shootdec:" + r.caseId + ":" + r.decideBy, "1", { expirationTtl: 60 * 86400 });
  return { ok: true, today, planned: plan.length, sent: fresh };
}
