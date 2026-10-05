/* ===== AIエージェントの学習ループ（2026-10-04） =====
   AIが「AKへ」回した質問に、AKがアプリ内で答える → 質問した人に届く → 適用範囲を選んだ回答は
   次からAIが資料として使う（knowledge/qa.md と同じ形・同じ扱い）。
   マニュアル「ものがたりっちAIエージェント」節の「学習ループ」と「継続判断」をここで支える。
   純粋なロジックだけを置き、index.js から KV の読み書きと通知を行う（Node でテストできるように）。 */

export const QA_SCOPES = ["この案件限定", "このチャンネル共通", "全案件共通"];
export const QA_NO_RECORD = "記録しない"; // 本人に返すだけ（AIの資料には入れない）

const jstDay = (ms) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);

/* qa.md の見出しに使う要約（AIが整理した質問文の1文目、最大48字） */
export function qaSummary(text) {
  const t = (text || "").replace(/\s+/g, " ").trim();
  const first = (t.split(/(?<=[。？?！!])/)[0] || t).trim();
  return first.length > 48 ? first.slice(0, 47) + "…" : first;
}

/* 回答を付ける。inbox はそのまま変えずに新しい配列を返す */
export function applyAnswer(inbox, id, { answer, scope, by, now = Date.now() }) {
  const ans = (answer || "").toString().trim();
  if (!ans) return { error: "回答が空です", status: 400 };
  if (ans.length > 4000) return { error: "回答は4000字までにしてください", status: 413 };
  if (scope !== QA_NO_RECORD && !QA_SCOPES.includes(scope)) return { error: "適用範囲を選んでください", status: 400 };
  const i = (inbox || []).findIndex((x) => x && x.id === id);
  if (i < 0) return { error: "質問が見つかりません", status: 404 };
  const cur = inbox[i];
  if (cur.status === "answered") return { error: "この質問には回答済みです", status: 409 };
  // 当てはめる手がかりが無い範囲は選べない（選んでも二度と使われない回答になるため）
  if (scope === "この案件限定" && !cur.caseId) return { error: "案件を開かずに聞かれた質問なので「この案件限定」は選べません", status: 400 };
  if (scope === "このチャンネル共通" && !cur.channel) return { error: "チャンネルが分からない質問なので「このチャンネル共通」は選べません", status: 400 };
  const item = { ...cur, status: "answered", answer: ans, scope, answeredBy: by || "", answeredAt: now };
  const next = inbox.slice(); next[i] = item;
  const qa = scope === QA_NO_RECORD ? null : {
    id: item.id, date: jstDay(now), summary: qaSummary(item.akQuestion || item.question),
    caseId: item.caseId || "", caseName: item.caseName || "", channel: item.channel || "",
    question: item.question, answer: ans, scope,
  };
  return { inbox: next, item, qa };
}

/* 今の質問に当てはまる回答だけを選ぶ（全案件共通／同じチャンネル／同じ案件） */
export function applicableQa(entries, { caseId = "", channel = "" } = {}) {
  return (entries || []).filter((e) => e && (
    e.scope === "全案件共通" ||
    (e.scope === "このチャンネル共通" && channel && e.channel === channel) ||
    (e.scope === "この案件限定" && caseId && e.caseId === caseId)));
}

/* knowledge/qa.md と同じ形式（AKがリポジトリへ写す時もこのまま貼れる） */
export function qaToMarkdown(entries) {
  return (entries || []).map((e) => [
    `## ${e.date} ${e.summary}`,
    `**案件**: ${e.caseName || e.caseId || "（案件なし）"}${e.channel ? `（${e.channel}）` : ""}`,
    `**質問**: ${e.question}`,
    `**AKの回答**: ${e.answer}`,
    `**適用範囲**: ${e.scope}`,
  ].join("\n")).join("\n\n");
}

/* AIの指示に足すブロック。当てはまる回答が無ければ空文字 */
export function qaSystemBlock(entries, ctx) {
  const hit = applicableQa(entries, ctx);
  if (!hit.length) return "";
  return "\n\n## knowledge/qa.md の追記分（AKがアプリから答えたもの。qa.md と同じ扱いで、適用範囲が今回の質問に当てはまるものだけ載せている）\n\n" + qaToMarkdown(hit);
}

/* 継続判断用の日別カウンタ（2週間ごとの質問数と「直接答えた」対「AKへ回した」） */
export function bumpStat(stat, verdict) {
  const s = { 回答: 0, AKへ: 0, ...(stat || {}) };
  if (verdict === "回答" || verdict === "AKへ") s[verdict] += 1;
  return s;
}
export function sumStats(days) {
  const t = { 回答: 0, AKへ: 0 };
  for (const d of days || []) if (d) { t.回答 += d.回答 || 0; t.AKへ += d.AKへ || 0; }
  const total = t.回答 + t.AKへ;
  return { ...t, total, directRate: total ? Math.round((t.回答 / total) * 100) : null };
}
