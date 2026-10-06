/* ===== ディレクター用の1日まとめ（2026-10-06、Issue #40） =====
   毎朝9時に、遥（公式LINE）からAKへ1通。birdflip-cron の15分ごとの処理が9時台に1回だけ GET /api/agent/director-digest を呼び、
   返った文面をそのまま送る（送るかどうか・いつ送るかは cron 側。ここは文面を作るだけ）。
   中身：①まだ答えていない質問 ②編集者が読んでいない通知（1日以上） ③空欄のまま編集者に渡した案件（前日分） ④★AK確認待ち（質問の形で）
   何も無い日は空文字＝送らない（通知は黙るのがデフォ）。純粋なロジックだけ（Nodeでテスト）。 */
const MAX = 5;
const more = (arr) => (arr.length > MAX ? `\n・ほか${arr.length - MAX}件` : "");

/* ★AK確認待ち の行を Markdown から拾う（「★AK確認待ち：〇〇」→「〇〇」） */
export function pendingFromMarkdown(md, source) {
  const out = [];
  for (const line of String(md || "").split("\n")) {
    const m = line.match(/★AK確認待ち[：:]\s*(.+)$/);
    if (m && m[1].trim()) out.push({ text: m[1].replace(/\*\*|`/g, "").trim(), source });
  }
  return out;
}

export function directorDigestText({ today, openQuestions = [], ignored = [], gaps = [], pending = [], appOrigin = "" }) {
  const parts = [];
  if (openQuestions.length) parts.push(`■ まだ答えていない質問（${openQuestions.length}件）\n` +
    openQuestions.slice(0, MAX).map((q) => `・${q.caseName || "（案件なし）"}：${String(q.akQuestion || q.question || "").slice(0, 80)}（${q.askedByName || q.askedBy || "不明"}）`).join("\n") + more(openQuestions));
  if (ignored.length) parts.push(`■ 編集者が読んでいない通知（1日以上）\n` +
    ignored.slice(0, MAX).map((x) => `・${x.who}：${x.count}件（いちばん古いもの：${x.title}）`).join("\n") + more(ignored));
  if (gaps.length) parts.push(`■ 空欄のまま編集者に渡した案件\n` +
    gaps.slice(0, MAX).map((g) => `・${g.caseName}：${g.missing.join("・")}`).join("\n") + more(gaps));
  if (pending.length) parts.push(`■ 決めてほしいこと（★AK確認待ち）\n` +
    pending.slice(0, MAX).map((p) => `・${p.text}は、どうしますか？`).join("\n") + more(pending));
  if (!parts.length) return "";
  return `【ものがたりっち】${today} のまとめ\n\n` + parts.join("\n\n") + (appOrigin ? `\n\n質問への回答はアプリの通知（ベル）から：${appOrigin}/` : "");
}
