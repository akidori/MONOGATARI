/* 編集者用リンクを出す前に埋まっていてほしい6項目（2026-10-06、Issue #38）。
   正本：birdflip-knowledge「編集者への受け渡しをものがたりっちとPremiereプラグインに集約する」の必須6項目。
   チャンネル単位（チャンネルに1回入れれば同じチャンネルの案件すべてに効く）：チャンネルURL・コンセプト・ターゲット・競合
   案件単位：プロマネ（Premiereプロジェクト一式のURL。案件に無ければチャンネルの共通URLで足りる）
   自動：マニュアル（チャンネルのマニュアルURL・決め事・スタジオ共通の決め事のどれかがあれば足りる）
   空欄でも発行は止めない（AK回答 2026-10-03）。警告して「それでも発行」を選べるようにし、空欄のまま渡したことを記録する。 */
const s = (x) => (x == null ? "" : String(x)).trim();

export function handoffMissing(meta, channelInfo, globalManuals) {
  const ci = channelInfo && typeof channelInfo === "object" ? channelInfo : {};
  const prod = meta && meta.prod && typeof meta.prod === "object" ? meta.prod : {};
  const out = [];
  if (!s(ci.url)) out.push("チャンネルURL");
  if (!s(ci.concept)) out.push("コンセプト・世界観");
  if (!s(ci.target)) out.push("ターゲット");
  if (!(Array.isArray(ci.competitors) ? ci.competitors : []).some((c) => c && (s(c.url) || s(c.name)))) out.push("競合チャンネル");
  if (!s(prod.promanUrl) && !s(ci.promanUrl)) out.push("プロマネ");
  const hasManual = !!s(ci.manualUrl) || (Array.isArray(ci.manuals) && ci.manuals.length > 0) || (Array.isArray(globalManuals) && globalManuals.length > 0);
  if (!hasManual) out.push("マニュアル");
  return out;
}

/* 空欄のまま渡した記録（meta.handoffGaps）。新しい順に最大20件 */
export function addHandoffGap(meta, entry) {
  const prev = meta && Array.isArray(meta.handoffGaps) ? meta.handoffGaps : [];
  return [{ at: entry.at, by: s(entry.by), missing: (entry.missing || []).map(String), kind: s(entry.kind) || "editor" }, ...prev].slice(0, 20);
}
