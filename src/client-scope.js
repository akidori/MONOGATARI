/* 先方・演者用リンク（Issue #37）で返してよい中身だけを残す。
   先方・演者用は「構成台本＋香盤表」だけを見せる。範囲を絞った鍵（?c=）で開かれた時はサーバーがこれを通して返すので、
   share.html の表示だけでなく、生データ（/api/snap の JSON）にも他のタブの中身が載らない。
   残すものは share.html の構成台本・香盤表の表示が読む項目だけ（足す時は share.html の paneScript / paneKouban / metaInfoBlock を見る）。 */
const pick = (o, keys) => {
  const out = {};
  if (!o || typeof o !== "object") return out;
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
};
export const CLIENT_PANES = ["script", "kouban"];
const META_KEYS = ["highlight", "shootDate", "place", "titles", "thumbs", "personNames"];
const PLAN_KEYS = ["title", "thumbText", "thumbText2", "thumbImages"];
const ROW_DROP = ["spine", "memo", "note", "internalNote"];

export function clientScopeProject(p) {
  if (!p || typeof p !== "object") return p;
  const out = pick(p, ["id", "name", "channel", "format", "theme", "rate", "timeFormat", "talk"]);
  out.meta = pick(p.meta, META_KEYS);
  const p0 = Array.isArray(p.plans) && p.plans[0] ? pick(p.plans[0], PLAN_KEYS) : null;
  out.plans = p0 ? [p0] : [];
  out.rows = (Array.isArray(p.rows) ? p.rows : []).map((r) => {
    if (!r || typeof r !== "object") return r;
    const x = { ...r };
    for (const k of ROW_DROP) delete x[k];
    return x;
  });
  return out;
}

export function clientScopeSnap(snap) {
  if (!snap || !snap.project) return snap;
  return { project: clientScopeProject(snap.project), createdAt: snap.createdAt, updatedAt: snap.updatedAt, scope: "client" };
}
