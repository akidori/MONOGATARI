/* チャンネル別の編集ルールをAIの資料に足す（2026-10-06）。
   AIの質問回答・台本チェックは、共通のマニュアルと qa.md しか読んでいなかったため、
   ReQuest「運命を職業に」のアバン・3分・対立などチャンネル固有の決まりがAIに届いていなかった。
   正本は GitHub birdflip-knowledge の Manuals/client-rules/（Clients/Rule の編集者向けの写し）。
   ナレッジAPIの /api/knowledge_get から読み、status が validated / published のものだけ渡す（draft は渡さない）。

   対応表は推測で作らない。ものがたりっちの案件の channel の値（D1 clients.mg_channel と同じ表記）と、
   ナレッジ側の実在するファイルの組だけを書く。ここに無いチャンネルは今まで通り共通の資料だけで動く。 */

export const CHANNEL_KNOWLEDGE = {
  "オリックス": ["Manuals/client-rules/orix.md"],
  "スタジアム（運命の職業）": ["Manuals/client-rules/request-sns.md"],
  "マナブ｜孤独に、静かに、淡々と": ["Manuals/client-rules/manabu.md"],
  "宇宙への挑戦者": ["Manuals/client-rules/uchuu.md"],
};

const OK_STATUS = new Set(["validated", "published"]);
// トークンが急に増えないよう上限を置く（1ページ・合計の文字数）。ORIXのページで約1.6万字
export const PAGE_MAX = 16000;
export const TOTAL_MAX = 20000;
const TTL = 600000; // 10分（学習タブと同じ）

export function channelPaths(channel) {
  const c = (channel || "").toString().trim();
  return Object.prototype.hasOwnProperty.call(CHANNEL_KNOWLEDGE, c) ? CHANNEL_KNOWLEDGE[c] : [];
}

/* ナレッジAPIの応答（knowledge_get）から、渡してよい本文だけを取り出す。渡せなければ null */
export function usableNote(res) {
  const n = res && res.found && res.note;
  if (!n || typeof n.body !== "string" || !n.body.trim()) return null;
  if (!OK_STATUS.has((n.status || "").toString().trim())) return null;
  if (n.superseded_by) return null;
  return { path: n.path, title: n.title || n.path, body: n.body };
}

/* AIの指示に足すブロックを作る。notes は usableNote の結果の配列 */
export function channelBlock(channel, notes) {
  let left = TOTAL_MAX;
  const parts = [];
  for (const n of notes) {
    if (!n || left <= 0) continue;
    const cap = Math.min(PAGE_MAX, left);
    const body = n.body.length > cap ? n.body.slice(0, cap) + "\n\n（長いため、ここで省略）" : n.body;
    left -= body.length;
    parts.push("### " + n.title + "（" + n.path + "）\n\n" + body);
  }
  if (!parts.length) return "";
  return "\n\n## このチャンネル（" + channel + "）の編集ルール（birdflip-knowledge の確認済みページ）\n\n" +
    "この案件のチャンネルにだけ当てはまる決まり。共通のマニュアルと食い違う時は、このチャンネルの決まりを優先する。根拠に使う時は節の名前を書く。\n\n" +
    parts.join("\n\n");
}

const CACHE = new Map(); // path → { at, note }（isolate ごと）

/* fetcher(path) は /api/knowledge_get の Response を返す関数。失敗しても空文字（AIは共通資料だけで動く） */
export async function channelKnowledgeBlock(channel, fetcher, now = Date.now()) {
  const paths = channelPaths(channel);
  if (!paths.length || typeof fetcher !== "function") return "";
  const notes = [];
  for (const p of paths) {
    const hit = CACHE.get(p);
    if (hit && now - hit.at < TTL) { if (hit.note) notes.push(hit.note); continue; }
    let note = null;
    try {
      const r = await fetcher(p);
      if (r && r.ok) note = usableNote(await r.json());
    } catch (e) { note = null; }
    CACHE.set(p, { at: now, note });
    if (note) notes.push(note);
  }
  return channelBlock((channel || "").toString().trim(), notes);
}

export function _clearChannelCache() { CACHE.clear(); }
