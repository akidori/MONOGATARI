import React, { useState, useEffect, useRef, useMemo } from "react";

/* ============================================================
   ものがたりっち！ — 一日密着ドキュメンタリー構成ツール
   v4: 構成台本 + 香盤表 / 時間表記切替 / テーマカラー変更
   ============================================================ */

const SECTION_TYPES = {
  "インサート": { full: "インサート（3~5秒）",   target: 5,   color: "#71717A", bg: "#F0F0F2" },
  "ブリッジ":   { full: "ブリッジ（5~10秒）",    target: 10,  color: "#0D9488", bg: "#E0F2EF" },
  "VLOG":      { full: "VLOG（15~30秒）",       target: 30,  color: "#D97706", bg: "#FCF0DC" },
  "解説系":     { full: "解説系（30秒~1分）",    target: 60,  color: "#2563EB", bg: "#E3EBFC" },
  "訴求":      { full: "訴求（2~3分）",         target: 180, color: "#DC2645", bg: "#FBE5EA" },
};
const TYPE_KEYS = Object.keys(SECTION_TYPES);

const uid = () => Math.random().toString(36).slice(2, 10);
const newScene = (type = "解説系", label = "") => ({ id: uid(), kind: "scene", label, type, sec: null, tc: null, script: "" });
const newLocation = (name = "") => ({ id: uid(), kind: "location", label: name, address: "", time: "", note: "", travelBy: "", travelCost: null });

const templateRows = () => [
  newLocation("ご自宅（朝）"),
  newScene("インサート", "外観インサート"),
  newScene("インサート", "玄関インサート"),
  newScene("ブリッジ", "自己紹介"),
  newScene("解説系", "現在の活動について"),
  newScene("訴求", "現在の活動（深掘り）"),
  newScene("VLOG", "朝の準備など"),
  newLocation("移動"),
  newScene("ブリッジ", "今向かっているのは…？"),
  newLocation("事業・仕事①"),
  newScene("解説系", "事業内容の紹介"),
  newScene("解説系", "商品・サービス紹介"),
  newScene("訴求", "事業の原点・想い"),
  newScene("ブリッジ", "移動"),
  newLocation("事業・仕事②"),
  newScene("解説系", "事業内容の紹介"),
  newScene("VLOG", "現場の様子・指導シーン"),
  newLocation("お昼休憩"),
  newScene("インサート", "お昼ご飯移動"),
  newScene("訴求", "この活動を始めたきっかけ"),
  newScene("解説系", "転機・人生を変えた出会い"),
  newLocation("仕事再開"),
  newScene("インサート", "仕事中インサート"),
  newScene("インサート", "次の予定へ移動トーク"),
  newLocation("晩御飯食べながら"),
  newScene("解説系", "幼少期について"),
  newScene("訴求", "過去の核心エピソード"),
  newLocation("締め・オフの顔"),
  newScene("VLOG", "オフの一面"),
  newScene("訴求", "今後の目標と若者へのメッセージ"),
];

const DEFAULT_THEME = { main: "#1F2430", accent: "#E63946" };

const DEFAULT_PROJECT = {
  meta: { shootDate: "", place: "", titles: ["", "", ""], thumbs: ["", "", ""], highlight: "" },
  theme: { ...DEFAULT_THEME },
  rate: 5,
  timeFormat: "tc", // "tc" = 00:00 / "jp" = 0分00秒
  rows: templateRows(),
};

const migrate = (p) => {
  const meta = p.meta || {};
  return {
    ...DEFAULT_PROJECT,
    ...p,
    meta: {
      shootDate: meta.shootDate || "",
      place: meta.place || "",
      titles: meta.titles || [meta.title || "", "", ""],
      thumbs: meta.thumbs || [meta.thumb || "", "", ""],
      highlight: meta.highlight || "",
    },
    theme: { ...DEFAULT_THEME, ...(p.theme || {}) },
    timeFormat: p.timeFormat || "tc",
    rows: (p.rows || templateRows()).map((r) =>
      r.kind === "scene"
        ? { sec: null, ...r }
        : { address: "", time: "", note: "", ...r }
    ),
  };
};

const STORAGE_KEY = "kousei-project-v1";        // 旧：単一プロジェクト（移行元）
// Fボード埋め込み（iframe）判定。埋め込み時はサイドバー/ハンバーガー/チャンネルチップを出さない
const IS_EMBED = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
const STORE_INDEX = "monogataritch-index-v1";   // 案件の並び順とメタ
const STORE_PROJ = (id) => "monogataritch-proj-" + id; // 各案件の本体
const STORE_CHANNELS = "monogataritch-channels-v1"; // チャンネル(クライアント)単位のコンセプト情報 {name:{...}}
const emptyChannelInfo = () => ({ name: "", url: "", concept: "", target: "", purpose: "", competitors: [], icon: "", clientNotes: "", manuals: [] });
/* チャンネルアイコンに選べる絵文字 */
const CHANNEL_ICONS = ["📁","🎬","🎥","🎙️","🎤","📺","🎮","📷","🎨","💡","🔥","⭐","🚀","💼","🏆","⚽","🏀","🍳","💪","🐦","🐱","🐶","🌸","🌙","🎯","💰","📚","🧠","❤️","✨","🎸","🍜","🧳","👑","🛠️","🌍"];
const emptyCompetitor = () => ({ url: "", vid: "", name: "", subs: 0, note: "" });

/* 共有＋コメント Worker。localStorage("mg:shareApi") で上書き可（ローカル検証用） */
const SHARE_API = (() => {
  try { const o = localStorage.getItem("mg:shareApi"); if (o) return o.replace(/\/$/, ""); } catch (e) {}
  return "https://mg-share.aki-surf89315.workers.dev";
})();
const shareUrl = (id, r) => location.origin + location.pathname.replace(/[^/]*$/, "") + "share.html?id=" + id + (r ? "&r=" + encodeURIComponent(r) : "");

/* ===== Googleログイン＋クラウド同期 =====
   未ログイン: window.storage = localStorage（index.htmlのshim）
   ログイン中: window.storage = cloudStorage（Worker /api/kv 経由・アカウント別） */
const GOOGLE_CLIENT_ID = ((typeof window !== "undefined" && window.MG_GOOGLE_CLIENT_ID) || "").trim().replace(/^REPLACE_.*/, "");
const AUTH_TOKEN_KEY = "mg:auth:token";
const AUTH_USER_KEY = "mg:auth:user";
const LOCAL_STORAGE_SHIM = (typeof window !== "undefined" && window.storage) ? window.storage : null;
let MG_SESSION = null; // 現在のセッショントークン（cloudStorage が参照）

async function authFetch(path, body) {
  const res = await fetch(SHARE_API + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(MG_SESSION ? { Authorization: "Bearer " + MG_SESSION } : {}) },
    body: JSON.stringify(body || {}),
  });
  if (res.status === 401) { const e = new Error("unauthorized"); e.code = 401; throw e; }
  if (!res.ok) { let m = "通信エラー"; try { m = (await res.json()).error || m; } catch (_) {} throw new Error(m); }
  return res.json();
}

/* localStorage shim と同じ形（get は未存在で throw）でクラウドKVをラップ */
const cloudStorage = {
  async get(key) { const r = await authFetch("/api/kv/get", { key }); if (!r || r.value == null) throw new Error("nf"); return { key, value: r.value, shared: true }; },
  async set(key, value) { await authFetch("/api/kv/set", { key, value }); return { key, value, shared: true }; },
  async delete(key) { await authFetch("/api/kv/delete", { key }); return { key, deleted: true, shared: true }; },
  async list(prefix) { const r = await authFetch("/api/kv/list", { prefix: prefix || "" }); return { keys: r.keys || [], prefix, shared: true }; },
};

function setActiveStorage(useCloud) {
  if (typeof window === "undefined") return;
  window.storage = (useCloud && MG_SESSION) ? cloudStorage : LOCAL_STORAGE_SHIM;
}

const DEFAULT_CHANNEL = "未分類";

/* ===== 制作OS：案件ステータス & 素材（assets単一正本） ===== */
/* ステータス6種（順序＝制作フロー）。色は案件カード/概要のバッジ用 */
/* ===== 受け渡し（ラリー）プリセット =====
   相手に渡すとき、見せるタブ（tabs）・最初に開くタブ（start）・コピーされる文面（msg）をまとめて1ボタンに。
   tabs はアプリのタブキー（script/kouban/assets/review/concept/plan/hearing）。share.html へは TAB_SHARE_PANE 経由でペイン名に変換して渡す。
   msg の {url} はリンクに、{name} は案件名に置換される。mg:handoff に保存され、UIから自由に編集できる。 */
const HANDOFF_KEY = "mg:handoff";
const HANDOFF_DEFAULTS = [
  { id: "editor", emoji: "✂️", label: "編集へ", tabs: ["script", "kouban", "assets", "review"], start: "script", upload: true,
    msg: "{name}、構成・香盤・素材まとめました！編集よろしくお願いします🙏\n完成動画は「動画」タブから直接アップできます（大容量OK）。\n{url}" },
  { id: "client", emoji: "🎬", label: "先方へ", tabs: ["review"], start: "review",
    msg: "{name} の動画が上がりました。ご確認お願いします（再生しながら時間指定でコメント頂けます）\n{url}" },
  { id: "talent", emoji: "🎤", label: "演者へ", tabs: ["review", "script"], start: "review",
    msg: "{name} の確認用ページです。動画と構成こちらからご覧いただけます\n{url}" },
  { id: "upload", emoji: "⬆️", label: "アップだけ", tabs: ["review"], start: "review", upload: true,
    msg: "{name} の完成動画、こちらから直接アップしてください（大容量OK・ログイン不要）。\n{url}" },
];
const STATUSES = ["未着手", "企画中", "撮影前", "編集中", "確認中", "完了"];
const STATUS_COLOR = {
  "未着手": { bg: "#F0F0F2", fg: "#71717A" },
  "企画中": { bg: "#E3EBFC", fg: "#2563EB" },
  "撮影前": { bg: "#FCF0DC", fg: "#D97706" },
  "編集中": { bg: "#E0F2EF", fg: "#0D9488" },
  "確認中": { bg: "#FBE5EA", fg: "#DC2645" },
  "完了":   { bg: "#E7F6EC", fg: "#15803D" },
};
/* ===== 修正管理（Frame.io型コメント） ===== */
const CMT_CATEGORIES = ["編集", "構成", "サムネ", "BGM", "SE", "テロップ", "色味", "演出", "その他"];
const CMT_PRIORITIES = ["高", "中", "低"];
const CMT_STATUSES = ["未対応", "対応中", "確認待ち", "完了"];
const CMT_STATUS_COLOR = {
  "未対応": { bg: "#FBE5EA", fg: "#DC2645" },
  "対応中": { bg: "#FCF0DC", fg: "#D97706" },
  "確認待ち": { bg: "#E3EBFC", fg: "#2563EB" },
  "完了":   { bg: "#E7F6EC", fg: "#15803D" },
};
const CMT_PRIO_COLOR = { "高": { bg: "#DC2645", fg: "#fff" }, "中": { bg: "#E8A33D", fg: "#fff" }, "低": { bg: "#E5E5E5", fg: "#57534E" } };
const cstat = (c) => c.status || (c.resolved ? "完了" : "未対応");

/* 素材管理に表示するカテゴリ（確認用動画は動画確認タブ・納品も動画確認OK＝ここは撮影素材とテンプレ素材だけ）。
   ※"確認用動画"はバージョンのミラー等で内部的には使うが、素材管理UIには出さない */
const ASSET_CATEGORIES = ["撮影素材", "テンプレ素材"];
const ASSET_CAT_ICON = { "撮影素材": "🎥", "テンプレ素材": "🧩", "確認用動画": "🎬", "参考素材": "📎", "納品物": "📦" };
const ASSET_CAT_DESC = { "撮影素材": "元動画・音声・写真・Bロール・インタビュー音声・文字起こしなど", "テンプレ素材": "OP/ED・テロップ・BGM・ロゴなど使い回す素材" };
/* asset: { id, category, type:"mp4"|"youtube"|"file", key?, url?, name, size?, mime?, planId?, sceneId?, createdAt } */
const newAsset = (category = "撮影素材", patch = {}) => ({ id: uid(), category, type: "file", key: "", url: "", name: "", size: 0, mime: "", planId: "", sceneId: "", folder: "", createdAt: Date.now(), ...patch });
/* Finderからのドロップを再帰展開してFile[]にする。フォルダごとドロップOK（.DS_Store等の不可視ファイルは除外）。
   注意: webkitGetAsEntry はdropイベント同期中に呼ぶ必要がある＝この関数はawaitを挟む前に呼び出すこと。 */
const collectDroppedFiles = async (dt) => {
  const entries = Array.from((dt && dt.items) || [])
    .map((it) => (it.kind === "file" && it.webkitGetAsEntry) ? it.webkitGetAsEntry() : null).filter(Boolean);
  if (!entries.length) return Array.from((dt && dt.files) || []);
  const out = [];
  const walk = async (ent) => {
    if (ent.isFile) {
      const f = await new Promise((res) => ent.file(res, () => res(null)));
      if (f && !f.name.startsWith(".")) {
        // フォルダごとドロップしたときの「どのシーンの素材か」を保持する。
        // ent.fullPath = "/金澤さん/01_冒頭/C0162.MP4" → ファイル名を除く全階層(金澤さん/01_冒頭)を素材の区分として持たせる。
        // 先頭1階層だけだと親フォルダごとドロップした時に中のシーン構造が潰れて平置きになる（＝素材の「解除」事故）。
        const fp = (ent.fullPath || "").replace(/^\/+/, "");
        const segs = fp.split("/");
        if (segs.length > 1) { try { f._folder = segs.slice(0, -1).join("/"); f._relPath = fp; } catch (e) {} }
        out.push(f);
      }
    } else if (ent.isDirectory) {
      const rd = ent.createReader();
      for (;;) {   // readEntriesは最大100件ずつ＝空になるまで繰り返す
        const batch = await new Promise((res) => rd.readEntries(res, () => res([])));
        if (!batch.length) break;
        for (const e2 of batch) await walk(e2);
      }
    }
  };
  for (const ent of entries) await walk(ent);
  return out;
};

/* ===== マニュアル／決め事（全体・チャンネル・案件の3スコープ、分類付き） ===== */
const MANUAL_CATS = ["撮影", "編集", "サムネ", "テロップ", "構成", "音", "納品", "その他"];
const newManual = (cat = "その他") => ({ id: uid(), cat, title: "", body: "" });
const STORE_MANUALS_GLOBAL = "manuals-global-v1"; // 全体の決め事（window.storage＝ログイン時クラウド同期）

/* トーク系台本の中身（タイトルは企画・サムネと連携、ハイライト/冒頭/目次/本編/CTA） */
const newTalkBody = () => ({ id: uid(), heading: "", script: "" });
const newTalk = () => ({ highlight: "", intro: "", toc: [""], body: [newTalkBody()], cta: "" });
/* 密着の事前ヒアリングシート（演者の人物理解→構成台本のネタ元）。セクション＋項目の配列。 */
const hearingItem = (label, hint = "") => ({ id: uid(), label, value: "", hint });
const HEARING_TEMPLATE = () => ([
  { id: uid(), title: "基本情報", items: [
    hearingItem("名前"), hearingItem("出身"), hearingItem("学歴"), hearingItem("年齢"), hearingItem("お住まい"),
  ] },
  { id: uid(), title: "現在の活動", items: [
    hearingItem("今やっていること", "何をしている人か。肩書き・事業・役割"),
    hearingItem("活動のきっかけ", "なぜ始めたか"),
    hearingItem("問題提起", "業界・世の中の何に課題を感じているか"),
    hearingItem("活動の原点", "この活動につながる原体験"),
    hearingItem("人生を変えた瞬間", "ターニングポイント・決断の瞬間"),
  ] },
  { id: uid(), title: "現在の活動に至るまで", items: [
    hearingItem("現在の活動の原点", "今に至るルーツ"),
    hearingItem("幼少期", "どんな子どもだったか・家庭環境"),
  ] },
  { id: uid(), title: "今後の目標", items: [
    hearingItem("今後の目標", "これから成し遂げたいこと"),
    hearingItem("それを達成するための現在の壁", "いま立ちはだかっている課題"),
  ] },
]);

/* 質問ウィザード（認識OS 質問13→密着台本の骨）。回答も生成した骨も案件データとして持つ */
const newWizard = () => ({ meta: { performer: "", genre: "", shoot: "", length: "" }, answers: {}, scaffold: "", scaffoldAt: null });

const newProjectData = (name = "新規案件", channel = DEFAULT_CHANNEL, format = "documentary") => ({
  id: uid(),
  name,
  channel: channel || DEFAULT_CHANNEL,
  createdAt: Date.now(),
  shareId: null,
  shareToken: null,
  format,
  status: "未着手",
  deadline: "",
  nextAction: "",
  meta: { shootDate: "", place: "", titles: ["", "", ""], thumbs: ["", "", ""], highlight: "", client: "", note: "" },
  theme: { ...DEFAULT_THEME },
  rate: 5,
  timeFormat: "tc",
  rows: format === "talk" ? [] : templateRows(),
  talk: format === "talk" ? newTalk() : null,
  plans: [],
  hearing: HEARING_TEMPLATE(),
  wizard: newWizard(),
  assets: [],
  review: { versions: [], comments: [] },
  manuals: [],
  video: null,
  files: [],
  liveId: null,
  liveToken: null,
  updatedAt: Date.now(),
});

/* 旧 video/files/plans[].video/files を assets（単一正本）へ非破壊移行。
   p.assets が既に配列なら何もしない（再実行で重複しない）。旧フィールドは消さない。 */
const assetsFromLegacy = (p) => {
  if (Array.isArray(p.assets)) return p.assets;
  const out = [];
  const vidAsset = (v, planId) => v ? newAsset("確認用動画", { type: v.type === "youtube" ? "youtube" : "mp4", key: v.key || "", url: v.url || "", name: v.title || v.name || (v.type === "youtube" ? "YouTube動画" : "動画"), planId: planId || "" }) : null;
  if (p.video) { const a = vidAsset(p.video, ""); if (a) out.push(a); }
  (Array.isArray(p.files) ? p.files : []).forEach((f) => out.push(newAsset("撮影素材", { type: "file", key: f.key || "", name: f.name || "ファイル", size: f.size || 0, mime: f.mime || "" })));
  (Array.isArray(p.plans) ? p.plans : []).forEach((pl) => {
    if (pl.video) { const a = vidAsset(pl.video, pl.id); if (a) out.push(a); }
    (Array.isArray(pl.files) ? pl.files : []).forEach((f) => out.push(newAsset("撮影素材", { type: "file", key: f.key || "", name: f.name || "ファイル", size: f.size || 0, mime: f.mime || "", planId: pl.id })));
  });
  return out;
};
/* 既存案件のステータスを中身から軽く推定（未設定時のみ。全部「未着手」表示を避ける） */
const inferStatus = (p) => {
  const hasVid = !!p.video || (Array.isArray(p.plans) && p.plans.some((pl) => pl.video));
  if (hasVid) return "確認中";
  const hasScript = (Array.isArray(p.rows) && p.rows.some((r) => r.kind === "scene" && (r.script || "").trim())) || (p.talk && Array.isArray(p.talk.body) && p.talk.body.some((b) => (b.script || "").trim()));
  if (hasScript) return "編集中";
  const hasPlan = Array.isArray(p.plans) && p.plans.some((pl) => (pl.title || "").trim() || (pl.refs || []).some((r) => r.url));
  if (hasPlan) return "企画中";
  return "未着手";
};

/* 案件データの欠損補完 */
const migrateProject = (p) => {
  const meta = p.meta || {};
  return {
    id: p.id || uid(),
    name: p.name || "案件",
    channel: p.channel || DEFAULT_CHANNEL,
    createdAt: p.createdAt || Date.now(),
    shareId: p.shareId || null,
    shareToken: p.shareToken || null,
    status: STATUSES.includes(p.status) ? p.status : inferStatus(p),
    deadline: p.deadline || "",
    nextAction: p.nextAction || "",
    meta: {
      shootDate: meta.shootDate || "",
      place: meta.place || "",
      titles: meta.titles || ["", "", ""],
      thumbs: meta.thumbs || ["", "", ""],
      highlight: meta.highlight || "",
      client: meta.client || "",
      note: meta.note || "",
    },
    theme: { ...DEFAULT_THEME, ...(p.theme || {}) },
    rate: p.rate || 5,
    timeFormat: p.timeFormat || "tc",
    rows: (p.rows || templateRows()).map((r) =>
      r.kind === "scene" ? { sec: null, ...r, type: SECTION_TYPES[r.type] ? r.type : (typeFromText(r.type) || "解説系") } : { address: "", time: "", note: "", ...r }
    ),
    plans: ((Array.isArray(p.plans) && p.plans.length) ? p.plans : seedPlansFromMeta(p.meta || {})).map((pl) => ({ video: null, files: [], shareId: null, shareToken: null, ...pl, thumbImages: Array.isArray(pl.thumbImages) ? pl.thumbImages.slice(0, 5) : (pl.thumbImage ? [pl.thumbImage] : []) })),
    format: p.format === "talk" ? "talk" : "documentary",
    talk: p.format === "talk"
      ? { ...newTalk(), ...(p.talk || {}), toc: (p.talk && p.talk.toc && p.talk.toc.length) ? p.talk.toc : [""], body: (p.talk && p.talk.body && p.talk.body.length) ? p.talk.body : [newTalkBody()] }
      : (p.talk || null),
    hearing: (Array.isArray(p.hearing) && p.hearing.length) ? p.hearing : HEARING_TEMPLATE(),
    wizard: { ...newWizard(), ...(p.wizard || {}), meta: { ...newWizard().meta, ...((p.wizard && p.wizard.meta) || {}) }, answers: (p.wizard && p.wizard.answers && typeof p.wizard.answers === "object") ? p.wizard.answers : {} },
    assets: assetsFromLegacy(p),
    review: { versions: Array.isArray(p.review && p.review.versions) ? p.review.versions : [], comments: Array.isArray(p.review && p.review.comments) ? p.review.comments : [] },
    manuals: Array.isArray(p.manuals) ? p.manuals : [],
    video: p.video || null,
    files: Array.isArray(p.files) ? p.files : [],
    liveId: p.liveId || null,
    liveToken: p.liveToken || null,
    aiChat: Array.isArray(p.aiChat) ? p.aiChat : [],
    updatedAt: p.updatedAt || p.createdAt || Date.now(),
  };
};

/* ===== 企画・サムネ：YouTube参考動画まわりのヘルパー ===== */
const emptyRef = () => ({ url: "", vid: "", title: "", channel: "", views: 0, subs: 0, likes: 0, uploadDate: "", duration: "" });
const newPlan = () => ({ id: uid(), title: "", thumbText: "", note: "", refs: [emptyRef(), emptyRef(), emptyRef(), emptyRef(), emptyRef()], thumbImages: [], video: null, files: [], shareId: null, shareToken: null });
const ytIdFromUrl = (url) => { const m = (url || "").match(/(?:v=|\/embed\/|\/shorts\/|youtu\.be\/|\/v\/)([a-zA-Z0-9_-]{11})/); return m ? m[1] : ((url || "").trim().match(/^[a-zA-Z0-9_-]{11}$/) ? url.trim() : null); };
const parseDur = (iso) => { const m = (iso || "").match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); if (!m) return ""; const h = +(m[1] || 0), mi = +(m[2] || 0), s = +(m[3] || 0); return (h ? h + ":" + String(mi).padStart(2, "0") : mi) + ":" + String(s).padStart(2, "0"); };
const fmtNum = (n) => { n = Number(n) || 0; if (n >= 1e8) return (n / 1e8).toFixed(1) + "億"; if (n >= 1e4) return (n / 1e4).toFixed(n >= 1e5 ? 0 : 1) + "万"; return n.toLocaleString(); };
/* YouTube APIのタイトルはHTMLエンティティ込み（&amp; 等）→ 復号 */
const decodeHtml = (s) => { if (!s) return ""; if (typeof document === "undefined") return s; const e = document.createElement("textarea"); e.innerHTML = s; return e.value; };
/* YouTube風「○○前」相対表記 */
const relTime = (iso) => {
  const t = new Date(iso || "").getTime();
  if (!t || isNaN(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 3600) return Math.max(1, Math.floor(s / 60)) + "分前";
  if (s < 86400) return Math.floor(s / 3600) + "時間前";
  if (s < 2592000) return Math.floor(s / 86400) + "日前";
  if (s < 31536000) { const m = Math.floor(s / 2592000); return (m < 12 ? m : 11) + "か月前"; }
  return Math.floor(s / 31536000) + "年前";
};
/* 評価：再生数÷登録者数の倍率＋投稿の新しさで S/A/B/C 判定（サムネ君と同ロジック） */
const scoreVideo = (info, now) => {
  if (!info || !info.uploadDate) return null;
  const days = (now - new Date(info.uploadDate).getTime()) / 86400000;
  if (isNaN(days)) return null;
  const ratio = info.subs > 0 ? info.views / info.subs : 0;
  const rec = Math.max(0, 50 - (days / 365) * 50);
  const rs = ratio >= 10 ? 50 : ratio >= 5 ? 40 : ratio >= 3 ? 28 : ratio >= 1 ? 14 : 4;
  const total = Math.round(rec + rs);
  let grade = days > 365 ? "C" : ratio >= 5 ? "S" : ratio >= 3 ? "A" : ratio >= 1 ? "B" : "C";
  if (total < 20 && grade !== "C") grade = "C";
  const ratioStr = ratio >= 1 ? ratio.toFixed(1) + "倍" : Math.round(ratio * 100) + "%";
  return { grade, total, ratio, ratioStr, days: Math.round(days) };
};
const GRADE_COLOR = { S: "#E11D48", A: "#EA580C", B: "#0EA5E9", C: "#9CA3AF" };

/* meta.titles/thumbs（番組情報）⇔ plans（企画・サムネ）の相互変換。plansを正本にして両者を連携 */
const seedPlansFromMeta = (meta) => {
  const titles = (meta && meta.titles) || [], thumbs = (meta && meta.thumbs) || [];
  let last = -1;
  const n = Math.max(titles.length, thumbs.length);
  for (let i = 0; i < n; i++) if ((titles[i] || "").trim() || (thumbs[i] || "").trim()) last = i;
  const out = [];
  for (let i = 0; i <= last; i++) out.push({ ...newPlan(), title: titles[i] || "", thumbText: thumbs[i] || "" });
  return out;
};
const applyTitlesToPlans = (plans, titles, thumbs) => {
  const arr = (plans || []).map((p) => ({ ...p }));
  const n = Math.max((titles || []).length, (thumbs || []).length);
  for (let i = 0; i < n; i++) {
    const t = (titles || [])[i], th = (thumbs || [])[i];
    if (!t && !th) continue;
    while (arr.length <= i) arr.push(newPlan());
    if (t) arr[i].title = t;
    if (th) arr[i].thumbText = th;
  }
  return arr;
};
const metaTitlesFromPlans = (plans) => {
  const ps = plans || [];
  const slot = (i, f) => (ps[i] && ps[i][f]) || "";
  return { titles: [slot(0, "title"), slot(1, "title"), slot(2, "title")], thumbs: [slot(0, "thumbText"), slot(1, "thumbText"), slot(2, "thumbText")] };
};

/* ---------- 構成台本の丸ごと取り込み（JSON / 構成台本コピーTSV 両対応） ----------
   Claudeが出力した project JSON、または「構成台本コピー」TSV を貼り付けて新規案件化する。 */
const typeFromText = (s) => {
  const t = (s || "").trim();
  if (!t) return null;
  for (const k of TYPE_KEYS) {
    if (t === k || t === SECTION_TYPES[k].full || t.startsWith(k)) return k;
  }
  return null;
};

/* 引用("")対応のTSVトークナイザ。セル内の改行・タブもOK。 */
const parseTSV = (text) => {
  const s = (text || "").replace(/\r\n?/g, "\n");
  const rows = [];
  let row = [], cur = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === "\t") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  row.push(cur); rows.push(row);
  return rows;
};

/* ---------- ファイル取り込み（TXT / CSV / Excel(.xlsx)）---------- */
const unescapeXml = (s) => (s || "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#10;/g, "\n").replace(/&#13;/g, "").replace(/&amp;/g, "&");

/* CSV → TSV（ダブルクオート/改行対応）。タブはスペースへ退避 */
const csvToTSV = (text) => {
  const s = (text || "").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  row.push(cur); rows.push(row);
  // セル内に改行/タブ/引用符があれば引用符でくくる（parseTSVが複数行セルを復元できるように）
  const esc = (c) => { c = c || ""; return /[\t\n"]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; };
  return rows.map((r) => r.map(esc).join("\t")).join("\n");
};

/* deflate-raw 解凍（ブラウザ標準） */
const inflateRaw = async (bytes) => {
  const ds = new DecompressionStream("deflate-raw");
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(buf);
};

/* 中央ディレクトリ走査による最小ZIP展開 → { ファイル名: Uint8Array } */
const unzip = async (arrBuf) => {
  const dv = new DataView(arrBuf), u8 = new Uint8Array(arrBuf);
  let eo = -1;
  for (let i = u8.length - 22; i >= 0 && i >= u8.length - 22 - 65536; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eo = i; break; }
  }
  if (eo < 0) throw new Error("ZIP形式ではありません");
  const cdCount = dv.getUint16(eo + 10, true);
  let p = dv.getUint32(eo + 16, true);
  const out = {}; const dec = new TextDecoder();
  for (let n = 0; n < cdCount; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    const lNameLen = dv.getUint16(lho + 26, true);
    const lExtraLen = dv.getUint16(lho + 28, true);
    const dataStart = lho + 30 + lNameLen + lExtraLen;
    const comp = u8.subarray(dataStart, dataStart + compSize);
    out[name] = method === 0 ? comp : await inflateRaw(comp);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
};

/* .xlsx の先頭シート → TSVテキスト */
const xlsxToTSV = async (arrBuf) => {
  const files = await unzip(arrBuf);
  const dec = new TextDecoder();
  const shared = [];
  if (files["xl/sharedStrings.xml"]) {
    dec.decode(files["xl/sharedStrings.xml"]).replace(/<si\b[^>]*>([\s\S]*?)<\/si>/g, (_, inner) => {
      let t = ""; inner.replace(/<t[^>]*>([\s\S]*?)<\/t>/g, (__, x) => { t += x; return ""; });
      shared.push(unescapeXml(t)); return "";
    });
  }
  let sheetKey = files["xl/worksheets/sheet1.xml"] ? "xl/worksheets/sheet1.xml"
    : Object.keys(files).find((k) => /^xl\/worksheets\/.*\.xml$/.test(k));
  if (!sheetKey) throw new Error("シートが見つかりません");
  const sheet = dec.decode(files[sheetKey]);
  const colNum = (ref) => { const m = (ref || "").match(/^([A-Z]+)/); if (!m) return 0; let n = 0; for (const c of m[1]) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1; };
  const lines = [];
  sheet.replace(/<row\b[^>]*>([\s\S]*?)<\/row>/g, (_, inner) => {
    const cells = [];
    inner.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (__, attrs, body) => {
      const ref = (attrs.match(/r="([^"]+)"/) || [])[1] || "";
      const t = (attrs.match(/t="([^"]+)"/) || [])[1] || "";
      let val = "";
      if (body) {
        if (t === "inlineStr") { const im = body.match(/<t[^>]*>([\s\S]*?)<\/t>/); val = im ? unescapeXml(im[1]) : ""; }
        else { const vm = body.match(/<v>([\s\S]*?)<\/v>/); const raw = vm ? vm[1] : ""; val = t === "s" ? (shared[Number(raw)] || "") : unescapeXml(raw); }
      }
      cells[colNum(ref)] = (val || "").replace(/[\t\n\r]/g, " ");
      return "";
    });
    for (let k = 0; k < cells.length; k++) if (cells[k] == null) cells[k] = "";
    lines.push(cells.join("\t"));
    return "";
  });
  return lines.join("\n");
};

/* 取り込みファイル → テキスト（TSV/プレーン）。AI整形・そのまま取り込み どちらにも渡せる形 */
const readImportFile = async (file) => {
  const name = (file.name || "").toLowerCase();
  if (name.endsWith(".xlsx")) return await xlsxToTSV(await file.arrayBuffer());
  if (name.endsWith(".xls")) throw new Error("旧Excel(.xls)は非対応。.xlsx か CSV で保存してください");
  if (name.endsWith(".csv")) return csvToTSV(await file.text());
  return await file.text(); // txt / tsv / md / json / 文字起こし等
};

const normalizeImport = (obj) => {
  const meta = obj.meta || {};
  const titles = (meta.titles && meta.titles.length ? meta.titles : ["", "", ""]).slice(0, 3);
  const thumbs = (meta.thumbs && meta.thumbs.length ? meta.thumbs : ["", "", ""]).slice(0, 3);
  while (titles.length < 3) titles.push("");
  while (thumbs.length < 3) thumbs.push("");
  return {
    name: obj.name || "",
    channel: obj.channel || "",
    meta: { shootDate: meta.shootDate || "", place: meta.place || "", titles, thumbs, highlight: meta.highlight || "" },
    theme: obj.theme && obj.theme.main ? { ...DEFAULT_THEME, ...obj.theme } : { ...DEFAULT_THEME },
    rate: Number(obj.rate) || 5,
    timeFormat: obj.timeFormat === "jp" ? "jp" : "tc",
    rows: (obj.rows || []).map((r) =>
      r.kind === "location"
        ? { id: uid(), kind: "location", label: r.label || "", address: r.address || "", time: r.time || "", note: r.note || "", travelBy: r.travelBy || "", travelCost: r.travelCost === 0 || r.travelCost ? Number(r.travelCost) : null }
        : { id: uid(), kind: "scene", label: r.label || "", type: TYPE_KEYS.includes(r.type) ? r.type : (typeFromText(r.type) || "解説系"), sec: r.sec === 0 || r.sec ? Number(r.sec) : null, script: r.script || "" }
    ),
  };
};

const parseImportText = (text) => {
  const trimmed = (text || "").trim();
  if (!trimmed) return null;
  // 1) JSON（Claudeが出力した完全プロジェクト）
  if (trimmed[0] === "{" || trimmed[0] === "[") {
    try {
      let obj = JSON.parse(trimmed);
      if (Array.isArray(obj)) obj = { rows: obj };
      if (!Array.isArray(obj.rows)) return null;
      return normalizeImport(obj);
    } catch (e) { return null; }
  }
  // 2) TSV（「構成台本コピー」 or スプシ貼り付け）
  const table = parseTSV(text);
  const meta = { shootDate: "", place: "", titles: ["", "", ""], thumbs: ["", "", ""], highlight: "" };
  const rows = [];
  let inTable = false;
  let cols = null; // ヘッダーから割り出した列位置 {time,loc,label,type,sec,script}
  const trimAt = (cells, i) => (i >= 0 && cells[i] != null ? String(cells[i]) : "");
  for (const cells of table) {
    const c0 = (cells[0] || "").trim();
    const c1 = (cells[1] || "").trim();
    if (!inTable) {
      // 値は col2 以降のどこか（ラベル「候補①/選考意図/パターン」等はスキップ）
      const isLabel = (v) => /^(候補|選考意図|パターン|案)\s*[①-⑩0-9]*$/.test((v || "").trim());
      const vals = cells.slice(2).map((v) => (v || "").trim()).filter((v) => v && !isLabel(v));
      if (c1 === "撮影日") { meta.shootDate = vals[0] || ""; continue; }
      if (c1 === "撮影場所") { meta.place = vals[0] || ""; continue; }
      if (c1 === "タイトル案") { meta.titles = [vals[0] || "", vals[1] || "", vals[2] || ""]; continue; }
      if (c1 === "サムネ案") { meta.thumbs = [vals[0] || "", vals[1] || "", vals[2] || ""]; continue; }
      if (c1 === "ハイライト") { meta.highlight = vals[0] || ""; continue; }
    }
    // ヘッダー行：列位置を記録（原稿/内容/秒数 が後ろや別位置にあっても正しく拾える）
    const norm = cells.map((x) => (x || "").trim());
    if (c0 === "時間" || c1 === "ロケーション" || (norm.includes("原稿") && norm.includes("シーン"))) {
      inTable = true;
      const idx = (name) => norm.indexOf(name);
      cols = { time: idx("時間"), loc: idx("ロケーション"), label: idx("内容"), type: idx("シーン"), sec: idx("秒数"), script: idx("原稿") };
      continue;
    }
    if (c1 === "合計") continue;
    if (cells.every((x) => !(x || "").trim())) continue;
    // シーン行：種別セルがある（ヘッダーの「シーン」列を優先、無ければ探索）。表の前（ルール説明等）は拾わない
    let ti = (cols && cols.type >= 0 && typeFromText(cells[cols.type])) ? cols.type : -1;
    if (ti < 0) ti = cells.findIndex((x) => typeFromText(x));
    if (inTable && ti >= 0) {
      const secRaw = ((cols && cols.sec >= 0 ? trimAt(cells, cols.sec) : trimAt(cells, ti + 1)) || "").trim();
      const label = ((cols && cols.label >= 0 ? trimAt(cells, cols.label) : (cells[2] || "")) || "").trim();
      const script = (cols && cols.script >= 0 ? trimAt(cells, cols.script) : (cells[cells.length - 1] || ""));
      rows.push({ kind: "scene", type: typeFromText(cells[ti]), label, sec: /^\d+$/.test(secRaw) ? Number(secRaw) : null, script });
      continue;
    }
    // ロケーション行：種別が無く名前がある（col0=時刻 のスプシ形式にも対応）
    const locName = ((cols && cols.loc >= 0 ? trimAt(cells, cols.loc) : c1) || "").trim();
    const locTime = ((cols && cols.time >= 0 ? trimAt(cells, cols.time) : c0) || "").trim();
    if (inTable && locName) { rows.push({ kind: "location", label: locName, time: /\d/.test(locTime) ? locTime : "" }); continue; }
  }
  if (!rows.length) return null;
  return normalizeImport({ meta, rows });
};

const countChars = (s) => (s || "").replace(/\s/g, "").length;
const fmtJP = (sec) => { const s = Math.round(sec); return Math.floor(s / 60) + "分" + String(s % 60).padStart(2, "0") + "秒"; };
const fmtTC = (sec) => { const s = Math.round(sec); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
const sectionOf = (type) => SECTION_TYPES[type] || SECTION_TYPES["解説系"];
const targetOf = (r) => (r.sec != null && r.sec !== "" ? Number(r.sec) : sectionOf(r.type).target);

const textOn = (hex) => {
  try {
    const h = hex.replace("#", "");
    const f = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const r = parseInt(f.slice(0, 2), 16), g = parseInt(f.slice(2, 4), 16), b = parseInt(f.slice(4, 6), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "#1A1A1A" : "#FFFFFF";
  } catch { return "#FFFFFF"; }
};

/* ---------- 原稿セル：◼︎自動挿入 + 質問行をアクセント色・太字で表示 ---------- */
/* インライン書式: **太字** / !!赤文字!!（ネスト可・改行またぎ可）。
   ** と !! をトグルとして全文を走査し、書式付きの run 配列に分解する */
function buildStyledRuns(text) {
  const runs = [];
  let bold = false, red = false, buf = "", bBold = false, bRed = false;
  const flush = () => { if (buf) { runs.push({ text: buf, bold: bBold, red: bRed }); buf = ""; } };
  for (let i = 0; i < text.length; ) {
    if (text[i] === "*" && text[i + 1] === "*") { flush(); bold = !bold; i += 2; continue; }
    if (text[i] === "!" && text[i + 1] === "!") { flush(); red = !red; i += 2; continue; }
    if (!buf) { bBold = bold; bRed = red; }
    buf += text[i]; i++;
  }
  flush();
  return runs;
}

/* ===== ピクトグラム（ライン系SVG・currentColorで配色追従）===== */
function Icon({ name, className = "w-4 h-4", style, strokeWidth = 1.8 }) {
  const c = { className, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth, strokeLinecap: "round", strokeLinejoin: "round", style, "aria-hidden": true };
  switch (name) {
    case "pin": return (<svg {...c}><path d="M12 21s6-5.3 6-10A6 6 0 1 0 6 11c0 4.7 6 10 6 10z" /><circle cx="12" cy="11" r="2.2" /></svg>);
    case "note": return (<svg {...c}><path d="M12 20H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9l5 5v3" /><path d="M14 4v5h5" /><path d="M8 13h5M8 16h3" /></svg>);
    case "map": return (<svg {...c}><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" /><path d="M9 4v14M15 6v14" /></svg>);
    case "download": return (<svg {...c}><path d="M12 4v10m0 0 4-4m-4 4-4-4" /><path d="M5 18h14" /></svg>);
    case "file": return (<svg {...c}><path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8l-5-5z" /><path d="M14 3v5h5" /></svg>);
    case "user": return (<svg {...c}><circle cx="12" cy="8" r="3.4" /><path d="M5.5 19a6.5 6.5 0 0 1 13 0" /></svg>);
    case "robot": return (<svg {...c}><rect x="4" y="8" width="16" height="11" rx="2.5" /><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16h5" /><path d="M2 12v3M22 12v3" /></svg>);
    case "cloud": return (<svg {...c}><path d="M7 18a4 4 0 0 1-.5-7.97 5.5 5.5 0 0 1 10.6 1.02A3.5 3.5 0 0 1 17 18H7z" /></svg>);
    case "warn": return (<svg {...c}><path d="M12 4 2.5 20h19L12 4z" /><path d="M12 10v4M12 17h.01" /></svg>);
    case "checkCircle": return (<svg {...c}><circle cx="12" cy="12" r="8.5" /><path d="M8.5 12.2l2.4 2.4 4.6-5" /></svg>);
    case "check": return (<svg {...c}><path d="M5 12.5l4.5 4.5L19 7" /></svg>);
    case "refresh": return (<svg {...c}><path d="M20 11a8 8 0 0 0-14-4.5L4 8" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14 4.5L20 16" /><path d="M20 20v-4h-4" /></svg>);
    case "undo": return (<svg {...c}><path d="M9 7 4 12l5 5" /><path d="M4 12h10a5 5 0 0 1 0 10h-1" /></svg>);
    case "sparkle": return (<svg {...c}><path d="M12 3l1.7 4.8L18.5 9.5l-4.8 1.7L12 16l-1.7-4.8L5.5 9.5l4.8-1.7L12 3z" /></svg>);
    case "chat": return (<svg {...c}><path d="M20 12a7 7 0 0 1-7 7H8l-4 3v-4.5A7 7 0 0 1 4 12a7 7 0 0 1 7-7h2a7 7 0 0 1 7 7z" /></svg>);
    case "plus": return (<svg {...c}><path d="M12 5v14M5 12h14" /></svg>);
    case "close": return (<svg {...c}><path d="M6 6l12 12M18 6L6 18" /></svg>);
    case "trash": return (<svg {...c}><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12" /></svg>);
    case "spellcheck": return (<svg {...c}><path d="M4 16l4-10 4 10M5.2 13h5.6" /><path d="M14.5 14.5l2 2 4-4.5" /></svg>);
    case "image": return (<svg {...c}><rect x="4" y="5" width="16" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M5 17l4-4 3 3 3-3 4 4" /></svg>);
    case "video": return (<svg {...c}><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3z" /></svg>);
    case "menu": return (<svg {...c}><path d="M4 7h16M4 12h16M4 17h16" /></svg>);
    case "search": return (<svg {...c}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>);
    case "up": return (<svg {...c}><path d="M6 14l6-6 6 6" /></svg>);
    case "down": return (<svg {...c}><path d="M6 10l6 6 6-6" /></svg>);
    case "folder": return (<svg {...c}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /></svg>);
    case "share": return (<svg {...c}><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="M8.2 13.2l7.6 4.6M15.8 6.2L8.2 10.8" /></svg>);
    case "grip": return (<svg {...c} strokeWidth="0" fill="currentColor"><circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" /><circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" /><circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" /></svg>);
    case "pencil": return (<svg {...c}><path d="M4 20l1-4L16.5 4.5a2.12 2.12 0 0 1 3 3L8 19l-4 1z" /><path d="M14.5 6.5l3 3" /></svg>);
    default: return null;
  }
}

/* 入力内容に応じて高さが伸びる textarea（全文が常に見える） */
function AutoTextarea({ value, onChange, placeholder, className, minHeight = 80 }) {
  const ref = useRef(null);
  const resize = (el) => { if (!el) return; el.style.height = "auto"; el.style.height = Math.max(minHeight, el.scrollHeight) + "px"; };
  // 親へは合成イベント({target:{value}})で渡す＝呼び出し側のe.target.value流儀を維持
  const [val, set, flush] = useBufferedField(value, (nv) => onChange({ target: { value: nv } }));
  useEffect(() => { resize(ref.current); }, [val]);
  return (
    <textarea ref={ref} value={val} placeholder={placeholder} className={className}
      style={{ overflow: "hidden", resize: "none", minHeight }}
      onChange={(e) => { set(e.target.value); resize(e.target); }}
      onBlur={flush} />
  );
}

/* ===== 入力のもたつき対策：ローカルバッファ =====
   巨大な案件stateを1打鍵ごとに更新すると全行が再描画され重い。
   打鍵は即ローカル反映し、親(updateRow→setProject)への反映は入力が
   止まった瞬間だけdebounceで流す。外部更新(AI反映/共同編集)は即取り込む。 */
function useBufferedField(value, onChange, delay = 220) {
  const norm = value == null ? "" : value;
  const [val, setVal] = useState(norm);
  const sent = useRef(norm);      // 直近で親へ送った値
  const pending = useRef(null);   // 未送信のローカル値
  const timer = useRef(null);
  const cbRef = useRef(onChange);
  cbRef.current = onChange;
  // 外部から値が変わった（自分の送信エコー以外）ら取り込む
  useEffect(() => {
    if (norm !== sent.current && norm !== val) {
      setVal(norm); sent.current = norm; pending.current = null;
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    }
  }, [norm]);
  const flush = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (pending.current != null && pending.current !== sent.current) {
      sent.current = pending.current; cbRef.current(pending.current);
    }
    pending.current = null;
  };
  const set = (nv) => {
    setVal(nv); pending.current = nv;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
  };
  useEffect(() => () => { flush(); }, []); // アンマウント時に未送信分を確定
  return [val, set, flush];
}

function BufferedTextarea({ value, onChange, onBlur, ...rest }) {
  const [val, set, flush] = useBufferedField(value, onChange);
  return <textarea {...rest} value={val}
    onChange={(e) => set(e.target.value)}
    onBlur={(e) => { flush(); if (onBlur) onBlur(e); }} />;
}

function BufferedInput({ value, onChange, onBlur, ...rest }) {
  const [val, set, flush] = useBufferedField(value, onChange);
  return <input {...rest} value={val}
    onChange={(e) => set(e.target.value)}
    onBlur={(e) => { flush(); if (onBlur) onBlur(e); }} />;
}

/* ===== 住所オートコンプリート（Google Places）=====
   キー未設定なら従来の手入力＋🗺️リンクにフォールバック */
let gmapsPromise = null;
function loadGMaps() {
  if (typeof window === "undefined") return Promise.reject(new Error("no-window"));
  if (window.google && window.google.maps && window.google.maps.places) return Promise.resolve();
  const key = ((window.MG_GMAPS_KEY || "").trim()).replace(/^REPLACE_.*/, "");
  if (!key) return Promise.reject(new Error("no-key"));
  if (gmapsPromise) return gmapsPromise;
  gmapsPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(key) + "&libraries=places&language=ja&region=JP&loading=async";
    s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("load-failed"));
    document.head.appendChild(s);
  });
  return gmapsPromise;
}

/* 連続するロケが同じ場所か（住所の空白差は無視）。同じ場所なら移動なし＝交通費の対象外 */
const normPlaceStr = (s) => (s || "").replace(/[\s　]/g, "");
const samePlace = (a, b) => {
  if (!a || !b) return false;
  if (a.placeId && b.placeId && a.placeId === b.placeId) return true;
  if (a.lat != null && b.lat != null && a.lat === b.lat && a.lng === b.lng) return true;
  const x = normPlaceStr(a.address), y = normPlaceStr(b.address);
  return !!x && x === y;
};

/* 鍵なしで使える場所検索（国土地理院＝住所・地名／OpenStreetMap＝建物・施設）。候補をマージして返す */
async function searchPlaces(q) {
  const enc = encodeURIComponent(q);
  const [gsi, osm] = await Promise.all([
    fetch("https://msearch.gsi.go.jp/address-search/AddressSearch?q=" + enc)
      .then((r) => (r.ok ? r.json() : []))
      .then((a) => (Array.isArray(a) ? a : []).map((f) => ({
        title: (f.properties && f.properties.title) || "",
        sub: "住所・地名",
        lat: f.geometry && f.geometry.coordinates ? f.geometry.coordinates[1] : null,
        lng: f.geometry && f.geometry.coordinates ? f.geometry.coordinates[0] : null,
      })).filter((c) => c.title.includes(q) || q.includes(c.title)).slice(0, 5)) // GSIは前方一致で無関係な地名も返すため、クエリを含むものだけ残す
      .catch(() => []),
    fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=jp&accept-language=ja&limit=5&q=" + enc)
      .then((r) => (r.ok ? r.json() : []))
      .then((a) => (Array.isArray(a) ? a : []).map((f) => {
        const name = f.name || (f.display_name || "").split(",")[0] || "";
        const addr = (f.display_name || "").split(",").map((s) => s.trim()).filter((s) => s && s !== name);
        return {
          title: name,
          sub: addr.slice(0, 4).reverse().join("") || "施設",
          lat: f.lat != null ? Number(f.lat) : null,
          lng: f.lon != null ? Number(f.lon) : null,
        };
      }))
      .catch(() => []),
  ]);
  const seen = new Set(), out = [];
  for (const c of [...osm, ...gsi]) {
    if (!c.title || seen.has(c.title)) continue;
    seen.add(c.title);
    out.push(c);
    if (out.length >= 8) break;
  }
  return out;
}

function AddressField({ loc, onChange }) {
  const ref = useRef(null);
  const acRef = useRef(null);
  const [cands, setCands] = useState(null); // null=閉 / []=0件 / [...]=候補
  const [busy, setBusy] = useState(false);
  const timerRef = useRef(null);
  const qRef = useRef("");
  useEffect(() => {
    let cancelled = false;
    loadGMaps().then(() => {
      if (cancelled || !ref.current || acRef.current || !(window.google && google.maps && google.maps.places)) return;
      const ac = new google.maps.places.Autocomplete(ref.current, {
        fields: ["formatted_address", "name", "geometry", "place_id"],
      });
      ac.addListener("place_changed", () => {
        const p = ac.getPlace();
        if (!p) return;
        const addr = p.formatted_address || (ref.current ? ref.current.value : "") || "";
        const name = p.name && !addr.includes(p.name) ? p.name : "";
        const display = (name ? name + " " : "") + addr;
        const patch = { address: display.trim(), placeId: p.place_id || "", lat: null, lng: null };
        if (p.geometry && p.geometry.location) { patch.lat = p.geometry.location.lat(); patch.lng = p.geometry.location.lng(); }
        onChange(patch);
      });
      acRef.current = ac;
    }).catch(() => {});
    return () => { cancelled = true; clearTimeout(timerRef.current); };
  }, []);
  /* Google未設定時のフォールバック検索：入力を500msデバウンスして候補表示 */
  const kick = (v) => {
    if (acRef.current) return; // Google Placesが生きていればそちらに任せる
    clearTimeout(timerRef.current);
    const q = (v || "").trim();
    qRef.current = q;
    if (q.length < 2) { setCands(null); setBusy(false); return; }
    setBusy(true);
    timerRef.current = setTimeout(async () => {
      const res = await searchPlaces(q).catch(() => []);
      if (qRef.current !== q) return; // 入力が進んでいたら破棄
      setCands(res);
      setBusy(false);
    }, 500);
  };
  const pick = (c) => {
    setCands(null);
    onChange({ address: c.title, placeId: "", lat: c.lat, lng: c.lng });
  };
  const q = (loc.address || "").trim();
  const linked = !!loc.placeId || loc.lat != null;
  const mapHref = !q ? null
    : loc.placeId ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q) + "&query_place_id=" + encodeURIComponent(loc.placeId)
    : loc.lat != null ? "https://www.google.com/maps/search/?api=1&query=" + loc.lat + "," + loc.lng
    : "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
  return (
    <div className="relative flex-1 min-w-0 flex items-center">
      <input
        ref={ref}
        value={loc.address}
        onChange={(e) => { onChange({ address: e.target.value, placeId: "", lat: null, lng: null }); kick(e.target.value); }}
        onBlur={() => setTimeout(() => setCands(null), 200)}
        placeholder="住所・施設名で検索（例：東京タワー）"
        className="block w-full min-w-0 bg-transparent text-[12px] px-1 py-2 focus:outline-none placeholder:text-stone-300"
      />
      {busy && <span className="shrink-0 mr-1 text-[10px] text-stone-300">検索中…</span>}
      {q && (
        <a href={mapHref} target="_blank" rel="noreferrer" title={linked ? "連携済みの場所をGoogleマップで開く" : "Googleマップで開く"}
           className={"shrink-0 mr-2 text-[11px] font-bold px-2 py-1 rounded-md whitespace-nowrap inline-flex items-center gap-1 border active:scale-95 transition " + (linked ? "border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100" : "border-stone-200 text-stone-600 hover:bg-stone-50")}>
          <Icon name={linked ? "pin" : "map"} className="w-3.5 h-3.5 shrink-0" /> <span className="hidden sm:inline">{linked ? "連携済" : "地図"}</span>
        </a>
      )}
      {cands != null && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 rounded-lg border border-stone-200 bg-white shadow-lg overflow-hidden">
          {cands.length === 0 && <div className="px-3 py-2 text-[11px] text-stone-400">候補が見つかりません（そのまま手入力でOK）</div>}
          {cands.map((c, i) => (
            <button key={i} type="button"
              onMouseDown={(e) => { e.preventDefault(); pick(c); }}
              className="w-full text-left px-3 py-2 hover:bg-stone-50 flex items-start gap-2 border-b border-stone-100 last:border-b-0">
              <Icon name="pin" className="w-3.5 h-3.5 shrink-0 mt-0.5 text-stone-400" />
              <span className="min-w-0">
                <span className="block text-[12px] font-bold text-stone-700 truncate">{c.title}</span>
                {c.sub && <span className="block text-[10px] text-stone-400 truncate">{c.sub}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ScriptCell({ value, onChange, placeholder, accent = "#E63946", fontSize = 13 }) {
  const taRef = useRef(null);
  const [focused, setFocused] = useState(false);
  const [val, set, flush] = useBufferedField(value, onChange);
  const textStyle = {
    fontFamily: "inherit",
    fontSize,
    lineHeight: 1.8,
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    wordBreak: "break-word",
  };

  /* 選択範囲をマーカーで囲む（太字/赤文字） */
  const wrap = (mk) => {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const v = val || "";
    const sel = e > s ? v.slice(s, e) : "ここ";
    const nv = v.slice(0, s) + mk + sel + mk + v.slice(e);
    set(nv);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = s + mk.length;
      ta.selectionEnd = s + mk.length + sel.length;
    });
  };

  const handleKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === "b" || e.key === "B")) { e.preventDefault(); wrap("**"); return; }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "h" || e.key === "H")) { e.preventDefault(); wrap("!!"); return; }
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    const ta = e.target;
    const { selectionStart: pos, value: v } = ta;
    const lineStart = v.lastIndexOf("\n", pos - 1) + 1;
    if (v.slice(lineStart, pos).trim() === "") {
      e.preventDefault();
      const insert = "\n◼︎ ";
      set(v.slice(0, pos) + insert + v.slice(pos));
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = pos + insert.length; });
    }
  };

  const handleFocus = (e) => {
    setFocused(true);
    if (!val) {
      set("◼︎ ");
      const ta = e.target;
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = 3; });
    }
  };

  /* 質問行（◼︎始まり）に色と太字をつけた表示レイヤー。
     太字/赤文字は全文を run 化してから行に流すので、改行をまたぐ ** でも崩れない */
  const runs = buildStyledRuns(val || "");
  const qFlags = runs.map((r) => r.text).join("").split("\n").map((l) => /^\s*◼/.test(l));
  const styleFor = (r, isQ) => {
    const st = {};
    if (r.red) st.color = "#DC2645";
    else if (isQ) st.color = accent;
    if (r.bold) st.fontWeight = 800;
    else if (isQ) st.fontWeight = 700;
    return st;
  };
  const nodes = [];
  let li = 0, key = 0;
  runs.forEach((r) => {
    r.text.split("\n").forEach((p, idx) => {
      if (idx > 0) { nodes.push("\n"); li++; }
      if (p) nodes.push(<span key={key++} style={styleFor(r, qFlags[li])}>{p}</span>);
    });
  });

  const fmtBtn = "w-6 h-6 grid place-items-center rounded-md bg-white border border-stone-200 shadow-sm hover:bg-stone-50 text-[12px] leading-none";

  return (
    <div className="relative">
      {focused && (
        <div className="absolute -top-3.5 right-1 z-10 flex gap-1" onMouseDown={(e) => e.preventDefault()}>
          <button type="button" onClick={() => wrap("**")} title="太字（⌘B）" className={fmtBtn} style={{ fontWeight: 800 }}>B</button>
          <button type="button" onClick={() => wrap("!!")} title="赤文字（⌘⇧H）" className={fmtBtn} style={{ color: "#DC2645", fontWeight: 800 }}>A</button>
        </div>
      )}
      <div aria-hidden className="px-3 py-2 text-stone-800" style={{ ...textStyle, minHeight: 38 }}>
        {val ? nodes : <span className="text-stone-300">{placeholder || "クリックして原稿を入力"}</span>}
        {"\u200b"}
      </div>
      <textarea
        ref={taRef}
        value={val}
        onChange={(e) => set(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={() => { setFocused(false); flush(); }}
        spellCheck={false}
        className="absolute inset-0 w-full h-full resize-none bg-transparent px-3 py-2 focus:outline-none"
        style={{ ...textStyle, color: "transparent", caretColor: "#1C1C1E" }}
      />
    </div>
  );
}

/* 太字(**)・赤文字(!!)の装飾に対応し、内容に合わせて高さが伸びる入力欄。
   ScriptCellと同じマークアップ（⌘B / ⌘⇧H・ツールバーB/A）だが、構成台本特有の◼︎質問行の自動処理は持たない。
   ヒアリング等の自由記述で「全文が見える＋太字・色付け」を使いたい箇所向け。 */
function RichCell({ value, onChange, placeholder, className = "", minHeight = 44, fontSize = 13 }) {
  const taRef = useRef(null);
  const [focused, setFocused] = useState(false);
  const [val, set, flush] = useBufferedField(value, (nv) => onChange({ target: { value: nv } }));
  const textStyle = { fontFamily: "inherit", fontSize, lineHeight: 1.7, whiteSpace: "pre-wrap", overflowWrap: "break-word", wordBreak: "break-word" };
  const wrap = (mk) => {
    const ta = taRef.current; if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd; const v = val || "";
    const sel = e > s ? v.slice(s, e) : "ここ";
    const nv = v.slice(0, s) + mk + sel + mk + v.slice(e);
    set(nv);
    requestAnimationFrame(() => { ta.focus(); ta.selectionStart = s + mk.length; ta.selectionEnd = s + mk.length + sel.length; });
  };
  // 選択行（複数可）の先頭に mk を付ける／既に付いていれば外すトグル。箇条書き「・」・コールアウト「> 」用。
  const prefixLines = (mk) => {
    const ta = taRef.current; if (!ta) return;
    const v = val || "";
    const s = ta.selectionStart, e = ta.selectionEnd;
    const ls = v.lastIndexOf("\n", s - 1) + 1;
    let le = v.indexOf("\n", e); if (le === -1) le = v.length;
    const block = v.slice(ls, le);
    const on = block.split("\n").every((l) => l.startsWith(mk));
    const nb = block.split("\n").map((l) => on ? l.slice(mk.length) : mk + l).join("\n");
    const nv = v.slice(0, ls) + nb + v.slice(le);
    set(nv);
    requestAnimationFrame(() => { ta.focus(); ta.selectionStart = ls; ta.selectionEnd = ls + nb.length; });
  };
  const handleKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === "b" || e.key === "B")) { e.preventDefault(); wrap("**"); }
    else if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "h" || e.key === "H")) { e.preventDefault(); wrap("!!"); }
  };
  const runs = buildStyledRuns(val || "");
  const nodes = []; let key = 0;
  runs.forEach((r) => {
    const st = {}; if (r.red) st.color = "#DC2645"; if (r.bold) st.fontWeight = 800;
    r.text.split("\n").forEach((p, idx) => {
      if (idx > 0) nodes.push("\n");
      if (p) nodes.push(<span key={key++} style={st}>{p}</span>);
    });
  });
  const fmtBtn = "w-6 h-6 grid place-items-center rounded-md bg-white border border-stone-200 shadow-sm hover:bg-stone-50 text-[12px] leading-none";
  return (
    <div className={"relative " + className}>
      {focused && (
        <div className="absolute -top-3 right-1 z-10 flex gap-1" onMouseDown={(e) => e.preventDefault()}>
          <button type="button" onClick={() => wrap("**")} title="太字（⌘B）" className={fmtBtn} style={{ fontWeight: 800 }}>B</button>
          <button type="button" onClick={() => wrap("!!")} title="赤文字（⌘⇧H）" className={fmtBtn} style={{ color: "#DC2645", fontWeight: 800 }}>A</button>
          <button type="button" onClick={() => prefixLines("・")} title="箇条書き" className={fmtBtn}>・</button>
          <button type="button" onClick={() => prefixLines("> ")} title="コールアウト（共有画面で囲み枠）" className={fmtBtn} style={{ color: "#F5A623", fontWeight: 800 }}>▍</button>
        </div>
      )}
      <div aria-hidden className="px-3 py-2 text-stone-800" style={{ ...textStyle, minHeight }}>
        {val ? nodes : <span className="text-stone-300">{placeholder}</span>}
        {"​"}
      </div>
      <textarea ref={taRef} value={val}
        onChange={(e) => set(e.target.value)} onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); flush(); }}
        spellCheck={false}
        className="absolute inset-0 w-full h-full resize-none bg-transparent px-3 py-2 focus:outline-none"
        style={{ ...textStyle, color: "transparent", caretColor: "#1C1C1E" }} />
    </div>
  );
}

/* 再生専用ビュー（mp4=速度ボタン付き / YouTube=埋め込み）。モーダルと企画カードで共用 */
function VideoView({ video, main }) {
  const vref = React.useRef(null);
  const [rate, setRate] = React.useState(1);
  if (!video) return null;
  if (video.type === "youtube") {
    return (
      <div className="rounded-lg overflow-hidden bg-black" style={{ aspectRatio: "16/9" }}>
        <iframe src={"https://www.youtube.com/embed/" + (ytIdFromUrl(video.url) || "")} className="w-full h-full" style={{ border: 0 }} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
      </div>
    );
  }
  const rates = [0.5, 1, 1.5, 2, 3, 4];
  return (
    <div>
      <div className="rounded-lg overflow-hidden bg-black" style={{ aspectRatio: "16/9" }}>
        <video ref={vref} src={video.key ? (SHARE_API + "/api/file/" + video.key) : video.url} controls playsInline className="w-full h-full bg-black" />
      </div>
      <div className="flex items-center gap-1 mt-1.5 flex-wrap">
        <span className="text-[10px] text-stone-400 mr-1">速度</span>
        {rates.map((r) => (
          <button key={r} onClick={() => { if (vref.current) vref.current.playbackRate = r; setRate(r); }}
            className={"text-[10px] mono px-1.5 py-0.5 rounded border " + (rate === r ? "text-white" : "border-stone-200 text-stone-500")}
            style={rate === r ? { background: main, borderColor: main } : {}}>{r}x</button>
        ))}
      </div>
    </div>
  );
}

/* 企画カードの動画レビュー（再生＋速度＋タイムコードコメント＋対応済）。frame.io的な試写をアプリ内で */
function PlanVideoReview({ video, comments, canComment, onPost, onResolve, main, accent }) {
  const vref = React.useRef(null);
  const [rate, setRate] = React.useState(1);
  const [cur, setCur] = React.useState(0);
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  const [atSec, setAtSec] = React.useState(0);
  const isMp4 = video.type !== "youtube";
  const fmtTC = (s) => { s = Math.max(0, +s || 0); const m = Math.floor(s / 60), sec = Math.floor(s % 60), cs = Math.floor((s * 100) % 100); return m + ":" + String(sec).padStart(2, "0") + "." + String(cs).padStart(2, "0"); };
  const list = (comments || []).slice().sort((a, b) => (a.timecode || 0) - (b.timecode || 0));
  const seek = (t) => { if (isMp4 && vref.current) { vref.current.currentTime = +t || 0; const p = vref.current.play(); if (p && p.catch) p.catch(() => {}); } };
  const startComment = () => { setAtSec(isMp4 && vref.current ? vref.current.currentTime : 0); setText(""); setOpen(true); };
  const submit = async () => { const ok = await onPost(isMp4 ? atSec : null, text); if (ok) { setText(""); setOpen(false); } };
  const rates = [0.5, 1, 1.5, 2, 3, 4];
  return (
    <div>
      {isMp4 ? (
        <div>
          <div className="rounded-lg overflow-hidden bg-black" style={{ aspectRatio: "16/9" }}>
            <video ref={vref} src={video.key ? (SHARE_API + "/api/file/" + video.key) : video.url} controls playsInline className="w-full h-full bg-black" onTimeUpdate={(e) => setCur(e.target.currentTime)} />
          </div>
          <div className="flex items-center gap-1 mt-1.5 flex-wrap">
            <span className="text-[10px] text-stone-400 mr-1">速度</span>
            {rates.map((r) => (<button key={r} onClick={() => { if (vref.current) vref.current.playbackRate = r; setRate(r); }} className={"text-[10px] mono px-1.5 py-0.5 rounded border " + (rate === r ? "text-white" : "border-stone-200 text-stone-500")} style={rate === r ? { background: main, borderColor: main } : {}}>{r}x</button>))}
            <span className="ml-auto mono text-[11px] font-bold" style={{ color: main }}>{fmtTC(cur)}</span>
            {canComment && <button onClick={startComment} className="text-[10px] font-bold text-white px-2 py-1 rounded shrink-0" style={{ background: accent }}>＋ここにコメント</button>}
          </div>
        </div>
      ) : (
        <div>
          <div className="rounded-lg overflow-hidden bg-black" style={{ aspectRatio: "16/9" }}>
            <iframe src={"https://www.youtube.com/embed/" + (ytIdFromUrl(video.url) || "")} className="w-full h-full" style={{ border: 0 }} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
          </div>
          {canComment && <div className="mt-1.5 text-right"><button onClick={() => { setAtSec(0); setText(""); setOpen(true); }} className="text-[10px] font-bold text-white px-2 py-1 rounded" style={{ background: accent }}>＋コメント</button></div>}
        </div>
      )}
      {open && (
        <div className="mt-2 rounded-lg border border-stone-200 bg-white p-2">
          {isMp4 && <div className="text-[10px] font-bold mb-1" style={{ color: accent }}>{fmtTC(atSec)} にコメント</div>}
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="修正依頼・気になる点…" className="w-full text-[12px] border border-stone-200 rounded px-2 py-1.5 focus:outline-none resize-y" />
          <div className="flex justify-end gap-2 mt-1"><button onClick={() => setOpen(false)} className="text-[10px] text-stone-400 px-2 py-1">やめる</button><button onClick={submit} className="text-[10px] font-bold text-white px-3 py-1 rounded" style={{ background: main }}>送信</button></div>
        </div>
      )}
      {list.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {list.map((c) => (
            <div key={c.id} className={"rounded-lg border px-2.5 py-1.5 " + (c.resolved ? "bg-emerald-50 border-emerald-200" : "bg-stone-50 border-stone-200")}>
              <div className="flex items-center gap-2">
                {typeof c.timecode === "number" ? <button onClick={() => seek(c.timecode)} className="mono text-[10px] font-bold text-white px-1.5 py-0.5 rounded" style={{ background: accent }}>▶ {fmtTC(c.timecode)}</button> : <span className="text-[10px] text-stone-400">全体</span>}
                <span className="text-[10px] font-bold text-stone-600">{c.author || "ゲスト"}</span>
                <button onClick={() => onResolve(c.id, !c.resolved)} className={"ml-auto text-[10px] font-bold " + (c.resolved ? "text-emerald-600" : "text-stone-400")}>{c.resolved ? "✓対応済" : "未対応"}</button>
              </div>
              <div className="text-[12px] text-stone-800 whitespace-pre-wrap break-words mt-0.5">{c.text}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* 企画カード内の「確認用動画（その場で再生）＋素材ファイル」ブロック */
function PlanMedia({ plan, canUpload, main, accent, comments, onPostComment, onResolveComment, onShare, sharing, onUploadVideo, onYouTube, onRemoveVideo, onUploadFile, onDeleteFile }) {
  const [yt, setYt] = React.useState("");
  const [vprog, setVprog] = React.useState(-1);
  const [fprog, setFprog] = React.useState(-1);
  const v = plan.video;
  const files = plan.files || [];
  const fmtB = (n) => { n = +n || 0; return n >= 1073741824 ? (n / 1073741824).toFixed(2) + " GB" : n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; };
  return (
    <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50/40 p-3 space-y-4">
      <div>
        <span className="text-[11px] font-bold text-stone-500">🎬 確認用の動画（その場で再生）</span>
        <div className="mt-2">
          {v ? (
            <div>
              <PlanVideoReview video={v} main={main} accent={accent} canComment={canUpload}
                comments={(comments || []).filter((c) => (c.videoKey || "") === (v.key || v.url || ""))}
                onPost={(tc, txt) => onPostComment(v.key || v.url || "", tc, txt, plan.shareId, plan.shareToken)}
                onResolve={onResolveComment} />
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-[10px] text-stone-400 truncate flex-1">{v.title || v.name || v.url}</span>
                <button onClick={onRemoveVideo} className="text-[11px] text-rose-500 font-bold shrink-0">削除</button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {canUpload ? (
                <label className="block rounded-lg border border-dashed border-stone-300 bg-white px-3 py-2.5 text-[11px] text-stone-500 cursor-pointer hover:bg-stone-50 text-center">
                  <input type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) { setVprog(0); Promise.resolve(onUploadVideo(f, setVprog)).finally(() => setVprog(-1)); } e.target.value = ""; }} />
                  ⬆ mp4をアップロード（0.5〜4倍速で確認）
                </label>
              ) : <div className="text-[10px] text-amber-600">mp4を上げるには先に右上「共有 → 閲覧用リンクを発行」してね（YouTubeはそのまま貼れます）</div>}
              {vprog >= 0 && <div className="h-1.5 bg-stone-200 rounded overflow-hidden"><div className="h-full" style={{ width: vprog + "%", background: accent }} /></div>}
              <div className="flex items-center gap-2">
                <input value={yt} onChange={(e) => setYt(e.target.value)} placeholder="または YouTube URL を貼る" className="flex-1 min-w-0 border border-stone-200 rounded-lg px-2 py-1.5 text-[12px] focus:outline-none" />
                <button onClick={() => { if (yt.trim()) { onYouTube(yt.trim()); setYt(""); } }} className="text-[11px] font-bold px-3 py-1.5 rounded-lg shrink-0 text-white" style={{ background: main }}>登録</button>
              </div>
            </div>
          )}
        </div>
      </div>
      <div>
        <span className="text-[11px] font-bold text-stone-500">📁 素材ファイル（元の名前のまま渡せる）</span>
        <div className="mt-2 space-y-1.5">
          {files.map((f) => (
            <div key={f.key} className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2">
              <div className="flex-1 min-w-0"><div className="text-[12px] font-semibold text-stone-800 truncate">{f.name}</div><div className="text-[10px] text-stone-400 mono">{fmtB(f.size)}</div></div>
              <a href={SHARE_API + "/api/file/" + f.key + "?dl=1"} target="_blank" rel="noreferrer" className="text-[11px] font-bold px-2.5 py-1 rounded-lg shrink-0 text-white" style={{ background: main }}>⬇</a>
              <button onClick={() => onDeleteFile(f.key)} className="text-[11px] text-rose-500 font-bold shrink-0">削除</button>
            </div>
          ))}
        </div>
        {canUpload ? (
          <label className="block mt-2 rounded-lg border border-dashed border-stone-300 bg-white px-3 py-2.5 text-[11px] text-stone-500 cursor-pointer hover:bg-stone-50 text-center">
            <input type="file" className="hidden" onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) { setFprog(0); Promise.resolve(onUploadFile(f, setFprog)).finally(() => setFprog(-1)); } e.target.value = ""; }} />
            ⬆ ファイルを追加（最大500GB・GB級もそのまま）
          </label>
        ) : <div className="text-[10px] text-amber-600 mt-2">ファイルを上げるには先に右上「共有 → 閲覧用リンクを発行」してね</div>}
        {fprog >= 0 && <div className="h-1.5 bg-stone-200 rounded overflow-hidden mt-1"><div className="h-full" style={{ width: fprog + "%", background: accent }} /></div>}
      </div>
      <div className="pt-1 border-t border-stone-200">
        <span className="text-[11px] font-bold text-stone-500">🔗 この企画の試写リンク</span>
        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
          <button onClick={onShare} disabled={sharing} className="text-[11px] font-bold text-white px-3 py-1.5 rounded-lg disabled:opacity-50" style={{ background: main }}>{sharing ? "発行中…" : (plan.shareId ? "試写リンクを更新" : "試写リンクを発行")}</button>
          {plan.shareId && <a href={shareUrl(plan.shareId, plan.shareReadToken)} target="_blank" rel="noreferrer" className="text-[11px] font-bold underline" style={{ color: main }}>リンクを開く ↗</a>}
        </div>
        <p className="text-[10px] text-stone-400 mt-1">この企画の動画・素材・コメントだけを先方に見せる専用リンク（案件丸ごとは右上「共有」）。</p>
      </div>
    </div>
  );
}

/* YouTube IFrame Player API（再生/停止・速度・タイムコードをアプリから制御） */
let _ytP = null;
function loadYT() {
  if (typeof window !== "undefined" && window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (_ytP) return _ytP;
  _ytP = new Promise((res) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (prev) try { prev(); } catch (e) {} res(window.YT); };
    if (!document.getElementById("yt-iframe-api")) { const s = document.createElement("script"); s.id = "yt-iframe-api"; s.src = "https://www.youtube.com/iframe_api"; document.head.appendChild(s); }
  });
  return _ytP;
}
/* YouTube流の起動チューニング：最低画質で即スタート→回線実測で数秒内に自動昇格。
   startLevel:0=初手を軽くして「押した瞬間に絵が出る」体感を作る（YouTubeの初動と同じ考え方）。
   abrEwmaFastVoD/SlowVoD を短めにして昇格判断を速く、maxBufferLength で先読みを厚めに。 */
const HLS_TUNING = {
  startLevel: 0,
  capLevelToPlayerSize: true,
  abrEwmaFastVoD: 2,
  abrEwmaSlowVoD: 6,
  maxBufferLength: 40,
  backBufferLength: 30,
  startFragPrefetch: true,
};
/* hls.js を必要時だけCDNから読み込む（Cloudflare Stream のHLS再生用） */
let _hlsP = null;
function loadHls() {
  if (typeof window !== "undefined" && window.Hls) return Promise.resolve(window.Hls);
  if (_hlsP) return _hlsP;
  _hlsP = new Promise((res) => { const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js"; s.onload = () => res(window.Hls); s.onerror = () => res(null); document.head.appendChild(s); });
  return _hlsP;
}

/* ===== マニュアル／決め事の編集パネル（全体・チャンネル・案件で共用） ===== */
function ManualPanel({ entries, onChange, main, accent, readOnly }) {
  const list = entries || [];
  const add = (cat) => onChange([...list, newManual(cat)]);
  const upd = (id, patch) => onChange(list.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const del = (id) => onChange(list.filter((m) => m.id !== id));
  return (
    <div>
      {list.length === 0 && <p className="text-[12px] text-stone-400 py-2">まだありません。{readOnly ? "" : "下の分類ボタンから決め事を追加できます。"}</p>}
      <div className="space-y-2">
        {list.map((m) => (
          <div key={m.id} className="rounded-xl border border-stone-200 bg-white p-3">
            {readOnly ? (
              <div>
                <div className="flex items-center gap-2 mb-1"><span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#F0F0F2", color: "#57534E" }}>{m.cat}</span><span className="text-[13px] font-bold text-stone-800">{m.title}</span></div>
                <div className="text-[12.5px] text-stone-700 whitespace-pre-wrap leading-relaxed">{m.body}</div>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <select value={m.cat} onChange={(e) => upd(m.id, { cat: e.target.value })} className="text-[11px] font-bold border border-stone-200 rounded px-1.5 py-1">{MANUAL_CATS.map((c) => <option key={c}>{c}</option>)}</select>
                  <input value={m.title} onChange={(e) => upd(m.id, { title: e.target.value })} placeholder="タイトル（例：テロップのフォント）" className="flex-1 min-w-0 text-[13px] font-bold border-0 border-b border-transparent hover:border-stone-200 focus:border-stone-400 focus:outline-none px-0.5 py-1" />
                  <button onClick={() => { if (window.confirm("この決め事を削除しますか？")) del(m.id); }} className="shrink-0 text-stone-300 hover:text-rose-500"><Icon name="trash" className="w-4 h-4" /></button>
                </div>
                <textarea value={m.body} onChange={(e) => upd(m.id, { body: e.target.value })} placeholder="内容・ルール（例：MORISAWA 新ゴ / 縁取り2px / 1行20字まで）" className="w-full h-20 text-[12.5px] border border-stone-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-stone-400 resize-y leading-relaxed" />
              </div>
            )}
          </div>
        ))}
      </div>
      {!readOnly && (
        <div className="mt-3 flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-bold text-stone-400">分類を選んで追加</span>
          {MANUAL_CATS.map((c) => (<button key={c} onClick={() => add(c)} className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-stone-200 hover:bg-stone-50 text-stone-600">＋{c}</button>))}
        </div>
      )}
    </div>
  );
}

/* ===== Flip-LAB のチャンネル編集ルール（読み取り専用・自動表示） =====
   確認コメントから蒸留した「このチャンネルの流儀」を mg-share 経由でLABから取得し、
   編集者が作業中に見れるように出す。未生成なら何も出さない。 */
// 学習した傾向(自動蒸留のmarkdown)を「採用」可能な個別行に割る。見出し(【..】/#)や空行は除外。
function splitTendencies(distilled) {
  if (!distilled) return [];
  return distilled.split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-*・••\d.)\]]+\s*/, "").trim()) // 先頭の箇条書き記号/番号を除去
    .filter((l) => l.length >= 4 && !/^[【#]/.test(l) && !/^学習した傾向|^確定ルール/.test(l));
}

function LabChannelRules({ channel, main, snapId, token, upToken, liveId, liveToken, onAdopt }) {
  const [data, setData] = React.useState(null);     // null=読込中, {fixed,distilled,updated}
  const [open, setOpen] = React.useState(true);
  const [adopted, setAdopted] = React.useState({}); // このセッションで採用済みの傾向テキスト→true（ボタン隠す）
  React.useEffect(() => {
    let on = true; setData(null);
    // 認証：クライアント固有の機密ルールのため、今この画面が持っている共有トークンを一緒に送る
    // （所有者token / 編集者upトークン / ライブ編集token+liveId / ログイン中セッション）。無ければ401で何も出さない。
    const qs = new URLSearchParams({ channel: channel || "" });
    if (snapId && token) { qs.set("id", snapId); qs.set("token", token); }
    else if (snapId && upToken) { qs.set("id", snapId); qs.set("up", upToken); }
    if (liveId && liveToken) { qs.set("live", liveId); qs.set("k", liveToken); }
    const headers = MG_SESSION ? { Authorization: "Bearer " + MG_SESSION } : {};
    fetch(SHARE_API + "/api/lab-manual?" + qs.toString(), { headers })
      .then((r) => r.json()).then((d) => { if (!on) return; setData({ fixed: d.fixed || "", distilled: d.distilled || "", updated: d.updated || null }); })
      .catch(() => { if (on) setData({ fixed: "", distilled: "", updated: null }); });
    return () => { on = false; };
  }, [channel, snapId, token, upToken, liveId, liveToken]);
  if (data === null) return <div className="text-[12px] text-stone-400 py-2">🧪 Flip-LABの編集ルールを読み込み中…</div>;
  const tendencies = splitTendencies(data.distilled);
  if (!data.fixed && !tendencies.length) return null;
  const adopt = (t) => { if (!onAdopt) return; onAdopt(t); setAdopted((a) => ({ ...a, [t]: true })); };
  return (
    <div className="rounded-xl border mb-3 overflow-hidden" style={{ borderColor: main + "55", background: main + "0c" }}>
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 px-3 py-2 text-left">
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full text-white shrink-0" style={{ background: main }}>🧪 Flip-LAB</span>
        <span className="text-[12.5px] font-bold text-stone-800">{channel} 編集ルール</span>
        <span className="ml-auto text-[10px] text-stone-400 shrink-0">{data.updated ? data.updated.slice(0, 10) : ""} {open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 border-t border-stone-200/60 pt-2 max-h-[46vh] overflow-y-auto">
          {data.fixed && (
            <div className="mb-3">
              <div className="text-[10.5px] font-bold text-stone-500 mb-1 tracking-wide">確定ルール（人が設定・厳守）</div>
              <div className="text-[12.5px] text-stone-700 whitespace-pre-wrap leading-relaxed">{data.fixed}</div>
            </div>
          )}
          {tendencies.length > 0 && (
            <div>
              <div className="text-[10.5px] font-bold text-stone-500 mb-1 tracking-wide">学習した傾向（確認コメントから自動蒸留）{onAdopt && <span className="font-normal text-stone-400">— 「採用」で確定ルールに昇格</span>}</div>
              <div className="space-y-1">
                {tendencies.map((t, i) => (
                  <div key={i} className="flex items-start gap-2 group">
                    <span className="text-[12.5px] text-stone-700 leading-relaxed flex-1">{t}</span>
                    {onAdopt && (adopted[t]
                      ? <span className="shrink-0 text-[10px] font-bold text-emerald-600 mt-0.5">✓採用</span>
                      : <button onClick={() => adopt(t)} title="この傾向を確定ルールに昇格" className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border text-white mt-0.5" style={{ background: main, borderColor: main }}>採用</button>)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ===== 動画確認：Frame.io型 修正管理ボード（バージョン＋ステータス/カテゴリ/優先度/返信/フィルタ） ===== */
function VersionTrashPanel({ items, onRestore }) {
  const [open, setOpen] = React.useState(false);
  if (!items.length) return null;
  const daysLeft = (v) => Math.max(0, 7 - Math.floor((Date.now() - v.trashedAt) / 86400000));
  return (
    <div className="mb-3">
      <button onClick={() => setOpen((o) => !o)} className="text-[11px] font-bold text-stone-400 hover:text-stone-600">🗑 ゴミ箱（{items.length}）{open ? " ▴" : " ▾"}</button>
      {open && (
        <div className="mt-1.5 rounded-xl border border-dashed border-stone-300 bg-white p-2.5 space-y-1.5">
          {items.map((v) => (
            <div key={v.id} className="flex items-center gap-2 text-[11px]">
              <span className="font-bold text-stone-500">{v.label}</span>
              <span className="text-stone-400 truncate flex-1">{v.name && v.name !== v.label ? v.name : ""}</span>
              <span className="text-stone-400">残り{daysLeft(v)}日で完全削除</span>
              <button onClick={() => onRestore(v.id)} className="font-bold px-2 py-1 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 shrink-0">復元</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function ReviewBoard({ versions, trashedVersions, comments, main, accent, accentText, busy, prog, onUploadVideo, onAddYouTube, onRemoveVersion, onRenameVersion, onRestoreVersion, onPost, onUpdate, onReply, onDelete, userName, onRefreshStream, shareId, shareToken, onEnsureShare }) {
  trashedVersions = trashedVersions || [];
  const mono = '"IBM Plex Mono",ui-monospace,monospace';
  const [selId, setSelId] = React.useState(versions.length ? versions[versions.length - 1].id : null);
  const [dropOver, setDropOver] = React.useState(false);
  const onDropVideo = (e) => { e.preventDefault(); setDropOver(false); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f && (f.type.startsWith("video/") || /\.(mp4|mov|m4v|webm)$/i.test(f.name || ""))) onUploadVideo(f); };
  const onDragOverVideo = (e) => { e.preventDefault(); if (!dropOver) setDropOver(true); };
  const [filter, setFilter] = React.useState("全部");
  const [cat, setCat] = React.useState("編集");
  const [prio, setPrio] = React.useState("中");
  const [text, setText] = React.useState("");
  const [yt, setYt] = React.useState("");
  const [replyText, setReplyText] = React.useState({});
  const [shortsBusy, setShortsBusy] = React.useState(false);
  const [shortsJobs, setShortsJobs] = React.useState([]);
  const [shortsItems, setShortsItems] = React.useState([]);
  const vref = React.useRef(null);
  const [rate, setRate] = React.useState(1);
  const [cur, setCur] = React.useState(0);
  const [dur, setDur] = React.useState(0);
  /* シーク/バッファ待ち中の表示。生mp4（軽量版なし）は移動に数秒かかるので「移動中」を出して固まって見えるのを防ぐ */
  const [seeking, setSeeking] = React.useState(false);
  /* シークバーのホバープレビュー（YouTube風）。pv={x,t}、pvImgは読み込み完了済みサムネURL（src直差し替えのチラつき防止） */
  const [pv, setPv] = React.useState(null);
  const [pvImg, setPvImg] = React.useState("");
  const pvCanvasRef = React.useRef(null);
  const pvVidRef = React.useRef(null);
  const pvTimer = React.useRef(null);
  const pvSeekT = React.useRef(0);
  const prevVerLen = React.useRef(versions.length);
  React.useEffect(() => {
    if (versions.length > prevVerLen.current) { setSelId(versions[versions.length - 1].id); } // 新ver追加→最新を自動表示（旧版誤確認の防止）
    else if (!versions.some((v) => v.id === selId)) setSelId(versions.length ? versions[versions.length - 1].id : null);
    prevVerLen.current = versions.length;
  }, [versions.map((v) => v.id).join(",")]);
  const sel = versions.find((v) => v.id === selId) || versions[versions.length - 1] || null;
  const vKey = sel ? (sel.uid || sel.key || sel.url || "") : "";
  const fmtTC = (s) => { s = Math.max(0, +s || 0); const m = Math.floor(s / 60), sec = Math.floor(s % 60), cs = Math.floor((s * 100) % 100); return m + ":" + String(sec).padStart(2, "0") + "." + String(cs).padStart(2, "0"); };
  const belongs = (c) => sel && (c.versionId === sel.id || (c.videoKey || "") === vKey || (sel.uid && c.videoKey === sel.uid) || (sel.key && c.videoKey === sel.key));
  const verComments = comments.filter(belongs);
  const counts = CMT_STATUSES.reduce((o, s) => { o[s] = verComments.filter((c) => cstat(c) === s).length; return o; }, {});
  const seek = (t) => {
    if (sel && sel.type === "youtube") { const p = ytPlayerRef.current; if (p && p.seekTo) { p.seekTo(+t || 0, true); if (p.playVideo) p.playVideo(); } return; }
    if (vref.current) { vref.current.currentTime = +t || 0; const p = vref.current.play(); if (p && p.catch) p.catch(() => {}); }
  };
  const isMp4 = sel && sel.type !== "youtube";
  // 再生方針：keyかurl(生データ)があれば常に観られる。HLS(軽量版)はreadyになったら昇格。
  const rawSrc = sel ? (sel.key ? (SHARE_API + "/api/file/" + sel.key) : (sel.url || "")) : "";
  const streamReadyHls = !!(sel && sel.type === "stream" && sel.ready && sel.hls);
  const streamBusy = !!(sel && sel.type === "stream" && !sel.ready);   // 変換中 or 変換失敗
  // 「本当に何も再生できない」＝HLS未完 かつ 生データも無い時だけ
  const streamPending = streamBusy && !rawSrc;
  // ホバープレビューの絵の出どころ：Stream変換済みは公式サムネAPI（?time=Ns）、生mp4は隠しvideoからフレーム描画、YouTubeはタイムコードのみ
  const pvThumbBase = (sel && sel.type === "stream" && sel.ready && sel.hls) ? sel.hls.replace(/manifest\/video\.m3u8.*$/, "thumbnails/thumbnail.jpg") : "";
  const pvThumbUrl = (pvThumbBase && pv) ? pvThumbBase + "?time=" + Math.max(0, Math.floor(pv.t)) + "s&height=90" : "";
  React.useEffect(() => { if (!pvThumbUrl) return; const im = new Image(); im.onload = () => setPvImg(pvThumbUrl); im.src = pvThumbUrl; }, [pvThumbUrl]);
  React.useEffect(() => { setPv(null); setPvImg(""); setSeeking(false); }, [sel && sel.id]);
  const pvNeedsVideo = !!(sel && sel.type !== "youtube" && !pvThumbBase && rawSrc);
  const queuePvSeek = (t) => {
    pvSeekT.current = t;
    if (pvTimer.current) return; // 連続ホバーは120msに間引く（2GB級mp4のシーク連打防止）
    pvTimer.current = setTimeout(() => { pvTimer.current = null; const v = pvVidRef.current; if (v && v.readyState >= 1) { try { v.currentTime = pvSeekT.current; } catch (e) {} } }, 120);
  };
  const pvMove = (e) => {
    if (!dur) return;
    const r = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setPv({ x: Math.min(r.width - 84, Math.max(84, e.clientX - r.left)), t: frac * dur });
    if (pvNeedsVideo) queuePvSeek(frac * dur);
  };
  const pvDraw = () => {
    const v = pvVidRef.current, c = pvCanvasRef.current;
    if (!v || !c) return;
    try {
      const ctx = c.getContext("2d");
      const vw = v.videoWidth || 16, vh = v.videoHeight || 9;
      const s = Math.min(c.width / vw, c.height / vh), w = vw * s, h = vh * s;
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(v, (c.width - w) / 2, (c.height - h) / 2, w, h);
    } catch (e) {}
  };
  // Cloudflare Stream(HLS) を hls.js で attach（Safariはネイティブ）
  React.useEffect(() => {
    if (!sel || sel.type !== "stream" || !sel.ready || !sel.hls || !vref.current) return;
    const video = vref.current; let hls;
    // hls.js優先。Chrome 149+はcanPlayTypeが"maybe"を返すのに実際はHLSを再生できないため、ネイティブはhls.js不可環境(iOS Safari)のみ
    loadHls().then((Hls) => { if (Hls && Hls.isSupported()) { hls = new Hls(HLS_TUNING); hls.loadSource(sel.hls); hls.attachMedia(video); } else { video.src = sel.hls; } });
    return () => { if (hls) hls.destroy(); };
  }, [sel && sel.id, sel && sel.ready, sel && sel.hls]);
  const isYT = sel && sel.type === "youtube";
  // YouTubeは IFrame API で制御（再生/停止・速度・タイムコード）。※YouTubeは仕様上2倍速まで
  const ytDivRef = React.useRef(null);
  const ytPlayerRef = React.useRef(null);
  React.useEffect(() => {
    if (!isYT || !ytDivRef.current) return;
    let timer, destroyed = false;
    loadYT().then((YT) => {
      if (destroyed || !YT || !ytDivRef.current) return;
      ytPlayerRef.current = new YT.Player(ytDivRef.current, {
        videoId: ytIdFromUrl(sel.url) || "",
        playerVars: { rel: 0, modestbranding: 1, iv_load_policy: 3, playsinline: 1 },
        events: { onReady: () => { timer = setInterval(() => { const p = ytPlayerRef.current; if (p && p.getCurrentTime) { setCur(p.getCurrentTime() || 0); if (p.getDuration) setDur(p.getDuration() || 0); } }, 200); } },
      });
    });
    return () => { destroyed = true; if (timer) clearInterval(timer); try { ytPlayerRef.current && ytPlayerRef.current.destroy && ytPlayerRef.current.destroy(); } catch (e) {} ytPlayerRef.current = null; };
  }, [sel && sel.id, isYT]);
  const getTime = () => isYT ? (ytPlayerRef.current && ytPlayerRef.current.getCurrentTime ? ytPlayerRef.current.getCurrentTime() : 0) : (vref.current ? vref.current.currentTime : 0);
  const applyRate = (r) => { if (isYT) { try { ytPlayerRef.current && ytPlayerRef.current.setPlaybackRate(r); } catch (e) {} } else if (vref.current) vref.current.playbackRate = r; setRate(r); };
  const togglePlay = () => {
    if (isYT) { const p = ytPlayerRef.current; if (!p || !p.getPlayerState) return; if (p.getPlayerState() === 1) p.pauseVideo(); else p.playVideo(); }
    else if (vref.current) { if (vref.current.paused) { const pr = vref.current.play(); if (pr && pr.catch) pr.catch(() => {}); } else vref.current.pause(); }
  };
  // キーボード操作：Enter/Space=再生停止、←→=5秒シーク(Shiftで1秒)。テキスト入力欄のみ無効（シークバー=range は対象にする）
  React.useEffect(() => {
    const seekBy = (d) => {
      if (isYT) { const p = ytPlayerRef.current; if (p && p.getCurrentTime && p.seekTo) { const nt = Math.max(0, (p.getCurrentTime() || 0) + d); p.seekTo(nt, true); setCur(nt); } }
      else if (vref.current) { const v = vref.current; const nt = Math.max(0, Math.min(v.duration || 1e9, (v.currentTime || 0) + d)); v.currentTime = nt; setCur(nt); }
    };
    const onKey = (e) => {
      const t = e.target, tag = (t && t.tagName || "").toLowerCase(), typ = (t && t.type || "").toLowerCase();
      const typing = tag === "textarea" || tag === "select" || (t && t.isContentEditable) || (tag === "input" && typ !== "range");
      if (typing || streamPending) return;
      const onRange = tag === "input" && typ === "range";
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") { e.preventDefault(); togglePlay(); }
      else if (!onRange && e.key === "ArrowRight") { e.preventDefault(); seekBy(e.shiftKey ? 1 : 5); }
      else if (!onRange && e.key === "ArrowLeft") { e.preventDefault(); seekBy(e.shiftKey ? -1 : -5); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel && sel.id, isYT, streamPending]);
  const filtered = verComments.filter((c) => filter === "全部" ? true : filter === "高優先度" ? c.priority === "高" : CMT_STATUSES.includes(filter) ? cstat(c) === filter : CMT_CATEGORIES.includes(filter) ? (c.category || "その他") === filter : true)
    .sort((a, b) => (a.timecode || 0) - (b.timecode || 0));
  const submit = () => { const t = text.trim(); if (!t || !sel) return; onPost({ versionId: sel.id, videoKey: vKey, timecode: streamPending ? null : getTime(), text: t, category: cat, priority: prio, status: "未対応" }); setText(""); try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {} };

  // たてがた君（縦ショート自動生成）結果ポーリング。pollStreamReadyと同じ「再帰setTimeout・triesで打ち切り」スタイル。
  const pollShortsList = async (snap, token, tries = 0) => {
    if (tries > 80) return;
    try {
      const r = await fetch(SHARE_API + "/api/shorts/list/" + snap + "?token=" + encodeURIComponent(token || ""));
      const d = await r.json();
      if (d && !d.error) {
        setShortsItems(d.shorts || []);
        setShortsJobs(d.jobs || []);
        const running = (d.jobs || []).some((j) => j.status === "pending" || j.status === "processing");
        if (!running) return;
      }
    } catch (e) {}
    setTimeout(() => pollShortsList(snap, token, tries + 1), 5000);
  };
  React.useEffect(() => {
    if (shareId) pollShortsList(shareId, shareToken, 0);
  }, [shareId]);
  const shortsRunning = shortsJobs.some((j) => j.status === "pending" || j.status === "processing");
  const enqueueShorts = async () => {
    if (!sel || !sel.key || shortsBusy || shortsRunning) return;
    setShortsBusy(true);
    try {
      const sh = await onEnsureShare();
      if (!sh) { setShortsBusy(false); return; }
      const r = await fetch(SHARE_API + "/api/shorts/enqueue", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snap: sh.id, token: sh.token, videoKey: sel.key }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "登録に失敗しました");
      pollShortsList(sh.id, sh.token, 0);
    } catch (e) {
      setShortsJobs((js) => [{ id: "err_" + Date.now(), status: "error", error: String((e && e.message) || e) }, ...js]);
    }
    setShortsBusy(false);
  };

  if (!versions.length) {
    return (
      <div>
        <VersionTrashPanel items={trashedVersions} onRestore={onRestoreVersion} />
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-6 text-center transition-all" style={dropOver ? { outline: "2px dashed " + main, outlineOffset: "2px" } : {}}
          onDragOver={onDragOverVideo} onDragLeave={() => setDropOver(false)} onDrop={onDropVideo}>
          <div className="text-[13px] font-bold text-stone-600 mb-1">確認用の動画を追加</div>
          <p className="text-[11px] text-stone-400 mb-4">mp4をここにドラッグ&ドロップ、または下のボタンから。0.5〜4倍速で試写しながら修正コメントを管理できます。</p>
          <div className="flex flex-col sm:flex-row gap-2 max-w-md mx-auto">
            <label className="flex-1 text-[12px] font-bold px-4 py-2.5 rounded-lg shadow cursor-pointer text-white" style={{ background: main }}>
              ⬆ mp4をアップロード
              <input type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) onUploadVideo(f); e.target.value = ""; }} />
            </label>
          </div>
          <div className="flex items-center gap-2 max-w-md mx-auto mt-2">
            <input value={yt} onChange={(e) => setYt(e.target.value)} placeholder="または YouTube限定公開URL" className="flex-1 min-w-0 border border-stone-200 rounded-lg px-2 py-2 text-[12px] focus:outline-none" />
            <button onClick={() => { onAddYouTube(yt); setYt(""); }} className="text-[11px] font-bold px-3 py-2 rounded-lg shrink-0 text-white" style={{ background: main }}>登録</button>
          </div>
          {busy && <div className="mt-3 text-[12px] text-stone-500">{busy} {prog ? prog + "%" : ""}</div>}
        </div>
      </div>
    );
  }
  const rates = isYT ? [0.5, 1, 1.5, 2] : [0.5, 1, 1.5, 2, 3, 4];
  return (
    <div>
      {/* バージョンタブ（ドラッグ&ドロップで動画追加OK） */}
      <div className="flex items-center gap-1.5 mb-3 overflow-x-auto pb-1 rounded-lg transition-all" style={dropOver ? { outline: "2px dashed " + main, outlineOffset: "3px" } : {}}
        onDragOver={onDragOverVideo} onDragLeave={() => setDropOver(false)} onDrop={onDropVideo}>
        {versions.map((v) => {
          const on = v.id === sel.id;
          const open = comments.filter((c) => (c.versionId === v.id || (c.videoKey || "") === (v.key || v.url || "")) && cstat(c) !== "完了").length;
          return (
            <button key={v.id} onClick={() => setSelId(v.id)}
              className={"shrink-0 px-3 py-1.5 rounded-lg text-[12px] font-bold border " + (on ? "text-white" : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50")}
              style={on ? { background: main, borderColor: main } : {}}>
              {v.label}<span className="font-normal opacity-80 ml-1">{v.name && v.name !== v.label ? v.name : ""}</span>
              {open > 0 && <span className="ml-1.5 text-[10px] px-1.5 rounded-full" style={{ background: on ? "rgba(255,255,255,.25)" : accent, color: "#fff" }}>{open}</span>}
            </button>
          );
        })}
        <label className="shrink-0 px-3.5 py-1.5 rounded-lg text-[12px] font-bold text-white cursor-pointer flex items-center gap-1 shadow-sm hover:opacity-90" style={{ background: main }} title="動画をアップ（ここにドラッグ&ドロップでも追加できます）">
          <span className="text-[13px] leading-none">⬆</span>動画を追加
          <input type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) onUploadVideo(f); e.target.value = ""; }} />
        </label>
      </div>
      {/* 修正サマリー */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {CMT_STATUSES.map((s) => (
          <span key={s} className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: CMT_STATUS_COLOR[s].bg, color: CMT_STATUS_COLOR[s].fg }}>{s} {counts[s]}</span>
        ))}
        <div className="flex-1" />
        {sel.key && (
          <a href={SHARE_API + "/api/file/" + sel.key + "?dl=1"} target="_blank" rel="noreferrer"
            title="この版のオリジナルmp4（アップした元データそのまま）をダウンロード"
            className="text-[11px] font-bold px-3 py-1.5 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 inline-flex items-center gap-1">
            ⬇ 元mp4をDL
          </a>
        )}
        {sel.key && (
          <button onClick={enqueueShorts} disabled={shortsBusy || shortsRunning}
            title={shortsRunning ? "既に生成中です" : "この版から縦型ショートを自動生成"}
            className="text-[11px] font-bold px-3 py-1.5 rounded-lg text-white disabled:opacity-50" style={{ background: accent }}>
            {shortsBusy || shortsRunning ? "生成中…" : "🎬 ショート生成"}
          </button>
        )}
        <button onClick={() => { if (window.confirm(sel.label + " を削除しますか？（7日間はゴミ箱から復元できます。コメントは残ります）")) onRemoveVersion(sel.id); }} className="text-[11px] text-stone-400 hover:text-rose-500 font-bold">この版を削除</button>
      </div>
      <VersionTrashPanel items={trashedVersions} onRestore={onRestoreVersion} />
      {(shortsBusy || shortsJobs.length > 0 || shortsItems.length > 0) && (
        <div className="mb-3 rounded-xl border border-stone-200 bg-white p-3">
          <div className="text-[11px] font-bold text-stone-500 mb-1.5">たてがた君（縦ショート自動生成）</div>
          {shortsBusy && (
            <div className="text-[11px] text-stone-500">📤 リクエストを送信中…</div>
          )}
          {shortsJobs.some((j) => j.status === "pending" || j.status === "processing") && (
            <div className="text-[11px] text-stone-500">⏳ 生成中…（Macでの処理待ち／実行中。数分かかることがあります）</div>
          )}
          {shortsJobs.filter((j) => j.status === "error").map((j) => (
            <div key={j.id} className="text-[11px] text-rose-500">⚠️ {j.error || "生成に失敗しました"}</div>
          ))}
          {shortsItems.length > 0 && (
            <ul className="flex flex-wrap gap-2 mt-1.5">
              {shortsItems.map((f) => (
                <li key={f.key}>
                  <a href={SHARE_API + "/api/file/" + f.key + "?dl=1"} target="_blank" rel="noreferrer"
                    className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 inline-flex items-center gap-1">
                    🎬 {f.name}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4">
        {/* 左：プレイヤー */}
        <div>
          <div className="relative rounded-xl overflow-hidden bg-black grid place-items-center" style={{ aspectRatio: "16/9" }}>
            {isYT
              ? <><div ref={ytDivRef} className="w-full h-full pointer-events-none" />
                  {/* 透明レイヤーでYouTubeのhover検知を遮断＝タイトル/関連動画などの情報を非表示に。クリックで再生/停止 */}
                  <div className="absolute inset-0 cursor-pointer" onClick={togglePlay} title="クリックで再生/停止" /></>
              : streamPending
                ? <div className="text-center text-white/80 px-4"><div className="text-[13px] font-bold mb-1">⚙️ 動画を準備中…{sel.pct ? " " + Math.round(sel.pct) + "%" : ""}</div><div className="text-[11px] opacity-70">アップロードか変換の完了待ちです。少し待ってから「🔄更新」を押してね。</div>
                    {onRefreshStream && <div className="mt-3"><button onClick={onRefreshStream} className="text-[11px] font-bold px-3 py-1 rounded bg-white/15 hover:bg-white/25">🔄 状況を更新</button></div>}</div>
                : streamReadyHls
                  ? <video ref={vref} playsInline preload="auto" poster={pvThumbBase ? pvThumbBase + "?time=0s&height=720" : undefined} onClick={togglePlay} onTimeUpdate={(e) => setCur(e.target.currentTime)} onLoadedMetadata={(e) => setDur(e.target.duration || 0)} onDurationChange={(e) => setDur(e.target.duration || 0)} onSeeking={() => setSeeking(true)} onWaiting={() => setSeeking(true)} onSeeked={() => setSeeking(false)} onPlaying={() => setSeeking(false)} onCanPlay={() => setSeeking(false)} className="w-full h-full bg-black cursor-pointer" title="クリックで再生/停止" />
                  : <video ref={vref} src={rawSrc} playsInline preload="auto" onClick={togglePlay} onTimeUpdate={(e) => setCur(e.target.currentTime)} onLoadedMetadata={(e) => setDur(e.target.duration || 0)} onDurationChange={(e) => setDur(e.target.duration || 0)} onSeeking={() => setSeeking(true)} onWaiting={() => setSeeking(true)} onSeeked={() => setSeeking(false)} onPlaying={() => setSeeking(false)} onCanPlay={() => setSeeking(false)} className="w-full h-full bg-black cursor-pointer" title="クリックで再生/停止" />}
            {/* シーク/バッファ待ちの間の「移動中」表示（生mp4は数秒かかる＝固まったと誤解されるのを防ぐ） */}
            {!isYT && !streamPending && seeking && (
              <div className="absolute inset-0 grid place-items-center pointer-events-none">
                <span className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-black/60 text-white/90">⏳ 移動中…{!streamReadyHls ? "（軽量版ができるとサクサクになります）" : ""}</span>
              </div>
            )}
            {/* 変換中/失敗でも生データで再生できている時の非ブロッキング・バッジ */}
            {!isYT && streamBusy && rawSrc && (
              <div className="absolute top-2 left-2 right-2 flex items-center gap-2 pointer-events-none">
                <span className="text-[10px] font-bold px-2 py-1 rounded bg-black/55 text-white/90 pointer-events-none">
                  {sel.streamFailed ? "⚠️ 軽量化できず元データで再生中" : "⚙️ 軽量版を準備中…" + (sel.pct ? Math.round(sel.pct) + "%" : "") + "（できたら自動で軽くなります）"}
                </span>
                {onRefreshStream && !sel.streamFailed && <button onClick={onRefreshStream} className="text-[10px] font-bold px-2 py-1 rounded bg-black/55 text-white/90 hover:bg-black/75 pointer-events-auto">🔄</button>}
              </div>
            )}
          </div>
          {/* 映像のすぐ下に常時見える太いシークバー（mp4もYouTubeも）。スクラブしても勝手に再生しない */}
          {!streamPending && dur > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <div className="relative flex-1 min-w-0" onMouseMove={pvMove} onMouseLeave={() => setPv(null)}>
                {pv && (
                  <div className="absolute bottom-4 z-30 pointer-events-none -translate-x-1/2 rounded-lg overflow-hidden shadow-lg border border-black/20 bg-black" style={{ left: pv.x }}>
                    {pvThumbUrl ? <img src={pvImg || pvThumbUrl} alt="" draggable={false} className="block w-40 h-[90px] object-cover" />
                      : pvNeedsVideo ? <canvas ref={pvCanvasRef} width={160} height={90} className="block w-40 h-[90px]" /> : null}
                    <div className="text-center text-[10px] font-bold text-white/90 py-0.5 bg-black/80" style={{ fontFamily: mono }}>{fmtTC(pv.t)}</div>
                  </div>
                )}
                <input type="range" min={0} max={dur} step="0.1" value={cur}
                  onChange={(e) => { const t = +e.target.value; setCur(t); if (isYT) { const p = ytPlayerRef.current; if (p && p.seekTo) p.seekTo(t, true); } else if (vref.current) vref.current.currentTime = t; }}
                  className="w-full h-2 cursor-pointer accent-current" style={{ color: accent }} />
              </div>
              <span className="text-[10px] tabular-nums text-stone-400 shrink-0" style={{ fontFamily: mono }}>{fmtTC(cur)} / {fmtTC(dur)}</span>
              {pvNeedsVideo && <video ref={pvVidRef} src={rawSrc} preload="metadata" muted playsInline className="hidden" onSeeked={pvDraw} />}
            </div>
          )}
          {!streamPending && (
            <div className="flex items-center gap-1 mt-2 flex-wrap">
              <span className="text-[11px] font-bold tabular-nums px-2 py-1 rounded" style={{ background: "#1C1C1E", color: "#fff", fontFamily: mono }}>{fmtTC(cur)}{isYT && dur ? " / " + fmtTC(dur) : ""}</span>
              <button onClick={togglePlay} title="再生/停止（Enter）" className="text-[11px] font-bold px-2 py-1 rounded border border-stone-200 text-stone-600 hover:bg-stone-50">⏯</button>
              <button onClick={() => { const el = isYT ? (ytDivRef.current && ytDivRef.current.querySelector("iframe")) || ytDivRef.current : vref.current; if (el && el.requestFullscreen) el.requestFullscreen(); }} title="全画面" className="text-[11px] font-bold px-2 py-1 rounded border border-stone-200 text-stone-600 hover:bg-stone-50">⛶</button>
              <span className="text-[10px] text-stone-400 ml-1 mr-0.5">速度</span>
              {rates.map((r) => (
                <button key={r} onClick={() => applyRate(r)}
                  className={"text-[11px] px-1.5 py-0.5 rounded border " + (rate === r ? "text-white" : "border-stone-200 text-stone-500")} style={rate === r ? { background: main, borderColor: main, fontFamily: mono } : { fontFamily: mono }}>{r}x</button>
              ))}
              {isYT && <span className="text-[10px] text-stone-400">（YouTubeは2倍まで）</span>}
              <span className="text-[10px] text-stone-400 ml-auto">Enter/Space=再生停止　←→=5秒（Shiftで1秒）</span>
            </div>
          )}
          {/* 新規修正コメント */}
          <div className="mt-3 rounded-xl border border-stone-200 bg-white p-3">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              {!streamPending && <span className="text-[11px] font-bold tabular-nums px-2 py-0.5 rounded" style={{ background: accent, color: accentText, fontFamily: mono }}>{fmtTC(cur)} に</span>}
              <select value={cat} onChange={(e) => setCat(e.target.value)} className="text-[11px] border border-stone-200 rounded px-1.5 py-1">{CMT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
              <select value={prio} onChange={(e) => setPrio(e.target.value)} className="text-[11px] border border-stone-200 rounded px-1.5 py-1">{CMT_PRIORITIES.map((p) => <option key={p}>優先:{p}</option>)}</select>
            </div>
            <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submit(); } }} placeholder="修正内容を入力（⌘+Enterで送信）" className="w-full h-16 text-[12px] border border-stone-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-stone-400 resize-y" />
            <div className="flex justify-end mt-1.5"><button onClick={submit} disabled={!text.trim()} className="text-[11px] font-bold px-4 py-1.5 rounded-lg shadow disabled:opacity-40 text-white" style={{ background: main }}>修正を追加</button></div>
          </div>
        </div>
        {/* 右：修正一覧＋フィルタ */}
        <div>
          <div className="flex items-center gap-1 mb-2 flex-wrap">
            {["全部", ...CMT_STATUSES, "高優先度"].map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={"text-[10px] font-bold px-2 py-1 rounded-full border " + (filter === f ? "text-white border-transparent" : "bg-white border-stone-200 text-stone-500")} style={filter === f ? { background: main } : {}}>{f}</button>
            ))}
            <select value={CMT_CATEGORIES.includes(filter) ? filter : ""} onChange={(e) => e.target.value && setFilter(e.target.value)} className="text-[10px] border border-stone-200 rounded-full px-2 py-1 text-stone-500"><option value="">カテゴリ</option>{CMT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          </div>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {filtered.length === 0 && <p className="text-[11px] text-stone-400 py-4 text-center">修正はありません</p>}
            {filtered.map((c) => {
              const st = cstat(c);
              return (
                <div key={c.id} className="rounded-xl border border-stone-200 bg-white p-2.5">
                  <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                    {typeof c.timecode === "number" && <button onClick={() => seek(c.timecode)} className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded text-white" style={{ background: main, fontFamily: mono }}>▶ {fmtTC(c.timecode)}</button>}
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "#F0F0F2", color: "#57534E" }}>{c.category || "その他"}</span>
                    {c.priority && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: (CMT_PRIO_COLOR[c.priority] || {}).bg, color: (CMT_PRIO_COLOR[c.priority] || {}).fg }}>{c.priority}</span>}
                    <select value={st} onChange={(e) => onUpdate(c.id, { status: e.target.value })} className="text-[10px] font-bold border-0 rounded px-1.5 py-0.5 ml-auto" style={{ background: CMT_STATUS_COLOR[st].bg, color: CMT_STATUS_COLOR[st].fg }}>{CMT_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
                  </div>
                  <div className="text-[12px] text-stone-800 leading-snug whitespace-pre-wrap">{c.text}</div>
                  <div className="text-[10px] text-stone-400 mt-1 flex items-center gap-2"><span>{c.author || "ゲスト"}</span>{c.createdAt && <span>{String(c.createdAt).slice(5, 16).replace("T", " ")}</span>}<button onClick={() => { if (window.confirm("この修正を削除？")) onDelete(c.id); }} className="ml-auto hover:text-rose-500">削除</button></div>
                  {/* 返信スレッド */}
                  {(c.replies || []).length > 0 && (
                    <div className="mt-2 pl-2 border-l-2 border-stone-100 space-y-1">
                      {c.replies.map((r, ri) => (<div key={ri} className="text-[11px]"><span className="font-bold text-stone-600">{r.author}</span> <span className="text-stone-700">{r.text}</span></div>))}
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <input value={replyText[c.id] || ""} onChange={(e) => setReplyText((m) => ({ ...m, [c.id]: e.target.value }))} onKeyDown={(e) => { if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return; e.preventDefault(); if (!(replyText[c.id] || "").trim()) return; onReply(c.id, replyText[c.id]); setReplyText((m) => ({ ...m, [c.id]: "" })); }} placeholder="返信…" className="flex-1 min-w-0 text-[11px] border border-stone-200 rounded-lg px-2 py-1 focus:outline-none" />
                    <button onClick={() => { onReply(c.id, replyText[c.id]); setReplyText((m) => ({ ...m, [c.id]: "" })); }} className="text-[10px] font-bold px-2 py-1 rounded-lg border border-stone-200 text-stone-500 hover:bg-stone-50 shrink-0">返信</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {busy && <div className="mt-2 text-[12px] text-stone-500">{busy} {prog ? prog + "%" : ""}</div>}
    </div>
  );
}

/* ---------- メイン ---------- */
/* ============================================================
   質問ウィザード — 認識OSの質問13に答えると密着台本の骨ができる
   Stage1: Flip-LABの質問テンプレ（質問13）を1問ずつ
   Stage2: 回答 → /api/wizard/scaffold（Opus）→ 台本の骨（markdown）
   回答も骨も project.wizard に保存＝案件データとして永続化
   ============================================================ */
const wizEsc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const wizInline = (s) => wizEsc(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");
function wizParseQuestions(md) {
  const out = [];
  const blocks = String(md).split(/^##+\s+/m).slice(1);
  for (const b of blocks) {
    const lines = b.trim().split("\n");
    const m = (lines[0] || "").trim().match(/^(Q\d+)\s*(.*)$/);
    if (!m) continue;
    out.push({ num: m[1], text: m[2] || lines[0], hint: lines.slice(1).join(" ").replace(/[（(）)]/g, "").trim() });
  }
  return out;
}
function wizMdHtml(md) {
  const lines = String(md).split("\n");
  let html = "", i = 0;
  while (i < lines.length) {
    const L = lines[i];
    if (/^\s*\|/.test(L) && /^\s*\|[\s:|-]+\|?\s*$/.test(lines[i + 1] || "")) {
      const heads = L.split("|").slice(1, -1).map((c) => wizInline(c.trim()));
      i += 2;
      let rows = "";
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const cells = lines[i].split("|").slice(1, -1).map((c) => wizInline(c.trim()));
        rows += '<tr' + (lines[i].includes("★") ? ' class="wiz-hot"' : "") + '>' + cells.map((c) => "<td>" + c + "</td>").join("") + "</tr>";
        i++;
      }
      html += '<div class="wiz-tbl"><table><thead><tr>' + heads.map((h) => "<th>" + h + "</th>").join("") + "</tr></thead><tbody>" + rows + "</tbody></table></div>";
      continue;
    }
    if (/^#{1,3}\s+/.test(L)) { const lv = L.match(/^(#{1,3})/)[1].length; const t = wizInline(L.replace(/^#{1,3}\s+/, "")); html += lv >= 3 ? "<h4>" + t + "</h4>" : "<h3>" + t + "</h3>"; i++; continue; }
    if (/^\s*[-*]\s+/.test(L)) {
      let items = "";
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items += "<li>" + wizInline(lines[i].replace(/^\s*[-*]\s+/, "")) + "</li>"; i++; }
      html += "<ul>" + items + "</ul>"; continue;
    }
    if (!L.trim()) { i++; continue; }
    html += "<p>" + wizInline(L) + "</p>"; i++;
  }
  return html;
}

/* 骨markdownの「シーン割り」表を構成台本の行データに変換する */
function wizParseScaffoldRows(md) {
  const lines = String(md || "").split("\n");
  // シーン割りセクションの表を探す（ヘッダに時間帯/シーンを含む表）
  let hi = -1, idx = null;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*\|/.test(lines[i]) && /時間/.test(lines[i]) && /シーン/.test(lines[i])) { hi = i; break; }
  }
  if (hi < 0) return [];
  const heads = lines[hi].split("|").slice(1, -1).map((c) => c.trim());
  const col = (kw) => heads.findIndex((h) => h.includes(kw));
  idx = { time: col("時間"), scene: col("シーン"), brain: col("脳"), aim: col("狙い"), q: col("質問"), promo: col("訴求"), len: col("尺") };
  if (idx.scene < 0) return [];
  const out = [];
  for (let i = hi + 2; i < lines.length; i++) {
    if (!/^\s*\|/.test(lines[i])) break;
    const c = lines[i].split("|").slice(1, -1).map((x) => x.trim());
    const g = (k) => (idx[k] >= 0 && c[idx[k]] ? c[idx[k]].replace(/\*\*/g, "") : "");
    const scene = g("scene"); if (!scene) continue;
    const aim = g("aim"), promo = g("promo"), brain = g("brain"), qraw = g("q");
    const blob = scene + " " + aim;
    let type = "解説系";
    if (promo && !/^[—―ー\-–]$/.test(promo)) type = "訴求";
    else if (/移動|車中|出発|支度|帰宅|日常|積む|片付け/.test(blob)) type = "VLOG";
    else if (/第三者|証言|風景|表情|無言|インサート|余韻/.test(blob)) type = "インサート";
    // 質問→◼︎行（「…」を1問ずつ）。無ければ括弧書き等をそのまま1行
    const qs = []; const re = /「([^」]+)」/g; let mm;
    while ((mm = re.exec(qraw))) qs.push("◼︎ " + mm[1]);
    let script = qs.length ? qs.join("\n") : (qraw && !/^[—―ー\-–]$/.test(qraw) ? qraw : "");
    const memo = ["※", brain, aim && (brain ? "｜" : "") + aim, promo && !/^[—―ー\-–]$/.test(promo) ? "｜訴求: " + promo : ""].join("").replace(/^※$/, "");
    if (memo) script = script ? script + "\n" + memo : memo;
    // 尺 "1:30"→90秒
    let sec = null; const lm = (g("len") || "").match(/^(\d+):(\d{2})$/);
    if (lm) sec = parseInt(lm[1], 10) * 60 + parseInt(lm[2], 10);
    out.push({ time: g("time"), label: scene, type, sec, script });
  }
  return out;
}

function WizardPane({ project, setProject, theme, setTab }) {
  const wiz = project.wizard || newWizard();
  const m = wiz.meta || {};
  const ans = wiz.answers || {};
  const [questions, setQuestions] = useState(null);
  const [qErr, setQErr] = useState("");
  const [qIdx, setQIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [genErr, setGenErr] = useState("");
  const [sugBusy, setSugBusy] = useState(false);
  const [view, setView] = useState(wiz.scaffold ? "result" : "form");
  const [copied, setCopied] = useState(false);
  const taRef = useRef(null);

  useEffect(() => {
    let dead = false;
    fetch(SHARE_API + "/api/wizard/questions")
      .then((r) => r.json())
      .then((d) => {
        if (dead) return;
        if (d && d.ok && d.template) { const qs = wizParseQuestions(d.template); if (qs.length) { setQuestions(qs); return; } }
        setQErr((d && d.error) || "質問の読み込みに失敗しました");
      })
      .catch((e) => { if (!dead) setQErr(String((e && e.message) || e)); });
    return () => { dead = true; };
  }, []);
  useEffect(() => { if (view === "form" && taRef.current) taRef.current.focus(); }, [qIdx, questions, view]);

  const setMetaF = (k, v) => setProject((p) => { const w = p.wizard || newWizard(); return { ...p, wizard: { ...w, meta: { ...(w.meta || {}), [k]: v } } }; });
  const setAns = (num, v) => setProject((p) => { const w = p.wizard || newWizard(); const a = { ...(w.answers || {}) }; if (v && v.trim()) a[num] = v; else delete a[num]; return { ...p, wizard: { ...w, answers: a } }; });
  const dropSug = (num) => setProject((p) => { const w = p.wizard || newWizard(); const s = { ...(w.suggestions || {}) }; delete s[num]; return { ...p, wizard: { ...w, suggestions: s } }; });
  // ヒアリングタブの入力から答え候補をAIに推測させる（「こういうのじゃない？」提案）
  const suggest = async () => {
    if (sugBusy || !questions) return;
    const secs = (project.hearing || []).map((sec) => {
      const items = (sec.items || []).filter((it) => (it.value || "").replace(/<[^>]+>/g, "").trim()).map((it) => it.label + ": " + (it.value || "").replace(/<[^>]+>/g, " ").trim());
      return items.length ? sec.title + "\n" + items.join("\n") : null;
    }).filter(Boolean);
    if (!secs.length) { setGenErr("ヒアリングタブにまだ入力がありません。先にヒアリングを埋めると提案できます。"); return; }
    setSugBusy(true); setGenErr("");
    try {
      const res = await fetch(SHARE_API + "/api/wizard/suggest", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questions: questions.map((q) => ({ num: q.num, text: q.text, hint: q.hint })), hearing: secs.join("\n\n"), performer: m.performer || "", genre: m.genre || "" }),
      });
      const d = await res.json();
      if (!d.ok || !d.suggestions) throw new Error(d.error || "提案の取得に失敗しました");
      const clean = {};
      Object.keys(d.suggestions).forEach((k) => { const v = d.suggestions[k]; if (v && String(v).trim()) clean[k] = String(v); });
      setProject((p) => { const w = p.wizard || newWizard(); return { ...p, wizard: { ...w, suggestions: clean } }; });
    } catch (e) { setGenErr(String((e && e.message) || e)); }
    setSugBusy(false);
  };

  const total = questions ? questions.length : 13;
  const answered = questions ? questions.filter((qq) => (ans[qq.num] || "").trim()).length : 0;
  const q = questions ? questions[Math.min(qIdx, questions.length - 1)] : null;

  const generate = async () => {
    if (busy || !questions) return;
    setBusy(true); setGenErr("");
    try {
      const answersText = questions.map((qq) => qq.num + "（" + qq.text + "）: " + ((ans[qq.num] || "").trim() || "【未回収】")).join("\n");
      const res = await fetch(SHARE_API + "/api/wizard/scaffold", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: answersText, performer: m.performer || "", genre: m.genre || "", shootContext: m.shoot || "", targetLength: m.length || "", caseLabel: project.name || "" }),
      });
      const d = await res.json();
      if (!d.ok || !d.scaffold) throw new Error(d.error || "生成に失敗しました");
      setProject((p) => ({ ...p, wizard: { ...(p.wizard || newWizard()), scaffold: d.scaffold, scaffoldAt: Date.now() } }));
      setView("result");
    } catch (e) { setGenErr(String((e && e.message) || e)); }
    setBusy(false);
  };
  const copyMd = async () => { try { await navigator.clipboard.writeText(wiz.scaffold || ""); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (e) {} };
  const [pourOpen, setPourOpen] = useState(false);
  const [pourMode, setPourMode] = useState("append");
  const pourRows = wiz.scaffold ? wizParseScaffoldRows(wiz.scaffold) : [];
  const doPour = () => {
    if (!pourRows.length) return;
    const made = []; let lastTime = null;
    pourRows.forEach((r) => {
      if (r.time && r.time !== lastTime) { made.push(newLocation(r.time)); lastTime = r.time; }
      const sc = newScene(r.type, r.label); sc.sec = r.sec; sc.script = r.script || "";
      made.push(sc);
    });
    setProject((p) => ({ ...p, rows: pourMode === "replace" ? made : [...(p.rows || []), ...made] }));
    setPourOpen(false);
    if (typeof setTab === "function") setTab("script");
  };
  const dlMd = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([wiz.scaffold || ""], { type: "text/markdown" }));
    a.download = (project.name || "台本の骨") + "_骨.md";
    a.click();
  };

  const genBtn = (label) => (
    <button onClick={generate} disabled={busy || !questions}
      className="text-[12px] font-bold px-5 py-2.5 rounded-lg text-white shadow-sm disabled:opacity-60 inline-flex items-center gap-2"
      style={{ background: theme.accent }}>
      {busy && <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
      {busy ? "生成中…（1〜2分そのまま）" : label}
    </button>
  );

  return (
    <div className="max-w-[1500px] mx-auto px-1 sm:px-0 py-1 space-y-4" style={{ "--wiz": theme.accent }}>
      <style>{`
        .wiz-md h3{font-size:15px;font-weight:700;color:#292524;margin:22px 0 8px;padding-bottom:6px;border-bottom:2px solid #e7e5e4}
        .wiz-md h3:first-child{margin-top:0}
        .wiz-md h4{font-size:13px;font-weight:700;color:#44403c;margin:14px 0 6px}
        .wiz-md p{font-size:13px;color:#44403c;margin:6px 0;line-height:1.85}
        .wiz-md ul{padding-left:20px;margin:6px 0;list-style:disc}
        .wiz-md li{font-size:13px;color:#44403c;margin:3px 0;line-height:1.75}
        .wiz-md strong{color:var(--wiz)}
        .wiz-md code{background:#f5f5f4;border-radius:4px;padding:1px 5px;font-size:12px}
        .wiz-tbl{overflow-x:auto;border:1px solid #e7e5e4;border-radius:12px;margin:10px 0}
        .wiz-tbl table{border-collapse:collapse;width:100%;min-width:780px;font-size:12px}
        .wiz-tbl th{background:#1c1917;color:#fff;padding:8px 10px;text-align:left;white-space:nowrap;font-weight:600}
        .wiz-tbl td{border-top:1px solid #f0efee;padding:8px 10px;vertical-align:top;line-height:1.7;color:#44403c}
        .wiz-tbl tr:nth-child(even) td{background:#fafaf9}
        .wiz-tbl tr.wiz-hot td{background:color-mix(in srgb, var(--wiz) 8%, #fff)}
      `}</style>

      {/* リード文＋ビュー切替 */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <p className="text-[12px] text-stone-500">認識OSの<span className="font-bold">13の質問</span>に順に答えると、視聴維持の脳科学設計に沿った<span className="font-bold">密着台本の骨</span>（シーン割り・現場で投げる質問・訴求の置き場所）ができます。ヒアリングの内容を横に置きながら埋めるのがおすすめ。</p>
        {wiz.scaffold && (
          <div className="shrink-0 inline-flex rounded-lg border border-stone-200 bg-white p-0.5">
            {[["form", "回答"], ["result", "台本の骨"]].map(([k, l]) => (
              <button key={k} onClick={() => setView(k)}
                className={"text-[11px] font-bold px-3 py-1.5 rounded-md transition-colors " + (view === k ? "text-white shadow-sm" : "text-stone-500 hover:text-stone-700")}
                style={view === k ? { background: theme.accent } : {}}>{l}</button>
            ))}
          </div>
        )}
      </div>

      {view === "form" && (
        <>
          {/* 案件の前提 */}
          <div className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <h2 className="text-[13px] font-bold text-stone-800">案件の前提<span className="ml-2 text-[10px] font-normal text-stone-400">埋めるほど骨の精度が上がります（空欄でもOK）</span></h2>
              <button onClick={suggest} disabled={sugBusy}
                className="shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-lg border inline-flex items-center gap-1.5 disabled:opacity-60"
                style={{ borderColor: theme.accent, color: theme.accent, background: "#fff" }}>
                {sugBusy && <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />}
                <Icon name="sparkle" className="w-3.5 h-3.5" />{sugBusy ? "ヒアリングを読んでいる…" : "ヒアリングから答え候補をもらう"}
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[["performer", "演者・対象", "例: 在宅緩和ケア医（終末期の患者を自宅で看取る医師）"], ["genre", "ジャンル・業種", "例: 終末医療ドキュメンタリー"], ["shoot", "撮影想定", "例: 往診に1日密着（出発→患者宅→カンファ→帰宅）"], ["length", "想定尺", "例: 23分前後"]].map(([k, label, ph]) => (
                <label key={k} className="block"><span className="text-[11px] font-bold text-stone-500">{label}</span>
                  <input value={m[k] || ""} onChange={(e) => setMetaF(k, e.target.value)} placeholder={ph}
                    className="mt-1 w-full text-[13px] border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-400" /></label>
              ))}
            </div>
          </div>

          {/* 質問エリア */}
          {qErr ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 text-rose-700 text-[12px] px-4 py-4">{qErr}<button onClick={() => { setQErr(""); setQuestions(null); location.reload(); }} className="ml-3 underline font-bold">再読み込み</button></div>
          ) : !questions ? (
            <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center text-[12px] text-stone-400">
              <span className="inline-block w-4 h-4 border-2 border-stone-300 border-t-transparent rounded-full animate-spin align-middle mr-2" />質問を読み込み中…
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-[230px_1fr] gap-4 items-start">
              {/* 左：質問ナビ */}
              <div className="flex md:flex-col gap-1.5 overflow-x-auto md:overflow-visible pb-1 md:pb-0">
                {questions.map((qq, i) => {
                  const done = !!(ans[qq.num] || "").trim(); const cur = i === qIdx;
                  return (
                    <button key={qq.num} onClick={() => setQIdx(i)}
                      className={"shrink-0 md:w-full text-left rounded-lg px-2.5 py-1.5 text-[11px] font-bold border transition-colors " + (cur ? "bg-white shadow-sm" : "border-transparent hover:bg-white " + (done ? "text-stone-500" : "text-stone-400"))}
                      style={cur ? { borderColor: theme.accent, color: theme.accent } : {}}>
                      <span className="inline-flex items-center gap-1.5 max-w-full">
                        <span className="shrink-0 inline-block w-1.5 h-1.5 rounded-full" style={{ background: done ? theme.accent : "#d6d3d1" }} />
                        <span className="shrink-0">{qq.num}</span>
                        <span className="hidden md:inline font-normal text-stone-400 truncate">{qq.text.slice(0, 12)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {/* 右：現在の質問 */}
              <div className="rounded-2xl border border-stone-200 bg-white p-5 sm:p-6">
                <div className="h-1 rounded-full bg-stone-100 mb-5 overflow-hidden"><div className="h-full rounded-full transition-all duration-300" style={{ width: (answered / total * 100) + "%", background: theme.accent }} /></div>
                <div className="text-[11px] font-bold tracking-widest" style={{ color: theme.accent }}>{q.num}<span className="text-stone-300 font-normal"> / {total}</span></div>
                <div className="text-[17px] font-bold text-stone-800 mt-1.5 leading-relaxed">{q.text}</div>
                {q.hint && <div className="mt-2.5 text-[11px] text-stone-500 bg-stone-50 border border-stone-100 rounded-lg px-3 py-2">狙い：{q.hint}</div>}
                {(() => { const sug = (wiz.suggestions || {})[q.num]; if (!sug) return null; return (
                  <div className="mt-2.5 rounded-xl border px-3.5 py-3" style={{ borderColor: "#F3C2CB", background: "#FBE5EA55" }}>
                    <div className="text-[10px] font-bold mb-1" style={{ color: theme.accent }}>ヒアリングからの提案 — こういうのじゃない？</div>
                    <div className="text-[12px] text-stone-700 leading-relaxed whitespace-pre-wrap">{sug}</div>
                    <div className="flex gap-2 mt-2.5">
                      <button onClick={() => { const cur = (ans[q.num] || "").trim(); setAns(q.num, cur ? cur + "\n" + sug : sug); dropSug(q.num); }}
                        className="text-[11px] font-bold px-3 py-1.5 rounded-lg text-white" style={{ background: theme.accent }}>これで埋める</button>
                      <button onClick={() => dropSug(q.num)} className="text-[11px] font-bold px-3 py-1.5 rounded-lg border border-stone-200 text-stone-500 bg-white">却下</button>
                    </div>
                  </div>
                ); })()}
                <textarea ref={taRef} value={ans[q.num] || ""} onChange={(e) => setAns(q.num, e.target.value)}
                  onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); if (qIdx < total - 1) setQIdx(qIdx + 1); } }}
                  placeholder="思いつくまま書けばOK。空欄のままなら【未回収】として骨に載り、現場で埋める質問リストになります"
                  className="mt-4 w-full min-h-[130px] text-[13px] leading-relaxed border border-stone-200 rounded-xl px-3.5 py-3 focus:outline-none focus:border-stone-400 resize-y" />
                <div className="flex items-center justify-between gap-2 mt-4">
                  <button onClick={() => setQIdx(Math.max(0, qIdx - 1))} disabled={qIdx === 0}
                    className="text-[12px] font-bold px-4 py-2 rounded-lg border border-stone-200 text-stone-500 hover:bg-stone-50 disabled:opacity-40">← 前へ</button>
                  <span className="text-[10px] text-stone-300 hidden sm:inline">⌘+Enter で次へ</span>
                  {qIdx < total - 1
                    ? <button onClick={() => setQIdx(qIdx + 1)} className="text-[12px] font-bold px-5 py-2 rounded-lg text-white shadow-sm" style={{ background: theme.accent }}>次へ →</button>
                    : genBtn("台本の骨を生成 →")}
                </div>
              </div>
            </div>
          )}

          {/* 生成バー */}
          {questions && (
            <div className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5 flex items-center justify-between gap-3 flex-wrap">
              <div className="text-[12px] text-stone-500"><span className="font-bold text-stone-700">{answered}</span> / {total} 問 回答済み{answered < total && <span className="text-stone-400">　未回答は【未回収】＝現場で埋める質問リストになります</span>}</div>
              {genBtn("台本の骨を生成する")}
            </div>
          )}
          {genErr && <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-[12px] px-4 py-3">{genErr}</div>}
        </>
      )}

      {view === "result" && wiz.scaffold && (
        <div className="rounded-2xl border border-stone-200 bg-white p-5 sm:p-7">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-5">
            <div>
              <div className="text-[15px] font-bold text-stone-800">密着台本の骨</div>
              {wiz.scaffoldAt && <div className="text-[10px] text-stone-400 mt-0.5">{new Date(wiz.scaffoldAt).toLocaleString("ja-JP")} 生成・回答を直して再生成できます</div>}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {pourRows.length > 0 && (
                <button onClick={() => setPourOpen(true)} className="text-[12px] font-bold px-4 py-2 rounded-lg text-white shadow-sm" style={{ background: theme.accent }}>構成台本に流し込む</button>
              )}
              <button onClick={copyMd} className="text-[12px] font-bold px-3.5 py-2 rounded-lg border border-stone-200 bg-white text-stone-600 hover:bg-stone-50">{copied ? "コピーした" : "コピー"}</button>
              <button onClick={dlMd} className="text-[12px] font-bold px-3.5 py-2 rounded-lg border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 inline-flex items-center gap-1.5"><Icon name="download" className="w-3.5 h-3.5" />.md</button>
              <button onClick={() => setView("form")} className="text-[12px] font-bold px-3.5 py-2 rounded-lg border border-stone-200 bg-white text-stone-600 hover:bg-stone-50">回答を編集</button>
              {genBtn("再生成")}
            </div>
          </div>
          {genErr && <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-[12px] px-4 py-3 mb-4">{genErr}</div>}
          <div className="wiz-md" dangerouslySetInnerHTML={{ __html: wizMdHtml(wiz.scaffold) }} />
        </div>
      )}

      {pourOpen && (
        <>
          <div className="fixed inset-0 z-[70] bg-black/40" onClick={() => setPourOpen(false)} />
          <div className="fixed z-[71] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(560px,92vw)] bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 pt-5">
              <div className="text-[15px] font-bold text-stone-800">構成台本に流し込む</div>
              <div className="text-[11.5px] text-stone-500 mt-1">骨のシーン割り {pourRows.length}行 を構成台本のシーン行に変換します。流し込んだ後も1行ずつ普通に編集できます。</div>
            </div>
            <div className="px-5 py-4">
              <div className="rounded-xl border border-stone-200 overflow-hidden text-[11.5px]">
                {[["時間帯", "ロケ地行（時間の区切り）"], ["シーン＋尺", "シーンラベル＋秒数＋タイプ自動判定"], ["演者に投げる質問", "原稿（◼︎ 質問行として）"], ["使う脳・狙い・訴求", "原稿末尾の ※演出メモ行"]].map(([f, to], i) => (
                  <div key={i} className={"flex items-center gap-2 px-3 py-2 " + (i ? "border-t border-stone-100" : "")}>
                    <span className="text-stone-500">{f}</span><span className="text-stone-300">→</span><span className="font-bold text-stone-700">{to}</span>
                  </div>
                ))}
              </div>
              {(project.rows || []).length > 0 && (
                <div className="flex gap-2 mt-3">
                  {[["append", "末尾に追記する", "いまの構成台本はそのまま"], ["replace", "丸ごと置き換える", "既存 " + (project.rows || []).length + " 行を消して骨だけにする"]].map(([k, l, s]) => (
                    <button key={k} onClick={() => setPourMode(k)}
                      className={"flex-1 text-left rounded-xl border px-3.5 py-2.5 " + (pourMode === k ? "" : "border-stone-200")}
                      style={pourMode === k ? { borderColor: theme.accent, background: "#FBE5EA44" } : {}}>
                      <div className="text-[12px] font-bold text-stone-800">{l}</div>
                      <div className="text-[10px] text-stone-400 mt-0.5">{s}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-stone-100">
              <button onClick={() => setPourOpen(false)} className="text-[12px] font-bold px-4 py-2 rounded-lg border border-stone-200 text-stone-500 bg-white">やめる</button>
              <button onClick={doPour} className="text-[12px] font-bold px-5 py-2 rounded-lg text-white" style={{ background: theme.accent }}>{pourRows.length}行を流し込む</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function App() {
  const [index, setIndex] = useState([]);       // [{id,name,createdAt}]
  const [activeId, setActiveId] = useState(null);
  const [project, setProject] = useState(null);  // 現在編集中の案件データ
  const [channelInfo, setChannelInfo] = useState({}); // {channelName: {name,url,concept,target,purpose,competitors[]}}
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState("");
  const [hoverId, setHoverId] = useState(null);
  const [highlightCollapsed, setHighlightCollapsed] = useState(false);
  const [deliverBusy, setDeliverBusy] = useState(false);
  const [saveState, setSaveState] = useState("ok");   // ok | error（クラウド保存の状態。回線断のsilent lost可視化）
  const [showTheme, setShowTheme] = useState(false);
  const [tab, setTab] = useState("overview"); // overview | plan | script | kouban | assets | review | deliver | concept
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [showFullImport, setShowFullImport] = useState(false);
  const [fullImportText, setFullImportText] = useState("");
  const [aiParsing, setAiParsing] = useState(false);
  const [importTarget, setImportTarget] = useState("new"); // "new" = 新規案件 / "current" = 開いている案件を更新
  const [importFileName, setImportFileName] = useState("");
  const importFileRef = useRef(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => { try { return window.self === window.top; } catch (e) { return true; } });  // Fボード埋め込み時は初期閉じ（左ツリーとダブらせない）
  const [user, setUser] = useState(null);                   // ログイン中のGoogleユーザー（null=未ログイン）
  const [showAccount, setShowAccount] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const gbtnRef = useRef(null);
  const [showAssistant, setShowAssistant] = useState(false);
  const [assistantText, setAssistantText] = useState("");
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantSummary, setAssistantSummary] = useState("");
  const [showReview, setShowReview] = useState(false);      // 校正チェックモーダル
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewResult, setReviewResult] = useState(null);   // { issues:[], summary } | null
  const [chatOpen, setChatOpen] = useState(false);          // AIチャットパネル開閉
  // AIチャットは塩漬け中：本番は非表示。検証時は localStorage.setItem("mg:aiChat","1") で表示
  const aiChatEnabled = (() => { try { return window.localStorage.getItem("mg:aiChat") === "1"; } catch (e) { return false; } })();
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatProposal, setChatProposal] = useState(null);   // AIの変更提案（承認待ち）
  const [chatUndo, setChatUndo] = useState(null);           // 反映直前の台本スナップ（取り消し用）
  const chatEndRef = useRef(null);
  const [flashId, setFlashId] = useState(null);             // ジャンプ先シーンの一時ハイライト
  const [editHeaderChannel, setEditHeaderChannel] = useState(false); // ヘッダーからカテゴリ変更中
  const [newMenu, setNewMenu] = useState(false);           // 新規案件のタイプ選択
  const [shareMenu, setShareMenu] = useState(false);       // 共有ボタンのメニュー（発行/台本コピー）
  const [shareMore, setShareMore] = useState(false);       // 共有メニュー「その他」の折りたたみ
  const [aiMenu, setAiMenu] = useState(false);             // AIボタンのメニュー（校正/反映）
  const [thumbTest, setThumbTest] = useState(null);        // サムネ目立ちテスト {pid, keyword, myImage, items[], myPos, busy, reveal}
  const [thumbPick, setThumbPick] = useState({});          // {pid: idx} 目立ちテストの対象サムネ（既定=最初の非空）
  const [caseSearch, setCaseSearch] = useState("");        // 全案件横断検索クエリ
  const [searchHits, setSearchHits] = useState(null);      // null=閉, []=ヒットなし, [...]=結果
  const [selAssets, setSelAssets] = useState([]);          // 素材管理: 複数選択DL用の選択id配列
  const [dragCat, setDragCat] = useState(null);            // 素材管理: ドラッグ＆ドロップ中のカテゴリ
  const [renamingAsset, setRenamingAsset] = useState(null); // 素材管理: 名前変更中の素材id

  /* Finderからのドロップがドロップ枠を外れた時にブラウザがファイルを開いて画面ごと飛ぶ事故を防ぐ。
     枠内のonDropはターゲット側が先に処理するのでこのガードと共存できる。 */
  useEffect(() => {
    const guard = (e) => { if (Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes("Files")) e.preventDefault(); };
    window.addEventListener("dragover", guard);
    window.addEventListener("drop", guard);
    return () => { window.removeEventListener("dragover", guard); window.removeEventListener("drop", guard); };
  }, []);
  const searchIndexRef = useRef({});                       // {id: 検索インデックス}（前計算キャッシュ）
  const [ctxMenu, setCtxMenu] = useState(null);            // サイドバー チャンネル右クリックメニュー {channel,x,y}
  const [iconPick, setIconPick] = useState(null);          // チャンネルアイコン選択ポップオーバー {channel,x,y}
  const [addMenu, setAddMenu] = useState(null);            // 案件追加のタイプ選択 {channel,x,y}
  const [chShareMenu, setChShareMenu] = useState(null);    // チャンネル共有の種類選択（読取専用/編集つき）{channel,x,y}
  const [view, setView] = useState("home");                // "home"(入口・一覧) | "editor"(案件編集)
  // チャンネル単位の編集者ライブモード（index.html?ch=… ＝ログイン不要で当該クライアントの案件だけ・全タブ直接編集）
  const [chanLive, setChanLive] = useState(null);          // {id,name,channelInfo,cases:[{id,name,format,edit:{liveId,editToken}}]}
  const [chanActiveCase, setChanActiveCase] = useState(null); // chanLive中に開いている案件id（サイドバー強調用）
  // 編集者向けヘルプAIチャット（使い方サポート＋意見収集→Discord）
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpMsgs, setHelpMsgs] = useState([]);            // [{role:"user"|"assistant", content, logged?}]
  const [helpInput, setHelpInput] = useState("");
  const [helpBusy, setHelpBusy] = useState(false);
  const [showInvite, setShowInvite] = useState(false);     // 共同編集の招待モーダル
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [renamingId, setRenamingId] = useState(null);
  const [channelEditId, setChannelEditId] = useState(null); // チャンネル変更中の案件id（新規フォルダ名の入力用）
  const [chanMenu, setChanMenu] = useState(null);          // 案件のチャンネル移動ドロップダウン {id, channel, x, y}
  const [caseMenu, setCaseMenu] = useState(null);          // 案件行の右クリックメニュー {id, channel, x, y}
  const [rowMenu, setRowMenu] = useState(null);             // 構成テーブル行の右クリックメニュー {id, idx, kind, sceneType, x, y}
  const [collapsed, setCollapsed] = useState({});           // {channel: true} で折りたたみ
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [dragIds, setDragIds] = useState(null);             // 複数行ドラッグ中のid配列
  const [dragCaseId, setDragCaseId] = useState(null);        // サイドバー：ドラッグ中の案件id
  const [dragOverCaseId, setDragOverCaseId] = useState(null); // サイドバー：ドラッグ先の案件id
  const [selectedIds, setSelectedIds] = useState([]);       // 複数選択中の行id
  const [painting, setPainting] = useState(false);          // チェック欄ドラッグ選択中
  const [isNarrow, setIsNarrow] = useState(false);          // スマホ幅（操作列を隠す等）
  const lastSelRef = useRef(null);                          // shift範囲選択の起点
  /* ヒアリング：文字起こし取込 */
  const [hearingImport, setHearingImport] = useState(null); // { raw } モーダル開いてる時 or null
  const [hearingBusy, setHearingBusy] = useState(false);
  /* 共有・コメント */
  const [shareModal, setShareModal] = useState(null);       // {url, id} or null
  const [showHandoffEdit, setShowHandoffEdit] = useState(false); // 受け渡しプリセットのカスタマイズモーダル
  const [handoffs, setHandoffs] = useState(() => {          // 相手別の受け渡しプリセット（リンク＋文面）。mg:handoff に保存
    try { const s = localStorage.getItem(HANDOFF_KEY); if (s) { const a = JSON.parse(s); if (Array.isArray(a) && a.length) return a; } } catch (e) {}
    return HANDOFF_DEFAULTS.map((h) => ({ ...h, tabs: [...h.tabs] }));
  });
  const saveHandoffs = (next) => { setHandoffs(next); try { localStorage.setItem(HANDOFF_KEY, JSON.stringify(next)); } catch (e) {} };
  const [sharing, setSharing] = useState(false);
  const [chSharing, setChSharing] = useState(false);        // チャンネル丸ごと共有の発行中
  const [comments, setComments] = useState([]);             // 現案件の先方コメント
  const [showComments, setShowComments] = useState(false);
  const saveTimer = useRef(null);
  const pendingSaveRef = useRef(null);   // クラウド保存に失敗したデータ。オンライン復帰で自動再送（silent lost根絶）
  const liveWS = useRef(null);          // リアルタイム編集の WebSocket
  const lastRemoteRef = useRef("");     // 直近に受信した project JSON（自分の送信エコー抑止）
  const liveSendTimer = useRef(null);
  /* 動画確認＋ファイル転送 */
  const [showMediaModal, setShowMediaModal] = useState(false); // 動画/ファイル登録モーダル
  const [mediaTarget, setMediaTarget] = useState("project");   // 動画/ファイルの対象 "project"|planId
  const [ytInput, setYtInput] = useState("");                // YouTube URL入力
  const [retention, setRetention] = useState(90);            // アップロードの保存期限（日）。0=無期限
  const [mediaBusy, setMediaBusy] = useState("");            // アップロード中の表示メッセージ
  const [mediaProg, setMediaProg] = useState(0);             // アップロード進捗 0-100
  const [assetUp, setAssetUp] = useState(null);              // 素材管理のアップ進捗 {cat, name, pct}
  const [thumbUp, setThumbUp] = useState(null);               // 納品完了タブのサムネ画像アップ進捗 {pct}
  const [thumbDropOver, setThumbDropOver] = useState(false);   // 納品完了タブのサムネ画像D&D中フラグ
  const shareUpTokRef = useRef("");                          // 編集者用アップロードトークン（&up=）。publish応答から取得
  const shareReadTokRef = useRef("");                        // 閲覧用トークン（&r=）。新方式snapの共有URLに必須。publish応答から取得
  const shareTokenRef = useRef("");                          // 直近publishのshareToken。setProjectが非同期なのでアップ直後に最新tokenを引くため
  const [globalManuals, setGlobalManuals] = useState([]);    // 全体の決め事（スタジオ共通）
  const [sched, setSched] = useState(null);                  // Flip Board(D1正本)から引いた日程スライス＝編集者ビューの進行ストリップ。読み取り専用
  const [board, setBoard] = useState(null);                  // Flip Board(D1)全案件の進行ボード＝ホームの可視化。読み取り専用
  const [boardAll, setBoardAll] = useState(false);           // 進行ボード：全件 ⇔ このチャンネルだけ
  const [boardDone, setBoardDone] = useState(false);          // 進行ボード：納品済の折りたたみ
  const [showManual, setShowManual] = useState(false);       // マニュアルモーダル
  const [manualScope, setManualScope] = useState("case");    // global | channel | case

  /* フォント */
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700;900&family=IBM+Plex+Mono:wght@400;600;700&display=swap";
    document.head.appendChild(link);
  }, []);

  /* 開いている案件＋タブを記憶（次回ロードで復元）。ホームに居る時は消す＝ホームでの⌘Rはホーム維持 */
  useEffect(() => {
    if (!loaded) return;
    try {
      if (view === "editor" && activeId) localStorage.setItem("mg:lastView", JSON.stringify({ id: activeId, tab }));
      else if (view === "home") localStorage.removeItem("mg:lastView");
    } catch (e) {}
  }, [view, activeId, tab, loaded]);

  /* index取得 → なければ旧データ移行 or 新規作成。ログイン/ログアウト後にも再実行する */
  const loadAll = async () => {
    try {
      if (typeof window.storage === "undefined") { setLoaded(true); return; }
      try { const cr = await window.storage.get(STORE_CHANNELS); setChannelInfo(cr && cr.value ? JSON.parse(cr.value) : {}); }
      catch (e) { if (e && e.code === 401) throw e; }
      let idx = null;
      try { const r = await window.storage.get(STORE_INDEX); idx = r && r.value ? JSON.parse(r.value) : null; }
      catch (e) { if (e && e.code === 401) throw e; }

      if (!idx || !idx.length) {
        // 旧単一データがあれば1案件として移行
        let migrated = null;
        try {
          const old = await window.storage.get(STORAGE_KEY);
          if (old && old.value) {
            const p = migrate(JSON.parse(old.value));
            migrated = { ...newProjectData("（移行）案件1"), ...p, id: uid(), name: "案件1" };
          }
        } catch (e) {}
        const first = migrated || newProjectData("案件1");
        idx = [{ id: first.id, name: first.name, channel: first.channel || DEFAULT_CHANNEL, createdAt: first.createdAt }];
        await window.storage.set(STORE_PROJ(first.id), JSON.stringify(first));
        await window.storage.set(STORE_INDEX, JSON.stringify(idx));
        setIndex(idx); setActiveId(first.id); setProject(first);
        setLoaded(true);
        return;
      }

      // 既存indexにchannelが無ければ補完
      idx = idx.map((x) => ({ ...x, channel: x.channel || DEFAULT_CHANNEL }));
      setIndex(idx);
      // Fボード制作モードからの案件指定（?case=<projectId|shareId>）を最優先で開く（PHASE1接続版）
      let urlCase = null;
      try { urlCase = new URLSearchParams(location.search).get("case"); } catch (e) {}
      if (urlCase) {
        let hitId = idx.some((x) => x.id === urlCase) ? urlCase : null;
        if (!hitId) {
          // shareId→projectId はキャッシュ(mg:shareMap)を先に見る。無ければ全案件を走査して逆引き
          let map = {};
          try { map = JSON.parse(localStorage.getItem("mg:shareMap") || "{}"); } catch (e) {}
          if (map[urlCase] && idx.some((x) => x.id === map[urlCase])) hitId = map[urlCase];
          else {
            for (const x of idx) {
              try {
                const rr = await window.storage.get(STORE_PROJ(x.id));
                const pd = rr && rr.value ? JSON.parse(rr.value) : null;
                if (pd && pd.shareId === urlCase) { hitId = x.id; map[urlCase] = x.id; try { localStorage.setItem("mg:shareMap", JSON.stringify(map)); } catch (e) {} break; }
              } catch (e) {}
            }
          }
        }
        if (hitId) {
          const rr = await window.storage.get(STORE_PROJ(hitId));
          const data = rr && rr.value ? migrateProject(JSON.parse(rr.value)) : null;
          if (data) { setActiveId(hitId); setProject(data); setView("editor"); setLoaded(true); return; }
        }
      }
      // 直前に開いていた案件＋タブを復元（⌘R/リロードでホームに戻さない）
      let lastView = null;
      try { lastView = JSON.parse(localStorage.getItem("mg:lastView") || "null"); } catch (e) {}
      const wantId = (lastView && lastView.id && idx.some((x) => x.id === lastView.id)) ? lastView.id : idx[0].id;
      const r = await window.storage.get(STORE_PROJ(wantId));
      const data = r && r.value ? migrateProject(JSON.parse(r.value)) : newProjectData((idx.find((x) => x.id === wantId) || idx[0]).name);
      setActiveId(wantId); setProject(data);
      if (lastView && lastView.id === wantId) { if (lastView.tab) setTab(lastView.tab); setView("editor"); }
    } catch (e) {
      if (e && e.code === 401) { doLogoutLocal(); return loadAll(); } // セッション切れ→ローカルに戻す
      console.error(e);
    }
    // どの経路でも project が無いまま終わらない（「読み込み中…」固着を防ぐ）
    setProject((p) => p || newProjectData("案件1"));
    setLoaded(true);
  };

  /* ログイン状態をクリアしてローカルストレージに戻す（再ロードは呼び出し側） */
  const doLogoutLocal = () => {
    MG_SESSION = null; setUser(null);
    try { localStorage.removeItem(AUTH_TOKEN_KEY); localStorage.removeItem(AUTH_USER_KEY); } catch (e) {}
    setActiveStorage(false);
  };

  /* 初回ログイン時：クラウドが空ならローカル案件を引っ越す */
  const migrateLocalToCloudIfEmpty = async () => {
    try {
      const r = await cloudStorage.list("");
      if ((r.keys || []).some((k) => k === STORE_INDEX)) return; // 既にクラウドに案件あり
      let lidx = null;
      try { const x = await LOCAL_STORAGE_SHIM.get(STORE_INDEX); lidx = x && x.value ? JSON.parse(x.value) : null; } catch (e) {}
      if (!lidx || !lidx.length) return;
      for (const it of lidx) {
        try { const p = await LOCAL_STORAGE_SHIM.get(STORE_PROJ(it.id)); if (p && p.value) await cloudStorage.set(STORE_PROJ(it.id), p.value); } catch (e) {}
      }
      await cloudStorage.set(STORE_INDEX, JSON.stringify(lidx));
      showToast("この端末の案件をクラウドに移行しました");
    } catch (e) {}
  };

  /* Googleの資格情報(JWT) → Worker でセッション発行 → クラウド同期へ切替 */
  const handleGoogleCredential = async (credential) => {
    if (!credential) return;
    setAuthBusy(true);
    try {
      const res = await fetch(SHARE_API + "/api/auth/google", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credential }),
      });
      const d = await res.json();
      if (!res.ok || !d.token) throw new Error(d.error || "ログインに失敗しました");
      MG_SESSION = d.token; setUser(d.user);
      try { localStorage.setItem(AUTH_TOKEN_KEY, d.token); localStorage.setItem(AUTH_USER_KEY, JSON.stringify(d.user)); } catch (e) {}
      setActiveStorage(true);
      await migrateLocalToCloudIfEmpty();
      setLoaded(false); await loadAll();
      setShowAccount(false);
      showToast("ログインしました：" + (d.user.name || ""));
    } catch (e) {
      showToast("ログイン失敗：" + (e.message || e));
    } finally { setAuthBusy(false); }
  };

  const logout = async () => {
    try { if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect(); } catch (e) {}
    doLogoutLocal();
    setLoaded(false); await loadAll();
    setShowAccount(false);
    showToast("ログアウトしました（この端末のローカルデータに戻りました）");
  };

  /* 初期読み込み：保存済みログインを復元してから読み込む */
  useEffect(() => {
    (async () => {
      try {
        const t = localStorage.getItem(AUTH_TOKEN_KEY), us = localStorage.getItem(AUTH_USER_KEY);
        if (t && us) { MG_SESSION = t; setUser(JSON.parse(us)); setActiveStorage(true); }
      } catch (e) {}
      // 編集用リンク（?live=）はライブセッションに直行（loadAllしない）
      const sp = new URLSearchParams(location.search);
      const liveId = sp.get("live");
      if (liveId) {
        const hp = new URLSearchParams((location.hash || "").replace(/^#/, ""));
        startLiveSession(liveId, hp.get("k") || "");
        return;
      }
      // チャンネル編集リンク（?ch=）：ログイン不要・当該クライアントの案件一覧モード
      const chId = sp.get("ch");
      if (chId) { await startChannelLive(chId); return; }
      await loadAll();
    })();
  }, []);

  /* アカウントモーダルを開いたら Googleボタンを描画 */
  useEffect(() => {
    if (!showAccount || user || !GOOGLE_CLIENT_ID) return;
    let tries = 0;
    const t = setInterval(() => {
      if (window.google && google.accounts && google.accounts.id) {
        clearInterval(t);
        try {
          google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: (resp) => handleGoogleCredential(resp.credential) });
          if (gbtnRef.current) { gbtnRef.current.innerHTML = ""; google.accounts.id.renderButton(gbtnRef.current, { theme: "outline", size: "large", shape: "pill", text: "signin_with", locale: "ja" }); }
        } catch (e) {}
      } else if (++tries > 50) clearInterval(t);
    }, 100);
    return () => clearInterval(t);
  }, [showAccount, user]);

  /* 案件本体の自動保存（live時はDOへ送信、それ以外はローカル/クラウド保存） */
  useEffect(() => {
    if (!loaded || !project) return;
    if (project.live) {
      const js = JSON.stringify(cleanProj(project));
      if (js === lastRemoteRef.current) return; // 受信直後の状態はエコー送信しない
      clearTimeout(liveSendTimer.current);
      liveSendTimer.current = setTimeout(() => {
        try { if (liveWS.current && liveWS.current.readyState === 1) liveWS.current.send(JSON.stringify({ t: "full", project: cleanProj(project) })); } catch (e) {}
      }, 400);
      return () => clearTimeout(liveSendTimer.current);
    }
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      // クラウド保存の成否を握る。失敗したら pendingSaveRef に退避して「未保存」表示＋裏で再送し続ける。
      const ok = await saveProjectData(project);
      if (ok === false) { pendingSaveRef.current = project; setSaveState("error"); }
      else { pendingSaveRef.current = null; setSaveState("ok"); }
    }, 700);
    return () => clearTimeout(saveTimer.current);
  }, [project, loaded]);

  /* クラウド保存の失敗を自動リトライ（8秒毎＋オンライン復帰イベントで即再送）。回線断でも黙って消えない。 */
  useEffect(() => {
    const retry = async () => {
      const p = pendingSaveRef.current;
      if (!p) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      const ok = await saveProjectData(p);
      if (ok !== false) { pendingSaveRef.current = null; setSaveState("ok"); }
    };
    const id = setInterval(retry, 8000);
    if (typeof window !== "undefined") window.addEventListener("online", retry);
    return () => { clearInterval(id); if (typeof window !== "undefined") window.removeEventListener("online", retry); };
  }, []);

  /* 共有スナップの自動再発行：素材/動画/構成などを変えたら、既存の共有リンクを裏で最新化する。
     ＝「押し直し忘れで共有URLに出てこない」を構造的に撲滅（URLもトークンも不変・副作用なし）。 */
  const republishTimer = useRef(null);
  const lastPubSig = useRef(null);
  useEffect(() => {
    if (!loaded || !project) return;
    if (!project.shareId || !project.shareToken || project.collab) return; // 未共有/権限なしは対象外
    // 共有に出る"中身"だけを指紋化（共有/ライブ系フィールドは除外＝再発行で自分が再発火するループを防ぐ）。
    // 台本テキストの編集も含めて常に最新を反映する。4秒デバウンスでKVレート(1書込/秒)も安全。
    const { shareId, shareToken, shareUpToken, live, liveId, liveToken, collab, collabRole, members, ownerEmail, ...contentSig } = project;
    const sig = JSON.stringify(contentSig);
    if (lastPubSig.current === null) { lastPubSig.current = sig; return; } // 初回ロード/リンク発行直後は送らない
    if (sig === lastPubSig.current) return;
    lastPubSig.current = sig;
    clearTimeout(republishTimer.current);
    republishTimer.current = setTimeout(() => { publishShare(true).catch(() => {}); }, 4000); // サイレント＝AKは意識しない
    return () => clearTimeout(republishTimer.current);
  }, [project, loaded]);

  /* チャンネルコンセプトの自動保存 */
  const chSaveTimer = useRef(null);
  useEffect(() => {
    if (!loaded) return;
    clearTimeout(chSaveTimer.current);
    chSaveTimer.current = setTimeout(async () => {
      try { if (typeof window.storage !== "undefined") await window.storage.set(STORE_CHANNELS, JSON.stringify(channelInfo)); }
      catch (e) { console.error("チャンネル保存エラー", e); }
    }, 700);
    return () => clearTimeout(chSaveTimer.current);
  }, [channelInfo, loaded]);

  /* 共同編集案件をサイドバーにマージ（ログイン状態に追従） */
  useEffect(() => {
    if (!loaded) return;
    if (!user) { setIndex((cur) => cur.filter((x) => !x.collab)); return; }
    loadCollab().then((collab) => setIndex((cur) => [...cur.filter((x) => !x.collab), ...collab]));
  }, [loaded, user]);

  /* 全体の決め事（マニュアル）をロード／保存。window.storage＝ログイン時クラウド同期 */
  useEffect(() => {
    if (!loaded) return;
    (async () => { try { const r = await window.storage.get(STORE_MANUALS_GLOBAL); if (r && r.value) setGlobalManuals(JSON.parse(r.value)); } catch (e) {} })();
  }, [loaded, user]);
  /* 決め事(確定ルール)をFlip-LABへ同期（会話AI・共有ビューが引ける固定事実に）。案件スコープは一時的なので送らない。 */
  const syncRulesToLab = (channel, entries) => {
    try {
      if (!project.shareId || !project.shareToken || !channel) return; // 未発行なら送れない（発行後の編集で反映）
      const text = (entries || []).map((m) => `【${m.cat || ""}】${(m.title || "").trim()}\n${(m.body || "").trim()}`.trim()).filter(Boolean).join("\n\n");
      fetch(SHARE_API + "/api/lab-rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ snap: project.shareId, token: project.shareToken, channel, text }) }).catch(() => {});
    } catch (e) {}
  };
  const saveGlobalManuals = (next) => { setGlobalManuals(next); try { window.storage.set(STORE_MANUALS_GLOBAL, JSON.stringify(next)); } catch (e) {} syncRulesToLab("編集マニュアル", next); };
  const setChannelManuals = (next) => { updateChannelInfo({ manuals: next }); syncRulesToLab(project.channel || DEFAULT_CHANNEL, next); };
  const setCaseManuals = (next) => setProject((p) => ({ ...p, manuals: next }));

  /* 現在の案件のチャンネルのコンセプト情報を取得／更新 */
  const curChannel = project ? (project.channel || DEFAULT_CHANNEL) : DEFAULT_CHANNEL;
  const curChannelInfo = { ...emptyChannelInfo(), name: curChannel, ...(channelInfo[curChannel] || {}) };
  const updateChannelInfo = (patch) => setChannelInfo((ci) => ({ ...ci, [curChannel]: { ...emptyChannelInfo(), name: curChannel, ...(ci[curChannel] || {}), ...patch } }));
  const setCompetitors = (updater) => updateChannelInfo({ competitors: typeof updater === "function" ? updater(curChannelInfo.competitors || []) : updater });
  const addCompetitor = () => setCompetitors((cs) => [...(cs || []), emptyCompetitor()]);
  const removeCompetitor = (i) => setCompetitors((cs) => (cs || []).filter((_, k) => k !== i));
  const updateCompetitor = (i, patch) => setCompetitors((cs) => (cs || []).map((c, k) => (k === i ? { ...c, ...patch } : c)));
  const [compBusy, setCompBusy] = useState({});
  const fetchCompetitor = async (i, urlOrName) => {
    const v = (urlOrName || "").trim(); if (!v) return;
    setCompBusy((b) => ({ ...b, [i]: true }));
    try {
      const res = await fetch(SHARE_API + "/api/ytchannel?u=" + encodeURIComponent(v));
      const d = await res.json();
      if (d.needKey) { showToast("YouTube APIキーが未設定"); updateCompetitor(i, { url: v }); return; }
      if (!res.ok || d.error) throw new Error(d.error || "取得失敗");
      updateCompetitor(i, { url: v, channelId: d.channelId, name: d.name, subs: d.subs, videos: d.videos, views: d.views, thumb: d.thumb });
    } catch (e) {
      showToast("チャンネル取得に失敗：" + (e.message || e));
      updateCompetitor(i, { url: v });
    } finally {
      setCompBusy((b) => { const n = { ...b }; delete n[i]; return n; });
    }
  };

  /* indexの保存 */
  const persistIndex = async (idx) => {
    // 共同編集(collab)案件はクラウドの collab ストアが正本なので個人indexには保存しない
    try { if (typeof window.storage !== "undefined") await window.storage.set(STORE_INDEX, JSON.stringify((idx || []).filter((x) => !x.collab))); }
    catch (e) { console.error(e); }
  };

  /* 案件を正しい保存先へ（collabはWorker collabストア、それ以外は個人ストレージ） */
  // 戻り値: クラウド(collab)へ確実に保存できたら true / 失敗してローカル退避に留まったら false。
  // 呼び出し側が保存成否をユーザーに知らせられるように（回線断のsilent fail対策）。既存の呼び出しは戻り値を使わないので後方互換。
  const saveProjectData = async (data0) => {
    if (!data0) return true;
    const data = { ...data0, updatedAt: Date.now() };
    // collab かつログイン中のみクラウドへ。未ログイン(ログアウト後)は個人ストレージへフォールバック保存（silent fail防止）
    if (data.collab && MG_SESSION) {
      try { await authFetch("/api/collab/upsert", { id: data.id, project: data }); return true; }
      catch (e) { console.error("collab保存", e); try { await window.storage.set(STORE_PROJ(data.id), JSON.stringify(data)); } catch (_) {} return false; }
    } else {
      try { if (typeof window.storage !== "undefined") await window.storage.set(STORE_PROJ(data.id), JSON.stringify(data)); return true; } catch (e) { console.error(e); return false; }
    }
  };

  /* 共同編集案件の一覧を取得（ログイン時のみ） */
  const loadCollab = async () => {
    if (!MG_SESSION) return [];
    try {
      const r = await authFetch("/api/collab/list", {});
      return (r.projects || []).map((p) => ({ id: p.id, name: p.name || "案件", channel: p.channel || DEFAULT_CHANNEL, createdAt: 0, collab: true, ownerEmail: p.ownerEmail, role: p.role, members: p.members }));
    } catch (e) { return []; }
  };

  /* 個人案件を共同編集(collab)に昇格させる（初回招待時など） */
  const ensureCollab = async () => {
    if (!project) return null;
    if (project.collab) return { members: project.members || [], role: project.collabRole || "owner", ownerEmail: project.ownerEmail };
    const r = await authFetch("/api/collab/upsert", { id: project.id, project });
    try { if (typeof window.storage !== "undefined") await window.storage.delete(STORE_PROJ(project.id)); } catch (e) {}
    setProject((p) => ({ ...p, collab: true, collabRole: r.role, ownerEmail: r.ownerEmail, members: r.members }));
    setIndex((cur) => { const nx = cur.map((x) => (x.id === project.id ? { ...x, collab: true, role: r.role, ownerEmail: r.ownerEmail, members: r.members } : x)); persistIndex(nx); return nx; });
    return r;
  };
  const inviteMember = async () => {
    const em = inviteEmail.trim().toLowerCase();
    if (!em.includes("@")) { showToast("メールアドレスを確認してね"); return; }
    if (!user) { showToast("共有にはログインが必要だよ"); return; }
    setInviteBusy(true);
    try {
      await ensureCollab();
      const r = await authFetch("/api/collab/invite", { id: project.id, email: em });
      setProject((p) => ({ ...p, members: r.members }));
      setIndex((cur) => cur.map((x) => (x.id === project.id ? { ...x, members: r.members } : x)));
      setInviteEmail("");
      showToast(em + " を招待しました");
    } catch (e) { showToast("招待失敗：" + (e.message || e)); }
    finally { setInviteBusy(false); }
  };
  /* チャンネル（フォルダ）を丸ごと共有：コンセプト＋配下の全案件を1つのURLで公開
     editable=true なら案件ごとに live 編集リンクを発行/再シードし、先方がURLから全部編集できる（ログイン不要・リアルタイム反映） */
  const publishChannel = async (channel, editable = false) => {
    setChSharing(true);
    try {
      const ci = channelInfo[channel] || {};
      const entries = index.filter((x) => (x.channel || DEFAULT_CHANNEL) === channel);
      const projects = [];
      for (const x of entries) {
        let p = null;
        try {
          if (x.id === activeId && project) p = project;
          else if (x.collab) { const r = await authFetch("/api/collab/get", { id: x.id }); p = r.project ? { ...r.project, id: x.id, collab: true } : null; }
          else { const r = await window.storage.get(STORE_PROJ(x.id)); if (r && r.value) p = JSON.parse(r.value); }
        } catch (e) {}
        if (!p) continue;
        // 編集共有：案件ごとに live 文書を発行（既存があれば現在の内容で再シード）して編集リンクを得る
        if (editable) {
          try {
            const lr = await fetch(SHARE_API + "/api/live/create", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ project: { ...cleanProj(p), channelInfo: { ...ci, name: ci.name || channel } }, prevLiveId: p.liveId || null, editToken: p.liveToken || null }),
            });
            const ld = await lr.json();
            if (ld.liveId) {
              p = { ...p, liveId: ld.liveId, liveToken: ld.editToken };
              // live リンクを案件に永続化（AK と先方が同じ文書を共同編集できるように）
              if (x.id === activeId) setProject((cur) => (cur && cur.id === p.id ? { ...cur, liveId: ld.liveId, liveToken: ld.editToken } : cur));
              try {
                if (x.collab && MG_SESSION) await authFetch("/api/collab/upsert", { id: p.id, project: p });
                else if (typeof window.storage !== "undefined") await window.storage.set(STORE_PROJ(p.id), JSON.stringify(p));
              } catch (e) {}
            }
          } catch (e) {}
        }
        projects.push(p);
      }
      const res = await fetch(SHARE_API + "/api/publish-channel", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: channel, channelInfo: { ...ci, name: ci.name || channel }, projects, edit: editable, prevId: ci.shareId || null, token: ci.shareToken || null }),
      });
      const d = await res.json();
      if (!d.id) throw new Error(d.error || "発行に失敗しました");
      setChannelInfo((c) => ({ ...c, [channel]: { ...emptyChannelInfo(), name: channel, ...(c[channel] || {}), shareId: d.id, shareToken: d.token || (c[channel] && c[channel].shareToken), shareEditable: editable } }));
      // 編集つき＝本体アプリのチャンネル編集モード(index.html?ch=・案件一覧＋全タブ直接編集)、閲覧専用＝従来の共有ページ
      const base = location.origin + location.pathname.replace(/[^/]*$/, "");
      const url = base + (editable ? "index.html?ch=" : "share.html?ch=") + d.id;
      setShareModal({ id: d.id, url, updated: !!ci.shareId, channel: true, caseCount: projects.length, editable });
      try { await navigator.clipboard.writeText(url); } catch (e) {}
    } catch (e) { showToast("チャンネル共有の発行に失敗：" + (e.message || e)); }
    finally { setChSharing(false); }
  };

  /* チャンネル一覧からそのチャンネルを開く（最初の案件＋コンセプトタブ） */
  const openChannel = async (channel) => {
    const grp = channelGroups.find((g) => g.channel === channel);
    if (grp && grp.items[0]) { await switchProject(grp.items[0].id); setTab("plan"); }
    else { showToast("この中に案件がありません。「＋案件」から追加してね"); }
  };

  /* チャンネル名クリック → そのチャンネルの企画一覧（案件ボード）を開く */
  const openChannelBoard = async (channel) => {
    setView("editor");
    const items = index.filter((x) => (x.channel || DEFAULT_CHANNEL) === channel);
    if (project && (project.channel || DEFAULT_CHANNEL) === channel) { setTab("plan"); return; }
    if (items[0]) { await switchProject(items[0].id); setTab("plan"); }
    else { await createProject(true, channel, "talk"); setTab("plan"); }
  };

  const uninviteMember = async (email) => {
    if (!window.confirm(email + " を共有から外しますか？")) return;
    try {
      const r = await authFetch("/api/collab/uninvite", { id: project.id, email });
      setProject((p) => ({ ...p, members: r.members }));
      setIndex((cur) => cur.map((x) => (x.id === project.id ? { ...x, members: r.members } : x)));
    } catch (e) { showToast("失敗：" + (e.message || e)); }
  };

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(""), 2200); };

  /* ---- 案件操作 ---- */
  /* Fボード制作モードからのリロードなし案件切替（postMessage）。ページ遷移の再読込を無くす */
  useEffect(() => {
    const onMsg = async (e) => {
      if (e.origin !== "https://birdflip-app.pages.dev") return;
      const d = e.data || {};
      if (d.type !== "mg:open" || !d.case) return;
      const key = String(d.case);
      let hitId = index.some((x) => x.id === key) ? key : null;
      if (!hitId) {
        let map = {}; try { map = JSON.parse(localStorage.getItem("mg:shareMap") || "{}"); } catch (err) {}
        if (map[key] && index.some((x) => x.id === map[key])) hitId = map[key];
        else {
          for (const x of index) {
            try {
              const rr = await window.storage.get(STORE_PROJ(x.id));
              const pd = rr && rr.value ? JSON.parse(rr.value) : null;
              if (pd && pd.shareId === key) { hitId = x.id; map[key] = x.id; try { localStorage.setItem("mg:shareMap", JSON.stringify(map)); } catch (err) {} break; }
            } catch (err) {}
          }
        }
      }
      if (hitId) switchProject(hitId);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  });

  const switchProject = async (id) => {
    // チャンネル編集モード：storageでなく該当案件のライブセッションを開く
    if (chanLive) { const c = chanLive.cases.find((x) => x.id === id); if (c) { openChanCase(c); return; } }
    setView("editor");
    pushRecent(id);
    if (id === activeId) return;
    // 現在のを即保存（保留中のautosaveタイマーは止めて二重・古い書き込みを防ぐ）
    clearTimeout(saveTimer.current);
    if (project) await saveProjectData(project);
    const entry = index.find((x) => x.id === id);
    try {
      if (entry && entry.collab) {
        const r = await authFetch("/api/collab/get", { id });
        const data = { ...migrateProject(r.project), id, collab: true, collabRole: r.role, ownerEmail: r.ownerEmail, members: r.members };
        setActiveId(id); setProject(data); setTab("script");
      } else {
        const r = await window.storage.get(STORE_PROJ(id));
        const data = r && r.value ? migrateProject(JSON.parse(r.value)) : newProjectData("案件");
        setActiveId(id); setProject(data); setTab("script");
      }
    } catch (e) {
      if ((e && e.message) === "nf") { setBrokenIds((b) => ({ ...b, [id]: true })); showToast("この案件の本体データが見つかりません。企画一覧の右のゴミ箱から削除してください"); }
      else showToast("案件を開けませんでした：" + (e.message || e));
    }
  };

  /* ホームの案件カードから開く＝概要タブに着地（作業の入口） */
  const openCase = async (id) => { await switchProject(id); setTab("overview"); };

  const createProject = async (template = true, channel = DEFAULT_CHANNEL, format = "documentary") => {
    const n = index.length + 1;
    const data = newProjectData((format === "talk" ? "トーク案件" : "案件") + n, channel, format);
    if (!template && format !== "talk") data.rows = [];
    // 本体を先に確定させ、書けたときだけ index に載せる（回線切れで本体だけ欠ける“幽霊案件”を作らない）
    try {
      if (project) await saveProjectData(project);
      await window.storage.set(STORE_PROJ(data.id), JSON.stringify(data));
    } catch (e) { showToast("案件を保存できませんでした（通信）。回線を確認してもう一度お試しください"); return; }
    const idx = [...index, { id: data.id, name: data.name, channel: data.channel, createdAt: data.createdAt }];
    setIndex(idx); persistIndex(idx);
    setActiveId(data.id); setProject(data); setTab("overview"); setView("editor");
    setNewMenu(false); setView("editor");
    showToast(format === "talk" ? "トーク台本を作成しました" : "案件を作成しました");
  };

  /* 解析済みデータから新規案件を作成（共通） */
  const createCaseFromParsed = async (parsed) => {
    const n = index.length + 1;
    const base = newProjectData(parsed.name || ("取込案件" + n), parsed.channel || DEFAULT_CHANNEL);
    const data = { ...base, meta: parsed.meta, theme: parsed.theme, rate: parsed.rate, timeFormat: parsed.timeFormat, rows: parsed.rows, plans: seedPlansFromMeta(parsed.meta) };
    if (project) await saveProjectData(project);
    // 本体が書けたときだけ index に載せる（“幽霊案件”防止）
    try { await window.storage.set(STORE_PROJ(data.id), JSON.stringify(data)); } catch (e) { showToast("取込案件を保存できませんでした（通信）。もう一度お試しください"); return; }
    const idx = [...index, { id: data.id, name: data.name, channel: data.channel, createdAt: data.createdAt }];
    setIndex(idx); persistIndex(idx);
    setActiveId(data.id); setProject(data); setTab("script"); setView("editor");
    setShowFullImport(false); setFullImportText(""); setImportFileName("");
    showToast(parsed.rows.filter((r) => r.kind === "scene").length + "シーンを新規案件として取り込みました");
  };

  /* 解析済みデータで「今開いている案件」を上書き更新（id・名前・共有リンクは保持） */
  const updateCurrentFromParsed = async (parsed, opts = {}) => {
    if (!project) { showToast("更新対象の案件がありません"); return; }
    const before = (project.rows || []).filter((r) => r.kind === "scene").length;
    const after = parsed.rows.filter((r) => r.kind === "scene").length;
    if (!opts.skipConfirm && !window.confirm("「" + project.name + "」の構成を、取り込んだ内容で上書き更新します。\n" + before + "シーン → " + after + "シーン。\n（案件名・チャンネル・共有リンクはそのまま）\n\nよろしいですか？")) return;
    const m = parsed.meta || {};
    const meta = { ...project.meta };
    if (m.shootDate) meta.shootDate = m.shootDate;
    if (m.place) meta.place = m.place;
    if (m.highlight) meta.highlight = m.highlight;
    if (m.titles && m.titles.some(Boolean)) meta.titles = m.titles;
    if (m.thumbs && m.thumbs.some(Boolean)) meta.thumbs = m.thumbs;
    const plans = ((m.titles && m.titles.some(Boolean)) || (m.thumbs && m.thumbs.some(Boolean)))
      ? applyTitlesToPlans(project.plans, m.titles, m.thumbs) : project.plans;
    const data = { ...project, meta, rate: parsed.rate || project.rate, timeFormat: parsed.timeFormat || project.timeFormat, rows: parsed.rows, plans };
    setProject(data);
    await saveProjectData(data); // collab/個人を正しく振り分けて確実に保存
    const idx = index.map((x) => (x.id === data.id ? { ...x, name: data.name, channel: data.channel } : x));
    setIndex(idx); persistIndex(idx);
    setShowFullImport(false); setFullImportText(""); setImportFileName("");
    showToast(after + "シーンで「" + data.name + "」を更新しました");
  };

  /* 取込先（新規 / 現案件）に応じて振り分け */
  const dispatchParsed = async (parsed, opts = {}) => {
    if (importTarget === "current") await updateCurrentFromParsed(parsed, opts);
    else await createCaseFromParsed(parsed);
  };
  /* 更新モードの上書き確認（重い処理の前に1回だけ聞く） */
  const confirmUpdateIfNeeded = () => {
    if (importTarget !== "current" || !project) return true;
    return window.confirm("「" + project.name + "」の構成を、取り込んだ内容で上書き更新します。\n（案件名・チャンネル・共有リンクはそのまま）\n\nよろしいですか？");
  };

  /* AIアシスタント：貼られた生メッセージ(LINE/メモ/指示)を現案件に反映 */
  const runAssistant = async () => {
    const msg = assistantText.trim();
    if (!msg || !project) return;
    setAssistantBusy(true); setAssistantSummary("");
    try {
      const res = await fetch(SHARE_API + "/api/assist", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, message: msg }),
      });
      const d = await res.json();
      if (!res.ok || !d.project) throw new Error(d.error || "反映に失敗しました");
      const parsed = normalizeImport(d.project);
      // 既存の地図リンク・撮影完了フラグはロケ名で引き継ぐ（AI更新で消さない）
      const prevByLabel = {};
      (project.rows || []).forEach((r) => { if (r.kind === "location") prevByLabel[(r.label || "").trim()] = r; });
      const rows = parsed.rows.map((r) => {
        if (r.kind !== "location") return r;
        const prev = prevByLabel[(r.label || "").trim()];
        if (!prev) return r;
        const out = { ...r };
        if (prev.done) out.done = true;
        if ((prev.address || "").trim() === (r.address || "").trim() && (prev.placeId || prev.lat != null)) {
          out.placeId = prev.placeId || ""; out.lat = prev.lat ?? null; out.lng = prev.lng ?? null;
        }
        return out;
      });
      const m = parsed.meta || {};
      const meta = { ...project.meta };
      if (m.shootDate) meta.shootDate = m.shootDate;
      if (m.place) meta.place = m.place;
      if (m.highlight) meta.highlight = m.highlight;
      if (m.titles && m.titles.some(Boolean)) meta.titles = m.titles;
      if (m.thumbs && m.thumbs.some(Boolean)) meta.thumbs = m.thumbs;
      const plans = ((m.titles && m.titles.some(Boolean)) || (m.thumbs && m.thumbs.some(Boolean)))
        ? applyTitlesToPlans(project.plans, m.titles, m.thumbs) : project.plans;
      const data = { ...project, meta, rate: parsed.rate || project.rate, rows, plans };
      setProject(data);
      try { await window.storage.set(STORE_PROJ(data.id), JSON.stringify(data)); } catch (e) {}
      setAssistantSummary(d.summary || "構成台本に反映しました。");
      setAssistantText("");
      showToast("AIが構成台本に反映しました");
    } catch (e) {
      showToast("反映に失敗：" + (e.message || e));
    } finally { setAssistantBusy(false); }
  };

  /* 校正チェック（誤字脱字・質問と回答の逆転・未記入）をAIに依頼 */
  const runReview = async () => {
    if (!project) return;
    setReviewBusy(true); setReviewResult(null);
    try {
      const res = await fetch(SHARE_API + "/api/review", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "チェックに失敗しました");
      setReviewResult({ issues: Array.isArray(d.issues) ? d.issues : [], summary: d.summary || "" });
    } catch (e) {
      showToast("校正チェック失敗：" + (e.message || e));
      setReviewResult({ issues: [], summary: "", error: e.message || String(e) });
    } finally { setReviewBusy(false); }
  };

  /* 納品完了タブ：既存の構成台本からタイトル・概要欄・ハッシュタグ・目次を自動生成
     目次は台本の構造（ロケの実尺／トーク台本のtoc）からその場で作れるのでAIを介さず即時生成。
     タイトル/概要欄/ハッシュタグは原稿の中身を読む必要があるのでAIに依頼する。
     ※サムネ文言はサムネ画像そのものをアップする運用になったため納品完了からは廃止（2026-07-07）。
     動画・切り抜きショートのURLは下の別effectで動画確認の完成データから自動補完する。 */
  const generateDeliverAll = async () => {
    if (!project) return;
    // まず台本ベースの目次で即時に埋める（文字起こしがあれば後段で実尺TC版に置き換わる）
    const chapters = project.format === "talk"
      ? (project.talk && project.talk.toc || []).filter((t) => t && t.trim()).map((t, i) => (i + 1) + ". " + t).join("\n")
      : locations.filter((l) => l.scenes.length).map((l) => fmt(tcs[l.id] || 0) + " " + (l.label || "（無題のロケ）")).join("\n");
    setMeta("deliverChapters", chapters);
    setDeliverBusy(true);
    try {
      // 切り抜き生成時のWhisper文字起こし（完成動画の実尺TC付き）があれば目次の根拠に使う
      let transcript = null;
      if (project.shareId) {
        try {
          const tr = await fetch(SHARE_API + "/api/transcript/" + project.shareId + "?token=" + encodeURIComponent(project.shareToken || "")).then((r) => r.json());
          if (tr && Array.isArray(tr.segments) && tr.segments.length) transcript = tr.segments;
        } catch (e) {}
      }
      const res = await fetch(SHARE_API + "/api/deliver", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(transcript ? { project, transcript } : { project }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "生成に失敗しました");
      // 生成結果を1つのpatchに集約。setMeta（非同期反映）に頼らず、この場で確実にクラウド保存する。
      const patch = { deliverChapters: chapters, deliverTitle: d.title || "", deliverDescription: d.description || "", deliverHashtags: d.hashtags || "" };
      if (transcript && (d.chapters || "").trim()) patch.deliverChapters = d.chapters.trim();
      Object.entries(patch).forEach(([k, v]) => setMeta(k, v));
      // デバウンスautosaveを待たず即・明示保存（回線が飛んでも取りこぼさない）。失敗はloud-failでAKに知らせる。
      const merged = { ...project, meta: { ...project.meta, ...patch } };
      const saved = await saveProjectData(merged);
      // 文字起こしがまだ無ければMacエンジンにWhisperを依頼→出来次第、目次だけ実尺TC版へ自動差し替え
      const transcribing = !transcript && (await requestTranscriptChapters());
      showToast(saved === false
        ? "生成できたけど保存に失敗（オフラインかも）。電波のいい所でもう一度「自動生成」を押すか、手直しして保存し直して"
        : (transcript && (d.chapters || "").trim()
            ? "自動生成して保存しました（目次は完成動画の文字起こしから実尺で作成）"
            : transcribing
              ? "自動生成して保存しました。完成動画の文字起こしを開始したので、目次は数分後に実尺版へ自動で差し替わります"
              : "自動生成して保存しました（タイトル・概要欄・ハッシュタグ・目次）"));
    } catch (e) {
      showToast("自動生成に失敗：" + (e.message || e));
    } finally { setDeliverBusy(false); }
  };

  /* 完成動画のWhisper文字起こしをMacエンジンに依頼（kind:"transcribe"＝ショートは作らない）。
     出来上がったら目次(deliverChapters)だけ実尺TC版に差し替える。タイトル・概要欄の手直しは触らない。
     setMetaは関数型更新なので、待っている間にAKが他を編集していても上書き事故にならない。 */
  const requestTranscriptChapters = async () => {
    try {
      if (!project || !project.shareId) return false;
      const vers = ((project.review && project.review.versions) || []).filter((v) => !v.trashedAt && v.key);
      const videoKey = vers.length ? vers[vers.length - 1].key : "";
      if (!videoKey) return false;
      const snap = project.shareId, token = project.shareToken || "";
      const r = await fetch(SHARE_API + "/api/shorts/enqueue", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snap, token, videoKey, kind: "transcribe" }),
      }).then((x) => x.json());
      if (!r || !r.ok) return false;
      const projRef = project; // deliver再依頼用（台本内容は目次生成に影響しないので多少古くてもOK）
      const poll = async (tries) => {
        if (tries > 60) { showToast("文字起こしが終わらなかった（Mac側停止かも）。あとでもう一度「自動生成」を押して"); return; }
        let segs = null;
        try {
          const tr = await fetch(SHARE_API + "/api/transcript/" + snap + "?token=" + encodeURIComponent(token)).then((x) => x.json());
          if (tr && Array.isArray(tr.segments) && tr.segments.length) segs = tr.segments;
        } catch (e) {}
        if (!segs) { setTimeout(() => poll(tries + 1), 20000); return; }
        try {
          const res = await fetch(SHARE_API + "/api/deliver", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ project: projRef, transcript: segs }),
          });
          const d = await res.json();
          if (res.ok && (d.chapters || "").trim()) {
            setMeta("deliverChapters", d.chapters.trim());
            showToast("目次を完成動画の文字起こしから実尺で作り直しました");
          }
        } catch (e) {}
      };
      setTimeout(() => poll(0), 20000);
      return true;
    } catch (e) { return false; }
  };

  /* 納品完了動画・切り抜きショート：動画確認の完成データから自動補完。
     動画=最新版のオリジナルmp4のURL、ショート=たてがた君の生成結果。
     手入力（Drive/YouTubeのURL等）は一切触らない。自動で入れたURL（/api/file/…）は
     新しい版がアップされたら最新に追従して差し替える（古い版のURLを納品し続ける事故防止）。 */
  const isAutoFileUrl = (s) => (s || "").trim().startsWith(SHARE_API + "/api/file/");
  useEffect(() => {
    if (tab !== "deliver" || !project) return;
    const m0 = project.meta || {};
    const vers = ((project.review && project.review.versions) || []).filter((v) => !v.trashedAt && v.key);
    const latest = vers.length ? SHARE_API + "/api/file/" + vers[vers.length - 1].key : "";
    const curUrl = (m0.deliverVideoUrl || "").trim();
    if (latest && (!curUrl || (isAutoFileUrl(curUrl) && curUrl !== latest))) setMeta("deliverVideoUrl", latest);
    const curShorts = (m0.deliverShorts || "").trim();
    const shortsIsAuto = !curShorts || curShorts.split("\n").every((l) => !l.trim() || isAutoFileUrl(l));
    if (shortsIsAuto && project.shareId) {
      fetch(SHARE_API + "/api/shorts/list/" + project.shareId + "?token=" + encodeURIComponent(project.shareToken || ""))
        .then((r) => r.json())
        .then((d) => {
          const urls = ((d && d.shorts) || []).map((f) => SHARE_API + "/api/file/" + f.key);
          if (!urls.length) return;
          const next = urls.join("\n");
          // fetch中に手入力された可能性があるので反映直前にもう一度自動判定してから差し替え
          setProject((p) => {
            if (!p) return p;
            const cs = (((p.meta || {}).deliverShorts) || "").trim();
            const stillAuto = !cs || cs.split("\n").every((l) => !l.trim() || isAutoFileUrl(l));
            return stillAuto && cs !== next ? { ...p, meta: { ...p.meta, deliverShorts: next } } : p;
          });
        }).catch(() => {});
    }
  }, [tab, activeId, project && project.review && (project.review.versions || []).length]);

  /* 指摘の対象シーンへスクロール＋一時ハイライト */
  const jumpToRow = (rowId) => {
    if (!rowId) return;
    setTab("script");
    setShowReview(false);
    setTimeout(() => {
      const el = document.getElementById("row-" + rowId);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setFlashId(rowId);
      setTimeout(() => setFlashId((f) => (f === rowId ? null : f)), 2000);
    }, 60);
  };

  /* ===== 全案件 横断検索（インデックス方式）===== */
  /* 案件本体 → 検索インデックス1件を構築（小文字化済の干し草＋行テキストを前計算）。
     キーストローク毎の全行スキャンを避け、案件数が増えても重くならない。 */
  const buildSearchEntry = (id, d, fallbackName, fallbackChannel) => {
    const name = ((d && d.name) || fallbackName || "") + "";
    const channel = (d && d.channel) || fallbackChannel || DEFAULT_CHANNEL;
    const plans = (d && d.plans) || [];
    const plansDisplay = (plans[0] && (plans[0].title || plans[0].thumbText)) || name;
    const plansLC = plans.map((p) => (p.title || "") + " " + (p.thumbText || "")).join(" ").toLowerCase();
    const rows = ((d && d.rows) || []).map((r) => {
      const text = (r.kind === "location" ? (r.label || "") : (r.script || "")) + "";
      return { id: r.id, kind: r.kind, text, textLC: text.toLowerCase() };
    });
    return { id, name, channel, nameLC: name.toLowerCase(), plansLC, plansDisplay, rows, rowsBlobLC: rows.map((r) => r.textLC).join("\n") };
  };
  /* フォーカス時に未読込のローカル案件を読み込み→インデックス化（collabは名前のみ）。各案件1回だけ。 */
  const primeSearch = async () => {
    for (const x of index) {
      if (x.id === activeId || boardCache[x.id] || searchIndexRef.current[x.id]) continue;
      if (x.collab) { searchIndexRef.current[x.id] = buildSearchEntry(x.id, null, x.name, x.channel); continue; }
      try {
        const r = await window.storage.get(STORE_PROJ(x.id));
        const d = r && r.value ? migrateProject(JSON.parse(r.value)) : null;
        searchIndexRef.current[x.id] = buildSearchEntry(x.id, d, x.name, x.channel);
      } catch (e) { searchIndexRef.current[x.id] = buildSearchEntry(x.id, null, x.name, x.channel); }
    }
    if (caseSearch.trim()) searchNow(caseSearch);
  };
  const searchNow = (q) => {
    const query = (q || "").trim().toLowerCase();
    if (!query) { setSearchHits(null); return; }
    const hits = [];
    for (const x of index) {
      if (hits.length >= 20) break;
      // アクティブ/ボードは編集中なので毎回再インデックス（1〜数件・軽い）。他は前計算を再利用。
      const entry = x.id === activeId ? buildSearchEntry(x.id, project, x.name, x.channel)
        : boardCache[x.id] ? buildSearchEntry(x.id, boardCache[x.id], x.name, x.channel)
        : (searchIndexRef.current[x.id] || buildSearchEntry(x.id, null, x.name, x.channel));
      let snippet = "", rowId = null;
      if (entry.nameLC.includes(query)) { snippet = entry.name; }
      else if (entry.plansLC.includes(query)) { snippet = entry.plansDisplay; }
      else if (entry.rowsBlobLC.includes(query)) {
        for (const r of entry.rows) {
          const at = r.textLC.indexOf(query);
          if (at >= 0) {
            const snip = r.text.slice(Math.max(0, at - 12), at + query.length + 20).replace(/\s+/g, " ").trim();
            snippet = (r.kind === "location" ? "📍 " : "") + snip;
            rowId = r.id;
            break;
          }
        }
      } else continue;
      hits.push({ caseId: x.id, caseName: entry.name, channel: entry.channel, snippet, rowId });
    }
    setSearchHits(hits);
  };
  const jumpToCaseRow = async (caseId, rowId) => {
    setSearchHits(null); setCaseSearch("");
    if (caseId !== activeId) await switchProject(caseId);
    setTab("script"); setView("editor"); // ホーム検索からでも案件編集へ遷移
    if (rowId) setTimeout(() => jumpToRow(rowId), 160);
  };

  /* ===== AIチャット（会話しながら台本を作る・磨く。提案→承認）===== */
  const chatMsgs = (project && project.aiChat) || [];
  const pushChat = (m) => setProject((p) => (p ? { ...p, aiChat: [...((p.aiChat) || []).slice(-39), m] } : p));
  const sendChat = async () => {
    const msg = chatInput.trim();
    if (!msg || !project || chatBusy) return;
    const history = ((project.aiChat) || []).filter((m) => m.role === "user" || m.role === "assistant").map((m) => ({ role: m.role, content: m.content }));
    pushChat({ role: "user", content: msg, ts: Date.now() });
    setChatInput(""); setChatBusy(true); setChatProposal(null);
    try {
      const res = await fetch(SHARE_API + "/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, history, message: msg }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "応答に失敗しました");
      pushChat({ role: "assistant", content: d.reply || "", ts: Date.now() });
      if (d.proposal) setChatProposal(d.proposal);
    } catch (e) {
      pushChat({ role: "assistant", content: "⚠️ エラー：" + (e.message || e), ts: Date.now() });
    } finally { setChatBusy(false); }
  };
  /* 提案を承認して台本に反映（地図リンク/撮影完了はロケ名で引き継ぐ。直前を退避してUndo可） */
  const applyProposal = () => {
    if (!chatProposal || !project) return;
    const prop = chatProposal;
    setChatUndo({ rows: project.rows, talk: project.talk, meta: project.meta, name: project.name, channel: project.channel, plans: project.plans });
    const m = prop.meta || {};
    const meta = { ...project.meta };
    if (m.shootDate) meta.shootDate = m.shootDate;
    if (m.place) meta.place = m.place;
    if (m.highlight) meta.highlight = m.highlight;
    if (m.titles && m.titles.some(Boolean)) meta.titles = m.titles;
    if (m.thumbs && m.thumbs.some(Boolean)) meta.thumbs = m.thumbs;
    const base = { ...project, meta };
    if (prop.name) base.name = prop.name;
    if (prop.channel) base.channel = prop.channel;
    if ((m.titles && m.titles.some(Boolean)) || (m.thumbs && m.thumbs.some(Boolean))) base.plans = applyTitlesToPlans(project.plans, m.titles, m.thumbs);
    let data;
    if (prop.format === "talk" && prop.talk) {
      const t = prop.talk;
      base.format = "talk";
      base.talk = {
        highlight: t.highlight || "", intro: t.intro || "", cta: t.cta || "",
        toc: Array.isArray(t.toc) && t.toc.length ? t.toc : [""],
        body: (Array.isArray(t.body) && t.body.length ? t.body : [newTalkBody()]).map((b) => ({ id: b.id || uid(), heading: b.heading || "", script: b.script || "" })),
      };
      data = base;
    } else if (Array.isArray(prop.rows)) {
      const parsed = normalizeImport({ meta, rows: prop.rows });
      const prevByLabel = {};
      (project.rows || []).forEach((r) => { if (r.kind === "location") prevByLabel[(r.label || "").trim()] = r; });
      const rows = parsed.rows.map((r) => {
        if (r.kind !== "location") return r;
        const prev = prevByLabel[(r.label || "").trim()];
        if (!prev) return r;
        const out = { ...r };
        if (prev.done) out.done = true;
        if ((prev.address || "").trim() === (r.address || "").trim() && (prev.placeId || prev.lat != null)) {
          out.placeId = prev.placeId || ""; out.lat = prev.lat ?? null; out.lng = prev.lng ?? null;
        }
        return out;
      });
      data = { ...base, rows };
    } else { data = base; }
    setProject(data);
    setChatProposal(null);
    pushChat({ role: "system", content: "✅ 反映しました：" + (prop.summary || ""), ts: Date.now() });
    showToast("AIの提案を反映しました（取り消し可）");
  };
  const undoChat = () => {
    if (!chatUndo) return;
    setProject((p) => (p ? { ...p, ...chatUndo } : p));
    setChatUndo(null);
    pushChat({ role: "system", content: "↩️ 反映を取り消しました", ts: Date.now() });
    showToast("取り消しました");
  };
  const clearChat = () => { if (window.confirm("この案件のAIとの会話履歴を消しますか？")) { setProject((p) => (p ? { ...p, aiChat: [] } : p)); setChatProposal(null); } };
  useEffect(() => { if (chatOpen && chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: "smooth" }); }, [chatMsgs.length, chatBusy, chatOpen, chatProposal]);

  /* ===== ヒアリング タブ ===== */
  const setHearing = (updater) => setProject((p) => ({ ...p, hearing: typeof updater === "function" ? updater(Array.isArray(p.hearing) ? p.hearing : []) : updater }));
  const setHearingItem = (secId, itemId, value) => setHearing((secs) => secs.map((s) => s.id !== secId ? s : { ...s, items: s.items.map((it) => it.id === itemId ? { ...it, value } : it) }));
  const setHearingItemLabel = (secId, itemId, label) => setHearing((secs) => secs.map((s) => s.id !== secId ? s : { ...s, items: s.items.map((it) => it.id === itemId ? { ...it, label } : it) }));
  const addHearingItem = (secId) => setHearing((secs) => secs.map((s) => s.id !== secId ? s : { ...s, items: [...s.items, hearingItem("新しい項目")] }));
  const removeHearingItem = (secId, itemId) => setHearing((secs) => secs.map((s) => s.id !== secId ? s : { ...s, items: s.items.filter((it) => it.id !== itemId) }));
  const setHearingTitle = (secId, title) => setHearing((secs) => secs.map((s) => s.id === secId ? { ...s, title } : s));
  const addHearingSection = () => setHearing((secs) => [...secs, { id: uid(), title: "新しいセクション", items: [hearingItem("項目")] }]);
  const removeHearingSection = (secId) => { if (window.confirm("このセクションを削除しますか？")) setHearing((secs) => secs.filter((s) => s.id !== secId)); };
  const resetHearing = () => { if (window.confirm("ヒアリング項目を初期テンプレに戻しますか？（入力した内容は消えます）")) setHearing(HEARING_TEMPLATE()); };
  /* 文字起こし→AIで各項目を埋める。既存の入力は残し、空欄＆AIが内容を返した項目だけ埋める */
  const runHearingFill = async () => {
    const raw = (hearingImport && hearingImport.raw || "").trim();
    if (!raw) { showToast("文字起こしを貼ってね"); return; }
    setHearingBusy(true);
    try {
      const res = await fetch(SHARE_API + "/api/hearing", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw, hearing: project.hearing || [] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "失敗");
      const map = {}; (data.items || []).forEach((it) => { if (it && it.id) map[it.id] = (it.value || "").toString(); });
      let filled = 0;
      setHearing((secs) => secs.map((s) => ({ ...s, items: s.items.map((it) => {
        const v = map[it.id];
        if (v && v.trim() && !(it.value || "").trim()) { filled++; return { ...it, value: v }; } // 空欄だけ埋める
        return it;
      }) })));
      setHearingImport(null);
      showToast((data.summary ? data.summary + "｜" : "") + filled + "項目を埋めたよ" + (filled === 0 ? "（既に入力済みは上書きしてない）" : ""));
    } catch (e) { showToast("ヒアリング整形に失敗：" + (e.message || e)); }
    setHearingBusy(false);
  };

  /* ===== 企画・サムネ タブ ===== */
  const setPlans = (updater) => setProject((p) => ({ ...p, plans: typeof updater === "function" ? updater(p.plans || []) : updater }));
  const addPlan = () => setPlans((ps) => [...(ps || []), newPlan()]);
  const removePlan = (pid) => { if (!window.confirm("この企画案を削除しますか？")) return; setPlans((ps) => (ps || []).filter((x) => x.id !== pid)); };
  const updatePlan = (pid, patch) => setPlans((ps) => (ps || []).map((x) => (x.id === pid ? { ...x, ...patch } : x)));
  const updatePlanRef = (pid, idx, patch) => setPlans((ps) => (ps || []).map((x) => {
    if (x.id !== pid) return x;
    const refs = x.refs.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    return { ...x, refs };
  }));
  /* ===== トーク系台本の編集 ===== */
  const tk = (p) => (p && p.talk) ? p.talk : newTalk();
  const updateTalk = (patch) => setProject((p) => (p ? { ...p, talk: { ...tk(p), ...patch } } : p));
  const addToc = () => setProject((p) => ({ ...p, talk: { ...tk(p), toc: [...tk(p).toc, ""] } }));
  const setToc = (i, val) => setProject((p) => ({ ...p, talk: { ...tk(p), toc: tk(p).toc.map((t, k) => (k === i ? val : t)) } }));
  const removeToc = (i) => setProject((p) => ({ ...p, talk: { ...tk(p), toc: tk(p).toc.filter((_, k) => k !== i) } }));
  const addBody = () => setProject((p) => ({ ...p, talk: { ...tk(p), body: [...tk(p).body, newTalkBody()] } }));
  const setBody = (id, patch) => setProject((p) => ({ ...p, talk: { ...tk(p), body: tk(p).body.map((b) => (b.id === id ? { ...b, ...patch } : b)) } }));
  const removeBody = (id) => setProject((p) => ({ ...p, talk: { ...tk(p), body: tk(p).body.filter((b) => b.id !== id) } }));
  const moveBody = (id, dir) => setProject((p) => { const arr = [...tk(p).body]; const i = arr.findIndex((b) => b.id === id); const j = i + dir; if (j < 0 || j >= arr.length) return p; [arr[i], arr[j]] = [arr[j], arr[i]]; return { ...p, talk: { ...tk(p), body: arr } }; });

  /* 番組情報のタイトル案/サムネ案（i番目）から企画案を編集（無ければ作る） */
  const setPlanField = (i, field, val) => setPlans((ps) => {
    const arr = [...(ps || [])];
    while (arr.length <= i) arr.push(newPlan());
    arr[i] = { ...arr[i], [field]: val };
    return arr;
  });
  /* 企画案(正本) → 番組情報のタイトル案/サムネ案 を自動ミラー（書き出し/AI用にmetaも常に最新化） */
  useEffect(() => {
    if (!project) return;
    const { titles, thumbs } = metaTitlesFromPlans(project.plans);
    const cm = project.meta || {};
    if (JSON.stringify((cm.titles || []).slice(0, 3)) === JSON.stringify(titles)
      && JSON.stringify((cm.thumbs || []).slice(0, 3)) === JSON.stringify(thumbs)) return;
    setProject((p) => (p ? { ...p, meta: { ...p.meta, titles, thumbs } } : p));
  }, [project && project.plans]);
  const [refBusy, setRefBusy] = useState({}); // {`${pid}:${idx}`: true}
  /* 参考動画URL → Worker経由でYouTube統計を取得して該当refに反映 */
  const fetchPlanRef = async (pid, idx, url) => {
    const vid = ytIdFromUrl(url);
    if (!vid) { showToast("YouTubeのURLを入力してね"); return; }
    const key = pid + ":" + idx;
    setRefBusy((b) => ({ ...b, [key]: true }));
    try {
      const res = await fetch(SHARE_API + "/api/yt?v=" + encodeURIComponent(vid));
      const d = await res.json();
      if (d.needKey) { showToast("YouTube APIキーが未設定（AKに設定を頼んで）"); updatePlanRef(pid, idx, { url, vid }); return; }
      if (!res.ok || d.error) throw new Error(d.error || "取得失敗");
      updatePlanRef(pid, idx, { url, vid, title: d.title, channel: d.channel, views: d.views, subs: d.subs, likes: d.likes, uploadDate: d.uploadDate, duration: parseDur(d.duration) });
    } catch (e) {
      showToast("動画取得に失敗：" + (e.message || e));
      updatePlanRef(pid, idx, { url, vid });
    } finally {
      setRefBusy((b) => { const n = { ...b }; delete n[key]; return n; });
    }
  };

  /* ===== 自作サムネ：アップロード（縮小してdataURLで案件に保存）＆ 目立ちテスト ===== */
  const resizeImageFile = (file, maxW = 640) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("読み込み失敗"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("画像が不正です"));
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        cv.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL("image/jpeg", 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
  /* 自作サムネ（最大5枚）の idx 番目を差し替え／削除 */
  const setThumbAt = (pid, idx, dataUrl) => setPlans((ps) => (ps || []).map((x) => {
    if (x.id !== pid) return x;
    const arr = (x.thumbImages || []).slice(0, 5);
    while (arr.length <= idx) arr.push("");
    arr[idx] = dataUrl || "";
    return { ...x, thumbImages: arr };
  }));
  const onPickThumb = async (pid, idx, file) => {
    if (!file) return;
    if (!/^image\//.test(file.type)) { showToast("画像ファイルを選んでね"); return; }
    try { const dataUrl = await resizeImageFile(file); setThumbAt(pid, idx, dataUrl); showToast("サムネをアップしました"); }
    catch (e) { showToast("失敗：" + (e.message || e)); }
  };
  const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  /* キーワード検索で競合サムネを取得 → 自分のサムネをランダム位置に混ぜて並べる */
  const runThumbTest = async (pid, keyword, myImage) => {
    const kw = (keyword || "").trim();
    if (!kw) { showToast("テストするキーワードを入れてね"); return; }
    setThumbTest({ pid, keyword: kw, myImage: myImage || "", items: [], myPos: 0, busy: true, reveal: false });
    try {
      const res = await fetch(SHARE_API + "/api/ytsearch?max=12&q=" + encodeURIComponent(kw));
      const d = await res.json();
      if (d.needKey) { showToast("YouTube APIキーが未設定（AKに設定を頼んで）"); setThumbTest(null); return; }
      if (!res.ok || d.error) throw new Error(d.error || "検索失敗");
      const items = shuffle(d.items || []).slice(0, 8);
      if (!items.length) throw new Error("競合サムネが見つかりませんでした");
      setThumbTest({ pid, keyword: kw, myImage: myImage || "", items, myPos: Math.floor(Math.random() * (items.length + 1)), busy: false, reveal: false });
    } catch (e) { showToast("テスト失敗：" + (e.message || e)); setThumbTest(null); }
  };
  const reshuffleThumbTest = () => setThumbTest((t) => t && ({ ...t, items: shuffle(t.items), myPos: Math.floor(Math.random() * (t.items.length + 1)), reveal: false }));

  /* ===== チャンネル案件ボード（企画・サムネ = チャンネル内の全案件を1案件1カードで一覧）===== */
  const [boardCache, setBoardCache] = useState({});          // {id: 案件本体}（アクティブ以外の同チャンネル案件）
  const [brokenIds, setBrokenIds] = useState({});            // {id:true} 本体がKVから消えた幽霊案件（無限ロード回避＝削除誘導）
  const [recentIds, setRecentIds] = useState(() => { try { return JSON.parse(localStorage.getItem("mg:recent") || "[]"); } catch (e) { return []; } }); // 最近触った案件id（新しい順）
  const pushRecent = (id) => setRecentIds((r) => { const n = [id, ...r.filter((x) => x !== id)].slice(0, 12); try { localStorage.setItem("mg:recent", JSON.stringify(n)); } catch (e) {} return n; });
  const [collapseActive, setCollapseActive] = useState(false); // アクティブ案件カードを畳むか
  const boardSaveTimers = useRef({});
  /* アクティブ案件が変わったら展開状態に戻す */
  useEffect(() => { setCollapseActive(false); }, [activeId]);
  /* 企画・サムネタブを開いている間、同チャンネルの他案件本体を読み込む */
  useEffect(() => {
    if (!loaded || tab !== "plan" || !project) return;
    let cancelled = false;
    (async () => {
      const sibs = index.filter((x) => (x.channel || DEFAULT_CHANNEL) === curChannel && x.id !== activeId);
      for (const x of sibs) {
        if (boardCache[x.id]) continue;
        try {
          let data = null;
          if (x.collab) { const r = await authFetch("/api/collab/get", { id: x.id }); data = { ...migrateProject(r.project), id: x.id, collab: true, collabRole: r.role, ownerEmail: r.ownerEmail, members: r.members }; }
          else { const r = await window.storage.get(STORE_PROJ(x.id)); data = r && r.value ? migrateProject(JSON.parse(r.value)) : null; }
          if (data && !cancelled) setBoardCache((c) => ({ ...c, [x.id]: data }));
        } catch (e) { if ((e && e.message) === "nf" && !cancelled) setBrokenIds((b) => ({ ...b, [x.id]: true })); }
      }
    })();
    return () => { cancelled = true; };
  }, [tab, curChannel, activeId, index, loaded, project && project.id]);

  /* ホーム表示中は全案件の本体を読み込んでカードにステータス/締切/次の一手を出す（取れたものから順次） */
  useEffect(() => {
    if (!loaded || view !== "home") return;
    let cancelled = false;
    (async () => {
      for (const x of index) {
        if (x.id === activeId || boardCache[x.id]) continue;
        try {
          let data = null;
          if (x.collab) { const r = await authFetch("/api/collab/get", { id: x.id }); data = { ...migrateProject(r.project), id: x.id, collab: true }; }
          else { const r = await window.storage.get(STORE_PROJ(x.id)); data = r && r.value ? migrateProject(JSON.parse(r.value)) : null; }
          if (data && !cancelled) setBoardCache((c) => ({ ...c, [x.id]: data }));
        } catch (e) { if ((e && e.message) === "nf" && !cancelled) setBrokenIds((b) => ({ ...b, [x.id]: true })); }
      }
    })();
    return () => { cancelled = true; };
  }, [view, index, loaded]);
  /* アクティブ案件にplans[0]が無ければ1枠だけ用意（ボード編集の土台） */
  useEffect(() => {
    if (tab !== "plan" || !project) return;
    if (!project.plans || project.plans.length === 0) setProject((p) => ({ ...p, plans: [newPlan()] }));
  }, [tab, project && project.id]);

  const boardCases = index.filter((x) => (x.channel || DEFAULT_CHANNEL) === curChannel);
  const boardPlan0 = (data) => (data && data.plans && data.plans[0]) || null;
  const saveBoardCaseSoon = (id) => {
    clearTimeout(boardSaveTimers.current[id]);
    boardSaveTimers.current[id] = setTimeout(() => { setBoardCache((c) => { if (c[id]) saveProjectData(c[id]); return c; }); }, 600);
  };
  /* ボード上の案件のタイトル / サムネ文言を編集（名前のindex同期はblur時に集約） */
  const updateBoardTitle = (id, field, val) => {
    if (id === activeId) {
      setProject((p) => { const plans = [...(p.plans || [])]; plans[0] = { ...(plans[0] || newPlan()), [field]: val }; const np = { ...p, plans }; if (field === "title" && val.trim()) np.name = val.trim(); return np; });
      return;
    }
    setBoardCache((c) => { const d = c[id]; if (!d) return c; const plans = [...(d.plans || [])]; plans[0] = { ...(plans[0] || newPlan()), [field]: val }; const nd = { ...d, plans }; if (field === "title" && val.trim()) nd.name = val.trim(); return { ...c, [id]: nd }; });
    saveBoardCaseSoon(id);
  };
  /* タイトル確定時に案件名（サイドバー表示）へ同期 */
  const commitCaseName = (id) => {
    const d = id === activeId ? project : boardCache[id];
    const t = ((d && d.plans && d.plans[0] && d.plans[0].title) || "").trim();
    if (!t) return;
    setIndex((cur) => { const e = cur.find((x) => x.id === id); if (!e || e.name === t) return cur; const nx = cur.map((x) => (x.id === id ? { ...x, name: t } : x)); persistIndex(nx); return nx; });
  };
  /* カードを開く（=その案件をアクティブにして展開。タブはplanのまま） */
  const openBoardCase = async (id) => {
    if (id === activeId) { setCollapseActive((v) => !v); return; }
    await switchProject(id); setTab("plan"); setCollapseActive(false);
    setBoardCache((c) => { const n = { ...c }; delete n[id]; return n; });
  };
  /* この案件の構成台本へ */
  const goScript = async (id) => { if (id === activeId) { setTab("script"); } else { await switchProject(id); } };
  /* ボードから案件追加（=このチャンネルに新しい案件＝新しい企画） */
  const addBoardCase = async () => {
    const fmt = (project && project.format === "documentary") ? "documentary" : "talk";
    await createProject(true, curChannel, fmt);
    setTab("plan"); setCollapseActive(false);
  };
  /* ボードから案件削除 */
  const deleteBoardCase = async (id) => {
    if (index.length <= 1) { showToast("最後の1案件は削除できません"); return; }
    const ch = curChannel, wasActive = id === activeId;
    const remainSibs = index.filter((x) => (x.channel || DEFAULT_CHANNEL) === ch && x.id !== id);
    await deleteProject(id);
    setBoardCache((c) => { const n = { ...c }; delete n[id]; return n; });
    if (wasActive && remainSibs.length) { await switchProject(remainSibs[0].id); setTab("plan"); }
  };
  /* 複数企画案を持つ旧データを、企画案ごとに別々の案件へ分割 */
  const splitExtraPlans = async (id) => {
    const src = id === activeId ? project : boardCache[id];
    if (!src || !(src.plans && src.plans.length > 1)) return;
    if (!window.confirm("この案件の企画案" + src.plans.length + "件を、それぞれ別の案件に分けます。よろしいですか？")) return;
    const extras = src.plans.slice(1);
    const ch = src.channel || DEFAULT_CHANNEL;
    const fmt = src.format === "talk" ? "talk" : "documentary";
    let idx = [...index];
    for (const pl of extras) {
      const base = newProjectData(((pl.title || "").trim() || "企画案"), ch, fmt);
      const data = { ...base, format: fmt, plans: [{ ...pl, id: uid() }], meta: { ...base.meta, titles: [pl.title || "", "", ""], thumbs: [pl.thumbText || "", "", ""] } };
      try { if (typeof window.storage !== "undefined") await window.storage.set(STORE_PROJ(data.id), JSON.stringify(data)); } catch (e) {}
      idx.push({ id: data.id, name: data.name, channel: data.channel, createdAt: data.createdAt });
    }
    setIndex(idx); persistIndex(idx);
    if (id === activeId) setProject((p) => ({ ...p, plans: [p.plans[0]] }));
    else setBoardCache((c) => { const d = c[id]; if (!d) return c; const nd = { ...d, plans: [d.plans[0]] }; saveProjectData(nd); return { ...c, [id]: nd }; });
    showToast(extras.length + "件の企画案を別々の案件に分けました");
  };

  /* ファイル選択（TXT / CSV / Excel）→ 取り込み欄へ流し込む */
  const onPickImportFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (e.target) e.target.value = ""; // 同じファイルの再選択を許可
    if (!file) return;
    try {
      const text = await readImportFile(file);
      if (!text || !text.trim()) { showToast("ファイルから文字を読めませんでした"); return; }
      setFullImportText(text);
      setImportFileName(file.name);
      showToast("「" + file.name + "」を読み込み（" + text.length.toLocaleString() + "字）→ 取り込み中…");
      await smartImport(text); // ファイルを入れたら中身を自動判定してそのまま構成へ
    } catch (err) {
      showToast("ファイル読み込み失敗：" + (err.message || err));
    }
  };

  /* 生原稿（Claude/GPT/Gemini出力やメモ）を Worker経由でClaude整形 → 新規 or 現案件更新 */
  const aiParseImport = async (rawArg) => {
    const raw = (rawArg != null ? rawArg : fullImportText).trim();
    if (!raw) return;
    if (!confirmUpdateIfNeeded()) return; // 重いAI処理の前に確認（待った後にダイアログが出ない）
    setAiParsing(true);
    try {
      const res = await fetch(SHARE_API + "/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw }),
      });
      const data = await res.json();
      if (!res.ok || !data.project) throw new Error(data.error || "整形に失敗しました");
      const parsed = normalizeImport(data.project);
      if (!parsed.rows || !parsed.rows.length) throw new Error("構成を読み取れませんでした（原稿が短い/形式が不明な可能性）");
      await dispatchParsed(parsed, { skipConfirm: true });
      showToast("✅ 取り込み完了（" + parsed.rows.filter((r) => r.kind === "scene").length + "シーン）");
    } catch (e) {
      showToast("AI整形に失敗：" + (e.message || e));
    } finally {
      setAiParsing(false);
    }
  };

  /* スマート取り込み：中身を自動判定。JSON/台本コピーTSVならそのまま即取込、
     それ以外（生原稿・取材メモ・文字起こし）はAI整形に自動で回す。
     貼り付けボタン・ファイル選択の両方からこれ1本に集約。 */
  const smartImport = async (rawArg) => {
    const raw = (rawArg != null ? rawArg : fullImportText).trim();
    if (!raw || aiParsing) return;
    const direct = parseImportText(raw); // JSON / 台本コピーTSV として読めるか
    if (direct && direct.rows.length) {
      if (!confirmUpdateIfNeeded()) return;
      await dispatchParsed(direct, { skipConfirm: true });
      showToast("✅ 取り込み完了（" + direct.rows.filter((r) => r.kind === "scene").length + "シーン）");
      return;
    }
    await aiParseImport(raw); // 生原稿 → AIが自動で構成台本に整形
  };

  const duplicateProject = async (id) => {
    try {
      const src = id === activeId ? project : migrateProject(JSON.parse((await window.storage.get(STORE_PROJ(id))).value));
      const copy = JSON.parse(JSON.stringify(src));
      copy.id = uid();
      copy.name = src.name + " のコピー";
      copy.createdAt = Date.now();
      // 行IDを振り直し（衝突回避）
      copy.rows = copy.rows.map((r) => ({ ...r, id: uid() }));
      copy.shareId = null; // 複製は別の共有リンク
      copy.shareToken = null; copy.liveId = null; copy.liveToken = null;
      // アップロード済みメディアは元案件の共有(snap)配下のキーを指すので引き継がない。
      // 引き継ぐと複製案件を公開したとき元案件の動画/ファイルが出る（別動画事故）。
      copy.video = null; copy.files = [];
      copy.review = { versions: [], comments: [] };
      copy.assets = [];
      copy.plans = (copy.plans || []).map((pl) => ({ ...pl, video: null, files: [], shareId: null, shareToken: null }));
      const srcIdx = index.findIndex((x) => x.id === id);
      const idx = [...index];
      idx.splice(srcIdx + 1, 0, { id: copy.id, name: copy.name, channel: copy.channel || DEFAULT_CHANNEL, createdAt: copy.createdAt });
      await window.storage.set(STORE_PROJ(copy.id), JSON.stringify(copy));
      setIndex(idx); persistIndex(idx);
      setActiveId(copy.id); setProject(copy); setTab("script"); setView("editor");
      showToast("案件を複製しました");
    } catch (e) { showToast("複製に失敗しました"); }
  };

  const deleteProject = async (id) => {
    if (index.length <= 1) { showToast("最後の1案件は削除できません"); return; }
    const entry = index.find((x) => x.id === id) || {};
    const name = entry.name || "この案件";
    if (entry.collab) {
      const isOwner = entry.role === "owner";
      if (!window.confirm(isOwner ? "「" + name + "」を削除します。招待メンバー全員から見えなくなります。よろしいですか？" : "共有案件「" + name + "」から退出します。よろしいですか？")) return;
      try { await authFetch(isOwner ? "/api/collab/delete" : "/api/collab/leave", { id }); } catch (e) { showToast("失敗：" + (e.message || e)); return; }
    } else {
      if (!window.confirm("「" + name + "」を削除します。元に戻せません。よろしいですか？")) return;
      try { if (typeof window.storage !== "undefined") await window.storage.delete(STORE_PROJ(id)); } catch (e) {}
    }
    const idx = index.filter((x) => x.id !== id);
    setIndex(idx); persistIndex(idx);
    if (id === activeId) {
      const next = idx[0];
      if (next.collab) { try { const r = await authFetch("/api/collab/get", { id: next.id }); setActiveId(next.id); setProject({ ...migrateProject(r.project), id: next.id, collab: true, collabRole: r.role, ownerEmail: r.ownerEmail, members: r.members }); } catch (e) {} }
      else { const r = await window.storage.get(STORE_PROJ(next.id)); setActiveId(next.id); setProject(r && r.value ? migrateProject(JSON.parse(r.value)) : newProjectData(next.name)); }
    }
    showToast(entry.collab && entry.role !== "owner" ? "共有から退出しました" : "案件を削除しました");
  };

  const renameProject = (id, name) => {
    const idx = index.map((x) => (x.id === id ? { ...x, name } : x));
    setIndex(idx); persistIndex(idx);
    if (id === activeId && project) setProject((p) => ({ ...p, name }));
  };

  /* 案件のチャンネル（クライアント）を変更 */
  const setProjectChannel = async (id, channel) => {
    const ch = (channel || "").trim() || DEFAULT_CHANNEL;
    const idx = index.map((x) => (x.id === id ? { ...x, channel: ch } : x));
    setIndex(idx); persistIndex(idx);
    if (id === activeId && project) setProject((p) => ({ ...p, channel: ch }));
    else {
      try {
        const r = await window.storage.get(STORE_PROJ(id));
        if (r && r.value) await window.storage.set(STORE_PROJ(id), JSON.stringify({ ...JSON.parse(r.value), channel: ch }));
      } catch (e) {}
    }
  };

  /* 既存チャンネル候補（案件＋案件管理ボードの両方から） */
  const channelOptions = useMemo(() => {
    const set = new Set(index.map((x) => x.channel || DEFAULT_CHANNEL));
    try {
      const raw = localStorage.getItem("mg:cases");
      if (raw) JSON.parse(raw).forEach((c) => c.channel && set.add(c.channel));
    } catch (e) {}
    return [...set].sort((a, b) => (a === DEFAULT_CHANNEL ? 1 : b === DEFAULT_CHANNEL ? -1 : a.localeCompare(b, "ja")));
  }, [index]);

  /* チャンネルごとに案件をグルーピング（チャンネルは初出順、案件はindex順） */
  const channelGroups = useMemo(() => {
    const order = [];
    const map = {};
    index.forEach((x) => {
      const ch = x.channel || DEFAULT_CHANNEL;
      if (!map[ch]) { map[ch] = []; order.push(ch); }
      map[ch].push(x);
    });
    // 案件ゼロでも登録済みの空チャンネルを表示
    Object.keys(channelInfo || {}).forEach((ch) => { if (ch && ch !== DEFAULT_CHANNEL && !map[ch]) { map[ch] = []; order.push(ch); } });
    // 未分類は末尾へ
    order.sort((a, b) => (a === DEFAULT_CHANNEL ? 1 : b === DEFAULT_CHANNEL ? -1 : 0));
    return order.map((channel) => ({ channel, items: map[channel] }));
  }, [index, channelInfo]);

  /* 案件カード用：本体（アクティブ=project / 他=boardCache）を引く。未読込はindexだけ */
  const caseData = (id) => (id === activeId && project) ? project : boardCache[id];
  const daysLeft = (d) => { if (!d) return null; const t = new Date(d + "T23:59:59").getTime(); if (isNaN(t)) return null; return Math.ceil((t - Date.now()) / 86400000); };
  /* ホームの作業セクション（今日やること/確認待ち/期限近い/最近触った）を算出 */
  const homeSections = useMemo(() => {
    const rows = index.map((x) => { const d = caseData(x.id); return { id: x.id, name: (d && d.name) || x.name, channel: x.channel || DEFAULT_CHANNEL, collab: x.collab, status: (d && d.status) || "未着手", deadline: (d && d.deadline) || "", nextAction: (d && d.nextAction) || "", updatedAt: (d && d.updatedAt) || x.createdAt || 0, dl: daysLeft(d && d.deadline) }; });
    const review = rows.filter((r) => r.status === "確認中");
    const due = rows.filter((r) => r.dl != null && r.dl <= 7 && r.status !== "完了").sort((a, b) => a.dl - b.dl);
    const todo = rows.filter((r) => r.status !== "完了" && (r.nextAction.trim() || (r.dl != null && r.dl <= 3))).sort((a, b) => (a.dl == null ? 99 : a.dl) - (b.dl == null ? 99 : b.dl)).slice(0, 8);
    const recent = recentIds.map((id) => rows.find((r) => r.id === id)).filter(Boolean).slice(0, 6);
    return { rows, review, due, todo, recent };
  }, [index, boardCache, project, recentIds, activeId]);

  const StatusBadge = ({ s }) => { const c = STATUS_COLOR[s] || STATUS_COLOR["未着手"]; return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ background: c.bg, color: c.fg }}>{s}</span>; };
  const renderCaseCard = (r) => {
    const overdue = r.dl != null && r.dl < 0, soon = r.dl != null && r.dl >= 0 && r.dl <= 3;
    return (
      <button key={r.id} onClick={() => openCase(r.id)}
        className="w-full text-left bg-white border border-stone-200 rounded-xl px-3.5 py-3 shadow-sm hover:shadow-md hover:border-stone-300 transition-all">
        <div className="flex items-center gap-2 mb-1">
          <StatusBadge s={r.status} />
          <span className="text-[13px] font-bold text-stone-800 truncate flex-1 min-w-0">{r.name}</span>
          {r.collab && <Icon name="user" className="w-3 h-3 shrink-0 text-stone-400" />}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-stone-500">
          <span className="truncate max-w-[140px]">{r.channel}</span>
          {r.deadline && <span className={"shrink-0 font-bold " + (overdue ? "text-rose-600" : soon ? "text-amber-600" : "text-stone-400")}>{overdue ? "期限超過" : r.dl === 0 ? "今日締切" : "あと" + r.dl + "日"}</span>}
        </div>
        {r.nextAction && <div className="mt-1.5 text-[12px] text-stone-700 flex items-start gap-1"><span className="text-stone-400">▶</span><span className="truncate">{r.nextAction}</span></div>}
      </button>
    );
  };

  /* チャンネル名の変更（配下の案件すべてに反映） */
  const renameChannel = (oldName) => {
    const isDefault = oldName === DEFAULT_CHANNEL;
    const next = window.prompt(isDefault ? "このフォルダに名前を付ける（クライアント名など）。配下の案件がまとめて移動します。" : "フォルダ名を変更", isDefault ? "" : oldName);
    if (next == null) return;
    const ch = next.trim() || DEFAULT_CHANNEL;
    if (ch === oldName) return;
    const idx = index.map((x) => ((x.channel || DEFAULT_CHANNEL) === oldName ? { ...x, channel: ch } : x));
    setIndex(idx); persistIndex(idx);
    if (project && (project.channel || DEFAULT_CHANNEL) === oldName) setProject((p) => ({ ...p, channel: ch }));
    // チャンネルコンセプト情報も新名へ移動（既存があれば優先）
    setChannelInfo((ci) => {
      if (!ci[oldName] && oldName !== DEFAULT_CHANNEL) return ci;
      const moved = { ...emptyChannelInfo(), ...(ci[oldName] || {}), ...(ci[ch] || {}), name: ch };
      const n = { ...ci, [ch]: moved }; delete n[oldName]; return n;
    });
  };

  /* チャンネルのアイコン（絵文字）を変更 */
  const setChannelIcon = (channel, icon) => {
    setChannelInfo((ci) => ({ ...ci, [channel]: { ...emptyChannelInfo(), name: channel, ...(ci[channel] || {}), icon } }));
    setIconPick(null);
  };
  const channelIconOf = (channel) => (channelInfo[channel] && channelInfo[channel].icon) || "";

  /* 同じチャンネル内で案件の順番を入れ替え（チャンネル跨ぎはしない＝事故防止） */
  const moveCaseInChannel = (id, dir) => {
    const item = index.find((x) => x.id === id); if (!item) return;
    const ch = item.channel || DEFAULT_CHANNEL;
    const same = index.filter((x) => (x.channel || DEFAULT_CHANNEL) === ch);
    const pos = same.findIndex((x) => x.id === id);
    const swap = same[pos + dir]; if (!swap) return;
    const ni = index.map((x) => (x.id === id ? swap : x.id === swap.id ? item : x));
    setIndex(ni); persistIndex(ni);
  };

  /* サイドバーの案件をドラッグ＆ドロップで並び替え（同じチャンネル内のみ＝事故防止） */
  const reorderCaseByDrag = (id, overId) => {
    if (!id || !overId || id === overId) return;
    const item = index.find((x) => x.id === id); if (!item) return;
    const overItem = index.find((x) => x.id === overId); if (!overItem) return;
    if ((item.channel || DEFAULT_CHANNEL) !== (overItem.channel || DEFAULT_CHANNEL)) return;
    const rest = index.filter((x) => x.id !== id);
    const pos = rest.findIndex((x) => x.id === overId);
    const ni = [...rest.slice(0, pos), item, ...rest.slice(pos)];
    setIndex(ni); persistIndex(ni);
  };

  /* チャンネル（フォルダ）の順番を入れ替え（未分類は常に末尾） */
  const moveChannel = (name, dir) => {
    const named = channelGroups.map((g) => g.channel).filter((c) => c !== DEFAULT_CHANNEL);
    const pos = named.indexOf(name);
    if (pos < 0 || pos + dir < 0 || pos + dir >= named.length) return;
    const newNamed = [...named];
    [newNamed[pos], newNamed[pos + dir]] = [newNamed[pos + dir], newNamed[pos]];
    const blocks = {};
    index.forEach((x) => { const ch = x.channel || DEFAULT_CHANNEL; (blocks[ch] = blocks[ch] || []).push(x); });
    const orderedCh = [...newNamed, ...Object.keys(blocks).filter((c) => !newNamed.includes(c) && c !== DEFAULT_CHANNEL)];
    if (blocks[DEFAULT_CHANNEL]) orderedCh.push(DEFAULT_CHANNEL);
    const ni = orderedCh.flatMap((ch) => blocks[ch] || []);
    setIndex(ni); persistIndex(ni);
  };

  /* 空のチャンネル（フォルダ）を新規作成 */
  const createChannel = (rawName) => {
    const name = (rawName || "").trim();
    if (!name || name === DEFAULT_CHANNEL) return;
    if ((channelInfo && channelInfo[name]) || channelGroups.some((g) => g.channel === name)) { showToast("「" + name + "」は既にあります"); return; }
    setChannelInfo((c) => ({ ...c, [name]: { ...emptyChannelInfo(), name } }));
    showToast("チャンネル「" + name + "」を作成しました");
  };

  /* フォルダ（チャンネル）ごと削除：配下の全案件を削除（未分類も可） */
  const deleteChannel = async (channel) => {
    const items = index.filter((x) => (x.channel || DEFAULT_CHANNEL) === channel);
    if (!items.length) {
      // 空チャンネル：登録だけ消す
      if (!window.confirm("空のフォルダ「" + channel + "」を削除しますか？")) return;
      setChannelInfo((c) => { const n = { ...c }; delete n[channel]; return n; });
      setCtxMenu(null); showToast("フォルダを削除しました"); return;
    }
    if (!window.confirm("フォルダ「" + channel + "」と中の" + items.length + "案件を全て削除します。元に戻せません。よろしいですか？")) return;
    for (const x of items) {
      try {
        if (x.collab) { await authFetch(x.role === "owner" ? "/api/collab/delete" : "/api/collab/leave", { id: x.id }); }
        else { if (typeof window.storage !== "undefined") await window.storage.delete(STORE_PROJ(x.id)); }
      } catch (e) {}
    }
    let idx = index.filter((x) => (x.channel || DEFAULT_CHANNEL) !== channel);
    setChannelInfo((c) => { const n = { ...c }; delete n[channel]; return n; });
    const activeInChannel = items.some((x) => x.id === activeId);
    if (idx.length === 0) {
      const data = newProjectData("案件1");
      idx = [{ id: data.id, name: data.name, channel: data.channel, createdAt: data.createdAt }];
      try { if (typeof window.storage !== "undefined") await window.storage.set(STORE_PROJ(data.id), JSON.stringify(data)); } catch (e) {}
      setActiveId(data.id); setProject(data);
    } else if (activeInChannel) {
      const first = idx[0];
      try {
        if (first.collab) { const r = await authFetch("/api/collab/get", { id: first.id }); setActiveId(first.id); setProject({ ...migrateProject(r.project), id: first.id, collab: true, collabRole: r.role, ownerEmail: r.ownerEmail, members: r.members }); }
        else { const r = await window.storage.get(STORE_PROJ(first.id)); setActiveId(first.id); setProject(r && r.value ? migrateProject(JSON.parse(r.value)) : newProjectData(first.name)); }
      } catch (e) {}
    }
    setIndex(idx); persistIndex(idx);
    if (activeInChannel || idx.length === 0) setView("home");
    setCtxMenu(null);
    showToast("フォルダを削除しました");
  };

  /* ---- リアルタイム共同編集（live） ---- */
  // 永続化・送信時に剥がすランタイム専用フラグ
  const cleanProj = (p) => {
    if (!p) return p;
    const { live, liveId, liveToken, collab, collabRole, members, ownerEmail, role, aiChat, ...rest } = p;
    return rest;
  };
  /* チャンネル編集リンク（index.html?ch=…）：ログイン不要で当該クライアントの案件一覧を出し、クリックで該当案件のライブ編集へ直行 */
  const startChannelLive = async (chId) => {
    try {
      const r = await fetch(SHARE_API + "/api/chan/" + encodeURIComponent(chId));
      if (!r.ok) { setView("home"); setLoaded(true); showToast("チャンネル共有リンクが見つかりませんでした"); return; }
      const doc = await r.json();
      if (!doc.editable) { location.replace("share.html?ch=" + encodeURIComponent(chId)); return; }  // 閲覧専用は従来の共有ページへ
      const cases = (doc.cases || []).filter((c) => c && c.edit && c.edit.liveId && c.edit.editToken)
        .map((c) => ({ id: c.id || c.edit.liveId, name: c.name || "案件", format: c.format || "documentary", edit: c.edit }));
      const chName = doc.name || "チャンネル";
      setChannelInfo({ [chName]: { ...emptyChannelInfo(), ...(doc.channelInfo || {}), name: chName } });
      setChanLive({ id: chId, name: chName, channelInfo: doc.channelInfo || {}, cases });
      setView("home"); setLoaded(true);
    } catch (e) { setView("home"); setLoaded(true); showToast("読み込みに失敗しました：" + (e.message || e)); }
  };
  /* chanLive中：案件クリック→該当案件のライブセッションへ（編集ボタンを挟まず全タブ直接編集） */
  const openChanCase = (c) => { if (!c || !c.edit) return; setChanActiveCase(c.id); startLiveSession(c.edit.liveId, c.edit.editToken); };
  const startLiveSession = (liveId, token) => {
    setView("editor"); setLoaded(false);
    try { if (liveWS.current) liveWS.current.close(); } catch (e) {}
    let ws;
    try { ws = new WebSocket(SHARE_API.replace(/^http/, "ws") + "/api/live/" + encodeURIComponent(liveId) + "?k=" + encodeURIComponent(token)); }
    catch (e) { showToast("接続に失敗しました"); return; }
    liveWS.current = ws;
    let inited = false;
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch (_) { return; }
      if (m.t === "init" || (m.t === "full" && m.project)) {
        const proj = m.project ? migrateProject(m.project) : newProjectData("共同編集");
        lastRemoteRef.current = JSON.stringify(cleanProj(proj));
        if (m.t === "init") { setActiveId(liveId); inited = true; }
        setProject({ ...proj, live: true, liveId, liveToken: token });
        if (m.t === "init") setLoaded(true);
      }
    };
    ws.onclose = () => { if (liveWS.current === ws) liveWS.current = null; if (!inited) { setView("home"); setLoaded(true); loadAll(); showToast("編集リンクが無効か、期限切れの可能性があります"); } };
    ws.onerror = () => {};
  };
  // 編集用（リアルタイム）リンクを発行
  const publishShareLive = async () => {
    if (!project) return;
    setSharing(true);
    try {
      const res = await fetch(SHARE_API + "/api/live/create", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: { ...cleanProj(project), channelInfo: curChannelInfo }, prevLiveId: project.liveId || null, editToken: project.liveToken || null }),
      });
      const data = await res.json();
      if (!data.liveId) throw new Error(data.error || "発行失敗");
      const next = { ...project, liveId: data.liveId, liveToken: data.editToken };
      setProject(next);
      try { if (!next.collab && typeof window.storage !== "undefined") await window.storage.set(STORE_PROJ(next.id), JSON.stringify(next)); } catch (e) {}
      const url = location.origin + location.pathname.replace(/[^/]*$/, "") + "index.html?live=" + data.liveId + "#k=" + data.editToken;
      setShareModal({ id: data.liveId, url, updated: !!project.liveId, live: true });
      try { await navigator.clipboard.writeText(url); } catch (e) {}
    } catch (e) { showToast("編集リンクの発行に失敗：" + (e.message || e)); }
    setSharing(false);
  };

  /* ---- 共有リンク発行 ---- */
  const publishShare = async (silent = false) => {
    if (!project) return;
    setSharing(true);
    try {
      const res = await fetch(SHARE_API + "/api/publish", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: { ...project, channelInfo: curChannelInfo, manualsGlobal: globalManuals }, prevId: project.shareId || null, token: project.shareToken || null }),
      });
      const data = await res.json();
      if (!data.id) throw new Error(data.error || "発行失敗");
      if (data.uptok) shareUpTokRef.current = data.uptok;   // 編集者URL用：&up= に乗せる
      if (data.rtok) shareReadTokRef.current = data.rtok;   // 閲覧URL用：&r= に乗せる（新方式snap）
      const next = { ...project, shareId: data.id, shareToken: data.token || project.shareToken, shareUpToken: data.uptok || project.shareUpToken, shareReadToken: data.rtok || project.shareReadToken };
      shareTokenRef.current = next.shareToken || "";   // setProjectは非同期。直後のアップが最新tokenを引けるよう保持
      setProject(next);
      try { await window.storage.set(STORE_PROJ(next.id), JSON.stringify(next)); } catch (e) {}
      if (!silent) {
        const url = shareUrl(data.id, data.rtok || project.shareReadToken);
        setShareModal({ id: data.id, url, updated: !!project.shareId });
        try { await navigator.clipboard.writeText(url); } catch (e) {}
      }
      setSharing(false);
      return data.id;
    } catch (e) { showToast("共有リンクの発行に失敗：" + (e.message || e)); }
    setSharing(false);
    return null;
  };
  /* 動画/ファイルを上げる前に確認用URLが無ければその場で自動発行（ユーザーに先に発行させない）。{id,token} を返す。
     setProjectは非同期で、この実行コンテキストの project.shareId/Token はまだ古いので、発行で確定した値を返して呼び出し側で直に使う。 */
  const ensureShare = async () => {
    if (project.shareId) return { id: project.shareId, token: project.shareToken || shareTokenRef.current || "" };
    const id = await publishShare(true);   // サイレント発行（モーダルは出さない）
    if (!id) return null;                  // 失敗時は publishShare がトースト済
    return { id, token: project.shareToken || shareTokenRef.current || "" };
  };
  /* ===== 共有URL：タブ別／案件まるごと ===== */
  /* アプリのタブ → share.html のペイン名 */
  const TAB_SHARE_PANE = { overview: "concept", plan: "plan", hearing: "hearing", script: "script", kouban: "kouban", review: "video", concept: "concept", assets: "files" };
  const buildShareUrl = (id, t) => { const pane = t ? TAB_SHARE_PANE[t] : ""; return shareUrl(id, project.shareReadToken || shareReadTokRef.current) + (pane ? "&tab=" + pane : ""); };
  /* t を渡すとそのタブだけ／省略で案件まるごと。未発行なら発行してからコピー */
  const copyShareUrl = async (t) => {
    const had = !!project.shareId;
    // 既存リンクでも必ず再発行してから渡す。動画確認の版など最新状態をスナップに反映するため
    // （これが無いと「URLをコピーするだけ」になり、追加した確認動画が共有ページに出ず別動画にフォールバックする）
    const id = await publishShare(true);
    if (!id) return;
    const u = buildShareUrl(id, t);
    setShareModal({ id, url: u, updated: had, tab: t || "" });
    try { await navigator.clipboard.writeText(u); showToast((t ? "このタブの" : "案件まるごとの") + "共有URLを更新してコピーしたよ"); } catch (e) {}
  };
  /* ===== 受け渡し（ラリー）：相手別に「見せるタブ＋着地タブ＋文面」をまとめてコピー ===== */
  /* アプリのタブキー配列 → share.html?id=..&tabs=ペイン,..&start=ペイン を組み立て */
  const buildHandoffUrl = (id, appTabs, startTab, allowUpload) => {
    const panes = (appTabs || []).map((t) => TAB_SHARE_PANE[t]).filter(Boolean);
    const startPane = TAB_SHARE_PANE[startTab] || panes[0] || "";
    // 編集者向け（upload）だけ &up= を付ける。先方・演者には付けない（大容量アップ権を渡さない）
    const up = allowUpload ? (shareUpTokRef.current || project.shareUpToken || "") : "";
    return shareUrl(id, project.shareReadToken || shareReadTokRef.current) + (panes.length ? "&tabs=" + panes.join(",") : "") + (startPane ? "&start=" + startPane : "") + (up ? "&up=" + up : "");
  };
  /* 受け渡しボタン押下：最新スナップを発行 → スコープ付きリンク＋文面をクリップボードへ */
  const doHandoff = async (h) => {
    const id = await publishShare(true); // 最新状態を共有スナップに反映してから渡す
    if (!id) return;
    const url = buildHandoffUrl(id, h.tabs, h.start, h.id === "editor" || h.upload === true);
    const text = (h.msg || "{url}").replace(/\{url\}/g, url).replace(/\{name\}/g, project.name || "この案件");
    setShareModal({ id, url, updated: !!project.shareId, handoff: h, text });
    try { await navigator.clipboard.writeText(text); showToast(h.label + "用のリンク＋文面をコピーしたよ。あとは貼るだけ📋"); } catch (e) {}
  };
  const TAB_LABEL = { overview: "概要", plan: "企画・サムネ", hearing: "ヒアリング", wizard: "質問ウィザード", script: "構成台本", kouban: "香盤表", assets: "素材管理", review: "動画確認", deliver: "納品完了", concept: "チャンネル" };
  /* タブ共有バー（全タブ共通・右上に固定表示）のボタン文言 */
  const TAB_SHARE_LABEL = { overview: "コンセプトを共有", plan: "企画を共有", hearing: "ヒアリングを共有", script: "台本を共有", kouban: "香盤表を共有", assets: "編集者用リンク（DL+アップ）", review: "確認URLをコピー" };
  const HANDOFF_TAB_CHOICES = ["script", "kouban", "assets", "review", "plan", "hearing", "concept"]; // 受け渡しで選べるタブ
  /* AI（Claude/GPT）に読ませる用リンク。share.html ではなくサーバー読み取り可能な JSON エンドポイントを渡す。
     #フラグメントは外部fetchで読めないので live URL は不可。/api/snap/{id} はトークン不要の読み取り専用JSON。 */
  const copyAiUrl = async () => {
    const had = !!project.shareId;
    const id = await publishShare(true); // 最新状態をスナップに反映してから渡す
    if (!id) return;
    const u = SHARE_API + "/api/snap/" + id;
    setShareModal({ id, url: u, updated: had, ai: true });
    try { await navigator.clipboard.writeText(u); showToast("AI用リンク（JSON）を更新してコピーしたよ"); } catch (e) {}
  };

  /* ---- 動画確認＋ファイル転送（R2） ---- */
  /* 共有済みスナップショットへ video/files を静かに反映（共有モーダルは出さない） */
  const syncProjectToShare = async (proj) => {
    if (!proj.shareId) return;
    try {
      await fetch(SHARE_API + "/api/publish", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: { ...proj, channelInfo: curChannelInfo, manualsGlobal: globalManuals }, prevId: proj.shareId, token: proj.shareToken }),
      });
    } catch (e) {}
  };
  const saveProject = async (next) => {
    setProject(next);
    try { await window.storage.set(STORE_PROJ(next.id), JSON.stringify(next)); } catch (e) {}
  };
  /* ブラウザ→Worker→R2 のマルチパートアップロード（鍵不要・GB級対応）。meta を返す */
  const uploadToR2 = async (file, planId = "", onProgress = null, snapOverride = null, tokenOverride = null, extraOverride = null) => {
    // 発行直後は setProject 未反映で project.shareId/Token が古い。ensureShare の戻り値を直に使えるよう上書き引数を受ける。
    const sid = snapOverride || project.shareId;
    const stok = tokenOverride != null ? tokenOverride : project.shareToken;
    // R2マルチパートは最大1万パート。500GB級でも収まるようチャンクを動的に（16〜90MB、Worker body上限内）
    // 細い/不安定な回線で1パートが小さいほど瞬断からの再試行が軽い＝下限を16MBに
    const CHUNK = Math.min(90 * 1024 * 1024, Math.max(16 * 1024 * 1024, Math.ceil(file.size / 9000)));
    const extra = { token: stok, retention, planId, ...(extraOverride || {}) };
    const cr = await fetch(SHARE_API + "/api/file/mpu/create", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snap: sid, name: file.name, size: file.size, mime: file.type || "application/octet-stream", ...extra }),
    });
    const cd = await cr.json();
    if (!cd.uploadId) throw new Error(cd.error || "開始に失敗");
    const total = Math.max(1, Math.ceil(file.size / CHUNK));
    const parts = [];
    for (let i = 0; i < total; i++) {
      const start = i * CHUNK, blob = file.slice(start, Math.min(file.size, start + CHUNK));
      let etag = null, lastErr;
      // 回線が不安定でも粘る：1パート最大6回まで再試行（指数バックオフ最大30秒）＋3分ストールで打ち切り再試行。
      // 上がり切ったパートは parts に残るので瞬断しても最初からにはならない。
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          etag = await new Promise((res, rej) => {
            const xhr = new XMLHttpRequest();
            xhr.open("PUT", SHARE_API + "/api/file/mpu/part?key=" + encodeURIComponent(cd.key) + "&uploadId=" + encodeURIComponent(cd.uploadId) + "&part=" + (i + 1));
            xhr.timeout = 180000;
            xhr.upload.onprogress = (e) => { if (e.lengthComputable) (onProgress || setMediaProg)(Math.min(100, Math.round((start + e.loaded) / file.size * 100))); };
            xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) { try { res(JSON.parse(xhr.responseText).etag); } catch (_) { rej(new Error("part応答不正")); } } else rej(new Error("part失敗(" + xhr.status + ")")); };
            xhr.onerror = () => rej(new Error("通信エラー"));
            xhr.ontimeout = () => rej(new Error("通信が止まりました（タイムアウト）"));
            xhr.send(blob);
          });
          break;
        } catch (e) { lastErr = e; if (attempt < 5) await new Promise((r) => setTimeout(r, Math.min(30000, 2000 * Math.pow(2, attempt)))); }
      }
      if (etag == null) throw lastErr || new Error("part失敗");
      parts.push({ partNumber: i + 1, etag });
    }
    const fr = await fetch(SHARE_API + "/api/file/mpu/complete", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snap: sid, key: cd.key, uploadId: cd.uploadId, parts, name: file.name, size: file.size, mime: file.type || "application/octet-stream", ...extra }),
    });
    const fd = await fr.json();
    if (!fd.file) throw new Error(fd.error || "確定に失敗");
    return fd.file;
  };
  /* 動画/ファイルの格納先。target = "project"(案件全体) | planId(企画) */
  const findPlan = (target) => (project.plans || []).find((pl) => pl.id === target);
  const getTargetVideo = (target) => { if (target === "project") return project.video; const pl = findPlan(target); return pl ? pl.video : null; };
  const getTargetFiles = (target) => { if (target === "project") return project.files || []; const pl = findPlan(target); return (pl && pl.files) ? pl.files : []; };
  // 企画の試写スナップ（plan.shareId）に video/files を反映（あるときだけ）
  const syncPlanShare = async (pl) => {
    if (!pl || !pl.shareId) return;
    try {
      const mini = { name: pl.title || "企画", channel: project.channel, format: "documentary", meta: {}, theme: project.theme, rows: [], plans: [], talk: null, video: pl.video || null, files: pl.files || [] };
      await fetch(SHARE_API + "/api/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: mini, prevId: pl.shareId, token: pl.shareToken }) });
    } catch (e) {}
  };
  const putVideo = async (target, video) => {
    const next = target === "project" ? { ...project, video }
      : { ...project, plans: (project.plans || []).map((pl) => (pl.id === target ? { ...pl, video } : pl)) };
    await saveProject(next);
    await syncProjectToShare(next);
    if (target !== "project") await syncPlanShare(next.plans.find((p) => p.id === target));
  };
  const putFiles = async (target, files) => {
    const next = target === "project" ? { ...project, files }
      : { ...project, plans: (project.plans || []).map((pl) => (pl.id === target ? { ...pl, files } : pl)) };
    await saveProject(next);
    await syncProjectToShare(next);
    if (target !== "project") await syncPlanShare(next.plans.find((p) => p.id === target));
  };
  // 企画ごとの試写リンク（その企画の動画・素材・コメントだけ）を発行
  const publishPlanShare = async (planId) => {
    if (!project) return;
    const pl = (project.plans || []).find((p) => p.id === planId);
    if (!pl) return;
    if (!pl.video && !(pl.files || []).length) { showToast("先にこの企画へ動画かファイルを入れてね"); return; }
    setSharing(true);
    try {
      const mini = { name: pl.title || "企画", channel: project.channel, format: "documentary", meta: {}, theme: project.theme, rows: [], plans: [], talk: null, video: pl.video || null, files: pl.files || [] };
      const res = await fetch(SHARE_API + "/api/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: mini, prevId: pl.shareId || null, token: pl.shareToken || null }) });
      const data = await res.json();
      if (!data.id) throw new Error(data.error || "発行失敗");
      const next = { ...project, plans: project.plans.map((p) => (p.id === planId ? { ...p, shareId: data.id, shareToken: data.token || p.shareToken, shareReadToken: data.rtok || p.shareReadToken } : p)) };
      await saveProject(next);
      const url = shareUrl(data.id, data.rtok || pl.shareReadToken);
      setShareModal({ id: data.id, url, updated: !!pl.shareId, planShare: true });
      try { await navigator.clipboard.writeText(url); } catch (e) {}
    } catch (e) { showToast("企画の試写リンク発行に失敗：" + (e.message || e)); }
    setSharing(false);
  };
  /* mp4 を動画として登録（onProgress指定時はカード内バー、未指定はモーダルの共通バー） */
  const uploadVideo = async (file, target = "project", onProgress = null) => {
    if (!/^video\//.test(file.type) && !/\.(mp4|mov|m4v|webm)$/i.test(file.name)) { showToast("動画ファイルを選んでね"); return; }
    const sh = await ensureShare(); if (!sh) return;   // 未発行ならその場で自動発行
    if (!onProgress) { setMediaBusy("動画をアップロード中…"); setMediaProg(0); }
    try {
      const meta = await uploadToR2(file, target === "project" ? "" : target, onProgress, sh.id, sh.token);
      const prev = getTargetVideo(target);
      await putVideo(target, { type: "mp4", key: meta.key, name: meta.name, title: (prev && prev.title) || file.name });
      showToast("動画を登録したよ");
    } catch (e) { showToast("動画アップロードに失敗：" + (e.message || e)); }
    if (!onProgress) setMediaBusy("");
  };
  /* YouTube URL を動画として登録 */
  const registerYouTubeUrl = async (target, rawUrl) => {
    const vid = ytIdFromUrl(rawUrl);
    if (!vid) { showToast("YouTubeのURLが正しくないみたい"); return; }
    const prev = getTargetVideo(target);
    await putVideo(target, { type: "youtube", url: "https://www.youtube.com/watch?v=" + vid, title: (prev && prev.title) || "" });
    showToast("YouTube動画を登録したよ");
  };
  const registerYouTube = async (target = "project") => { await registerYouTubeUrl(target, ytInput); setYtInput(""); };
  const removeVideo = async (target = "project") => {
    const v = getTargetVideo(target);
    await putVideo(target, null);
    if (v && v.type === "mp4" && v.key) {
      try { await fetch(SHARE_API + "/api/file/" + v.key + "?snap=" + project.shareId + "&token=" + encodeURIComponent(project.shareToken), { method: "DELETE" }); } catch (e) {}
    }
  };
  /* 転送ファイルを追加 */
  const uploadFile = async (file, target = "project", onProgress = null) => {
    const sh = await ensureShare(); if (!sh) return;   // 未発行ならその場で自動発行
    if (!onProgress) { setMediaBusy("アップロード中…"); setMediaProg(0); }
    try {
      const meta = await uploadToR2(file, target === "project" ? "" : target, onProgress, sh.id, sh.token);
      await putFiles(target, [...getTargetFiles(target), meta]);
      showToast("ファイルを追加したよ");
    } catch (e) { showToast("アップロードに失敗：" + (e.message || e)); }
    if (!onProgress) setMediaBusy("");
  };
  const deleteFile = async (target, key) => {
    await putFiles(target, getTargetFiles(target).filter((f) => f.key !== key));
    try { await fetch(SHARE_API + "/api/file/" + key + "?snap=" + project.shareId + "&token=" + encodeURIComponent(project.shareToken), { method: "DELETE" }); } catch (e) {}
  };

  /* ===== 素材管理（assets単一正本）のCRUD ===== */
  const setAssets = (updater) => setProject((p) => ({ ...p, assets: typeof updater === "function" ? updater(Array.isArray(p.assets) ? p.assets : []) : updater }));
  /* ファイル/動画を素材として登録（カテゴリ指定）。R2へ上げて asset を1件追加 */
  const uploadAsset = async (file, category = "撮影素材", batch = null) => {
    let sh;
    try { sh = await ensureShare(); } catch (e) { sh = null; }   // 未発行ならその場で自動発行
    if (!sh) { showToast("共有の発行に失敗してアップできなかった。回線を確認してもう一度試して"); return false; }
    const lbl = batch ? `${category}（${batch.i}/${batch.n}）` : category;
    setAssetUp({ cat: category, name: file.name, pct: 0 });
    try {
      // 素材管理（撮影素材・テンプレ素材）は無期限固定。90日で勝手に消えると後日の再編集・編集者の後追いDLで素材ロストになるため（確認用動画と同じ思想）。
      const meta = await uploadToR2(file, "", (p) => setAssetUp({ cat: category, name: (batch ? `[${batch.i}/${batch.n}] ` : "") + file.name, pct: p }), sh.id, sh.token, { retention: 0 });
      const isVideo = /^video\//.test(file.type) || /\.(mp4|mov|m4v|webm)$/i.test(file.name);
      // フォルダごとドロップした素材はフォルダ階層を folder に保持（シーン区分）。平置き＝構造消失を防ぐ。
      const folder = (file._folder || "").toString().slice(0, 160);
      setAssets((arr) => [newAsset(category, { type: isVideo ? "mp4" : "file", key: meta.key, name: meta.name, size: meta.size || file.size, mime: meta.mime || file.type, folder }), ...arr]);
      if (!batch) showToast(category + "に追加したよ");
      return true;
    } catch (e) { showToast(file.name + " のアップロードに失敗：" + (e.message || e)); return false; }
    finally { if (!batch) setAssetUp(null); }
  };
  /* 複数ファイルは1本ずつ順番にアップ（同時多発だと回線レース＋進捗が壊れる。大容量の撮影素材で特に）。 */
  const uploadAssets = async (files, category = "撮影素材") => {
    const list = Array.from(files || []);
    if (!list.length) return;
    let ok = 0;
    for (let i = 0; i < list.length; i++) {
      const done = await uploadAsset(list[i], category, { i: i + 1, n: list.length });
      if (done) ok++;
    }
    setAssetUp(null);
    if (list.length > 1) showToast(`${category}：${ok}/${list.length}件アップ完了`);
    else if (ok) showToast(category + "に追加したよ");
  };
  /* YouTube/参考URLを素材として登録 */
  const addAssetUrl = (category, rawUrl, name = "") => {
    const url = (rawUrl || "").trim();
    if (!url) return;
    const vid = ytIdFromUrl(url);
    setAssets((arr) => [newAsset(category, { type: vid ? "youtube" : "file", url: vid ? "https://www.youtube.com/watch?v=" + vid : url, name: name || (vid ? "YouTube動画" : url) }), ...arr]);
    showToast(category + "にリンクを追加したよ");
  };
  const removeAsset = async (id) => {
    const a = (project.assets || []).find((x) => x.id === id);
    setAssets((arr) => arr.filter((x) => x.id !== id));
    if (a && a.key) { try { await fetch(SHARE_API + "/api/file/" + a.key + "?snap=" + project.shareId + "&token=" + encodeURIComponent(project.shareToken), { method: "DELETE" }); } catch (e) {} }
  };
  // 納品完了タブ：サムネ画像アップロード（最大6枚）
  const DELIVER_THUMB_MAX = 6;
  const deliverThumbs = () => (m.deliverThumbImages && Array.isArray(m.deliverThumbImages)) ? m.deliverThumbImages : (m.deliverThumbImage ? [m.deliverThumbImage] : []);
  const uploadDeliverThumbs = async (files) => {
    const list = Array.from(files || []).filter((f) => /^image\//.test(f.type));
    if (!list.length) { showToast("画像ファイルを選んでね"); return; }
    const room = DELIVER_THUMB_MAX - deliverThumbs().length;
    if (room <= 0) { showToast(`サムネ画像は最大${DELIVER_THUMB_MAX}枚まで`); return; }
    const todo = list.slice(0, room);
    if (list.length > todo.length) showToast(`最大${DELIVER_THUMB_MAX}枚までのため${todo.length}枚だけアップします`);
    const sh = await ensureShare();
    if (!sh) { showToast("共有の発行に失敗してアップできなかった"); return; }
    let current = deliverThumbs(); // setMetaは非同期反映のため、進捗はローカル変数で積み上げる（mの読み直しだと前段の追加分が消える）
    for (let i = 0; i < todo.length; i++) {
      setThumbUp({ i: i + 1, n: todo.length, pct: 0 });
      try {
        const meta = await uploadToR2(todo[i], "", (p) => setThumbUp({ i: i + 1, n: todo.length, pct: p }), sh.id, sh.token);
        current = [...current, { key: meta.key, name: meta.name, mime: meta.mime || todo[i].type }];
        setMeta("deliverThumbImages", current);
      } catch (e) { showToast(todo[i].name + " のアップロードに失敗：" + (e.message || e)); }
    }
    setThumbUp(null);
  };
  const removeDeliverThumb = async (idx) => {
    const old = deliverThumbs()[idx];
    setMeta("deliverThumbImages", deliverThumbs().filter((_, i) => i !== idx));
    if (old && old.key) { try { await fetch(SHARE_API + "/api/file/" + old.key + "?snap=" + project.shareId + "&token=" + encodeURIComponent(project.shareToken), { method: "DELETE" }); } catch (e) {} }
  };
  // 既存タイルをクリック→その場で差し替え（位置はそのまま・古い方はhard delete）
  const replaceDeliverThumb = async (idx, file) => {
    if (!file || !/^image\//.test(file.type)) { showToast("画像ファイルを選んでね"); return; }
    const old = deliverThumbs()[idx];
    setThumbUp({ i: 1, n: 1, pct: 0 });
    try {
      const sh = await ensureShare();
      if (!sh) { showToast("共有の発行に失敗してアップできなかった"); return; }
      const meta = await uploadToR2(file, "", (p) => setThumbUp({ i: 1, n: 1, pct: p }), sh.id, sh.token);
      setMeta("deliverThumbImages", deliverThumbs().map((t, i) => (i === idx ? { key: meta.key, name: meta.name, mime: meta.mime || file.type } : t)));
      if (old && old.key) { try { await fetch(SHARE_API + "/api/file/" + old.key + "?snap=" + project.shareId + "&token=" + encodeURIComponent(project.shareToken), { method: "DELETE" }); } catch (e) {} }
    } catch (e) { showToast("アップロードに失敗：" + (e.message || e)); }
    finally { setThumbUp(null); }
  };
  const moveAsset = (id, category) => setAssets((arr) => arr.map((x) => (x.id === id ? { ...x, category } : x)));
  const renameAsset = (id, name) => { const n = (name || "").trim(); if (n) setAssets((arr) => arr.map((x) => (x.id === id ? { ...x, name: n } : x))); };
  const assetUrl = (a) => a.type === "youtube" ? a.url : (a.key ? (SHARE_API + "/api/file/" + a.key) : a.url);
  const fmtSize = (n) => { n = Number(n) || 0; if (n >= 1e9) return (n / 1e9).toFixed(1) + "GB"; if (n >= 1e6) return (n / 1e6).toFixed(1) + "MB"; if (n >= 1e3) return Math.round(n / 1e3) + "KB"; return n + "B"; };
  // 素材ダウンロード（?dl=1 で worker が Content-Disposition を付け元ファイル名で保存。?name= でアプリ内リネームを反映）
  const downloadAsset = (a) => {
    if (!a || a.type === "youtube" || !a.key) return false;
    const link = document.createElement("a");
    link.href = SHARE_API + "/api/file/" + a.key + "?dl=1" + (a.name ? "&name=" + encodeURIComponent(a.name) : "");
    link.download = a.name || ""; link.rel = "noreferrer";
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    return true;
  };
  const downloadAssets = (list) => {
    const dl = (list || []).filter((a) => a && a.key && a.type !== "youtube");
    dl.forEach((a, i) => setTimeout(() => downloadAsset(a), i * 600)); // 連続DLブロック回避でずらす
    return dl.length;
  };
  const toggleSelAsset = (id) => setSelAssets((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  // 編集者が共有リンクから上げた素材(file_up)を、この案件の素材管理に取り込む
  const importGuestUploads = async (silent) => {
    if (!project || !project.shareId) { if (!silent) showToast("先に確認用URLを発行してね"); return; }
    let ups = [];
    try { const r = await fetch(SHARE_API + "/api/snap/" + project.shareId + "/uploads"); const d = await r.json(); ups = (d && d.uploads) || []; }
    catch (e) { if (!silent) showToast("取り込み失敗：" + (e.message || e)); return; }
    const have0 = new Set((project.assets || []).map((a) => a.key).filter(Boolean));
    const haveVer = new Set(reviewVersions().map((v) => v.key).filter(Boolean));
    // 重複判定は役割ごとに分ける：完成動画(role:review)の再取り込みをブロックしていいのは
    // 「動画確認のバージョン一覧（ゴミ箱含む＝意図的削除の尊重）」だけ。
    // 素材管理のミラー(have0)まで見ると、バージョン側だけ消えた時に編集者の新版が永久に入らなくなる（2026-07-07 近川さん）
    const fresh = ups.filter((u) => u && u.key && (u.role === "review" ? !haveVer.has(u.key) : (!have0.has(u.key) && !haveVer.has(u.key))));
    if (!fresh.length) { if (!silent) showToast("新しい編集者アップはありません"); return; }
    // 完成動画(role:review)は「動画確認」のバージョンへ、それ以外は素材へ
    const reviewUps = fresh.filter((u) => u.role === "review");
    const assetUps = fresh.filter((u) => u.role !== "review");
    const mk = (u) => { const isVid = /^video\//.test(u.mime || "") || /\.(mp4|mov|m4v|webm)$/i.test(u.name || ""); return newAsset("撮影素材", { type: isVid ? "mp4" : "file", key: u.key, name: u.name || "ファイル", size: u.size || 0, mime: u.mime || "", planId: u.planId || "", folder: u.folder || "", by: "guest" }); };
    if (assetUps.length) setAssets((arr) => { const have = new Set(arr.map((a) => a.key).filter(Boolean)); const add = assetUps.filter((u) => !have.has(u.key)).map(mk); return add.length ? [...add, ...arr] : arr; });
    for (const u of reviewUps) {
      // R2直再生で即追加し、Stream（軽量化）が使えるなら変換して差し替え
      let v = { type: "mp4", key: u.key };
      try {
        const r = await fetch(SHARE_API + "/api/stream/copy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ snap: project.shareId, token: project.shareToken, key: u.key, name: u.name || "編集者アップ" }) });
        const d = await r.json();
        if (d.uid) v = { type: "stream", uid: d.uid, key: u.key, ready: false };
      } catch (e) {}
      await addVersionFromVideo(v, (u.name || "編集者アップ"));
      if (v.type === "stream") pollStreamReady(v.uid);
    }
    if (!silent) showToast("編集者アップを取り込んだよ（動画" + reviewUps.length + "・素材" + assetUps.length + "件）");
  };
  /* 自己修復：共有snap側にだけ残っている版をローカルへ回収。
     クラウド同期の巻き戻りや別端末の上書きでローカルの版が消えると、編集者の新版が「無かったこと」になる事故の防止網。
     ローカルに同じ key/uid があれば（ゴミ箱含む＝意図的削除の尊重）触らない。 */
  const reconcileVersionsFromSnap = async () => {
    if (!project || !project.shareId) return;
    try {
      const sn = await fetch(SHARE_API + "/api/snap/" + project.shareId + "?token=" + encodeURIComponent(project.shareToken || "")).then((r) => r.json());
      const sv = (((sn && sn.project) || {}).review || {}).versions || [];
      const cand = sv.filter((v) => v && !v.trashedAt && (v.key || v.uid));
      if (!cand.length) return;
      setVersions((arr) => {
        const has = (v) => arr.some((x) => (v.uid && x.uid === v.uid) || (v.key && x.key === v.key));
        const add = cand.filter((v) => !has(v));
        if (add.length) console.log("[mg] snapから版を回収:", add.map((v) => v.label).join(","));
        return add.length ? [...arr, ...add.map((v) => ({ ...v }))] : arr;
      });
    } catch (e) {}
  };
  const reconcileRef = React.useRef(null);
  reconcileRef.current = reconcileVersionsFromSnap;
  // 素材管理タブを開いたら編集者アップを自動取り込み（サイレント）＋snap側との版の自己修復
  React.useEffect(() => { if ((tab === "assets" || tab === "review") && project && project.shareId) { importGuestUploads(true); reconcileVersionsFromSnap(); } }, [tab, project && project.shareId]);
  // タブ切替時だけだと「動画確認に居っぱなし」で編集者の新版に永遠に気づけない（2026-07-05 喜多さん0704）。
  // 案件を開いている間は45秒ごとに拾う。refで毎レンダー最新のクロージャを持たせる＝古いproject stateで重複取り込みしない
  const importGuestRef = React.useRef(null);
  importGuestRef.current = importGuestUploads;
  React.useEffect(() => {
    if (!project || !project.shareId) return;
    const t = setInterval(() => { try { importGuestRef.current && importGuestRef.current(true); reconcileRef.current && reconcileRef.current(); } catch (e) {} }, 45000);
    return () => clearInterval(t);
  }, [project && project.shareId]);

  // 進行ボード：ホーム表示時にFlip Board(D1)の全案件をまとめて引く（担当・工程・次の締切の可視化）
  React.useEffect(() => {
    if (view !== "home") return;
    let live = true;
    (async () => {
      try {
        const r = await fetch(SHARE_API + "/api/board");
        const d = await r.json();
        if (live) setBoard(d && Array.isArray(d.rows) ? d.rows : null);
      } catch (_) { /* 取れなければ静かに非表示 */ }
    })();
    return () => { live = false; };
  }, [view]);

  // 進行ストリップ：Flip Board(D1正本)から担当案件の日程スライスを引く。未公開(shareId無し)/未リンクは出さない（窓表示・読み取り専用）
  React.useEffect(() => {
    const id = project && project.shareId;
    if (!id) { setSched(null); return; }
    let live = true;
    (async () => {
      try {
        const r = await fetch(SHARE_API + "/api/schedule?id=" + encodeURIComponent(id),
          MG_SESSION ? { headers: { Authorization: "Bearer " + MG_SESSION } } : undefined); // ログイン中はemailを渡しcanReportUp判定
        const d = await r.json();
        if (live) setSched(d && d.found ? d : null);
      } catch (_) { if (live) setSched(null); }
    })();
    return () => { live = false; };
  }, [project && project.shareId]);

  // あがり報告：担当編集者のワンタップで ball→AK（Flip Board書き戻し）。phaseは触らずAKが確認して進める。
  const [reportingUp, setReportingUp] = useState(false);
  const reportUp = async () => {
    if (!sched || !project || !project.shareId || reportingUp) return;
    setReportingUp(true);
    try {
      const d = await authFetch("/api/report-up", { id: project.shareId });
      if (d && d.ok) { setSched((s) => (s ? { ...s, ballHolder: "ak", canReportUp: false } : s)); showToast("AKにあがり報告したよ ✅"); }
      else showToast("報告できなかった：" + ((d && d.error) || "不明"));
    } catch (e) { showToast("報告失敗：" + (e.message || e)); }
    finally { setReportingUp(false); }
  };

  // 納品セット完了報告：納品完了タブのワンタップで ball→AK＋納品動画URLをFlip Boardに書き添え。
  // 納品確定(status='delivered')はAKがFボード側で押す＝誤タップが請求まで波及しない承認ゲート。
  const [reportingDelivered, setReportingDelivered] = useState(false);
  const reportDelivered = async () => {
    if (!project || !project.shareId || reportingDelivered) return;
    if (!window.confirm("納品セット完了をAKに報告しますか？\n（Flip BoardのボールがAKに渡り、納品動画URLが書き添えられます。納品確定はAKが行います）")) return;
    setReportingDelivered(true);
    try {
      const d = await authFetch("/api/report-delivered", { id: project.shareId, videoUrl: ((project.meta || {}).deliverVideoUrl || "").trim() });
      if (d && d.ok) {
        setSched((s) => (s ? { ...s, ballHolder: "ak", canReportUp: false } : s));
        showToast(d.note === "already" ? (d.status ? "この案件はもう納品済みだよ" : "もう報告済みだよ（ボールはAKにあります）") : "納品セット完了をAKに報告したよ 📦");
      } else showToast("報告できなかった：" + ((d && d.error) || "不明"));
    } catch (e) { showToast(e.code === 401 ? "報告にはログインが必要です" : "報告失敗：" + (e.message || e)); }
    finally { setReportingDelivered(false); }
  };

  // 変換中(stream)のまま戻ってきた版のポーリングを再開＝リロードで「変換中%」が固まる問題の根治
  const streamResumeRef = React.useRef({});
  const resumeStreamPolls = (force) => {
    for (const v of reviewVersions()) {
      // 変換失敗(streamFailed)は生データ再生で確定済み＝自動では再開しない。手動(force)のみ再試行
      if (v && v.type === "stream" && !v.ready && v.uid && (force || (!streamResumeRef.current[v.uid] && !v.streamFailed))) {
        if (force) { streamResumeRef.current[v.uid] = 0; setVersions((arr) => arr.map((x) => (x.uid === v.uid ? { ...x, streamFailed: false } : x))); }
        streamResumeRef.current[v.uid] = 1;
        pollStreamReady(v.uid);
      }
    }
  };
  React.useEffect(() => { if (tab === "review" && project) resumeStreamPolls(false); }, [tab, project && project.id]);

  /* 動画アップ＆ギガファイルの本体（モーダルと「動画・ファイル」タブで共用） */
  const renderMediaBody = (inModal = false) => {
    if (!project.shareId) {
      return (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-[12px] text-amber-800">
          先に<span className="font-bold">共有リンクを発行</span>してね。発行すると、ここに動画やファイルを載せて先方に確認してもらえるよ。
          <div className="mt-3"><button onClick={() => { if (inModal) setShowMediaModal(false); publishShare(); }} className="text-[11px] font-bold px-4 py-2 rounded-lg shadow" style={{ background: theme.accent, color: accentText }}>共有リンクを発行</button></div>
        </div>
      );
    }
    return (
      <>
        {/* 対象（案件全体 / 企画ごと）＋保存期限 */}
        <div className="flex items-center gap-2 text-[12px] flex-wrap">
          <span className="font-bold text-stone-600">対象</span>
          <select value={mediaTarget} onChange={(e) => setMediaTarget(e.target.value)} className="border border-stone-200 rounded-lg px-2 py-1 text-[12px] max-w-[200px]">
            <option value="project">案件全体</option>
            {(project.plans || []).map((pl, i) => (
              <option key={pl.id} value={pl.id}>{"企画" + (i + 1) + (pl.title ? "：" + pl.title.slice(0, 16) : "")}</option>
            ))}
          </select>
          <span className="font-bold text-stone-600 ml-2">保存期限</span>
          <select value={retention} onChange={(e) => setRetention(+e.target.value)} className="border border-stone-200 rounded-lg px-2 py-1 text-[12px]">
            <option value={30}>30日</option>
            <option value={90}>90日</option>
            <option value={0}>無期限</option>
          </select>
        </div>
        <p className="text-[10px] text-stone-400 -mt-3">企画ごとに動画・ファイルを1セット設定できるよ（本編／ショート等を分けて試写）。</p>

        {/* 動画確認 */}
        <div>
          <div className="text-[12px] font-bold text-stone-700 mb-2">🎬 確認用の動画</div>
          {getTargetVideo(mediaTarget) ? (
            <div>
              <VideoView video={getTargetVideo(mediaTarget)} main={theme.main} />
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: theme.main, color: mainText }}>{getTargetVideo(mediaTarget).type === "youtube" ? "YouTube" : "mp4"}</span>
                <span className="flex-1 min-w-0 truncate text-[12px]">{getTargetVideo(mediaTarget).title || getTargetVideo(mediaTarget).name || getTargetVideo(mediaTarget).url}</span>
                <button onClick={() => removeVideo(mediaTarget)} className="text-[11px] text-rose-500 font-bold shrink-0">削除</button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block rounded-lg border border-dashed border-stone-300 bg-stone-50 px-3 py-3 text-[12px] text-stone-500 cursor-pointer hover:bg-stone-100">
                <input type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) uploadVideo(f, mediaTarget); e.target.value = ""; }} />
                ⬆ mp4をアップロード（0.5〜4倍速で確認できる）
              </label>
              <div className="flex items-center gap-2">
                <input value={ytInput} onChange={(e) => setYtInput(e.target.value)} placeholder="または YouTube限定公開URL を貼る" className="flex-1 min-w-0 border border-stone-200 rounded-lg px-2 py-1.5 text-[12px] focus:outline-none" />
                <button onClick={() => registerYouTube(mediaTarget)} className="text-[11px] font-bold px-3 py-1.5 rounded-lg shrink-0" style={{ background: theme.main, color: mainText }}>登録</button>
              </div>
            </div>
          )}
        </div>

        {/* ファイル転送 */}
        <div>
          <div className="text-[12px] font-bold text-stone-700 mb-2">📁 ファイル転送（元のファイル名のまま渡せる）</div>
          {getTargetFiles(mediaTarget).length > 0 && (
            <div className="space-y-1.5 mb-2">
              {getTargetFiles(mediaTarget).map((f) => (
                <div key={f.key} className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-semibold text-stone-800 truncate">{f.name}</div>
                    <div className="text-[10px] text-stone-400" style={{ fontFamily: mono }}>{f.size >= 1073741824 ? (f.size / 1073741824).toFixed(2) + " GB" : f.size >= 1048576 ? (f.size / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(f.size / 1024)) + " KB"}{f.expiresAt ? " ・" + (f.expiresAt || "").slice(0, 10) + "まで" : " ・無期限"}</div>
                  </div>
                  <a href={SHARE_API + "/api/file/" + f.key + "?dl=1"} target="_blank" rel="noreferrer" className="text-[11px] font-bold px-2.5 py-1 rounded-lg shrink-0" style={{ background: theme.main, color: mainText }}>⬇</a>
                  <button onClick={() => deleteFile(mediaTarget, f.key)} className="text-[11px] text-rose-500 font-bold shrink-0">削除</button>
                </div>
              ))}
            </div>
          )}
          <label className="block rounded-lg border border-dashed border-stone-300 bg-stone-50 px-3 py-3 text-[12px] text-stone-500 cursor-pointer hover:bg-stone-100">
            <input type="file" className="hidden" onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) uploadFile(f, mediaTarget); e.target.value = ""; }} />
            ⬆ ファイルを追加（最大500GB）
          </label>
          <p className="text-[10px] text-stone-400 mt-1.5">先方も共有ページの「ファイル」タブから素材をアップできるよ（2GBまで）。<span className="font-bold">「編集へ」リンクで渡した編集者は大容量＆「動画」タブから完成動画を直接アップ</span>できる。</p>
        </div>

        {mediaBusy && (
          <div className="rounded-lg bg-stone-50 border border-stone-200 p-3">
            <div className="text-[11px] text-stone-500 mb-1">{mediaBusy} {mediaProg}%</div>
            <div className="h-1.5 bg-stone-200 rounded overflow-hidden"><div className="h-full" style={{ width: mediaProg + "%", background: theme.accent }} /></div>
          </div>
        )}
      </>
    );
  };

  /* ---- 先方コメント ---- */
  // 案件スナップ＋各企画の試写スナップから集めて1つに（videoKeyで動画別に束ねる）
  const fetchComments = async () => {
    if (!project) { setComments([]); return; }
    const sources = [];
    if (project.shareId) sources.push({ id: project.shareId, token: project.shareToken });
    (project.plans || []).forEach((pl) => { if (pl.shareId) sources.push({ id: pl.shareId, token: pl.shareToken }); });
    if (!sources.length) { setComments([]); return; }
    try {
      const all = [], seen = new Set();
      for (const s of sources) {
        const r = await fetch(SHARE_API + "/api/snap/" + s.id + "/comments");
        const d = await r.json();
        (Array.isArray(d.comments) ? d.comments : []).forEach((c) => { if (!seen.has(c.id)) { seen.add(c.id); all.push({ ...c, _snap: s.id, _token: s.token }); } });
      }
      setComments(all);
    } catch (e) { /* オフライン時は無視 */ }
  };
  // 企画カードの動画にコメント投稿（AK＝ディレクター視点。timecode付き。企画に試写リンクがあればそちらへ）
  const postPlanComment = async (videoKey, timecode, text, snapId, snapToken) => {
    const t = (text || "").trim();
    if (!t) return false;
    const snap = snapId || (project && project.shareId);
    const token = snapToken || (project && project.shareToken);
    if (!snap) { showToast("先に共有リンクを発行してね"); return false; }
    const author = (user && user.name) ? user.name : "ディレクター";
    try {
      const r = await fetch(SHARE_API + "/api/snap/" + snap + "/comments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timecode: (typeof timecode === "number" ? timecode : null), videoKey: videoKey || "", author, text: t }),
      });
      const d = await r.json();
      if (d.comment) { setComments((cs) => [...cs, { ...d.comment, _snap: snap, _token: token }]); return d.comment; }
    } catch (e) {}
    showToast("コメント送信に失敗");
    return false;
  };
  const resolveComment = async (cid, resolved) => {
    const c = comments.find((x) => x.id === cid);
    const snap = (c && c._snap) || (project && project.shareId);
    const token = (c && c._token) || (project && project.shareToken);
    if (!snap) return;
    setComments((cs) => cs.map((x) => (x.id === cid ? { ...x, resolved } : x))); // 楽観更新
    try {
      await fetch(SHARE_API + "/api/snap/" + snap + "/comments/" + cid, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolved, token }),
      });
    } catch (e) { showToast("更新に失敗しました"); }
  };

  /* ===== 修正管理：コメント投稿（属性付き）／状態変更／返信／削除 ===== */
  const postReviewComment = async (body) => {
    const snap = project && project.shareId, token = project && project.shareToken;
    if (!snap) { showToast("先に確認用URLを発行してね"); return false; }
    const author = (user && user.name) ? user.name : "ディレクター";
    try {
      const r = await fetch(SHARE_API + "/api/snap/" + snap + "/comments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author, ...body }),
      });
      const d = await r.json();
      if (d.comment) { setComments((cs) => [...cs, { ...d.comment, _snap: snap, _token: token }]); return d.comment; }
    } catch (e) {}
    showToast("コメント送信に失敗"); return false;
  };
  const updateComment = async (cid, patch) => {
    const c = comments.find((x) => x.id === cid);
    const snap = (c && c._snap) || (project && project.shareId);
    const token = (c && c._token) || (project && project.shareToken);
    if (!snap) return;
    setComments((cs) => cs.map((x) => (x.id === cid ? { ...x, ...patch, resolved: patch.status ? patch.status === "完了" : x.resolved } : x)));
    try { await fetch(SHARE_API + "/api/snap/" + snap + "/comments/" + cid, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...patch, token }) }); }
    catch (e) { showToast("更新に失敗しました"); }
  };
  const addCommentReply = async (cid, text) => {
    const t = (text || "").trim(); if (!t) return;
    const c = comments.find((x) => x.id === cid);
    const snap = (c && c._snap) || (project && project.shareId);
    if (!snap) return;
    const author = (user && user.name) ? user.name : "ディレクター";
    const reply = { author, text: t, createdAt: new Date().toISOString() };
    setComments((cs) => cs.map((x) => (x.id === cid ? { ...x, replies: [...(x.replies || []), reply] } : x)));
    try { await fetch(SHARE_API + "/api/snap/" + snap + "/comments/" + cid, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reply }) }); }
    catch (e) { showToast("返信に失敗しました"); }
  };
  const deleteComment = async (cid) => {
    const c = comments.find((x) => x.id === cid);
    const snap = (c && c._snap) || (project && project.shareId);
    const token = (c && c._token) || (project && project.shareToken);
    if (!snap) return;
    setComments((cs) => cs.filter((x) => x.id !== cid));
    try { await fetch(SHARE_API + "/api/snap/" + snap + "/comments/" + cid + "?token=" + encodeURIComponent(token || ""), { method: "DELETE" }); } catch (e) {}
  };

  /* ===== 確認動画バージョン（v1/v2/v3…） ===== */
  const reviewVersions = () => (project && project.review && Array.isArray(project.review.versions)) ? project.review.versions : [];
  const activeReviewVersions = () => reviewVersions().filter((v) => !v.trashedAt);
  const trashedReviewVersions = () => reviewVersions().filter((v) => v.trashedAt);
  const setVersions = (updater) => setProject((p) => { const rv = (p.review && p.review.versions) || []; const next = typeof updater === "function" ? updater(rv) : updater; return { ...p, review: { versions: next, comments: (p.review && p.review.comments) || [] } }; });
  const addVersionFromVideo = async (vobj, name) => {
    setVersions((arr) => {
      // 採番は「配列長+1」だと削除や競合でv3が2個できる（2026-07-07 近川さんで実発生）→既存最大番号+1
      const maxN = arr.reduce((mx, v) => { const m = /^v(\d+)$/.exec(v.label || ""); return m ? Math.max(mx, +m[1]) : mx; }, 0);
      const label = "v" + (maxN + 1);
      const v = { id: uid(), label, name: name || label, type: vobj.type, key: vobj.key || "", url: vobj.url || "", uid: vobj.uid || "", hls: vobj.hls || "", ready: vobj.type === "stream" ? !!vobj.ready : true, createdAt: Date.now(), createdBy: (user && user.name) || "ディレクター" };
      // 素材管理の「確認用動画」にもミラー（DLは元のR2マスター）
      setAssets((as) => [newAsset("確認用動画", { type: vobj.type === "youtube" ? "youtube" : "mp4", key: vobj.key || "", url: vobj.url || "", name: v.name, versionId: v.id }), ...as]);
      return [...arr, v];
    });
  };
  /* Stream変換状況をポーリングして hls を埋める */
  const pollStreamReady = async (sid, tries = 0) => {
    // 打ち切り条件でも生データ再生は生きてるので「観られない」事故にはならない
    if (tries > 80) { setVersions((arr) => arr.map((x) => (x.uid === sid && !x.ready ? { ...x, streamFailed: true } : x))); return; }
    try {
      const r = await fetch(SHARE_API + "/api/stream/" + sid);
      const d = await r.json();
      if (d.ready && d.hls) { setVersions((arr) => arr.map((x) => (x.uid === sid ? { ...x, ready: true, hls: d.hls, pct: 100, streamFailed: false } : x))); return; }
      // Stream変換が失敗(error)→軽量化を諦めて生データ再生に確定。永遠「変換中」を撲滅
      if (d.state === "error") { streamResumeRef.current[sid] = 1; setVersions((arr) => arr.map((x) => (x.uid === sid ? { ...x, streamFailed: true } : x))); return; }
      setVersions((arr) => arr.map((x) => (x.uid === sid ? { ...x, pct: d.pct || x.pct } : x)));
    } catch (e) {}
    setTimeout(() => pollStreamReady(sid, tries + 1), 5000);
  };
  const uploadVersionVideo = async (file, onProgress = null) => {
    if (!/^video\//.test(file.type) && !/\.(mp4|mov|m4v|webm)$/i.test(file.name)) { showToast("動画ファイルを選んでね"); return; }
    const sh = await ensureShare(); if (!sh) return;   // 確認用URLは動画アップの副産物として自動発行（先に手で発行させない）
    setMediaBusy("動画をアップロード中…"); setMediaProg(0);
    try {
      // 確認用バージョン＝納品URLにもなる金看板。保存期限で消えると先方に渡したURLが死ぬため無期限固定
      const meta = await uploadToR2(file, "", onProgress, sh.id, sh.token, { retention: 0 });
      // Streamへ取り込み（自動で軽量化）。無効/失敗ならR2直再生にフォールバック
      let v = null;
      try {
        const r = await fetch(SHARE_API + "/api/stream/copy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ snap: sh.id, token: sh.token, key: meta.key, name: file.name }) });
        const d = await r.json();
        if (d.uid) v = { type: "stream", uid: d.uid, key: meta.key, ready: false };
      } catch (e) {}
      if (!v) v = { type: "mp4", key: meta.key };
      await addVersionFromVideo(v, file.name);
      if (v.type === "stream") { pollStreamReady(v.uid); showToast("アップ完了。変換中…（少し待つと軽く再生できる）"); }
      else showToast("バージョンを追加したよ（Stream未設定のためR2直再生）");
    }
    catch (e) { showToast("アップロードに失敗：" + (e.message || e)); }
    setMediaBusy("");
  };
  const addVersionYouTube = async (rawUrl) => {
    const vid = ytIdFromUrl(rawUrl); if (!vid) { showToast("YouTubeのURLが正しくないみたい"); return; }
    const sh = await ensureShare(); if (!sh) return;   // 共有URLが無ければ自動発行（追加した版がそのまま確認URLに出るように）
    await addVersionFromVideo({ type: "youtube", url: "https://www.youtube.com/watch?v=" + vid }, "YouTube版");
    showToast("バージョンを追加したよ");
  };
  // 即消しではなくゴミ箱送り＝7日間は復元可能（誤削除対策）。R2/Stream本体はcleanupExpired cronが猶予後に消す
  const removeVersion = async (vid) => {
    const v = reviewVersions().find((x) => x.id === vid);
    setVersions((arr) => arr.map((x) => (x.id === vid ? { ...x, trashedAt: Date.now() } : x)));
    setAssets((as) => as.filter((a) => a.versionId !== vid));
    if (v && v.key) {
      try { await fetch(SHARE_API + "/api/file/" + v.key + "/trash?snap=" + project.shareId + "&token=" + encodeURIComponent(project.shareToken), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ streamUid: v.uid || "" }) }); } catch (e) {}
    }
  };
  const restoreVersion = async (vid) => {
    const v = reviewVersions().find((x) => x.id === vid);
    if (v && v.key) {
      try {
        const r = await fetch(SHARE_API + "/api/file/" + v.key + "/restore?snap=" + project.shareId + "&token=" + encodeURIComponent(project.shareToken), { method: "POST" });
        const d = await r.json();
        if (!r.ok) { showToast(d.error || "復元期限が切れています"); return; }
      } catch (e) { showToast("復元に失敗しました"); return; }
    }
    setVersions((arr) => arr.map((x) => (x.id === vid ? { ...x, trashedAt: null } : x)));
    showToast(v && v.label ? v.label + " を復元したよ" : "復元したよ");
  };
  const renameVersion = (vid, name) => setVersions((arr) => arr.map((x) => (x.id === vid ? { ...x, name } : x)));

  /* 案件を開いた / 案件・企画の共有が付いたらコメント取得（全スナップ集約） */
  useEffect(() => {
    const planSnaps = (project && project.plans || []).map((p) => p.shareId).filter(Boolean).join(",");
    if (project && (project.shareId || planSnaps)) fetchComments();
    else setComments([]);
  }, [activeId, project && project.shareId, (project && project.plans || []).map((p) => p.shareId).join(",")]);

  const openComments = comments.filter((c) => !c.resolved);

  const fmt = (sec) => ((project && project.timeFormat === "jp") ? fmtJP(sec) : fmtTC(sec));

  const setMeta = (key, val) => setProject((p) => ({ ...p, meta: { ...p.meta, [key]: val } }));
  const setMetaArr = (key, i, val) => setProject((p) => {
    const arr = [...(p.meta[key] || ["", "", ""])]; arr[i] = val;
    return { ...p, meta: { ...p.meta, [key]: arr } };
  });
  const setTheme = (key, val) => setProject((p) => ({ ...p, theme: { ...p.theme, [key]: val } }));
  const setRows = (fn) => setProject((p) => ({ ...p, rows: typeof fn === "function" ? fn(p.rows) : fn }));
  const updateRow = (id, patch) => setRows((rows) => rows.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const deleteRow = (id) => setRows((rows) => rows.filter((x) => x.id !== id));
  const moveRow = (idx, dir) => setRows((rows) => {
    const j = idx + dir;
    if (j < 0 || j >= rows.length) return rows;
    const next = [...rows]; [next[idx], next[j]] = [next[j], next[idx]];
    return next;
  });
  const insertBelow = (idx, row) => setRows((rows) => {
    const next = [...rows]; next.splice(idx + 1, 0, row); return next;
  });

  /* ---- 複数選択 ---- */
  const isSelected = (id) => selectedIds.includes(id);
  const clearSelection = () => { setSelectedIds([]); lastSelRef.current = null; };
  const toggleSelect = (id, e) => {
    const rows = (project && project.rows) || [];
    if (e && e.shiftKey && lastSelRef.current) {
      const a = rows.findIndex((r) => r.id === lastSelRef.current);
      const b = rows.findIndex((r) => r.id === id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const range = rows.slice(lo, hi + 1).map((r) => r.id);
        setSelectedIds((prev) => Array.from(new Set([...prev, ...range])));
        return;
      }
    }
    lastSelRef.current = id;
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const deleteSelected = () => {
    if (!selectedIds.length) return;
    if (!window.confirm(selectedIds.length + "件の行を削除します。よろしいですか？")) return;
    const set = new Set(selectedIds);
    setRows((rows) => rows.filter((r) => !set.has(r.id)));
    clearSelection();
  };

  /* ---- ドラッグ＆ドロップ（複数行対応・左側のセルをつかんで移動） ---- */
  const reorderMany = (ids, to) => setRows((rows) => {
    if (!ids || !ids.length || to == null) return rows;
    const set = new Set(ids);
    const moved = rows.filter((r) => set.has(r.id));
    if (!moved.length) return rows;
    const rest = rows.filter((r) => !set.has(r.id));
    const targetId = rows[to] ? rows[to].id : null;
    let pos = targetId && !set.has(targetId) ? rest.findIndex((r) => r.id === targetId) : rest.length;
    if (pos < 0) pos = rest.length;
    rest.splice(pos, 0, ...moved);
    return rest;
  });
  const endDrag = () => { setDragIndex(null); setDragOverIndex(null); setDragIds(null); };
  const dropOn = (idx) => { if (dragIds) reorderMany(dragIds, idx); endDrag(); };
  /* 行の左セルにつける：ドラッグ開始（選択行ごと、未選択なら単体） */
  const rowDragProps = (idx, id) => ({
    draggable: true,
    onDragStart: (e) => {
      const ids = isSelected(id) && selectedIds.length > 1
        ? ((project.rows || []).filter((r) => selectedIds.includes(r.id)).map((r) => r.id))
        : [id];
      setDragIds(ids); setDragIndex(idx);
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", ids.join(",")); } catch (_) {}
    },
    onDragEnd: endDrag,
  });
  const dropZoneProps = (idx) => ({
    onDragOver: (e) => { if (dragIds != null) { e.preventDefault(); setDragOverIndex(idx); } },
    onDrop: (e) => { e.preventDefault(); dropOn(idx); },
  });

  /* ---- ドラッグでなぞって複数選択（チェック欄を押したまま上下になぞる） ---- */
  const paintRef = useRef(null); // { anchorIdx, baseline:Set }
  const beginPaintSelect = (idx, id, e) => {
    e.stopPropagation();
    paintRef.current = { anchorIdx: idx, baseline: new Set(selectedIds) };
    lastSelRef.current = id;
    setPainting(true);
  };
  const paintSelectTo = (idx) => {
    const p = paintRef.current;
    if (!p) return;
    const rows = (project && project.rows) || [];
    const [lo, hi] = p.anchorIdx < idx ? [p.anchorIdx, idx] : [idx, p.anchorIdx];
    const range = rows.slice(lo, hi + 1).filter((r) => r.kind === "scene").map((r) => r.id);
    setSelectedIds(Array.from(new Set([...p.baseline, ...range])));
  };
  useEffect(() => {
    const up = () => { if (paintRef.current) { paintRef.current = null; setPainting(false); } };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => { window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
  }, []);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(max-width: 640px)");
    const on = () => { setIsNarrow(mq.matches); if (mq.matches) setSidebarOpen(false); };
    on(); mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  /* スマホ：スワイプでサイドバー（案件一覧）を開閉。左端から右スワイプで表示／左スワイプで非表示 */
  useEffect(() => {
    if (!isNarrow || typeof window === "undefined") return;
    let sx = 0, sy = 0, st = 0;
    const onStart = (e) => { const t = e.touches[0]; if (!t) return; sx = t.clientX; sy = t.clientY; st = Date.now(); };
    const onEnd = (e) => {
      const t = e.changedTouches[0]; if (!t) return;
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (Date.now() - st > 600) return;
      if (Math.abs(dx) < 60 || Math.abs(dy) > 45) return; // ほぼ水平のスワイプだけ
      if (dx > 0 && sx < 36 && !sidebarOpen) setSidebarOpen(true);  // 左端から右へ → 開く
      else if (dx < 0 && sidebarOpen) setSidebarOpen(false);        // 左へ → 閉じる
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    return () => { window.removeEventListener("touchstart", onStart); window.removeEventListener("touchend", onEnd); };
  }, [isNarrow, sidebarOpen]);

  /* 時間(TC)文字列 → 秒。"mm:ss" / "h:mm:ss" / "0分00秒" / 数字(秒) を許容 */
  const parseTC = (str) => {
    const s = (str || "").trim();
    if (!s) return null;
    let m = s.match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
    if (m) return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
    m = s.match(/^(\d+):(\d{1,2})$/);
    if (m) return (+m[1]) * 60 + (+m[2]);
    m = s.match(/(?:(\d+)\s*分)?\s*(\d+)\s*秒/);
    if (m) return (+(m[1] || 0)) * 60 + (+m[2]);
    const n = Number(s);
    return isNaN(n) ? null : n;
  };

  /* 実時計 "H:MM"/"HH:MM:SS" → 一日の経過秒。香盤表のloc.time（type="time"）用 */
  const parseClock = (str) => {
    const m = (str || "").trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return null;
    return (+m[1]) * 3600 + (+m[2]) * 60 + (+(m[3] || 0));
  };
  /* 一日の経過秒 → "H:MM"（実時計表示） */
  const fmtClock = (sec) => {
    if (sec == null) return "";
    const s = ((Math.round(sec) % 86400) + 86400) % 86400;
    return Math.floor(s / 3600) + ":" + String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  };

  /* ロケーション単位の移動（配下のシーンごと） */
  const moveLocationBlock = (locId, dir) => setRows((rows) => {
    const blocks = [];
    let cur = null;
    for (const r of rows) {
      if (r.kind === "location") { cur = { loc: r, items: [r] }; blocks.push(cur); }
      else if (cur) cur.items.push(r);
      else { cur = { loc: null, items: [r] }; blocks.push(cur); cur = null; }
    }
    const i = blocks.findIndex((b) => b.loc && b.loc.id === locId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= blocks.length) return rows;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    return next.flatMap((b) => b.items);
  });

  const { tcs, clocks, totalEst, totalTarget, totalChars, totalTravel, locations, sceneNos, sceneLocDone } = useMemo(() => {
    let acc = 0, tt = 0, tc = 0, no = 0;
    const tcs = {};
    const clocks = {}; // 行id → 実時計の経過秒（香盤表のロケ到着時刻＋尺の積み上げ）
    const sceneNos = {};
    const locations = [];
    let cur = null;
    let curDone = false;
    let anchorClock = null; // 直近で時刻が入ったロケの実時計（秒）
    let anchorTcIn = 0;     // そのロケ時点の尺（秒）
    const sceneLocDone = {}; // シーンid → 所属ロケが撮影完了か
    const rows = (project && project.rows) ? project.rows : [];
    const rate = (project && project.rate) ? project.rate : 5;
    for (const r of rows) {
      // 手入力の開始時刻(TC)があればそこから積み上げ直す
      if (r.tc != null && r.tc !== "" && !isNaN(Number(r.tc))) acc = Number(r.tc);
      tcs[r.id] = acc;
      if (r.kind === "location") {
        cur = { ...r, scenes: [], dur: 0, secSum: 0, tcIn: acc };
        curDone = !!r.done;
        locations.push(cur);
        // このロケに到着時刻が入っていれば、以降の実時刻アンカーを更新
        const lc = parseClock(r.time);
        if (lc != null) { anchorClock = lc; anchorTcIn = acc; }
      } else {
        no += 1;
        sceneNos[r.id] = no;
        sceneLocDone[r.id] = curDone;
        const target = targetOf(r);
        const chars = countChars(r.script);
        const d = chars > 0 ? chars / rate : target;
        acc += d; tt += target; tc += chars;
        if (cur) { cur.scenes.push(r); cur.dur += d; cur.secSum += target; }
      }
      // 実時刻＝アンカーのロケ到着時刻＋（その行までの尺 − アンカー時点の尺）
      if (anchorClock != null) clocks[r.id] = anchorClock + (tcs[r.id] - anchorTcIn);
    }
    // 交通費合計：先頭ロケと「前ロケと同じ場所」の区間は移動が存在しないので除外
    const totalTravel = locations.reduce((a, l, i) => a + (i > 0 && !samePlace(locations[i - 1], l) ? (Number(l.travelCost) || 0) : 0), 0);
    return { tcs, clocks, totalEst: acc, totalTarget: tt, totalChars: tc, totalTravel, locations, sceneNos, sceneLocDone };
  }, [project]);

  /* ---------- TSV書き出し ---------- */
  /* トーク系台本をプレーンテキストでコピー */
  const exportTalkText = async () => {
    const t = project.talk || newTalk();
    const title = (project.plans && project.plans[0] && project.plans[0].title) || project.name || "";
    const L = ["【タイトル】" + title];
    if (t.highlight) L.push("\n【ハイライト】\n" + t.highlight);
    if (t.intro) L.push("\n【冒頭】\n" + t.intro);
    const toc = (t.toc || []).filter((x) => x && x.trim());
    if (toc.length) L.push("\n【目次】\n" + toc.map((x, i) => (i + 1) + ". " + x).join("\n"));
    L.push("\n【本編】");
    (t.body || []).forEach((b, i) => { L.push("\n■ " + (b.heading || ("本編" + (i + 1)))); if (b.script) L.push(b.script); });
    if (t.cta) L.push("\n【CTA】\n" + t.cta);
    try { await navigator.clipboard.writeText(L.join("\n")); showToast("トーク台本をコピーしました"); } catch (e) { showToast("コピーに失敗しました"); }
  };

  const exportScriptTSV = async () => {
    const esc = (s) => {
      const v = (s || "").toString();
      return /[\t\n"]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    const m = project.meta;
    const lines = [];
    lines.push(["", "撮影日", esc(m.shootDate)].join("\t"));
    lines.push(["", "撮影場所", esc(m.place)].join("\t"));
    lines.push(["", "タイトル案", esc(m.titles[0]), esc(m.titles[1]), esc(m.titles[2])].join("\t"));
    lines.push(["", "サムネ案", esc(m.thumbs[0]), esc(m.thumbs[1]), esc(m.thumbs[2])].join("\t"));
    lines.push(["", "ハイライト", esc(m.highlight)].join("\t"));
    lines.push("");
    lines.push(["時間", "ロケーション", "内容", "シーン", "秒数", "所要時間", "文字数", "原稿"].join("\t"));
    let acc = 0;
    for (const r of project.rows) {
      if (r.kind === "location") {
        lines.push(["", esc(r.label), "", "", "", "", "", ""].join("\t"));
      } else {
        const t = sectionOf(r.type);
        const target = targetOf(r);
        const chars = countChars(r.script);
        const dur = chars / project.rate;
        lines.push([fmt(acc), "", esc(r.label), t.full, target, chars ? fmtJP(dur) : "", chars || "", esc(r.script)].join("\t"));
        acc += chars > 0 ? dur : target;
      }
    }
    lines.push(["", "合計", "", "", totalTarget, fmtJP(totalEst), totalChars, ""].join("\t"));
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      showToast("構成台本をコピーしました");
    } catch { showToast("コピーに失敗しました"); }
  };

  const exportKoubanTSV = async () => {
    const esc = (s) => {
      const v = (s || "").toString();
      return /[\t\n"]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    const lines = [["順番", "予定時刻", "ロケーション", "住所", "シーン数", "想定尺", "移動手段", "交通費", "メモ"].join("\t")];
    locations.forEach((loc, i) => {
      const noMove = i === 0 || samePlace(locations[i - 1], loc);
      lines.push([i + 1, esc(loc.time), esc(loc.label), esc(loc.address), loc.scenes.length, fmtJP(loc.dur), noMove ? (i === 0 ? "" : "（同じ場所）") : esc(loc.travelBy), noMove || loc.travelCost == null ? "" : loc.travelCost, esc(loc.note)].join("\t"));
    });
    if (totalTravel > 0) lines.push(["", "", "", "", "", "", "合計", totalTravel, ""].join("\t"));
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      showToast("香盤表をコピーしました");
    } catch { showToast("コピーに失敗しました"); }
  };

  /* ヒアリングを外部（GPT等）へ出す。装飾マーカー（**・!!）は除いたプレーン文で書き出す */
  const hearingPlain = (s) => (s || "").toString().replace(/\*\*/g, "").replace(/!!/g, "");
  const exportHearingCSV = () => {
    const esc = (s) => { const v = hearingPlain(s); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const rows = [["セクション", "項目", "内容"]];
    (project.hearing || []).forEach((sec) => (sec.items || []).forEach((it) => rows.push([sec.title, it.label, it.value])));
    const csv = "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n"); // BOM付き＝Excel/GPTで文字化けしない
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "ヒアリング_" + (project.name || "案件").replace(/[\\/:*?"<>|]/g, "_") + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("ヒアリングをCSVで書き出したよ");
  };
  const copyHearingForAI = async () => {
    const L = ["# ヒアリング：" + (project.name || "")];
    (project.hearing || []).forEach((sec) => {
      L.push("", "## " + sec.title);
      (sec.items || []).forEach((it) => { if ((it.value || "").trim()) L.push("- " + it.label + "：" + hearingPlain(it.value)); });
    });
    try { await navigator.clipboard.writeText(L.join("\n")); showToast("ヒアリングをGPT用にコピーしたよ（そのまま貼り付けて）📋"); }
    catch { showToast("コピーに失敗しました"); }
  };

  /* 編集者向けヘルプAIチャット送信（/api/help）。要望は worker 側で Discord へ */
  const sendHelp = async () => {
    const text = helpInput.trim();
    if (!text || helpBusy) return;
    const hist = helpMsgs.map((m) => ({ role: m.role, content: m.content }));
    setHelpMsgs((m) => [...m, { role: "user", content: text }]);
    setHelpInput(""); setHelpBusy(true);
    try {
      const r = await fetch(SHARE_API + "/api/help", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: hist.slice(-16), channel: chanLive ? chanLive.name : (project ? project.channel : ""), caseName: project ? project.name : "" }),
      });
      const d = await r.json();
      setHelpMsgs((m) => [...m, d.reply ? { role: "assistant", content: d.reply, logged: !!d.logged } : { role: "assistant", content: "エラー：" + (d.error || "応答がありませんでした") }]);
    } catch (e) { setHelpMsgs((m) => [...m, { role: "assistant", content: "通信エラー：" + (e.message || e) }]); }
    setHelpBusy(false);
  };
  /* ヘルプチャットのフローティングUI。編集者文脈（chanLive or ライブ編集中）のみ表示。テーマ非依存(DEFAULT_THEME) */
  const renderHelpChat = () => {
    if (!(chanLive || (project && project.live))) return null;
    if (!helpOpen) return (
      <button onClick={() => setHelpOpen(true)} title="使い方・ご意見"
        className="fixed bottom-4 right-4 z-[60] inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full shadow-lg text-[12px] font-bold text-white hover:opacity-90"
        style={{ background: DEFAULT_THEME.main }}>
        <span>💬</span> 使い方・ご意見
      </button>
    );
    return (
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col rounded-2xl bg-white shadow-2xl border border-stone-200 overflow-hidden" style={{ width: "min(92vw, 360px)", height: "min(72vh, 540px)" }}>
        <div className="flex items-center gap-2 px-3 py-2.5 shrink-0" style={{ background: DEFAULT_THEME.main, color: "#fff" }}>
          <span className="text-[13px] font-bold">💬 ヘルプ・ご意見</span>
          <button onClick={() => setHelpOpen(false)} className="ml-auto w-7 h-7 grid place-items-center rounded-lg hover:bg-white/15 text-white/80">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-stone-50">
          {helpMsgs.length === 0 && (
            <div className="text-[12px] text-stone-500 leading-relaxed bg-white border border-stone-200 rounded-xl px-3 py-2.5">
              使い方で迷ったら聞いてください（例：「完成動画はどこから上げる？」）。<br />「ここ使いにくい」「こうしてほしい」もそのまま書いてOK。運営に届きます。
            </div>
          )}
          {helpMsgs.map((m, i) => (
            <div key={i} className={"flex " + (m.role === "user" ? "justify-end" : "justify-start")}>
              <div className={"max-w-[85%] text-[12.5px] leading-relaxed px-3 py-2 rounded-2xl whitespace-pre-wrap break-words " + (m.role === "user" ? "text-white rounded-br-sm" : "bg-white border border-stone-200 text-stone-800 rounded-bl-sm")}
                style={m.role === "user" ? { background: DEFAULT_THEME.accent } : {}}>
                {m.content}
                {m.logged && <span className="block mt-1 text-[10px] font-bold" style={{ color: DEFAULT_THEME.accent }}>✓ 運営に届けました</span>}
              </div>
            </div>
          ))}
          {helpBusy && <div className="text-[11px] text-stone-400 px-1">考え中…</div>}
        </div>
        <div className="shrink-0 p-2 border-t border-stone-200 flex items-end gap-2">
          <textarea value={helpInput} onChange={(e) => setHelpInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendHelp(); } }}
            rows={1} placeholder="質問やご意見を入力（⌘+Enterで送信）"
            className="flex-1 min-w-0 text-[12.5px] border border-stone-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:border-stone-400" style={{ maxHeight: 96 }} />
          <button onClick={sendHelp} disabled={helpBusy || !helpInput.trim()}
            className="shrink-0 px-3 py-2 rounded-xl text-[12px] font-bold text-white disabled:opacity-40" style={{ background: DEFAULT_THEME.main }}>送信</button>
        </div>
      </div>
    );
  };
  // チャンネル編集モードのホーム（編集者用・project未選択でも案件一覧を出す＝Image3）。テーマはproject依存のためDEFAULT_THEMEで描く
  if (loaded && chanLive && view === "home") return (
    <div className="fixed inset-0 overflow-y-auto" style={{ background: "#E9E8E3" }}>
      <header className="sticky top-0 z-10 shadow-sm" style={{ background: DEFAULT_THEME.main, color: "#fff" }}>
        <div className="max-w-[1200px] mx-auto px-5 py-3 flex items-center gap-2">
          <img src="logo-header.png" alt="" className="w-8 h-8 rounded-lg" />
          <span className="font-black tracking-[0.08em] text-[15px]">ものがたりっち！</span>
        </div>
      </header>
      <main className="max-w-[1200px] mx-auto px-5 py-7">
        <div className="text-[11px] font-bold text-stone-400 tracking-widest mb-1">CHANNEL</div>
        <div className="rounded-2xl px-5 py-4 mb-4" style={{ background: DEFAULT_THEME.main, color: "#fff" }}>
          <div className="text-[20px] font-black">{chanLive.name}</div>
        </div>
        <div className="mb-5 text-[12px] text-stone-700 bg-white border-l-4 rounded-xl px-4 py-3" style={{ borderColor: DEFAULT_THEME.accent }}>
          ✏️ <span className="font-bold">編集できる共有です。</span>案件をクリックすると、企画・サムネ／構成台本／香盤表／素材／動画まで全タブをそのまま編集できます（ログイン不要・直したらすぐ反映）。
        </div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[12px] font-bold text-stone-500">案件一覧（{chanLive.cases.length}）</div>
          <div className="text-[10px] text-stone-400">クリックで開く</div>
        </div>
        {chanLive.cases.length === 0 ? (
          <div className="text-[12px] text-stone-400 bg-white border border-stone-200 rounded-xl px-4 py-6 text-center">編集できる案件がまだありません。</div>
        ) : chanLive.cases.map((c, i) => (
          <button key={c.id} onClick={() => openChanCase(c)}
            className="w-full text-left rounded-xl border border-stone-200 bg-white px-4 py-3 mb-2 hover:shadow-md hover:border-stone-300 transition-all flex items-center gap-3">
            <span className="text-[11px] font-bold text-stone-400 tabular-nums shrink-0">#{i + 1}</span>
            <span className="flex-1 min-w-0">
              <span className="block text-[14px] font-bold text-stone-800 truncate">{c.name}</span>
              <span className="block text-[10px] text-stone-400">{c.format === "talk" ? "トーク系" : "一日密着"}</span>
            </span>
            <span className="text-[12px] font-bold shrink-0" style={{ color: DEFAULT_THEME.accent }}>開く →</span>
          </button>
        ))}
        <div className="text-center text-[10px] text-stone-300 mt-8">制作：ものがたりっち！</div>
      </main>
      {renderHelpChat()}
    </div>
  );
  if (!loaded || !project) return <div className="min-h-screen flex items-center justify-center text-stone-400 text-sm">読み込み中…</div>;

  /* ---------- Claude連携 ---------- */
  const buildClaudePrompt = () => {
    const m2 = project.meta;
    const L = [];
    L.push("あなたは一日密着ドキュメンタリー番組の構成作家です。");
    L.push("以下の構成表の各シーンの「原稿」を、この後に渡すヒアリング資料を元に書いてください。");
    L.push("");
    L.push("# 番組情報");
    if (m2.titles.filter(Boolean).length) L.push("タイトル案: " + m2.titles.filter(Boolean).join(" ／ "));
    if (m2.place) L.push("撮影場所: " + m2.place);
    if (m2.highlight) L.push("冒頭ハイライト案:\n" + m2.highlight);
    L.push("");
    L.push("# 書式ルール（厳守）");
    L.push("- インタビュアーの質問は「◼︎ 」で行頭を始める。被写体の回答は地の文で、話し言葉のまま自然に");
    L.push("- 各シーンの目標文字数（±2割）を守る");
    L.push("- ヒアリング資料にない事実・数字・固有名詞は捏造しない。不明な箇所は「〇〇」で残す");
    L.push("- インサートのみのシーンは、原稿の代わりに映像指示を1〜2行で書く");
    L.push("- 隣り合うシーン同士の話の流れが自然に繋がるようにする");
    L.push("");
    L.push("# 出力形式（厳守・この形式でないと取り込めません）");
    L.push("各シーンを以下の形式で、シーン番号を付けて出力してください。前置きや解説は一切不要です。");
    L.push("");
    L.push("【1】シーン名");
    L.push("（原稿本文）");
    L.push("");
    L.push("【2】シーン名");
    L.push("（原稿本文）");
    L.push("");
    L.push("# 構成表");
    let curLoc = "";
    let no = 0;
    for (const r of project.rows) {
      if (r.kind === "location") { curLoc = r.label; continue; }
      no += 1;
      const t = sectionOf(r.type);
      const target = targetOf(r);
      const approx = Math.round(target * project.rate);
      L.push(
        "【" + no + "】" + (r.label || "（内容未定）") +
        "｜ロケ: " + (curLoc || "—") +
        "｜種別: " + t.full +
        "｜目安" + target + "秒（約" + approx + "字）" +
        (countChars(r.script) > 0 ? "｜※既存原稿あり（より良くなる場合のみ書き直し）" : "")
      );
    }
    L.push("");
    L.push("――――――――――――――――");
    L.push("↓以下、ヒアリング資料（ここに貼り付けてから送信してください）");
    L.push("");
    return L.join("\n");
  };

  const copyClaudePrompt = async () => {
    try {
      await navigator.clipboard.writeText(buildClaudePrompt());
      showToast("プロンプトをコピーしました。Claudeに貼り付け、続けてヒアリング資料を貼って送信してください");
    } catch { showToast("コピーに失敗しました"); }
  };

  const importFromClaude = () => {
    const text = importText;
    const map = {};
    const re = /【(\d+)】[^\n]*\n([\s\S]*?)(?=\n*【\d+】|\s*$)/g;
    let match;
    while ((match = re.exec(text)) !== null) {
      const body = match[2].trim();
      if (body) map[Number(match[1])] = body;
    }
    if (Object.keys(map).length === 0) {
      showToast("【番号】の形式が見つかりませんでした。出力形式を確認してください");
      return;
    }
    let count = 0;
    setRows((rows) => {
      let no = 0;
      return rows.map((r) => {
        if (r.kind !== "scene") return r;
        no += 1;
        if (map[no] != null) { count += 1; return { ...r, script: map[no] }; }
        return r;
      });
    });
    setShowImport(false);
    setImportText("");
    showToast(count + "件の原稿を取り込みました");
  };

  const m = project.meta;
  const theme = project.theme;
  const mainText = textOn(theme.main);
  const accentText = textOn(theme.accent);
  const sans = '"Zen Kaku Gothic New","Hiragino Kaku Gothic ProN","Hiragino Sans",system-ui,sans-serif';
  const mono = '"IBM Plex Mono",ui-monospace,monospace';
  const stripe = "repeating-linear-gradient(135deg," + theme.main + " 0 10px,#FFFFFF 10px 14px)";

  const metaInput = "block w-full bg-transparent text-[13px] px-3 py-2 focus:outline-none placeholder:text-stone-300";
  const opBtn = "w-6 h-6 grid place-items-center rounded-md text-stone-400 hover:bg-stone-200 hover:text-stone-700 text-[11px] leading-none transition-colors";
  const cardCls = "bg-white rounded-2xl shadow-sm border border-stone-200/70 overflow-hidden";
  const cardHead = (label, right) => (
    <div className="px-4 py-2 flex items-center gap-2 border-b border-stone-100">
      <span className="w-1.5 h-4 rounded-full" style={{ background: theme.accent }} />
      <h2 className="text-[12px] font-bold tracking-wider text-stone-600 flex-1">{label}</h2>
      {right}
    </div>
  );

  return (
    <div className="min-h-screen" style={{ background: "#E9E8E3", fontFamily: sans, color: "#1C1C1E" }}>

      {/* チャンネル（クライアント）名の入力候補 */}
      <datalist id="mg-channels">
        {channelOptions.map((c) => <option key={c} value={c} />)}
      </datalist>

      {/* ===== 案件サイドバー ===== */}
      <aside
        className="fixed top-0 left-0 h-full z-40 flex flex-col"
        style={{
          width: 292,
          background: "#15181D",
          color: "#fff",
          display: (() => { try { return window.self !== window.top ? "none" : ""; } catch (e) { return ""; } })(),  // Fボード埋め込み時はサイドバー自体を出さない（左タブ二重防止）
          transform: sidebarOpen ? "translateX(0)" : "translateX(-292px)",
          transition: "transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
          willChange: "transform",
        }}>
        <div className="px-3 py-2.5 border-b border-white/10">
          <button onClick={() => setView("home")} title="ホーム（チャンネル一覧）へ"
            className="w-full flex items-center gap-2 px-1.5 py-1 rounded-lg hover:bg-white/10 transition-colors">
            <img src="logo-header.png" alt="" className="w-7 h-7 rounded-lg shrink-0" />
            <span className="font-black tracking-[0.08em] text-[14px]">ものがたりっち！</span>
            <svg className="w-4 h-4 ml-auto text-white/40 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>
          </button>
        </div>
        {!chanLive && (<>
        <div className="px-3 py-2 flex gap-1.5 relative">
          <button onClick={() => setNewMenu((v) => !v)}
            className="flex-1 inline-flex items-center justify-center gap-1 text-[11px] font-bold py-2 rounded-lg"
            style={{ background: theme.accent, color: accentText }}>
            <Icon name="plus" className="w-3.5 h-3.5" /> 新規案件
          </button>
          <button onClick={() => { const ch = window.prompt("新しいチャンネル（クライアント）名"); if (ch && ch.trim()) createChannel(ch.trim()); }}
            title="新しいチャンネル（フォルダ）を作成"
            className="inline-flex items-center gap-0.5 text-[11px] font-bold py-2 px-2.5 rounded-lg bg-white/10 hover:bg-white/20">
            <Icon name="plus" className="w-3.5 h-3.5" />ch
          </button>
          {newMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setNewMenu(false)} />
              <div className="absolute left-3 right-3 top-full mt-1 z-50 bg-[#1f242c] border border-white/15 rounded-xl shadow-2xl overflow-hidden">
                <div className="px-3 pt-2 pb-1 text-[10px] font-bold text-white/40">どのタイプの台本？</div>
                <button onClick={() => createProject(true, DEFAULT_CHANNEL, "documentary")} className="w-full text-left px-3 py-2.5 hover:bg-white/10 flex items-start gap-2">
                  <span className="text-base leading-none mt-0.5">🎬</span>
                  <span><span className="block text-[12px] font-bold text-white">一日密着</span><span className="block text-[10px] text-white/45">ロケ・シーン構成のドキュメンタリー</span></span>
                </button>
                <button onClick={() => createProject(true, DEFAULT_CHANNEL, "talk")} className="w-full text-left px-3 py-2.5 hover:bg-white/10 flex items-start gap-2 border-t border-white/10">
                  <span className="text-base leading-none mt-0.5">🎙️</span>
                  <span><span className="block text-[12px] font-bold text-white">トーク系</span><span className="block text-[10px] text-white/45">ハイライト/冒頭/目次/本編/CTA構成</span></span>
                </button>
              </div>
            </>
          )}
        </div>
        </>)}

        {/* チャンネル名サジェスト用 */}
        <datalist id="mg-channels">
          {channelOptions.map((c) => <option key={c} value={c} />)}
        </datalist>

        {/* ===== チャンネル → 案件 ネスト ===== */}
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {chanLive ? (
            <div className="pt-1">
              <div className="px-2 py-1.5 text-[11px] font-bold text-white/50 truncate flex items-center gap-1">
                {channelIconOf(chanLive.name) || "📁"}<span className="truncate">{chanLive.name}</span>
                <span className="ml-auto text-[10px] text-white/30 tabular-nums">{chanLive.cases.length}</span>
              </div>
              {chanLive.cases.map((c) => {
                const active = chanActiveCase === c.id;
                return (
                  <button key={c.id} onClick={() => openChanCase(c)}
                    className={"w-full text-left rounded-lg mb-0.5 px-3 py-2 flex items-center gap-2 transition-colors " + (active ? "" : "hover:bg-white/5")}
                    style={active ? { background: "rgba(255,255,255,0.12)" } : {}}>
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: active ? theme.accent : "rgba(255,255,255,0.3)" }} />
                    <span className="flex-1 min-w-0 truncate text-[12.5px] font-medium">{c.name}</span>
                  </button>
                );
              })}
            </div>
          ) : channelGroups.map(({ channel, items }) => {
            const hasActive = items.some((x) => x.id === activeId);
            // 既定はすべて畳む（開いている案件のチャンネルだけ自動展開）。タップで開閉（アコーディオン＝1つだけ開く）
            const isCollapsed = collapsed[channel] !== undefined ? !!collapsed[channel] : !hasActive;
            const toggleChannel = () => setCollapsed(() => {
              const next = {};
              channelGroups.forEach((g) => { next[g.channel] = true; });
              if (isCollapsed) next[channel] = false; // 畳んでいたら開く（他は畳む）
              return next;
            });
            return (
              <div key={channel} className="mb-1.5">
                {/* チャンネル見出し（タップでそのチャンネルの台本一覧を開閉） */}
                <div className="group/ch flex items-center gap-1 px-1.5 py-1.5 rounded-lg hover:bg-white/5 cursor-pointer select-none"
                  onClick={toggleChannel}
                  onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ channel, x: e.clientX, y: e.clientY }); }}>
                  <button title={isCollapsed ? "案件を表示" : "案件を隠す"} onClick={(e) => { e.stopPropagation(); toggleChannel(); }}
                    className="w-3.5 shrink-0 text-white/40 text-[10px] transition-transform grid place-items-center hover:text-white/80" style={{ transform: isCollapsed ? "rotate(-90deg)" : "none" }}>▾</button>
                  {channelIconOf(channel) ? (
                    <button title="アイコンを変更" onClick={(e) => { e.stopPropagation(); setIconPick({ channel, x: e.clientX, y: e.clientY }); }}
                      className="w-3.5 h-3.5 shrink-0 grid place-items-center text-[12px] leading-none hover:scale-125 transition-transform">{channelIconOf(channel)}</button>
                  ) : (
                    <button title="アイコンを変更" onClick={(e) => { e.stopPropagation(); setIconPick({ channel, x: e.clientX, y: e.clientY }); }} className="w-3.5 h-3.5 shrink-0 grid place-items-center hover:text-white/80">
                      <svg className="w-3.5 h-3.5 text-white/45" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                      </svg>
                    </button>
                  )}
                  <span className="flex-1 min-w-0 truncate text-[11.5px] font-bold tracking-wide cursor-pointer hover:underline"
                    style={{ color: hasActive ? "#fff" : "rgba(255,255,255,0.7)" }}
                    title="このチャンネルの企画・サムネ一覧を開く"
                    onClick={(e) => { e.stopPropagation(); if (isCollapsed) toggleChannel(); openChannelBoard(channel); }}>
                    {channel}
                  </span>
                  <span className="text-[10px] text-white/30 tabular-nums">{items.length}</span>
                  <div className="flex gap-0.5 opacity-0 group-hover/ch:opacity-100 transition-opacity shrink-0">
                    <button title={channel === DEFAULT_CHANNEL ? "このフォルダに名前を付ける（クライアント名など）" : "フォルダ名を変更"} onClick={(e) => { e.stopPropagation(); renameChannel(channel); }} className="w-5 h-5 grid place-items-center rounded hover:bg-white/20 text-[10px]">✎</button>
                  </div>
                </div>

                {/* 案件リスト */}
                {!isCollapsed && items.map((p) => {
                  const active = p.id === activeId;
                  return (
                    <div key={p.id}
                      draggable
                      onDragStart={(e) => { e.stopPropagation(); setDragCaseId(p.id); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", p.id); } catch (_) {} }}
                      onDragOver={(e) => { if (dragCaseId && dragCaseId !== p.id) { e.preventDefault(); e.stopPropagation(); setDragOverCaseId(p.id); } }}
                      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); reorderCaseByDrag(dragCaseId, p.id); setDragCaseId(null); setDragOverCaseId(null); }}
                      onDragEnd={() => { setDragCaseId(null); setDragOverCaseId(null); }}
                      className={"group/p rounded-lg mb-0.5 ml-3 pl-2.5 pr-2 py-1.5 cursor-pointer transition-colors border-l border-white/10 " + (active ? "" : "hover:bg-white/5")}
                      style={{
                        ...(active ? { background: "rgba(255,255,255,0.12)" } : {}),
                        ...(dragCaseId === p.id ? { opacity: 0.4 } : {}),
                        ...(dragOverCaseId === p.id && dragCaseId !== p.id ? { boxShadow: "inset 0 2px 0 0 " + theme.accent } : {}),
                      }}
                      onClick={() => switchProject(p.id)}
                      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCaseMenu({ id: p.id, channel: p.channel || DEFAULT_CHANNEL, x: e.clientX, y: e.clientY }); }}
                      title="右クリックで操作（名前変更・複製・移動・削除）">
                      <div className="flex items-center gap-2">
                        <span title="ドラッグして並び替え" className="shrink-0 -ml-0.5 opacity-0 group-hover/p:opacity-60 text-white/60 cursor-grab"><Icon name="grip" className="w-3 h-3" /></span>
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: active ? theme.accent : "rgba(255,255,255,0.3)" }} />
                        {renamingId === p.id ? (
                          <input
                            autoFocus
                            defaultValue={p.name}
                            onClick={(e) => e.stopPropagation()}
                            onBlur={(e) => { renameProject(p.id, e.target.value || p.name); setRenamingId(null); }}
                            onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
                            className="flex-1 min-w-0 bg-black/30 text-[12px] px-1.5 py-1 rounded focus:outline-none"
                          />
                        ) : channelEditId === p.id ? (
                          <input
                            autoFocus
                            list="mg-channels"
                            defaultValue={p.channel || DEFAULT_CHANNEL}
                            placeholder="チャンネル名"
                            onClick={(e) => e.stopPropagation()}
                            onBlur={(e) => { setProjectChannel(p.id, e.target.value); setChannelEditId(null); }}
                            onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") { e.preventDefault(); setChannelEditId(null); } }}
                            className="flex-1 min-w-0 bg-black/30 text-[12px] px-1.5 py-1 rounded focus:outline-none"
                          />
                        ) : (
                          <span className="flex-1 min-w-0 truncate text-[12.5px] font-medium inline-flex items-center gap-1"
                            onDoubleClick={(e) => { e.stopPropagation(); setRenamingId(p.id); }}>
                            {p.collab && <span title={p.role === "owner" ? "共同編集（あなたがオーナー）" : "共有された案件（" + (p.ownerEmail || "") + "）"} className="shrink-0 text-white/50"><Icon name="user" className="w-3 h-3" /></span>}
                            <span className="truncate">{p.name}</span>
                          </span>
                        )}
                        {/* 操作(名前変更・複製・移動・削除)は行の右クリック → caseMenu に集約 */}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="px-3 py-2 border-t border-white/10 flex flex-col gap-0.5">
          <button onClick={() => setShowAccount(true)}
            className="flex items-center gap-2 text-[12px] font-medium px-2.5 py-2 rounded-lg text-white/80 hover:bg-white/10 text-left w-full">
            {user && user.picture
              ? <img src={user.picture} alt="" className="w-4 h-4 rounded-full shrink-0" referrerPolicy="no-referrer" />
              : <Icon name="user" className="w-4 h-4 shrink-0" />}
            <span className="truncate">{user ? user.name + "（クラウド同期中）" : "Googleでログイン"}</span>
          </button>
          <a href="settings.html"
            className="flex items-center gap-2 text-[12px] font-medium px-2.5 py-2 rounded-lg text-white/80 hover:bg-white/10">
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
            共有・連携設定
          </a>
        </div>
        <div className={"px-3 py-2 border-t border-white/10 text-[10px] " + (saveState === "error" ? "text-amber-400" : "text-white/40")}>
          {index.length}件の案件・{saveState === "error" ? "未保存（電波待ち・自動で再送中）" : "自動保存"}
        </div>
      </aside>

      {/* サイドバー開閉オーバーレイ（モバイル・フェード） */}
      <div
        className={"fixed inset-0 z-30 bg-black/40 sm:hidden transition-opacity duration-300 ease-out " + (sidebarOpen ? "opacity-100" : "opacity-0 pointer-events-none")}
        onClick={() => setSidebarOpen(false)} />

      {/* ===== コンテンツ（サイドバー分シフト） ===== */}
      <div className="pb-28" style={{ marginLeft: (() => { try { if (window.self !== window.top) return 0; } catch (e) {} return sidebarOpen && !isNarrow ? 292 : 0; })(), transition: "margin-left 0.3s cubic-bezier(0.22, 1, 0.36, 1)" }}>

      {/* ===== ツールバー ===== */}
      <header className="sticky top-0 z-20 shadow-lg" style={{ background: theme.main, color: mainText }}>
        <div className="max-w-[1500px] mx-auto px-3 sm:px-4 pt-2.5 pb-1.5 flex items-center gap-2 sm:gap-3 flex-wrap">
          {/* Fボード埋め込み時はハンバーガーとチャンネルチップを出さない（左ツリーが案件切替を担う 2026-07-17 AK指示） */}
          {!IS_EMBED && (
          <button onClick={() => setSidebarOpen((s) => !s)} title="案件リスト"
            className="w-8 h-8 rounded-lg grid place-items-center border border-white/20 hover:bg-white/10 shrink-0">
            <Icon name="menu" className="w-[18px] h-[18px]" />
          </button>
          )}
          <input
            value={project.name}
            onChange={(e) => renameProject(project.id, e.target.value)}
            className="bg-transparent font-bold tracking-wide text-[14px] focus:outline-none focus:bg-white/10 rounded px-1.5 py-1 min-w-0 max-w-[200px]"
            style={{ color: mainText }}
            title="案件名（クリックで編集）"
          />
          {/* カテゴリ（クライアント／チャンネル）— クリックで変更。埋め込み時は非表示（正本はFボード側の紐付け） */}
          {IS_EMBED ? null : editHeaderChannel ? (
            <input
              autoFocus
              list="mg-channels"
              defaultValue={project.channel || DEFAULT_CHANNEL}
              placeholder="カテゴリ名"
              onBlur={(e) => { setProjectChannel(project.id, e.target.value); setEditHeaderChannel(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") setEditHeaderChannel(false); }}
              className="text-[11px] bg-black/30 border border-white/30 rounded-md px-2 py-1 focus:outline-none w-32"
              style={{ color: mainText }}
            />
          ) : (
            <button onClick={() => setEditHeaderChannel(true)} title="カテゴリ（クライアント）を変更"
              className="shrink-0 inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-white/20 hover:bg-white/10 max-w-[160px]"
              style={{ color: mainText, opacity: (project.channel || DEFAULT_CHANNEL) === DEFAULT_CHANNEL ? 0.6 : 1 }}>
              <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              </svg>
              <span className="truncate">{project.channel || DEFAULT_CHANNEL}</span>
            </button>
          )}
          {/* Googleアカウント（チャンネル名の右横） */}
          <button onClick={() => setShowAccount(true)} title={user ? user.name + "（クラウド同期中）" : "ログイン / アカウント"}
            className="w-8 h-8 rounded-full grid place-items-center border border-white/20 hover:bg-white/10 overflow-hidden shrink-0" style={{ color: mainText }}>
            {user && user.picture
              ? <img src={user.picture} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              : <Icon name="user" className="w-[18px] h-[18px]" />}
          </button>
          <span className="relative hidden sm:flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background: theme.accent }}></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: theme.accent }}></span>
          </span>
          <div className="flex-1" />
          {/* 先方コメント */}
          {project.shareId && (
            <button onClick={() => { setShowComments(true); fetchComments(); }} title="先方コメント"
              className="relative h-8 px-2.5 rounded-lg grid place-items-center border border-white/20 hover:bg-white/10">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: mainText }}>
                <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
              </svg>
              {openComments.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] px-1 grid place-items-center rounded-full text-[9px] font-bold tabular-nums"
                  style={{ background: theme.accent, color: accentText }}>{openComments.length}</span>
              )}
            </button>
          )}
          {/* マニュアル／決め事 */}
          <button onClick={() => setShowManual(true)} title="マニュアル・決め事（全体／チャンネル／案件）"
            className="h-8 px-3 rounded-lg inline-flex items-center gap-1.5 text-[11px] font-bold border border-white/20 hover:bg-white/10" style={{ color: mainText }}>
            <span className="text-[13px] leading-none">📖</span><span className="hidden sm:inline">マニュアル</span>
          </button>
          {/* 共有メニュー（共有リンク発行 / 台本コピー） */}
          <div className="relative">
            <button onClick={() => setShareMenu((v) => !v)} disabled={sharing} title="共有・書き出し"
              className="h-8 px-3 rounded-lg flex items-center gap-1.5 text-[11px] font-bold border border-white/20 hover:bg-white/10 disabled:opacity-50" style={{ color: mainText }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></svg>
              {sharing ? "発行中…" : "共有"} <span className="opacity-50 text-[9px]">▾</span>
            </button>
            {shareMenu && (<>
              <div className="fixed inset-0 z-40" onClick={() => setShareMenu(false)} />
              <div className="absolute right-0 top-full mt-1 z-50 w-60 bg-white rounded-xl shadow-2xl border border-stone-200 overflow-hidden text-stone-700 max-h-[80vh] overflow-y-auto">
                {/* ===== 2択だけ（2026-07-17 AK指示：このタブだけ／全体、それだけでいい） ===== */}
                {TAB_SHARE_PANE[tab] && (
                  <button onClick={() => { setShareMenu(false); copyShareUrl(tab); }} className="w-full text-left px-3 py-3 hover:bg-stone-50 text-[13px] font-bold flex items-center gap-2.5">
                    <Icon name="folder" className="w-4 h-4 shrink-0 text-stone-500" />
                    このタブだけ共有<span className="text-[10px] text-stone-400 font-normal ml-auto truncate max-w-[84px]">{TAB_LABEL[tab]}</span>
                  </button>
                )}
                <button onClick={() => { setShareMenu(false); copyShareUrl(); }} className="w-full text-left px-3 py-3 hover:bg-stone-50 text-[13px] font-bold flex items-center gap-2.5 border-b border-stone-100">
                  <Icon name="share" className="w-4 h-4 shrink-0 text-stone-500" />
                  全体を共有<span className="text-[10px] text-stone-400 font-normal ml-auto">全タブ</span>
                </button>
                {/* ===== その他（折りたたみ）：編集者渡し（大容量アップ）・先方/演者・同時編集・AI・書き出し ===== */}
                <button onClick={() => setShareMore((v) => !v)} className="w-full text-left px-3 py-2 hover:bg-stone-50 text-[11px] text-stone-500 flex items-center gap-2">
                  <span className="text-[10px] w-3 inline-block">{shareMore ? "▾" : "▸"}</span> その他のリンク・書き出し
                </button>
                {shareMore && (<>
                  {handoffs.map((h) => (
                    <button key={h.id} onClick={() => { setShareMenu(false); doHandoff(h); }} className="w-full text-left pl-7 pr-3 py-2.5 hover:bg-stone-50 text-[12px] font-bold flex items-center gap-2">
                      <span className="text-[13px] leading-none">{h.emoji || "📨"}</span>
                      {h.label}<span className="text-[10px] text-stone-400 font-normal ml-auto truncate max-w-[96px]">{(h.tabs || []).map((t) => TAB_LABEL[t]).filter(Boolean).join("・")}</span>
                    </button>
                  ))}
                  <button onClick={() => { setShareMenu(false); setShowHandoffEdit(true); }} className="w-full text-left pl-7 pr-3 py-2 hover:bg-stone-50 text-[11px] text-stone-500 flex items-center gap-2 border-b border-stone-100">
                    <span className="text-[12px] leading-none">⚙️</span> 受け渡しをカスタマイズ
                  </button>
                  <button onClick={() => { setShareMenu(false); publishShareLive(); }} className="w-full text-left pl-7 pr-3 py-2.5 hover:bg-stone-50 text-[12px] font-bold flex items-center gap-2">
                    <span className="text-[13px] leading-none">✏️</span>
                    {project.liveId ? "編集用リンクを更新" : "編集用リンクを発行"}<span className="text-[10px] text-stone-400 font-normal ml-auto">同時編集</span>
                  </button>
                  <button onClick={() => { setShareMenu(false); copyAiUrl(); }} className="w-full text-left pl-7 pr-3 py-2.5 hover:bg-stone-50 text-[12px] font-bold flex items-center gap-2">
                    <span className="text-[13px] leading-none">🤖</span>
                    AIに読ませる用<span className="text-[10px] text-stone-400 font-normal ml-auto">Claude/GPT</span>
                  </button>
                  <button onClick={() => { setShareMenu(false); setShowMediaModal(true); }} className="w-full text-left pl-7 pr-3 py-2.5 hover:bg-stone-50 text-[12px] font-bold flex items-center gap-2">
                    <span className="text-[13px] leading-none">🎬</span> 動画確認・ファイル転送
                  </button>
                  <button onClick={() => { setShareMenu(false); (project.format === "talk" ? exportTalkText : exportScriptTSV)(); }} className="w-full text-left pl-7 pr-3 py-2.5 hover:bg-stone-50 text-[12px] font-bold flex items-center gap-2">
                    <span className="text-[13px] leading-none">📄</span> 台本コピー{project.format === "talk" ? "（テキスト）" : "（TSV）"}
                  </button>
                </>)}
              </div>
            </>)}
          </div>
          <button onClick={() => setShowInvite(true)} title="チームメンバーを招待して共同編集（要ログイン）"
            className="h-8 px-3 rounded-lg flex items-center gap-1.5 text-[11px] font-bold border border-white/20 hover:bg-white/10 relative" style={{ color: mainText }}>
            <Icon name="user" className="w-4 h-4" />
            <span className="hidden sm:inline">{project.collab ? "共同編集中" : "招待"}</span>
            {project.collab && (project.members || []).length > 1 && <span className="text-[10px] tabular-nums opacity-70">{(project.members || []).length}</span>}
          </button>
          {/* AIメニュー（校正 / 反映） */}
          <div className="relative">
            <button onClick={() => setAiMenu((v) => !v)} title="AI機能"
              className="h-8 px-3 rounded-lg inline-flex items-center gap-1 border border-white/20 hover:bg-white/10 text-[12px] font-bold whitespace-nowrap" style={{ color: mainText }}>
              <Icon name="sparkle" className="w-4 h-4 shrink-0" /> <span className="hidden sm:inline">AI</span> <span className="opacity-50 text-[9px]">▾</span>
            </button>
            {aiMenu && (<>
              <div className="fixed inset-0 z-40" onClick={() => setAiMenu(false)} />
              <div className="absolute right-0 top-full mt-1 z-50 w-60 bg-white rounded-xl shadow-2xl border border-stone-200 overflow-hidden text-stone-700">
                <button onClick={() => { setAiMenu(false); setShowReview(true); if (!reviewBusy) runReview(); }} className="w-full text-left px-3 py-2.5 hover:bg-stone-50 flex items-start gap-2 border-b border-stone-100">
                  <Icon name="spellcheck" className="w-4 h-4 shrink-0 mt-0.5 text-stone-500" />
                  <span><span className="block text-[12px] font-bold">AI校正チェック</span><span className="block text-[10px] text-stone-400">誤字脱字・未記入・構成の弱点を確認</span></span>
                </button>
                <button onClick={() => { setAiMenu(false); setShowAssistant(true); setAssistantSummary(""); }} className="w-full text-left px-3 py-2.5 hover:bg-stone-50 flex items-start gap-2">
                  <Icon name="robot" className="w-4 h-4 shrink-0 mt-0.5 text-stone-500" />
                  <span><span className="block text-[12px] font-bold">AIで反映</span><span className="block text-[10px] text-stone-400">LINE文面やメモを貼って構成に反映</span></span>
                </button>
              </div>
            </>)}
          </div>
          <button onClick={() => setShowTheme((s) => !s)} title="テーマカラー変更"
            className="w-8 h-8 rounded-lg grid place-items-center border border-white/20 hover:bg-white/10">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: mainText }}>
              <path d="M12 2a10 10 0 100 20 2 2 0 002-2 1.8 1.8 0 00-.5-1.2 1.8 1.8 0 01-.5-1.2 2 2 0 012-2H17a5 5 0 005-5c0-4.4-4.5-8-10-8z" />
              <circle cx="7.5" cy="10.5" r="1.2" fill="currentColor" stroke="none" />
              <circle cx="12" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
              <circle cx="16.5" cy="10.5" r="1.2" fill="currentColor" stroke="none" />
            </svg>
          </button>
        </div>
        {/* タブ（アイコン＋短ラベルで1行に収める） */}
        <div className="max-w-[1500px] mx-auto px-2 sm:px-4 flex gap-1">
          {[["overview", "note", "概要", "概要"], ["plan", "image", "企画・サムネ", "企画"], ...(project.format === "talk" ? [] : [["hearing", "chat", "ヒアリング", "聞取り"], ["wizard", "sparkle", "質問ウィザード", "質問"]]), ["script", "file", "構成台本", "台本"], ...(project.format === "talk" ? [] : [["kouban", "map", "香盤表", "香盤"]]), ["assets", "folder", "素材管理", "素材"], ["review", "video", "動画確認", "動画"], ["deliver", "checkCircle", "納品完了", "納品"]].map(([k, ic, label, short]) => (
            <button key={k} onClick={() => setTab(k)}
              className={"flex-1 min-w-0 inline-flex items-center justify-center gap-1 sm:gap-1.5 whitespace-nowrap px-1 sm:px-4 py-2 sm:py-1.5 rounded-t-lg text-[11px] sm:text-[12px] font-bold tracking-wide transition-colors " + (tab === k ? "" : "opacity-50 hover:opacity-80")}
              style={tab === k ? { background: "#E9E8E3", color: "#1C1C1E" } : { color: mainText }}>
              <Icon name={ic} className="w-4 h-4 shrink-0" />
              <span className="truncate"><span className="sm:hidden">{short}</span><span className="hidden sm:inline">{label}</span></span>
            </button>
          ))}
        </div>
        <div className="h-[5px] w-full" style={{ background: stripe }} />

        {showTheme && (
          <div className="absolute right-4 top-full mt-2 bg-white text-stone-800 rounded-xl shadow-xl border border-stone-200 p-4 w-64 z-40">
            <h3 className="text-xs font-bold mb-3">テーマカラー</h3>
            <label className="flex items-center justify-between text-xs mb-2.5">
              メインカラー
              <input type="color" value={theme.main} onChange={(e) => setTheme("main", e.target.value)}
                className="w-10 h-7 rounded cursor-pointer border border-stone-200" />
            </label>
            <label className="flex items-center justify-between text-xs mb-3">
              アクセントカラー
              <input type="color" value={theme.accent} onChange={(e) => setTheme("accent", e.target.value)}
                className="w-10 h-7 rounded cursor-pointer border border-stone-200" />
            </label>
            <div className="flex gap-2">
              {[["#1F2430", "#E63946"], ["#0F1A14", "#34C77B"], ["#1A1040", "#8B5CF6"], ["#241A12", "#E8A33D"], ["#FFFFFF", "#1C1C1E"]].map(([mn, ac], i) => (
                <button key={i} onClick={() => setProject((p) => ({ ...p, theme: { main: mn, accent: ac } }))}
                  className="w-9 h-7 rounded-md border border-stone-200 overflow-hidden flex" title="プリセット">
                  <span className="flex-1" style={{ background: mn }} />
                  <span className="w-2.5" style={{ background: ac }} />
                </button>
              ))}
            </div>
            <button onClick={() => setProject((p) => ({ ...p, theme: { ...DEFAULT_THEME } }))}
              className="mt-3 text-[11px] text-stone-400 underline">初期色に戻す</button>
          </div>
        )}
      </header>

      <main className="max-w-[1500px] mx-auto px-3 sm:px-5 pt-5">

        {/* ===== 進行ストリップ（全タブ共通）：日程の正本＝Flip Board。ここは読み取りの「窓」 ===== */}
        {sched && (
          <div className="max-w-[1500px] mx-auto mb-4 rounded-xl border border-stone-200 bg-white px-3 sm:px-4 py-2 flex items-center gap-x-4 gap-y-1 flex-wrap text-[12px]">
            <span className="inline-flex items-center gap-1.5 font-bold text-stone-700">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: theme.accent }} />
              {sched.phase || "進行中"}
            </span>
            {(sched.status === "delivered" || sched.status === "posted") && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600">納品済</span>
            )}
            {sched.shootDate && (
              <span className="text-stone-500">撮影 {sched.shootDate.slice(5).replace("-", "/")}{sched.shootTime ? " " + sched.shootTime : ""}</span>
            )}
            {sched.next && sched.next.date && (
              <span className={"font-bold " + (sched.next.days < 0 ? "text-rose-600" : sched.next.days <= 3 ? "text-amber-600" : "text-stone-600")}>
                {sched.next.phase}締切 {sched.next.date.slice(5).replace("-", "/")}
                <span className="ml-1 font-normal">{sched.next.days < 0 ? "（期限超過）" : sched.next.days === 0 ? "（今日）" : "（あと" + sched.next.days + "日）"}</span>
              </span>
            )}
            {sched.nextAction && <span className="text-stone-600 truncate max-w-[42ch]">次の一手：{sched.nextAction}</span>}
            {sched.canReportUp && (
              <button onClick={reportUp} disabled={reportingUp}
                title="この案件のあがりをAKに報告（ボールをAKに渡す）。phaseは動かさず、AKが確認して次へ進めます。"
                className="ml-auto shrink-0 text-[11px] font-bold px-3 py-1 rounded-lg text-white shadow disabled:opacity-50"
                style={{ background: theme.accent, color: accentText }}>
                {reportingUp ? "報告中…" : "✅ あがり報告"}
              </button>
            )}
            <span className={(sched.canReportUp ? "" : "ml-auto ") + "text-[10px] text-stone-400 shrink-0"}>日程 = Flip Board連動</span>
          </div>
        )}

        {/* ===== タブ共有ボタン（全タブ共通・常に右上の同じ位置）：今のタブの共有URLをコピー ===== */}
        {TAB_SHARE_PANE[tab] && (
          <div className="max-w-[1500px] mx-auto mb-4 flex justify-end">
            <button onClick={() => copyShareUrl(tab)} disabled={sharing} title="このタブの共有URLをコピー"
              className="text-[11px] font-bold px-3 py-1.5 rounded-lg text-white shadow inline-flex items-center gap-1.5 disabled:opacity-50" style={{ background: theme.accent, color: accentText }}>
              <Icon name="share" className="w-3.5 h-3.5" />{sharing ? "発行中…" : TAB_SHARE_LABEL[tab]}
            </button>
          </div>
        )}

        {/* ===== 構成台本の指標（TOTAL尺・字数・字/秒・取り込み）：構成台本タブの中に内包 ===== */}
        {tab === "script" && (
          <div className="max-w-[1500px] mx-auto mb-4 rounded-xl border border-stone-200 bg-white px-3 sm:px-4 py-2 flex items-center gap-3 flex-wrap text-[12px]">
            <div className="flex items-baseline gap-1.5" style={{ fontFamily: mono }}>
              <span className="text-[9px] tracking-widest text-stone-400">TOTAL</span>
              <span className="text-base sm:text-xl font-bold tabular-nums leading-none text-stone-800">{fmt(totalEst)}</span>
              <span className="text-[10px] text-stone-400">{totalChars.toLocaleString()}字</span>
              <span className="text-[10px] tabular-nums text-stone-400 ml-1 pl-1.5 border-l border-stone-200" title="各シーンの秒数の合計（シーン尺）">シーン {fmt(totalTarget)}</span>
            </div>
            <label className="flex items-center gap-1 text-[11px] text-stone-500">
              <input type="number" min="3" max="8" step="0.5" value={project.rate}
                onChange={(e) => setProject((p) => ({ ...p, rate: Number(e.target.value) || 5 }))}
                className="w-11 sm:w-12 bg-stone-50 border border-stone-200 rounded-md px-1 sm:px-1.5 py-1 text-center focus:outline-none focus:border-stone-400"
                style={{ fontFamily: mono }} />
              字/秒
            </label>
            <button onClick={() => { setImportTarget("current"); setImportFileName(""); setFullImportText(""); setShowFullImport(true); }}
              title="JSON / 構成台本コピー / TXT・CSV・Excel から取り込み（この案件を更新）"
              className="ml-auto h-8 px-3 rounded-lg inline-flex items-center gap-1.5 text-[11px] font-bold border border-stone-200 hover:bg-stone-50 text-stone-600">
              <Icon name="download" className="w-3.5 h-3.5" />取り込み
            </button>
          </div>
        )}

        {/* ================= チャンネルコンセプトタブ ================= */}
        {/* チャンネル（コンセプト）は概要タブに統合 */}
        {tab === "overview" && (
          <div className="max-w-[1000px] mx-auto mb-8">
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <p className="text-[12px] text-stone-500 leading-relaxed flex-1 min-w-[200px]">
                チャンネル「<span className="font-bold" style={{ color: theme.main }}>{curChannel}</span>」のコンセプト。<span className="font-bold">同じチャンネル（フォルダ）の全案件で共有</span>されます。
              </p>
              {curChannel !== DEFAULT_CHANNEL && (
                <div className="shrink-0 flex items-center gap-1.5">
                  <button onClick={() => publishChannel(curChannel, false)} disabled={chSharing}
                    title="このチャンネルのコンセプト＋配下の全案件をまとめて見せる共有URLを発行（読み取り専用）"
                    className="h-8 px-3 rounded-lg inline-flex items-center gap-1.5 text-[11px] font-bold text-white shadow disabled:opacity-50" style={{ background: theme.main }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></svg>
                    {chSharing ? "発行中…" : (channelInfo[curChannel] && channelInfo[curChannel].shareId) ? "共有を更新" : "見せる用に共有"}
                  </button>
                  <button onClick={() => publishChannel(curChannel, true)} disabled={chSharing}
                    title="先方がURLから全案件の企画・サムネ・構成台本を直接編集できる共有URLを発行（ログイン不要・リアルタイム反映）"
                    className="h-8 px-3 rounded-lg inline-flex items-center gap-1.5 text-[11px] font-bold shadow disabled:opacity-50 border" style={{ borderColor: theme.accent, color: theme.accent }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                    {chSharing ? "発行中…" : "編集つきで共有"}
                  </button>
                </div>
              )}
            </div>
            {curChannel === DEFAULT_CHANNEL && (
              <div className="mb-4 text-[12px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 inline-flex items-start gap-1.5">
                <Icon name="warn" className="w-4 h-4 shrink-0 mt-0.5" /><span>この案件は「未分類」です。サイドバーでフォルダにクライアント名を付ける（✎）と、チャンネル単位でコンセプトを管理できます。</span>
              </div>
            )}

            {/* クライアントの傾向・注意点（修正コメントから蓄積） */}
            <section className={cardCls + " mb-4"}>
              {cardHead("クライアントの傾向・注意点")}
              <div className="p-4">
                {(() => {
                  const tally = CMT_CATEGORIES.map((c) => [c, comments.filter((x) => (x.category || "その他") === c).length]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
                  return tally.length ? (
                    <div className="mb-3">
                      <div className="text-[11px] font-bold text-stone-500 mb-1.5">この案件で来た修正の傾向（カテゴリ別）</div>
                      <div className="flex flex-wrap gap-1.5">{tally.map(([c, n]) => (<span key={c} className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-stone-100 text-stone-600">{c} {n}</span>))}</div>
                    </div>
                  ) : <p className="text-[11px] text-stone-400 mb-3">まだ修正コメントがありません。動画確認で来た修正がカテゴリ別にここへ集まります。</p>;
                })()}
                <label className="block">
                  <span className="text-[11px] font-bold text-stone-500">このクライアントで気をつけること（蓄積メモ）</span>
                  <textarea value={curChannelInfo.clientNotes || ""} onChange={(e) => updateChannelInfo({ clientNotes: e.target.value })}
                    placeholder="例）テロップの誤字に厳しい／OPは短め好み／顔出しNGの人がいる／納期は前倒し希望 …案件をこなすごとに追記"
                    className="mt-1 w-full h-24 text-[13px] border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-400 resize-y" />
                </label>
              </div>
            </section>

            <section className={cardCls + " mb-4"}>
              {cardHead("チャンネル基本情報")}
              <div className="p-4 grid sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[11px] font-bold text-stone-500">チャンネル名</span>
                  <input value={curChannelInfo.name} onChange={(e) => updateChannelInfo({ name: e.target.value })}
                    placeholder="例）Bird Flip チャンネル"
                    className="mt-1 w-full text-[14px] border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-400" />
                </label>
                <label className="block">
                  <span className="text-[11px] font-bold text-stone-500">チャンネルURL</span>
                  <input value={curChannelInfo.url} onChange={(e) => updateChannelInfo({ url: e.target.value })}
                    placeholder="https://www.youtube.com/@..."
                    className="mt-1 w-full text-[13px] border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-400" style={{ fontFamily: mono }} />
                </label>
              </div>
            </section>

            <section className={cardCls + " mb-4"}>
              {cardHead("コンセプト設計")}
              <div className="p-4 space-y-3">
                {[
                  ["concept", "コンセプト", "このチャンネルで何を発信するか。一言で言うと？"],
                  ["target", "ターゲット", "誰に届けるか（年齢・性別・悩み・状況など）"],
                  ["purpose", "CV先・チャンネルの目的", "最終的に何につなげるか（自社サービス送客／集客／採用／ブランディング 等）"],
                ].map(([key, label, ph]) => (
                  <label key={key} className="block">
                    <span className="text-[11px] font-bold text-stone-500">{label}</span>
                    <textarea value={curChannelInfo[key]} onChange={(e) => updateChannelInfo({ [key]: e.target.value })}
                      placeholder={ph}
                      className="mt-1 w-full h-20 text-[13px] leading-relaxed border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-400 resize-y" />
                  </label>
                ))}
              </div>
            </section>

            <section className={cardCls + " mb-4"}>
              <div className="px-4 py-2.5 flex items-center justify-between border-b border-stone-100">
                <span className="text-[12px] font-bold tracking-wide text-stone-600">競合チャンネル</span>
                <span className="text-[10px] text-stone-400">URLを貼ると登録者数を自動取得</span>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                  {(curChannelInfo.competitors || []).map((c, i) => (
                      <div key={i} className="border border-stone-200 rounded-xl overflow-hidden flex flex-col bg-stone-50/50 relative">
                        <button onClick={() => removeCompetitor(i)} title="削除"
                          className="absolute top-1 right-1 z-10 w-6 h-6 rounded-lg grid place-items-center bg-white/80 text-stone-400 hover:text-red-500 hover:bg-white shadow-sm"><Icon name="trash" className="w-3 h-3" /></button>
                        {compBusy[i] ? (
                          <div className="aspect-video grid place-items-center bg-white border-b border-stone-100"><div className="w-12 h-12 rounded-full bg-stone-200 animate-pulse" /></div>
                        ) : c.thumb ? (
                          <a href={c.url || "#"} target="_blank" rel="noreferrer" className="aspect-video grid place-items-center bg-white border-b border-stone-100">
                            <img src={c.thumb} alt="" className="w-14 h-14 rounded-full object-cover" referrerPolicy="no-referrer" />
                          </a>
                        ) : (
                          <div className="aspect-video grid place-items-center bg-white border-b border-dashed border-stone-200 text-[9px] text-stone-300 text-center px-1">URLを貼ると<br />サムネ表示</div>
                        )}
                        <div className="px-2 pt-1.5">
                          {c.name
                            ? <div className="text-[11px] font-bold text-stone-700 leading-snug line-clamp-2" title={c.name}>{c.name}</div>
                            : <div className="text-[10px] text-stone-300">未取得</div>}
                          {(c.subs > 0 || c.videos > 0) && (
                            <div className="text-[9px] text-stone-500 flex flex-wrap gap-x-1.5" style={{ fontFamily: mono }}>
                              <span title="登録者数">👤 {fmtNum(c.subs)}</span>
                              {c.videos > 0 && <span title="動画数">🎬 {fmtNum(c.videos)}</span>}
                            </div>
                          )}
                        </div>
                        <div className="p-1.5 mt-auto space-y-1">
                          <input
                            key={c.url}
                            defaultValue={c.url}
                            placeholder="チャンネルURL"
                            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== c.url) fetchCompetitor(i, v); }}
                            onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
                            className="w-full text-[9px] border border-stone-200 rounded px-1.5 py-1 focus:outline-none focus:border-stone-400" style={{ fontFamily: mono }} />
                          <input value={c.note || ""} onChange={(e) => updateCompetitor(i, { note: e.target.value })}
                            placeholder="メモ"
                            className="w-full text-[10px] border border-stone-200 rounded px-1.5 py-1 focus:outline-none focus:border-stone-400" />
                        </div>
                      </div>
                  ))}
                  <button onClick={addCompetitor}
                    className="border border-dashed border-stone-300 rounded-xl aspect-[3/4] grid place-items-center text-stone-400 hover:bg-stone-50 hover:text-stone-600">
                    <span className="inline-flex flex-col items-center gap-1 text-[11px] font-bold"><Icon name="plus" className="w-5 h-5" />競合を追加</span>
                  </button>
                </div>
              </div>
            </section>

            <p className="text-[11px] text-stone-400 leading-relaxed">
              ここで決めたコンセプト・ターゲット・競合は、このチャンネルの全案件で共有されます。企画やタイトルを考えるときの土台にしてください。
            </p>
          </div>
        )}

        {/* 全案件 横断検索バーはホーム（案件一覧）へ移設 */}

        {/* ================= トーク系 構成台本タブ ================= */}
        {tab === "script" && project.format === "talk" && (() => {
          const t = project.talk || newTalk();
          const labelCls = "text-[11px] font-bold tracking-wide";
          const taCls = "mt-1 w-full text-[13.5px] leading-relaxed border border-stone-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-stone-400 resize-y";
          const sec = (no, title, hint, children) => (
            <section className={cardCls + " mb-3"}>
              <div className="px-4 py-2.5 flex items-center gap-2 border-b border-stone-100">
                <span className="w-6 h-6 rounded-lg grid place-items-center text-[11px] font-bold text-white shrink-0" style={{ background: theme.main }}>{no}</span>
                <span className="text-[13px] font-bold text-stone-700">{title}</span>
                {hint && <span className="text-[10px] text-stone-400 ml-auto">{hint}</span>}
              </div>
              <div className="p-4">{children}</div>
            </section>
          );
          return (
            <div className="max-w-[900px] mx-auto">
              <p className="text-[12px] text-stone-500 mb-3">トーク系台本（一人語り・対談など）。タイトルは「企画・サムネ」タブと連携しています。</p>
              {sec("①", "タイトル", "企画・サムネと連携", (
                <input value={(project.plans && project.plans[0] && project.plans[0].title) || ""} onChange={(e) => setPlanField(0, "title", e.target.value)} onBlur={() => commitCaseName(activeId)}
                  placeholder="動画のタイトル" className="w-full text-[15px] font-bold border border-stone-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-stone-400" />
              ))}
              {sec("②", "ハイライト", "冒頭に差し込む見せ場・名場面", (
                <AutoTextarea value={t.highlight} onChange={(e) => updateTalk({ highlight: e.target.value })} placeholder="一番盛り上がる部分・パンチのある一言など。視聴維持のためのつかみ" className={taCls} minHeight={88} />
              ))}
              {sec("③", "冒頭", "挨拶〜本題に入るまでの導入", (
                <AutoTextarea value={t.intro} onChange={(e) => updateTalk({ intro: e.target.value })} placeholder="自己紹介、今日のテーマ、この動画を見ると何がわかるか" className={taCls} minHeight={104} />
              ))}
              {sec("④", "目次", "話す項目（チャプター）", (
                <div className="space-y-1.5">
                  {t.toc.map((item, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-[11px] font-bold text-stone-400 w-5 shrink-0 text-center" style={{ fontFamily: mono }}>{i + 1}</span>
                      <input value={item} onChange={(e) => setToc(i, e.target.value)} placeholder={"項目 " + (i + 1)}
                        className="flex-1 text-[13px] border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-400" />
                      <button onClick={() => removeToc(i)} className="w-7 h-7 rounded-lg grid place-items-center text-stone-300 hover:bg-red-50 hover:text-red-500 shrink-0"><Icon name="trash" className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                  <button onClick={addToc} className="text-xs font-bold px-3 py-1.5 rounded-lg border border-stone-300 hover:bg-stone-50 inline-flex items-center gap-1"><Icon name="plus" className="w-3.5 h-3.5" />項目を追加</button>
                </div>
              ))}
              {sec("⑤", "本編", "各トピックの中身", (
                <div className="space-y-2.5">
                  {t.body.map((b, i) => (
                    <div key={b.id} id={"row-" + b.id} className="border rounded-xl overflow-hidden transition-shadow" style={flashId === b.id ? { boxShadow: "0 0 0 3px " + theme.accent } : { borderColor: "#e7e5e4" }}>
                      <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-stone-50 border-b border-stone-100">
                        <span className="text-[10px] font-bold text-stone-400 shrink-0" style={{ fontFamily: mono }}>本編{i + 1}</span>
                        <input value={b.heading} onChange={(e) => setBody(b.id, { heading: e.target.value })} placeholder="この区切りの見出し"
                          className="flex-1 min-w-0 bg-transparent text-[13px] font-bold focus:outline-none" />
                        <button onClick={() => moveBody(b.id, -1)} title="上へ" className="w-6 h-6 grid place-items-center rounded text-stone-400 hover:bg-stone-200 shrink-0"><Icon name="up" className="w-3.5 h-3.5" /></button>
                        <button onClick={() => moveBody(b.id, 1)} title="下へ" className="w-6 h-6 grid place-items-center rounded text-stone-400 hover:bg-stone-200 shrink-0"><Icon name="down" className="w-3.5 h-3.5" /></button>
                        <button onClick={() => removeBody(b.id)} title="削除" className="w-6 h-6 grid place-items-center rounded text-stone-300 hover:bg-red-50 hover:text-red-500 shrink-0"><Icon name="trash" className="w-3.5 h-3.5" /></button>
                      </div>
                      <AutoTextarea value={b.script} onChange={(e) => setBody(b.id, { script: e.target.value })} placeholder="話す内容（原稿）。質問は行頭に ◼ を付けると見出し扱いになります"
                        className="w-full text-[13.5px] leading-relaxed px-3 py-2.5 focus:outline-none" minHeight={128} />
                    </div>
                  ))}
                  <button onClick={addBody} className="text-xs font-bold px-3 py-1.5 rounded-lg border border-stone-300 hover:bg-stone-50 inline-flex items-center gap-1"><Icon name="plus" className="w-3.5 h-3.5" />本編を追加</button>
                </div>
              ))}
              {sec("⑥", "CTA", "締め・行動喚起", (
                <AutoTextarea value={t.cta} onChange={(e) => updateTalk({ cta: e.target.value })} placeholder="チャンネル登録・高評価・次の動画・概要欄リンクなどの誘導" className={taCls} minHeight={88} />
              ))}
            </div>
          );
        })()}

        {/* ================= 構成台本タブ ================= */}
        {tab === "script" && project.format !== "talk" && (
          <>
            {/* 番組情報 */}
            <section className={cardCls + " mb-4"}>
              {cardHead("番組情報")}
              <div className="grid sm:grid-cols-2 border-b border-stone-100">
                <div className="flex sm:border-r border-stone-100">
                  <div className="w-20 shrink-0 px-3 py-2 text-[11px] font-bold text-stone-400">撮影日</div>
                  <input className={metaInput} value={m.shootDate} placeholder="例：5月16日" onChange={(e) => setMeta("shootDate", e.target.value)} />
                </div>
                <div className="flex border-t sm:border-t-0 border-stone-100">
                  <div className="w-20 shrink-0 px-3 py-2 text-[11px] font-bold text-stone-400">撮影場所</div>
                  <input className={metaInput} value={m.place} onChange={(e) => setMeta("place", e.target.value)} />
                </div>
              </div>
              {/* タイトル（企画・サムネタブと連携／1企画＝1案件） */}
              <div className="flex border-b border-stone-100">
                <div className="w-20 shrink-0 px-3 py-2 text-[11px] font-bold text-stone-400">タイトル</div>
                <input className={metaInput} value={((project.plans || [])[0] && project.plans[0].title) || ""} placeholder="例）30歳で会社を捨てた男の末路" onChange={(e) => setPlanField(0, "title", e.target.value)} onBlur={() => commitCaseName(activeId)} title="企画・サムネタブのタイトルと連携しています" />
              </div>
              {/* サムネ文言 */}
              <div className="flex">
                <div className="w-20 shrink-0 px-3 py-2 text-[11px] font-bold text-stone-400">サムネ文言</div>
                <input className={metaInput} value={((project.plans || [])[0] && project.plans[0].thumbText) || ""} placeholder="例）人生、詰んだ。" onChange={(e) => setPlanField(0, "thumbText", e.target.value)} title="企画・サムネタブのサムネ文言と連携しています" />
              </div>
            </section>

            {/* ハイライト（独立カード） */}
            <section className={cardCls + " mb-4"}>
              {cardHead("ハイライト（冒頭フック）", (
                <button onClick={() => setHighlightCollapsed((v) => !v)} title={highlightCollapsed ? "ハイライトを開く" : "ハイライトを畳む"}
                  className="w-6 h-6 shrink-0 grid place-items-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-stone-700 transition-colors">
                  <span className="text-[10px] transition-transform inline-block" style={{ transform: highlightCollapsed ? "rotate(-90deg)" : "none" }}>▾</span>
                </button>
              ))}
              {!highlightCollapsed && (
                <ScriptCell value={m.highlight} onChange={(v) => setMeta("highlight", v)} accent={theme.accent} placeholder="冒頭フックの原稿・テロップ案など（空行でEnter → ◼︎ 自動挿入）" />
              )}
            </section>

            {/* 構成テーブル（PC：横並びテーブル） */}
            {!isNarrow && (
            <section className={cardCls}>
             <div className="overflow-x-auto">
              <table className="w-full border-collapse table-fixed" style={{ minWidth: isNarrow ? 600 : undefined }}>
                <colgroup>
                  <col style={{ width: isNarrow ? 64 : 86 }} />
                  <col style={{ width: isNarrow ? 130 : 148 }} />
                  <col style={{ width: isNarrow ? 120 : 148 }} />
                  <col style={{ width: 58 }} />
                  <col style={{ width: 80 }} />
                  <col />
                  {!isNarrow && <col style={{ width: 100 }} />}
                </colgroup>
                <thead>
                  <tr style={{ background: theme.main, color: mainText }}>
                    {["時間", "内容", "シーン", "秒数", "所要時間", "原稿", ...(isNarrow ? [] : [""])].map((h, i) => (
                      <th key={i} className="px-3 py-2 text-left text-[10px] font-bold tracking-[0.15em] whitespace-nowrap" style={{ opacity: 0.9 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody style={{ userSelect: painting ? "none" : "auto" }}>
                  {project.rows.map((r, idx) => {
                    if (r.kind === "location") {
                      return (
                        <tr key={r.id} id={"row-" + r.id} {...dropZoneProps(idx)}
                          onMouseEnter={() => setHoverId(r.id)} onMouseLeave={() => setHoverId(null)}
                          onPointerEnter={() => paintSelectTo(idx)}
                          onContextMenu={(e) => { e.preventDefault(); setRowMenu({ id: r.id, idx, kind: "location", x: e.clientX, y: e.clientY }); }}
                          style={{
                            ...(dragOverIndex === idx && dragIds && !dragIds.includes(r.id) ? { boxShadow: "inset 0 3px 0 0 " + theme.accent } : {}),
                            ...(flashId === r.id ? { boxShadow: "inset 0 0 0 3px " + theme.accent } : {}),
                          }}>
                          <td colSpan={6} className="p-0 pt-2">
                            <div className="flex items-stretch overflow-hidden" style={{ background: theme.main, filter: r.done ? "grayscale(1)" : "none", opacity: r.done ? 0.7 : 1 }}>
                              <div className="w-6 shrink-0 grid place-items-center cursor-grab active:cursor-grabbing" style={{ background: stripe }}
                                {...rowDragProps(idx, r.id)} title="ドラッグで移動" />
                              <BufferedInput
                                value={r.label}
                                onChange={(v) => updateRow(r.id, { label: v })}
                                placeholder="ロケーション名（例：ご自宅）"
                                className="flex-1 bg-transparent text-[13px] font-bold tracking-[0.08em] px-3 py-2 focus:outline-none"
                                style={{ color: mainText, textDecoration: r.done ? "line-through" : "none" }}
                              />
                              <input
                                type="time"
                                value={r.time || ""}
                                onChange={(e) => updateRow(r.id, { time: e.target.value })}
                                onClick={(e) => e.stopPropagation()}
                                title="到着・開始予定時刻（香盤表と連動／以降のシーンの実時刻の起点）"
                                className="shrink-0 w-[64px] self-center mr-1 bg-transparent text-[12px] font-bold tabular-nums text-center rounded px-0 py-0.5 focus:outline-none focus:bg-white/15 appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-datetime-edit]:text-center [&::-webkit-datetime-edit-fields-wrapper]:justify-center"
                                style={{ fontFamily: mono, color: mainText, opacity: r.time ? 1 : 0.5 }} />
                              {!r.time && clocks[r.id] != null && (
                                <span className="shrink-0 self-center mr-1 text-[11px] tabular-nums opacity-50" style={{ fontFamily: mono, color: mainText }} title="前のロケ時刻からの自動算出（実時刻）">
                                  ≈{fmtClock(clocks[r.id])}
                                </span>
                              )}
                              <button
                                onClick={() => updateRow(r.id, { done: !r.done })}
                                title={r.done ? "撮影完了を取り消す（香盤表と連動）" : "このロケを撮影完了にする（香盤表と連動）"}
                                className={"shrink-0 self-center text-[10px] font-bold px-2.5 py-1 my-1 mr-2 rounded-md whitespace-nowrap transition-colors " + (r.done ? "bg-white/15 hover:bg-white/25 text-white/80" : "bg-white text-stone-700 hover:bg-stone-100 shadow-sm")}>
                                {r.done
                                  ? <span className="inline-flex items-center gap-1"><Icon name="checkCircle" className="w-3.5 h-3.5" />完了</span>
                                  : <span className="inline-flex items-center gap-1"><Icon name="check" className="w-3.5 h-3.5" />撮影完了</span>}
                              </button>
                              {r.done && (() => { const lc = locations.find((l) => l.id === r.id); return (
                                <span className="shrink-0 self-center mr-2 text-[10px] whitespace-nowrap opacity-60" style={{ color: mainText, fontFamily: mono }} title="撮影完了で畳み中">
                                  {lc ? lc.scenes.length : 0}シーン・尺 {fmt(lc ? lc.secSum : 0)} ▾畳み
                                </span>
                              ); })()}
                              <span className="self-center pr-3 text-[9px] tracking-[0.2em] opacity-40" style={{ color: mainText, fontFamily: mono }}>LOCATION</span>
                            </div>
                          </td>
                          {!isNarrow && <td className="pt-2 align-middle" />}
                        </tr>
                      );
                    }

                    const t = sectionOf(r.type);
                    const target = targetOf(r);
                    const chars = countChars(r.script);
                    const dur = chars / project.rate;
                    const over = chars > 0 && dur > target * 1.5;
                    const locDone = sceneLocDone[r.id];
                    if (locDone) return null; // 所属ロケが撮影完了 → 畳んで非表示
                    const sceneDone = !!r.done;
                    return (
                      <tr key={r.id} id={"row-" + r.id}
                        {...dropZoneProps(idx)}
                        onMouseEnter={() => setHoverId(r.id)} onMouseLeave={() => setHoverId(null)}
                        onContextMenu={(e) => { e.preventDefault(); setRowMenu({ id: r.id, idx, kind: "scene", sceneType: r.type, x: e.clientX, y: e.clientY }); }}
                        className="border-b border-stone-100 transition-colors hover:bg-stone-50/70"
                        style={{
                          ...(sceneDone ? { background: "#F5F5F4", opacity: 0.55 } : {}),
                          ...(dragOverIndex === idx && dragIds && !dragIds.includes(r.id) ? { boxShadow: "inset 0 3px 0 0 " + theme.accent } : {}),
                          ...(flashId === r.id ? { boxShadow: "inset 0 0 0 3px " + theme.accent } : {}),
                        }}>
                        <td className="align-top pt-2 pl-1.5 pr-1" style={{ borderLeft: "3px solid " + t.color }}>
                          <div className="flex flex-col items-center gap-1">
                            <button
                              onClick={(e) => { e.stopPropagation(); updateRow(r.id, { done: !r.done }); }}
                              title={r.done ? "撮影完了を取り消す" : "このシーンを撮影完了にする"}
                              className={"shrink-0 w-6 h-6 grid place-items-center rounded-md border transition-colors " + (r.done ? "bg-emerald-500 border-emerald-500 text-white" : "bg-white border-stone-300 text-stone-400 hover:bg-stone-100 hover:border-stone-400")}>
                              <Icon name="check" className="w-3.5 h-3.5" />
                            </button>
                            <span className="cursor-grab active:cursor-grabbing text-stone-300 text-[10px] leading-none select-none" {...rowDragProps(idx, r.id)} title="ドラッグで移動">⋮⋮</span>
                            <div className="min-w-0 w-full text-center">
                              {clocks[r.id] != null ? (
                                <div
                                  className="w-full text-[11px] tabular-nums text-center px-0.5 py-0.5"
                                  style={{ fontFamily: mono, color: "#9CA3AF" }}
                                  title="香盤表のロケ到着時刻＋尺の積み上げ（実時刻）。時刻はロケ見出しまたは香盤表タブで編集">
                                  {fmtClock(clocks[r.id])}
                                </div>
                              ) : (
                                <input
                                  key={(r.tc != null ? "m" : "a") + Math.round(tcs[r.id])}
                                  defaultValue={fmt(tcs[r.id])}
                                  draggable={false}
                                  onClick={(e) => e.stopPropagation()}
                                  onBlur={(e) => { const v = e.target.value.trim(); updateRow(r.id, { tc: v === "" ? null : parseTC(v) }); }}
                                  onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
                                  className="w-full text-[11px] tabular-nums text-center bg-transparent rounded px-0.5 py-0.5 focus:outline-none focus:bg-stone-100 hover:bg-stone-100/60"
                                  style={{ fontFamily: mono, color: r.tc != null ? theme.accent : "#9CA3AF", fontWeight: r.tc != null ? 700 : 400 }}
                                  title="開始時刻を手入力で固定（空欄で自動に戻る）" />
                              )}
                              <span className="text-[9px] text-stone-300 tabular-nums" style={{ fontFamily: mono }}>#{sceneNos[r.id]}</span>
                            </div>
                          </div>
                        </td>
                        <td className="align-top p-0">
                          <BufferedTextarea
                            value={r.label}
                            onChange={(v) => updateRow(r.id, { label: v })}
                            rows={1}
                            placeholder="内容"
                            className="block w-full resize-none bg-transparent text-[13px] font-medium leading-snug px-3 py-2 focus:outline-none placeholder:text-stone-300"
                            style={{ minHeight: 38 }}
                          />
                        </td>
                        <td className="align-top px-2 py-1.5">
                          <select
                            value={r.type}
                            onChange={(e) => updateRow(r.id, { type: e.target.value, sec: null })}
                            className="w-full text-[11px] font-bold rounded-full px-2.5 py-1.5 cursor-pointer focus:outline-none focus:ring-2 focus:ring-stone-300 appearance-none text-center"
                            style={{ background: t.bg, color: t.color }}
                          >
                            {TYPE_KEYS.map((k) => <option key={k} value={k}>{SECTION_TYPES[k].full}</option>)}
                          </select>
                        </td>
                        <td className="align-top px-1 py-1.5">
                          <input
                            type="number" min="1"
                            value={target}
                            onChange={(e) => updateRow(r.id, { sec: e.target.value === "" ? null : Number(e.target.value) })}
                            className="w-full text-[12px] text-center bg-stone-50 rounded-md px-1 py-1.5 tabular-nums focus:outline-none focus:ring-2 focus:ring-stone-300"
                            style={{ fontFamily: mono }}
                            title="このシーンの目安秒数"
                          />
                        </td>
                        <td className="align-top px-2 pt-2.5">
                          <div className={"text-[12px] tabular-nums leading-tight whitespace-nowrap " + (over ? "text-red-500 font-bold" : chars ? "text-stone-800 font-semibold" : "text-stone-300")} style={{ fontFamily: mono }}>
                            {chars ? fmt(dur) : "—"}
                          </div>
                          <div className="text-[10px] text-stone-400 leading-tight mt-0.5" style={{ fontFamily: mono }}>{chars}字</div>
                        </td>
                        <td className="align-top p-0 border-l border-stone-100">
                          <ScriptCell value={r.script} onChange={(v) => updateRow(r.id, { script: v })} accent={theme.accent} />
                        </td>
                        {!isNarrow && <td className="align-top py-1.5 pr-2" />}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: theme.main, color: mainText }}>
                    <td className="px-3 py-2.5 text-[11px] tabular-nums" style={{ fontFamily: mono, opacity: 0.7 }}>{fmt(totalEst)}</td>
                    <td className="px-3 py-2.5 text-[12px] font-bold tracking-wider">合計</td>
                    <td></td>
                    <td className="px-1 py-2.5 text-center text-[12px] tabular-nums" style={{ fontFamily: mono, opacity: 0.7 }}>{totalTarget}</td>
                    <td className="px-2 py-2.5 text-[13px] font-bold tabular-nums whitespace-nowrap" style={{ fontFamily: mono }}>{fmt(totalEst)}</td>
                    <td className="px-3 py-2.5 text-[11px]" style={{ fontFamily: mono, opacity: 0.6 }}>{totalChars.toLocaleString()}字</td>
                    {!isNarrow && <td></td>}
                  </tr>
                </tfoot>
              </table>
             </div>
            </section>
            )}

            {/* 構成台本（スマホ：上下積みカード。原稿を全幅で読めるように） */}
            {isNarrow && (
            <section className="flex flex-col">
              {project.rows.map((r, idx) => {
                if (r.kind === "location") {
                  return (
                    <div key={r.id} id={"row-" + r.id}
                      className="flex items-stretch overflow-hidden rounded-lg mt-3 mb-1.5 shadow-sm"
                      style={{ background: theme.main, filter: r.done ? "grayscale(1)" : "none", opacity: r.done ? 0.7 : 1, ...(flashId === r.id ? { boxShadow: "inset 0 0 0 3px " + theme.accent } : {}) }}>
                      <div className="w-1.5 shrink-0" style={{ background: stripe }} />
                      <BufferedInput
                        value={r.label}
                        onChange={(v) => updateRow(r.id, { label: v })}
                        placeholder="ロケーション名（例：ご自宅）"
                        className="flex-1 min-w-0 bg-transparent text-[13px] font-bold tracking-[0.06em] px-2.5 py-2 focus:outline-none"
                        style={{ color: mainText, textDecoration: r.done ? "line-through" : "none" }}
                      />
                      <input
                        type="time"
                        value={r.time || ""}
                        onChange={(e) => updateRow(r.id, { time: e.target.value })}
                        title="到着・開始予定時刻（香盤表と連動）"
                        className="shrink-0 w-[58px] self-center bg-transparent text-[12px] font-bold tabular-nums text-center rounded px-0 py-0.5 focus:outline-none focus:bg-white/15 appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-datetime-edit]:text-center [&::-webkit-datetime-edit-fields-wrapper]:justify-center"
                        style={{ fontFamily: mono, color: mainText, opacity: r.time ? 1 : 0.5 }} />
                      <button
                        onClick={() => updateRow(r.id, { done: !r.done })}
                        title={r.done ? "撮影完了を取り消す" : "このロケを撮影完了にする"}
                        className={"shrink-0 self-center text-[10px] font-bold px-2 py-1 my-1 mr-2 ml-1 rounded-md whitespace-nowrap " + (r.done ? "bg-white/15 text-white/80" : "bg-white text-stone-700 shadow-sm")}>
                        {r.done
                          ? <span className="inline-flex items-center gap-0.5"><Icon name="checkCircle" className="w-3 h-3" />済</span>
                          : <span className="inline-flex items-center gap-0.5"><Icon name="check" className="w-3 h-3" />完了</span>}
                      </button>
                      {r.done && (() => { const lc = locations.find((l) => l.id === r.id); return (
                        <span className="shrink-0 self-center mr-2 text-[10px] whitespace-nowrap opacity-60" style={{ color: mainText, fontFamily: mono }}>
                          {lc ? lc.scenes.length : 0}シーン・{fmt(lc ? lc.secSum : 0)} ▾
                        </span>
                      ); })()}
                    </div>
                  );
                }

                const t = sectionOf(r.type);
                const target = targetOf(r);
                const chars = countChars(r.script);
                const dur = chars / project.rate;
                const over = chars > 0 && dur > target * 1.5;
                const locDone = sceneLocDone[r.id];
                if (locDone) return null; // 所属ロケが撮影完了 → 畳んで非表示
                const sceneDone = !!r.done;
                return (
                  <div key={r.id} id={"row-" + r.id}
                    className="rounded-xl border border-stone-200 bg-white overflow-hidden mb-2"
                    style={{ borderLeft: "3px solid " + t.color, ...(sceneDone ? { opacity: 0.55 } : {}), ...(flashId === r.id ? { boxShadow: "inset 0 0 0 3px " + theme.accent } : {}) }}>
                    {/* メタ：撮影完了・番号・時刻・所要 */}
                    <div className="flex items-center gap-2 px-3 pt-2">
                      <button
                        onClick={() => updateRow(r.id, { done: !r.done })}
                        title={r.done ? "撮影完了を取り消す" : "このシーンを撮影完了にする"}
                        className={"shrink-0 w-6 h-6 grid place-items-center rounded-md border transition-colors " + (r.done ? "bg-emerald-500 border-emerald-500 text-white" : "bg-white border-stone-300 text-stone-400")}>
                        <Icon name="check" className="w-3.5 h-3.5" />
                      </button>
                      <span className="text-[10px] text-stone-300 tabular-nums shrink-0" style={{ fontFamily: mono }}>#{sceneNos[r.id]}</span>
                      {clocks[r.id] != null ? (
                        <span className="text-[11px] tabular-nums shrink-0" style={{ fontFamily: mono, color: "#9CA3AF" }} title="ロケ到着時刻＋尺の積み上げ（実時刻）">{fmtClock(clocks[r.id])}</span>
                      ) : (
                        <input
                          key={(r.tc != null ? "m" : "a") + Math.round(tcs[r.id])}
                          defaultValue={fmt(tcs[r.id])}
                          onBlur={(e) => { const v = e.target.value.trim(); updateRow(r.id, { tc: v === "" ? null : parseTC(v) }); }}
                          onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
                          className="w-[52px] text-[11px] tabular-nums text-center bg-transparent rounded px-0.5 py-0.5 focus:outline-none focus:bg-stone-100"
                          style={{ fontFamily: mono, color: r.tc != null ? theme.accent : "#9CA3AF", fontWeight: r.tc != null ? 700 : 400 }}
                          title="開始時刻を手入力で固定（空欄で自動）" />
                      )}
                      <span className={"ml-auto text-[11px] tabular-nums shrink-0 " + (over ? "text-red-500 font-bold" : chars ? "text-stone-600 font-semibold" : "text-stone-300")} style={{ fontFamily: mono }}>
                        {chars ? fmt(dur) : "—"}<span className="text-stone-400 font-normal"> / {chars}字</span>
                      </span>
                    </div>
                    {/* シーン種別・秒数 */}
                    <div className="flex items-center gap-2 px-3 pt-2">
                      <select
                        value={r.type}
                        onChange={(e) => updateRow(r.id, { type: e.target.value, sec: null })}
                        className="flex-1 min-w-0 text-[11px] font-bold rounded-full px-2.5 py-1 cursor-pointer focus:outline-none appearance-none text-center"
                        style={{ background: t.bg, color: t.color }}>
                        {TYPE_KEYS.map((k) => <option key={k} value={k}>{SECTION_TYPES[k].full}</option>)}
                      </select>
                      <input
                        type="number" min="1"
                        value={target}
                        onChange={(e) => updateRow(r.id, { sec: e.target.value === "" ? null : Number(e.target.value) })}
                        className="w-14 shrink-0 text-[12px] text-center bg-stone-50 rounded-md px-1 py-1 tabular-nums focus:outline-none focus:ring-2 focus:ring-stone-300"
                        style={{ fontFamily: mono }}
                        title="このシーンの目安秒数" />
                    </div>
                    {/* 内容 */}
                    <BufferedTextarea
                      value={r.label}
                      onChange={(v) => updateRow(r.id, { label: v })}
                      rows={1}
                      placeholder="内容（シーンの見出し）"
                      className="block w-full resize-none bg-transparent text-[13px] font-bold leading-snug px-3 pt-2 pb-1 focus:outline-none placeholder:text-stone-300 placeholder:font-normal" />
                    {/* 原稿（全幅・スマホは大きめフォントで読みやすく） */}
                    <div className="border-t border-stone-100 mt-1">
                      <ScriptCell value={r.script} onChange={(v) => updateRow(r.id, { script: v })} accent={theme.accent} fontSize={15} />
                    </div>
                    {/* 操作 */}
                    <div className="flex items-center gap-1 px-2 py-1 border-t border-stone-100 bg-stone-50/60">
                      <button className={opBtn} title="上へ" onClick={() => moveRow(idx, -1)}><Icon name="up" className="w-3.5 h-3.5" /></button>
                      <button className={opBtn} title="下へ" onClick={() => moveRow(idx, 1)}><Icon name="down" className="w-3.5 h-3.5" /></button>
                      <div className="flex-1" />
                      <button className={opBtn} title="下に行を追加" onClick={() => insertBelow(idx, newScene(r.type))}><Icon name="plus" className="w-3.5 h-3.5" /></button>
                      <button className={opBtn + " hover:bg-red-100 hover:text-red-500"} title="削除" onClick={() => deleteRow(r.id)}><Icon name="trash" className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                );
              })}
              {/* 合計 */}
              <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 mt-1 text-[11px] tabular-nums" style={{ background: theme.main, color: mainText, fontFamily: mono }}>
                <span className="font-bold tracking-wider">合計</span>
                <span className="ml-auto">想定 {fmt(totalEst)}</span>
                <span className="opacity-70">{totalChars.toLocaleString()}字</span>
              </div>
            </section>
            )}

            <div className="mt-4 flex flex-wrap gap-2 items-center">
              <button onClick={() => setRows((rows) => [...rows, newLocation("")])}
                className="text-xs font-bold px-4 py-2 rounded-full shadow-sm hover:opacity-90 inline-flex items-center gap-1"
                style={{ background: theme.main, color: mainText }}>
                <Icon name="plus" className="w-3.5 h-3.5" /> ロケーション
              </button>
              {TYPE_KEYS.map((k) => (
                <button key={k} onClick={() => setRows((rows) => [...rows, newScene(k)])}
                  className="text-xs font-bold px-4 py-2 rounded-full shadow-sm hover:opacity-80 inline-flex items-center gap-1"
                  style={{ background: SECTION_TYPES[k].bg, color: SECTION_TYPES[k].color }}>
                  <Icon name="plus" className="w-3.5 h-3.5" /> {k}
                </button>
              ))}
              <div className="flex-1" />
              <button
                onClick={() => { if (window.confirm("この案件の構成をリセットして一日密着テンプレート（8ロケーション）に戻しますか？")) setProject((p) => ({ ...p, rows: templateRows() })); }}
                className="text-[11px] text-stone-400 underline hover:text-red-400">
                テンプレートに戻す
              </button>
            </div>

            <p className="mt-3 text-[11px] text-stone-400 leading-relaxed">
              原稿：太字 ⌘B／赤文字 ⌘⇧H（空行Enterで「◼︎ 」自動挿入）　／　ロケ見出しの時刻＝香盤表と連動。各シーンの時間はロケ到着時刻＋尺の積み上げで実時刻表示（時刻未設定なら動画内TC、空欄で自動に戻る）　／　左の⋮⋮をドラッグで移動・左の✓で撮影完了（グレーアウト）　／　所要時間 ＝ 文字数 ÷ {project.rate}字/秒　／　自動保存
            </p>
          </>
        )}

        {/* ================= 香盤表タブ ================= */}
        {tab === "kouban" && (
          <>
            <section className={cardCls + " mb-4"}>
              <div className="px-4 py-2.5 flex items-center justify-between border-b border-stone-100 flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-4 rounded-full" style={{ background: theme.accent }} />
                  <h2 className="text-[12px] font-bold tracking-wider text-stone-600">香盤表 — 1日の流れ</h2>
                </div>
                <div className="text-[11px] text-stone-400" style={{ fontFamily: mono }}>
                  {m.shootDate || "撮影日未設定"}・{locations.length}ロケーション・本編想定 {fmt(totalEst)}・シーン尺 {fmt(totalTarget)}{totalTravel > 0 && <>・交通費 ¥{totalTravel.toLocaleString()}</>}
                </div>
              </div>

              <div className="px-4 sm:px-6 py-5">
                {locations.length === 0 && (
                  <p className="text-sm text-stone-400 text-center py-8">構成台本タブでロケーションを追加すると、ここに1日の流れが表示されます。</p>
                )}

                {locations.map((loc, i) => (
                  <div key={loc.id} className="relative flex gap-2.5 sm:gap-4 group/loc">
                    {/* 左：時刻レール */}
                    <div className="flex flex-col items-center w-[46px] sm:w-[72px] shrink-0 pt-0.5">
                      <input
                        type="time"
                        value={loc.time}
                        onChange={(e) => updateRow(loc.id, { time: e.target.value })}
                        className="bg-transparent text-[11px] sm:text-[14px] font-bold tabular-nums w-full text-center px-0 py-0.5 rounded focus:outline-none focus:bg-stone-100 appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-datetime-edit]:text-center [&::-webkit-datetime-edit-fields-wrapper]:justify-center"
                        style={{ fontFamily: mono, color: loc.done ? "#A8A29E" : theme.main, textDecoration: loc.done ? "line-through" : "none" }}
                        title="到着・開始予定時刻（最初のロケに時刻を入れると、以降は撮影尺から自動で連動）"
                      />
                      {!parseClock(loc.time) && clocks[loc.id] != null && (
                        <span className="text-[10px] sm:text-[12px] tabular-nums text-stone-400 leading-none mt-0.5" style={{ fontFamily: mono }} title="前のロケ到着時刻＋撮影尺の積み上げから自動算出（目安）">
                          ≈{fmtClock(clocks[loc.id])}
                        </span>
                      )}
                      <div className="w-5 h-5 sm:w-7 sm:h-7 mt-1 rounded-full grid place-items-center font-bold text-[10px] sm:text-[12px] shadow-sm z-10 transition-colors"
                        style={{ background: loc.done ? "#A8A29E" : theme.accent, color: accentText, fontFamily: mono }}>
                        {loc.done ? <Icon name="check" className="w-3 h-3 sm:w-3.5 sm:h-3.5" /> : i + 1}
                      </div>
                      {i < locations.length - 1 && (
                        <div className="flex-1 w-0.5 my-1 rounded min-h-[20px]" style={{ background: theme.main, opacity: 0.2 }} />
                      )}
                    </div>

                    {/* 右：移動ストリップ＋ロケーションカード */}
                    <div className="flex-1 min-w-0 mb-3">
                    {i > 0 && (() => {
                      const prev = locations[i - 1];
                      if (samePlace(prev, loc)) return (
                        <div className="mb-2 px-2.5 py-1 flex items-center gap-1.5 text-[10px] text-stone-300" title="前のロケと同じ住所のため移動なし（交通費の対象外）">
                          <Icon name="pin" className="w-3 h-3" />同じ場所（移動なし）
                        </div>
                      );
                      const from = (prev.label || "").trim() || "前のロケ";
                      const to = (loc.label || "").trim() || "このロケ";
                      const oq = prev.lat != null ? prev.lat + "," + prev.lng : (prev.address || "").trim();
                      const dq = loc.lat != null ? loc.lat + "," + loc.lng : (loc.address || "").trim();
                      const dirHref = oq && dq ? "https://www.google.com/maps/dir/?api=1&origin=" + encodeURIComponent(oq) + "&destination=" + encodeURIComponent(dq) : null;
                      return (
                        <div className="mb-2 px-2.5 py-1.5 rounded-lg border border-dashed border-stone-200 bg-stone-50 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-stone-500">
                          <span className="inline-flex items-center gap-1 font-bold text-stone-400 shrink-0"><Icon name="map" className="w-3.5 h-3.5" />移動</span>
                          <span className="min-w-0 truncate" title={from + " → " + to}>{from} <span className="text-stone-300">→</span> {to}</span>
                          <span className="flex items-center gap-1.5 ml-auto">
                            <input
                              value={loc.travelBy || ""}
                              onChange={(e) => updateRow(loc.id, { travelBy: e.target.value })}
                              placeholder="電車・車など"
                              className="w-[84px] bg-white border border-stone-200 rounded px-1.5 py-0.5 text-[11px] focus:outline-none placeholder:text-stone-300"
                            />
                            <span className="inline-flex items-center gap-0.5">
                              <span className="text-stone-400">¥</span>
                              <input
                                type="number" inputMode="numeric" min="0"
                                value={loc.travelCost == null ? "" : loc.travelCost}
                                onChange={(e) => updateRow(loc.id, { travelCost: e.target.value === "" ? null : Number(e.target.value) })}
                                placeholder="0"
                                className="w-[64px] bg-white border border-stone-200 rounded px-1.5 py-0.5 text-[11px] tabular-nums focus:outline-none placeholder:text-stone-300"
                                style={{ fontFamily: mono }}
                                title="この区間の交通費（片道の実費）"
                              />
                            </span>
                            {dirHref && (
                              <a href={dirHref} target="_blank" rel="noreferrer" title="Googleマップで経路を開く"
                                 className="text-[10px] font-bold px-1.5 py-0.5 rounded border border-stone-200 text-stone-500 hover:bg-white whitespace-nowrap">経路</a>
                            )}
                          </span>
                        </div>
                      );
                    })()}
                    <div className={"relative rounded-xl border overflow-visible transition-all duration-200 " + (loc.done ? "border-stone-200 bg-stone-100 opacity-60" : (loc.peak ? "border-2 bg-white shadow-md" : "border-stone-200 bg-white shadow-sm"))}
                      style={loc.peak && !loc.done ? { borderColor: theme.accent } : undefined}>
                      {loc.peak && !loc.done && (
                        <span className="absolute -top-2.5 left-3 z-20 text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm inline-flex items-center gap-0.5"
                          style={{ background: theme.accent, color: accentText }}>★ 山場</span>
                      )}
                      <div className={"flex items-stretch overflow-hidden " + (loc.peak ? "rounded-t-[10px]" : "rounded-t-xl")} style={{ background: theme.main, filter: loc.done ? "grayscale(1)" : "none" }}>
                        <div className="w-1.5 shrink-0" style={{ background: stripe }} />
                        <input
                          value={loc.label}
                          onChange={(e) => updateRow(loc.id, { label: e.target.value })}
                          placeholder="ロケーション名"
                          className="flex-1 min-w-0 bg-transparent text-[14px] font-bold tracking-wide px-3 py-2 focus:outline-none"
                          style={{ color: mainText, textDecoration: loc.done ? "line-through" : "none" }}
                        />
                        <button
                          onClick={() => updateRow(loc.id, { peak: !loc.peak })}
                          title={loc.peak ? "山場マークを外す" : "ここを山場（見せ場）にする"}
                          className="shrink-0 self-center w-7 h-7 my-1 grid place-items-center rounded-md transition-colors hover:bg-white/15"
                          style={{ color: mainText }}>
                          <span className={"text-[15px] leading-none transition-opacity " + (loc.peak ? "opacity-100" : "opacity-35")}>★</span>
                        </button>
                        {/* 撮影完了トグル（常時表示・スマホ対応） */}
                        <button
                          onClick={() => updateRow(loc.id, { done: !loc.done })}
                          title={loc.done ? "撮影完了を取り消す" : "このロケの撮影を完了にして畳む"}
                          className={"shrink-0 self-center text-[11px] font-bold px-2.5 py-1.5 my-1 rounded-md whitespace-nowrap transition-colors " + (loc.done ? "bg-white/15 hover:bg-white/25 text-white/80" : "bg-white text-stone-700 hover:bg-stone-100 shadow-sm")}>
                          {loc.done
                            ? <span className="inline-flex items-center gap-1"><Icon name="undo" className="w-3.5 h-3.5" />戻す</span>
                            : <span className="inline-flex items-center gap-1"><Icon name="check" className="w-3.5 h-3.5" /><span className="sm:hidden">完了</span><span className="hidden sm:inline">撮影完了</span></span>}
                        </button>
                        <div className="hidden sm:flex items-center gap-0.5 pr-2 opacity-0 group-hover/loc:opacity-100 transition-opacity">
                          <button className="w-6 h-6 grid place-items-center rounded text-[11px] hover:bg-white/15" style={{ color: mainText }} title="ロケーションごと上へ" onClick={() => moveLocationBlock(loc.id, -1)}><Icon name="up" className="w-3.5 h-3.5" /></button>
                          <button className="w-6 h-6 grid place-items-center rounded text-[11px] hover:bg-white/15" style={{ color: mainText }} title="ロケーションごと下へ" onClick={() => moveLocationBlock(loc.id, 1)}><Icon name="down" className="w-3.5 h-3.5" /></button>
                        </div>
                      </div>

                      {loc.done ? (
                        /* 完了時：グレーアウト＆縮小（1行サマリ） */
                        <div className="px-3 py-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-stone-400 min-w-0" style={{ fontFamily: mono }}>
                          <span className="font-bold text-emerald-600 inline-flex items-center gap-1"><Icon name="checkCircle" className="w-3.5 h-3.5" />撮影完了</span>
                          <span>{loc.scenes.length}シーン</span>
                          <span className="ml-auto whitespace-nowrap">想定 {fmt(loc.dur)} / シーン尺 {fmt(loc.secSum)}</span>
                        </div>
                      ) : (
                        <>
                          <div className="grid sm:grid-cols-2 border-b border-stone-200/70 bg-white">
                            <div className="flex items-center sm:border-r border-stone-100">
                              <span className="pl-3 pr-1 shrink-0 text-stone-400"><Icon name="pin" className="w-3.5 h-3.5" /></span>
                              <AddressField loc={loc} onChange={(patch) => updateRow(loc.id, patch)} />
                            </div>
                            <div className="flex items-center border-t sm:border-t-0 border-stone-100">
                              <span className="pl-3 pr-1 shrink-0 text-stone-400"><Icon name="note" className="w-3.5 h-3.5" /></span>
                              <input
                                value={loc.note}
                                onChange={(e) => updateRow(loc.id, { note: e.target.value })}
                                placeholder="メモ（駐車場・許可・持ち物など）"
                                className="block w-full bg-transparent text-[12px] px-1 py-2 focus:outline-none placeholder:text-stone-300"
                              />
                            </div>
                          </div>

                          {/* シーンチップ */}
                          <div className="px-3 py-2.5 flex flex-wrap items-center gap-1.5">
                            {loc.scenes.length === 0 && <span className="text-[11px] text-stone-300">シーンなし</span>}
                            {loc.scenes.map((s) => {
                              const st = SECTION_TYPES[s.type];
                              return (
                                <span key={s.id} className="text-[10px] font-bold px-2 py-1 rounded-full"
                                  style={{ background: st.bg, color: st.color }}>
                                  {s.label || st.full}
                                </span>
                              );
                            })}
                            <span className="ml-auto text-[10px] text-stone-400 whitespace-nowrap" style={{ fontFamily: mono }}>
                              {loc.scenes.length}シーン / 想定 {fmt(loc.dur)} / シーン尺 {fmt(loc.secSum)}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <p className="text-[11px] text-stone-400 leading-relaxed">
              時刻・住所・メモはこの画面で入力（構成台本と自動で連動）　／　ロケ間の「移動」行に手段・交通費を入れると合計が上に出ます（共有ページにも表示）　／　↑↓でロケーションごと順番を入れ替え（配下のシーンも一緒に動きます）　／　右上のボタンで香盤表だけをスプシ用にコピーできます
            </p>
          </>
        )}

        {/* ================= 企画・サムネ タブ（チャンネル案件ボード） ================= */}
        {tab === "plan" && (
          <>
            <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
              <p className="text-[12px] text-stone-500 leading-relaxed max-w-2xl">
                <span className="font-bold">「{curChannel}」の企画一覧</span>。1つの企画＝1本の動画＝1案件です。行をクリックすると参考サムネを展開、<span className="font-bold">「構成台本へ→」</span>でその企画の台本を書けます。
              </p>
              <button onClick={addBoardCase}
                className="shrink-0 text-[11px] font-bold px-3 py-2 rounded-lg shadow inline-flex items-center gap-1"
                style={{ background: theme.accent, color: accentText }}>
                <Icon name="plus" className="w-3.5 h-3.5" />企画を追加
              </button>
            </div>

            <div className="space-y-1.5">
              {boardCases.map((entry, pi) => {
                const isActive = entry.id === activeId;
                const data = isActive ? project : boardCache[entry.id];
                const p0 = boardPlan0(data);
                const expanded = isActive && !collapseActive;
                const hasMulti = !!(data && data.plans && data.plans.length > 1);
                const title = p0 ? p0.title : "";
                const thumbText = p0 ? p0.thumbText : "";
                const firstVid = p0 && p0.refs ? (p0.refs.find((r) => r.vid) || {}).vid : "";
                return (
                  <section key={entry.id} className={"rounded-xl border bg-white overflow-hidden " + (isActive ? "border-stone-400 shadow-sm" : "border-stone-200")}>
                    {/* コンパクト1行ヘッダ：#N ＋ タイトル ＋ サムネ文言 ＋ 操作 */}
                    <div className="flex items-center gap-2 px-2.5 py-2 cursor-pointer hover:bg-stone-50" onClick={() => openBoardCase(entry.id)}>
                      <div className="shrink-0 flex flex-col -my-1" onClick={(e) => e.stopPropagation()}>
                        <button onClick={(e) => { e.stopPropagation(); moveCaseInChannel(entry.id, -1); }} disabled={pi === 0} title="この企画を上へ"
                          className="w-4 h-4 grid place-items-center rounded text-stone-400 hover:bg-stone-200 disabled:opacity-25 disabled:hover:bg-transparent"><Icon name="up" className="w-3 h-3" /></button>
                        <button onClick={(e) => { e.stopPropagation(); moveCaseInChannel(entry.id, 1); }} disabled={pi === boardCases.length - 1} title="この企画を下へ"
                          className="w-4 h-4 grid place-items-center rounded text-stone-400 hover:bg-stone-200 disabled:opacity-25 disabled:hover:bg-transparent"><Icon name="down" className="w-3 h-3" /></button>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); openBoardCase(entry.id); }} title={expanded ? "畳む" : "参考サムネを開く"}
                        className="shrink-0 w-6 h-6 grid place-items-center rounded-lg text-[11px] font-bold tabular-nums"
                        style={{ background: isActive ? theme.accent : "#f5f5f4", color: isActive ? accentText : "#78716c" }}>
                        #{pi + 1}
                      </button>
                      {firstVid
                        ? <img src={"https://img.youtube.com/vi/" + firstVid + "/default.jpg"} alt="" className="shrink-0 w-12 h-7 object-cover rounded" />
                        : <div className="shrink-0 w-12 h-7 rounded bg-stone-100 grid place-items-center text-[10px] text-stone-300"><Icon name="image" className="w-3.5 h-3.5" /></div>}
                      {data ? (
                        <input value={title} onClick={(e) => e.stopPropagation()} onChange={(e) => updateBoardTitle(entry.id, "title", e.target.value)} onBlur={() => commitCaseName(entry.id)}
                          placeholder={"タイトル案（例：30歳で会社を捨てた男の末路）"}
                          className="flex-1 min-w-0 text-[13px] font-bold bg-transparent border-0 border-b border-transparent hover:border-stone-200 focus:border-stone-400 focus:outline-none px-0.5 py-1" />
                      ) : brokenIds[entry.id] ? (
                        <span className="flex-1 min-w-0 truncate text-[13px] font-bold text-rose-500">{entry.name}（本体データ無し → 右のゴミ箱で削除）</span>
                      ) : <span className="flex-1 min-w-0 truncate text-[13px] font-bold text-stone-400">{entry.name}（読み込み中…）</span>}
                      {data && (
                        <input value={thumbText} onClick={(e) => e.stopPropagation()} onChange={(e) => updateBoardTitle(entry.id, "thumbText", e.target.value)}
                          placeholder="サムネ文言"
                          className="hidden md:block w-44 shrink-0 text-[12px] font-bold text-stone-600 bg-stone-50 rounded-lg border border-transparent hover:border-stone-200 focus:border-stone-400 focus:outline-none px-2 py-1.5" />
                      )}
                      <button onClick={(e) => { e.stopPropagation(); goScript(entry.id); }} title="この企画の構成台本を書く"
                        className="shrink-0 text-[11px] font-bold px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1 text-white" style={{ background: theme.main }}>
                        <Icon name="file" className="w-3.5 h-3.5" /><span className="hidden sm:inline">構成台本へ</span> →
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); deleteBoardCase(entry.id); }} title="この企画（案件）を削除"
                        className="shrink-0 w-7 h-7 rounded-lg grid place-items-center text-stone-400 hover:bg-red-50 hover:text-red-500"><Icon name="trash" className="w-3.5 h-3.5" /></button>
                      <span className="shrink-0 w-4 text-center text-[10px] text-stone-400 transition-transform" style={{ transform: expanded ? "none" : "rotate(-90deg)" }}>▾</span>
                    </div>

                    {/* 折り畳み時：参考サムネを横並びで一覧表示（サムネ君風・クリックで展開して編集） */}
                    {!expanded && (() => {
                      const refs = (data && data.plans ? data.plans.flatMap((pl) => pl.refs || []) : []).filter((r) => r.vid);
                      if (!refs.length) return null;
                      return (
                        <div className="px-2.5 pb-2.5 flex gap-2 overflow-x-auto cursor-pointer" onClick={() => openBoardCase(entry.id)}>
                          {refs.map((rf, ri) => {
                            const sc = rf.uploadDate ? scoreVideo(rf, Date.now()) : null;
                            return (
                              <div key={ri} className="shrink-0 w-48">
                                <div className="relative">
                                  <img src={"https://img.youtube.com/vi/" + rf.vid + "/mqdefault.jpg"} alt="" className="w-full aspect-video object-cover rounded-md border border-stone-200" />
                                  {sc && <span className="absolute top-1 left-1 text-[10px] font-bold text-white px-1.5 py-0.5 rounded" style={{ background: GRADE_COLOR[sc.grade] }}>{sc.grade}</span>}
                                  {sc && <span className="absolute top-1 right-1 text-[10px] font-bold text-white bg-black/70 px-1.5 py-0.5 rounded" style={{ fontFamily: mono }}>{sc.ratioStr}</span>}
                                </div>
                                <div className="text-[10px] font-bold leading-tight mt-1 line-clamp-2 text-stone-600">{rf.title}</div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}

                    {/* 旧データ：複数企画案を持つ案件 → 分割導線 */}
                    {hasMulti && (
                      <div className="mx-2.5 mb-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-800 flex items-center justify-between gap-2">
                        <span>この案件には企画案が<span className="font-bold">{data.plans.length}件</span>入っています。1企画＝1案件にするには分けてください。</span>
                        <button onClick={() => splitExtraPlans(entry.id)} className="shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-lg bg-amber-500 text-white hover:bg-amber-600">別々の案件に分ける</button>
                      </div>
                    )}

                    {/* アクティブ案件のみ展開：参考サムネ＋メモ */}
                    {expanded && p0 && (() => {
                      const pl = project.plans[0];
                      return (
                        <div className="px-3 pb-3 pt-1 border-t border-stone-100">
                          <div className="text-[11px] font-bold text-stone-500 mb-2">参考サムネ・動画（5本まで）</div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                            {pl.refs.map((rf, ri) => {
                              const busy = refBusy[pl.id + ":" + ri];
                              const sc = rf.uploadDate ? scoreVideo(rf, Date.now()) : null;
                              return (
                                <div key={ri} className="border border-stone-200 rounded-xl overflow-hidden flex flex-col bg-stone-50/50">
                                  <div className="px-2 pt-1.5 text-[9px] font-bold text-stone-400">参考 {ri + 1}</div>
                                  {busy ? (
                                    <div className="aspect-video mx-2 my-1 rounded-lg bg-stone-200 animate-pulse" />
                                  ) : rf.vid ? (
                                    <a href={"https://www.youtube.com/watch?v=" + rf.vid} target="_blank" rel="noreferrer" className="block relative mx-2 mt-1">
                                      <img src={"https://img.youtube.com/vi/" + rf.vid + "/mqdefault.jpg"} alt="" className="w-full aspect-video object-cover rounded-lg" />
                                      {rf.duration && <span className="absolute bottom-1 right-1 text-[9px] font-bold text-white bg-black/75 px-1 rounded" style={{ fontFamily: mono }}>{rf.duration}</span>}
                                      {sc && <span className="absolute top-1 left-1 text-[10px] font-bold text-white px-1.5 rounded" style={{ background: GRADE_COLOR[sc.grade] }}>{sc.grade}</span>}
                                    </a>
                                  ) : (
                                    <div className="aspect-video mx-2 my-1 rounded-lg border border-dashed border-stone-300 grid place-items-center text-[9px] text-stone-300">URLを貼る</div>
                                  )}
                                  {rf.vid && (
                                    <div className="px-2 pt-1">
                                      <div className="text-[10px] font-bold text-stone-700 leading-snug line-clamp-2" title={rf.title}>{rf.title}</div>
                                      <div className="text-[9px] text-stone-400 truncate" title={rf.channel}>{rf.channel}</div>
                                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] text-stone-500 mt-0.5" style={{ fontFamily: mono }}>
                                        <span title="再生数">▶ {fmtNum(rf.views)}</span>
                                        <span title="登録者数">👤 {fmtNum(rf.subs)}</span>
                                        {sc && <span className="font-bold" style={{ color: GRADE_COLOR[sc.grade] }} title="再生数÷登録者数（バズ倍率）">{sc.ratioStr}</span>}
                                      </div>
                                    </div>
                                  )}
                                  <div className="p-1.5 mt-auto">
                                    <input
                                      defaultValue={rf.url}
                                      key={rf.url}
                                      placeholder="YouTube URL"
                                      onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== rf.url) fetchPlanRef(pl.id, ri, v); else if (!v && rf.url) updatePlanRef(pl.id, ri, emptyRef()); }}
                                      onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
                                      className="w-full text-[9px] border border-stone-200 rounded px-1.5 py-1 focus:outline-none focus:border-stone-400" />
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                        </div>
                      );
                    })()}
                  </section>
                );
              })}
            </div>

            <button onClick={addBoardCase}
              className="mt-2 text-xs font-bold px-4 py-2.5 rounded-lg border border-dashed border-stone-300 hover:bg-white inline-flex items-center gap-1.5 w-full justify-center text-stone-500">
              <Icon name="plus" className="w-4 h-4" />このチャンネルに企画（案件）を追加
            </button>
            <p className="text-[11px] text-stone-400 leading-relaxed mt-2">
              評価は<span className="font-bold">再生数 ÷ 登録者数</span>（バズ倍率）と投稿の新しさから自動算出（S＝5倍以上 / A＝3倍 / B＝等倍 / C＝それ未満）。各企画は別々の案件として保存され、ログインすればクラウド同期されます。
            </p>
          </>
        )}

        {/* ================= ヒアリングタブ（演者の事前聞き取り→構成のネタ元） ================= */}
        {tab === "hearing" && (
          <div className="max-w-[1500px] mx-auto px-1 sm:px-0 py-1 space-y-4">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <p className="text-[12px] text-stone-500">撮影前に演者のことを聞き取るシート。ここを埋めると<span className="font-bold">構成台本のネタ元</span>になります。「🤖 AIに読ませる用リンク」で渡せば、この内容から構成案を作らせられます。</p>
              <button onClick={resetHearing} className="shrink-0 text-[11px] font-bold text-stone-400 hover:text-stone-600 underline">初期テンプレに戻す</button>
            </div>
            <button onClick={() => setHearingImport({ raw: "" })}
              className="w-full rounded-xl border border-dashed p-3 text-[12px] font-bold inline-flex items-center justify-center gap-2 transition-colors"
              style={{ borderColor: theme.accent, color: theme.accent }}>
              <Icon name="sparkle" className="w-4 h-4" />文字起こしを貼ってAIに自動でまとめてもらう
            </button>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-stone-400">GPT等に渡す：</span>
              <button onClick={copyHearingForAI} className="text-[12px] font-bold px-3 py-1.5 rounded-lg border border-stone-300 bg-white text-stone-700 shadow-sm hover:bg-stone-50 inline-flex items-center gap-1.5">
                <Icon name="sparkle" className="w-3.5 h-3.5" />GPT用にコピー
              </button>
              <button onClick={exportHearingCSV} className="text-[12px] font-bold px-3 py-1.5 rounded-lg border border-stone-300 bg-white text-stone-700 shadow-sm hover:bg-stone-50 inline-flex items-center gap-1.5">
                <Icon name="download" className="w-3.5 h-3.5" />CSVで書き出し
              </button>
            </div>
            {(project.hearing || []).map((sec) => (
              <div key={sec.id} className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5">
                <div className="flex items-center gap-2 mb-3">
                  <input value={sec.title} onChange={(e) => setHearingTitle(sec.id, e.target.value)}
                    className="flex-1 min-w-0 text-[14px] font-bold text-stone-800 bg-transparent border-b border-transparent hover:border-stone-200 focus:border-stone-400 focus:outline-none py-0.5" />
                  <button onClick={() => removeHearingSection(sec.id)} title="セクション削除" className="shrink-0 text-stone-300 hover:text-rose-500"><Icon name="trash" className="w-4 h-4" /></button>
                </div>
                <div className="space-y-3">
                  {sec.items.map((it) => (
                    <div key={it.id} className="group">
                      <div className="flex items-center gap-2 mb-1">
                        <input value={it.label} onChange={(e) => setHearingItemLabel(sec.id, it.id, e.target.value)}
                          className="flex-1 min-w-0 text-[11px] font-bold text-stone-500 bg-transparent border-b border-transparent hover:border-stone-200 focus:border-stone-400 focus:outline-none" />
                        <button onClick={() => removeHearingItem(sec.id, it.id)} title="項目削除" className="shrink-0 opacity-0 group-hover:opacity-100 text-stone-300 hover:text-rose-500"><Icon name="close" className="w-3.5 h-3.5" /></button>
                      </div>
                      {it.hint && <div className="text-[10px] text-stone-400 mb-1 leading-snug whitespace-pre-wrap break-words">{it.hint}</div>}
                      <RichCell value={it.value} onChange={(e) => setHearingItem(sec.id, it.id, e.target.value)}
                        placeholder={it.hint || "ここに聞き取った内容を入力…"} minHeight={44}
                        className="w-full bg-white border border-stone-200 rounded-lg focus-within:border-stone-400" />
                    </div>
                  ))}
                </div>
                <button onClick={() => addHearingItem(sec.id)} className="mt-3 text-[12px] font-bold text-stone-500 hover:text-stone-800 inline-flex items-center gap-1"><Icon name="plus" className="w-3.5 h-3.5" />項目を追加</button>
              </div>
            ))}
            <button onClick={addHearingSection} className="w-full rounded-2xl border-2 border-dashed border-stone-200 hover:border-stone-300 text-[12px] font-bold text-stone-400 hover:text-stone-600 py-3 inline-flex items-center justify-center gap-1"><Icon name="plus" className="w-4 h-4" />セクションを追加</button>
          </div>
        )}

        {/* ================= 質問ウィザードタブ（質問13→台本の骨） ================= */}
        {tab === "wizard" && <WizardPane project={project} setProject={setProject} theme={theme} setTab={setTab} />}

        {/* ================= 概要タブ（案件の入口・現在地） ================= */}
        {tab === "overview" && (
          <div className="max-w-[1500px] mx-auto px-1 sm:px-0 py-1 space-y-4">
            {/* 「いまの状態」(ステータス/次にやること/締切)はタスク管理＝Flip Boardに集約のため削除 */}
            {/* 基本情報 */}
            <div className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5">
              <h2 className="text-[14px] font-bold text-stone-800 mb-3">基本情報</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block"><span className="text-[11px] font-bold text-stone-500">案件名</span>
                  <input value={project.name || ""} onChange={(e) => { const v = e.target.value; setProject((p) => ({ ...p, name: v })); renameProject(project.id, v); }} className="mt-1 w-full text-[13px] border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-400" /></label>
                <label className="block"><span className="text-[11px] font-bold text-stone-500">チャンネル / クライアント</span>
                  <input value={(project.meta && project.meta.client) || ""} onChange={(e) => { const v = e.target.value; setProject((p) => ({ ...p, meta: { ...p.meta, client: v } })); }} placeholder={project.channel} className="mt-1 w-full text-[13px] border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-400" /></label>
                <label className="block"><span className="text-[11px] font-bold text-stone-500">撮影日</span>
                  <input type="date" value={(project.meta && project.meta.shootDate) || ""} onChange={(e) => { const v = e.target.value; setProject((p) => ({ ...p, meta: { ...p.meta, shootDate: v } })); }} className="mt-1 w-full text-[13px] border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-400" /></label>
                <label className="block"><span className="text-[11px] font-bold text-stone-500">撮影場所</span>
                  <input value={(project.meta && project.meta.place) || ""} onChange={(e) => { const v = e.target.value; setProject((p) => ({ ...p, meta: { ...p.meta, place: v } })); }} className="mt-1 w-full text-[13px] border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-400" /></label>
              </div>
              <label className="block mt-3"><span className="text-[11px] font-bold text-stone-500">メモ</span>
                <textarea value={(project.meta && project.meta.note) || ""} onChange={(e) => { const v = e.target.value; setProject((p) => ({ ...p, meta: { ...p.meta, note: v } })); }} className="mt-1 w-full h-20 text-[13px] border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-400 resize-y" /></label>
            </div>
            {/* ひと目サマリー */}
            <div className="grid grid-cols-3 gap-3">
              {[["企画案", (project.plans || []).length], ["素材", (project.assets || []).length], ["確認用動画", (project.assets || []).filter((a) => a.category === "確認用動画").length]].map(([lbl, n]) => (
                <div key={lbl} className="rounded-2xl border border-stone-200 bg-white p-3 text-center">
                  <div className="text-[20px] font-bold text-stone-800">{n}</div>
                  <div className="text-[11px] text-stone-500">{lbl}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ================= 素材管理タブ（assets単一正本） ================= */}
        {tab === "assets" && (
          <div className="max-w-[1500px] mx-auto px-1 sm:px-0 py-1">
            <p className="text-[12px] text-stone-500 mb-3">撮影素材とテンプレ素材を<span className="font-bold">この案件に一元管理</span>。確認用動画は「動画確認」タブで管理します。<span className="text-stone-400">ファイルやフォルダはFinderから各枠に<span className="font-bold">ドラッグ＆ドロップ</span>でアップできます（フォルダは中身をまとめてアップ）。名前は鉛筆アイコンで変更できます。</span></p>
            {project.shareId && (
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <button onClick={() => importGuestUploads(false)} title="編集者が共有リンクから上げた素材をここに取り込む"
                  className="text-[11px] font-bold px-3 py-1.5 rounded-lg border border-stone-300 bg-white text-stone-700 shadow-sm hover:bg-stone-50 inline-flex items-center gap-1.5">
                  <Icon name="refresh" className="w-3.5 h-3.5" /> 編集者アップを取り込み
                </button>
                {(project.assets || []).some((a) => a.key && a.type !== "youtube") && (
                  <button onClick={() => { const n = downloadAssets((project.assets || []).filter((a) => a.key && a.type !== "youtube")); showToast(n + "件のダウンロードを開始"); }}
                    className="text-[11px] font-bold px-3 py-1.5 rounded-lg border border-stone-300 bg-white text-stone-700 shadow-sm hover:bg-stone-50 inline-flex items-center gap-1.5">
                    <Icon name="download" className="w-3.5 h-3.5" /> 全部DL
                  </button>
                )}
                {selAssets.length > 0 && (<>
                  <button onClick={() => { const n = downloadAssets((project.assets || []).filter((a) => selAssets.includes(a.id))); showToast(n + "件のダウンロードを開始"); }}
                    className="text-[11px] font-bold px-3 py-1.5 rounded-lg text-white shadow inline-flex items-center gap-1.5" style={{ background: theme.main }}>
                    <Icon name="download" className="w-3.5 h-3.5" /> 選択をDL（{selAssets.length}）
                  </button>
                  <button onClick={() => setSelAssets([])} className="text-[11px] text-stone-400 hover:text-stone-600 underline">選択解除</button>
                </>)}
              </div>
            )}
            <div className="space-y-4">
              {ASSET_CATEGORIES.map((cat) => {
                const items = (project.assets || []).filter((a) => a.category === cat);
                const uping = assetUp && assetUp.cat === cat;
                return (
                  <section key={cat}
                    onDragOver={(e) => { e.preventDefault(); setDragCat(cat); }}
                    onDragLeave={(e) => { if (e.currentTarget === e.target) setDragCat(null); }}
                    onDrop={(e) => { e.preventDefault(); setDragCat(null); const p = collectDroppedFiles(e.dataTransfer); p.then((fs) => { if (fs.length) uploadAssets(fs, cat); else showToast("ファイルが読み取れなかった。もう一度ドロップしてみて"); }); }}
                    className={"rounded-2xl bg-white p-4 transition-colors " + (dragCat === cat ? "border-2 border-dashed" : "border border-stone-200")}
                    style={dragCat === cat ? { borderColor: theme.accent, background: "#fafaf8" } : {}}>
                    <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                      <h3 className="text-[13px] font-bold text-stone-800">{ASSET_CAT_ICON[cat]} {cat} <span className="text-stone-400 font-normal">{items.length}</span></h3>
                      <label className={"text-[11px] font-bold px-2.5 py-1.5 rounded-lg shadow cursor-pointer " + (project.shareId ? "" : "opacity-40 pointer-events-none")} style={{ background: theme.main, color: "#fff" }}>
                        ＋ファイル
                        <input type="file" multiple className="hidden" onChange={(e) => { const fs = Array.from(e.target.files || []); uploadAssets(fs, cat); e.target.value = ""; }} />
                      </label>
                    </div>
                    <p className="text-[10px] mb-2" style={dragCat === cat ? { color: theme.accent, fontWeight: 700 } : { color: "#a8a29e" }}>{dragCat === cat ? "📥 ここにドロップしてアップロード" : ASSET_CAT_DESC[cat]}</p>
                    {uping && (
                      <div className="mb-2 rounded-lg bg-stone-50 border border-stone-200 px-3 py-2">
                        <div className="text-[11px] text-stone-600 flex items-center gap-2"><span className="truncate flex-1">⬆ {assetUp.name}</span><span className="font-bold tabular-nums">{assetUp.pct}%</span></div>
                        <div className="mt-1 h-1.5 bg-stone-200 rounded overflow-hidden"><div className="h-full transition-all" style={{ width: assetUp.pct + "%", background: theme.accent }} /></div>
                      </div>
                    )}
                    {items.length === 0 ? (
                      <p className="text-[11px] text-stone-400 py-2">{uping ? "" : "まだありません"}</p>
                    ) : (() => {
                      // フォルダごとドロップした素材はシーン別(00_外観〜)にまとめて表示。平置きにしない。
                      const groups = []; const gi = {};
                      for (const a of items) { const fk = a.folder || ""; if (!(fk in gi)) { gi[fk] = groups.length; groups.push([fk, []]); } groups[gi[fk]][1].push(a); }
                      groups.sort((x, y) => (x[0] === "" ? -1 : y[0] === "" ? 1 : x[0].localeCompare(y[0], "ja")));
                      const selGroup = (arr, on) => setSelAssets((cur) => { const ids = arr.filter((a) => a.key && a.type !== "youtube").map((a) => a.id); return on ? Array.from(new Set([...cur, ...ids])) : cur.filter((id) => !ids.includes(id)); });
                      const renderRow = (a) => (
                          <li key={a.id} className="flex items-center gap-2 py-2 text-[12px]">
                            {a.key && a.type !== "youtube"
                              ? <input type="checkbox" checked={selAssets.includes(a.id)} onChange={() => toggleSelAsset(a.id)} title="まとめてDL用に選択" className="shrink-0 w-3.5 h-3.5 accent-stone-600 cursor-pointer" />
                              : <span className="shrink-0 w-3.5" />}
                            <span className="shrink-0">{a.type === "youtube" ? "▶️" : a.type === "mp4" ? "🎬" : "📄"}</span>
                            {renamingAsset === a.id ? (
                              <input autoFocus defaultValue={a.name} placeholder="素材の名前"
                                className="flex-1 min-w-0 border border-stone-300 rounded px-2 py-1 text-[12px] outline-none"
                                style={{ borderColor: theme.accent }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") { renameAsset(a.id, e.currentTarget.value); setRenamingAsset(null); }
                                  if (e.key === "Escape") setRenamingAsset(null);
                                }}
                                onBlur={(e) => { renameAsset(a.id, e.target.value); setRenamingAsset(null); }} />
                            ) : (
                              <a href={assetUrl(a)} target="_blank" rel="noreferrer" className="flex-1 min-w-0 truncate text-stone-700 hover:underline">{a.name || "(無題)"}</a>
                            )}
                            {renamingAsset !== a.id && (
                              <button onClick={() => setRenamingAsset(a.id)} title="名前を変更" className="shrink-0 text-stone-300 hover:text-stone-600"><Icon name="pencil" className="w-3.5 h-3.5" /></button>
                            )}
                            {a.size ? <span className="shrink-0 text-stone-400">{fmtSize(a.size)}</span> : null}
                            <select value={a.category} onChange={(e) => moveAsset(a.id, e.target.value)} className="shrink-0 border border-stone-200 rounded px-1 py-0.5 text-[10px] text-stone-500">
                              {ASSET_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                            {a.key && a.type !== "youtube" && (
                              <button onClick={() => downloadAsset(a)} title="ダウンロード" className="shrink-0 text-stone-400 hover:text-stone-700"><Icon name="download" className="w-4 h-4" /></button>
                            )}
                            <button onClick={() => { if (window.confirm("この素材を削除しますか？")) removeAsset(a.id); }} className="shrink-0 text-stone-300 hover:text-rose-500"><Icon name="trash" className="w-4 h-4" /></button>
                          </li>
                      );
                      return (
                        <div className="space-y-1">
                          {groups.map(([fname, arr]) => {
                            const dlIds = arr.filter((a) => a.key && a.type !== "youtube").map((a) => a.id);
                            const allSel = dlIds.length > 0 && dlIds.every((id) => selAssets.includes(id));
                            return (
                              <div key={fname || "_loose"}>
                                {fname ? (
                                  <div className="flex items-center gap-1.5 mt-2 mb-0.5 pb-0.5 border-b border-stone-100">
                                    {dlIds.length > 0 && <input type="checkbox" checked={allSel} onChange={(e) => selGroup(arr, e.target.checked)} title="このシーンをまとめて選択" className="w-3.5 h-3.5 accent-stone-600 cursor-pointer" />}
                                    <Icon name="folder" className="w-3.5 h-3.5 text-stone-400" />
                                    <span className="text-[11px] font-bold text-stone-500">{fname}</span>
                                    <span className="text-[10px] text-stone-400">{arr.length}</span>
                                  </div>
                                ) : null}
                                <ul className="divide-y divide-stone-100">{arr.map(renderRow)}</ul>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </section>
                );
              })}
            </div>
            {mediaBusy && <div className="mt-3 text-[12px] text-stone-500">{mediaBusy} {mediaProg ? mediaProg + "%" : ""}</div>}
          </div>
        )}

        {/* ================= 動画確認タブ（Frame.io型 修正管理＋バージョン） ================= */}
        {tab === "review" && (() => {
          const evs = activeReviewVersions().length ? activeReviewVersions()
            : (project.assets || []).filter((a) => a.category === "確認用動画").map((a, i) => ({ id: a.id, label: "v" + (i + 1), name: a.name, type: a.type, key: a.key, url: a.url, createdAt: a.createdAt }));
          return (
          <div className="max-w-5xl mx-auto px-1 sm:px-0 py-2">
            <div className="mb-3">
              <h2 className="text-[15px] font-bold text-stone-800">動画確認（試写・修正管理）</h2>
              <p className="text-[12px] text-stone-500 mt-0.5">初稿/修正版をバージョン管理。止めた位置に修正コメント（カテゴリ・優先度・ステータス・返信）。OKが出たらそれが納品。</p>
            </div>
            <ReviewBoard
              versions={evs} trashedVersions={trashedReviewVersions()} comments={comments} main={theme.main} accent={theme.accent} accentText={accentText}
              busy={mediaBusy} prog={mediaProg} userName={(user && user.name) || "ディレクター"}
              shareId={project.shareId} shareToken={project.shareToken} onEnsureShare={ensureShare}
              onUploadVideo={(f) => uploadVersionVideo(f)} onAddYouTube={(u) => addVersionYouTube(u)}
              onRemoveVersion={(id) => removeVersion(id)} onRenameVersion={(id, n) => renameVersion(id, n)} onRestoreVersion={(id) => restoreVersion(id)}
              onPost={(b) => postReviewComment(b)} onUpdate={(cid, p) => updateComment(cid, p)} onReply={(cid, t) => addCommentReply(cid, t)} onDelete={(cid) => deleteComment(cid)} onRefreshStream={() => resumeStreamPolls(true)} />
          </div>
          );
        })()}

        {/* ================= 納品完了タブ ================= */}
        {tab === "deliver" && (() => {
          const dv = [
            ["deliverVideoUrl", "納品完了動画", "動画確認の最新版から自動で入ります（Drive/YouTubeのURLに差し替えOK）", false, true],
            ["deliverShorts", "切り抜きショート", "たてがた君のショートから自動で入ります（1行に1本・差し替えOK）", true, true],
            ["deliverThumbImages", "サムネ画像", "", false, false, "image"],
            ["deliverTitle", "タイトル", "自動生成で埋まります（手直しOK）", false, true],
            ["deliverDescription", "概要欄", "自動生成で埋まります（手直しOK）", true, true],
            ["deliverHashtags", "ハッシュタグ", "自動生成で埋まります（手直しOK）", false, true],
            ["deliverChapters", "目次", "自動生成で埋まります（手直しOK）", true, true],
          ];
          const isFilled = ([key, , , , , kind]) => kind === "image" ? deliverThumbs().length > 0 : !!(m[key] || "").trim();
          const doneCount = dv.filter(isFilled).length;
          return (
          <div className="max-w-3xl mx-auto px-1 sm:px-0 py-2">
            <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-[15px] font-bold text-stone-800">納品完了</h2>
                <p className="text-[12px] text-stone-500 mt-0.5">動画・ショートのURLは動画確認の完成データから自動。タイトル・概要欄・ハッシュタグ・目次は台本から自動生成。編集者も入力OK。</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={generateDeliverAll} disabled={deliverBusy}
                  className="h-8 px-3 rounded-lg inline-flex items-center gap-1.5 text-[11px] font-bold text-white shadow disabled:opacity-50"
                  style={{ background: theme.accent, color: accentText }}>
                  <Icon name="sparkle" className="w-3.5 h-3.5" />{deliverBusy ? "生成中…" : "自動生成"}
                </button>
                <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-stone-100 text-stone-500 tabular-nums">{doneCount}/{dv.length}</span>
                {/* 納品セット完了の報告：Flip Boardリンク済案件だけ。納品確定はAKがFボードで押す（ここでは status を触らない） */}
                {sched && ((sched.status === "delivered" || sched.status === "posted") ? (
                  <span className="h-8 px-3 rounded-lg inline-flex items-center text-[11px] font-bold bg-emerald-50 text-emerald-600">納品済（Flip Board）</span>
                ) : (
                  <button onClick={reportDelivered} disabled={reportingDelivered || !(m.deliverVideoUrl || "").trim()}
                    title="納品セットの完了をAKに報告（Flip Boardのボール→AK＋納品動画URLを書き添え）。納品完了動画のURLが入ると押せます。"
                    className="h-8 px-3 rounded-lg inline-flex items-center gap-1.5 text-[11px] font-bold text-white shadow disabled:opacity-50 bg-emerald-500">
                    <Icon name="checkCircle" className="w-3.5 h-3.5" />{reportingDelivered ? "報告中…" : "納品セット完了を報告"}
                  </button>
                ))}
              </div>
            </div>
            <section className={cardCls}>
              {dv.map((row, i) => {
                const [key, label, placeholder, multiline, auto, kind] = row;
                const filled = isFilled(row);
                const thumbs = kind === "image" ? deliverThumbs() : null;
                return (
                  <div key={key} className={"flex items-start gap-2 px-3 sm:px-4 py-2.5 " + (i === 0 ? "" : "border-t border-stone-100")}>
                    <span className={"shrink-0 w-5 h-5 mt-1 grid place-items-center rounded-md " + (filled ? "bg-emerald-500 text-white" : "bg-stone-100 text-stone-300")}>
                      <Icon name="check" className="w-3 h-3" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-bold text-stone-400 mb-0.5 flex items-center gap-1.5">
                        {label}
                        {auto && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-500">自動</span>}
                      </div>
                      {kind === "image" ? (
                        <div className="mt-1 rounded-lg transition-all p-1 -m-1" style={thumbDropOver ? { outline: "2px dashed " + theme.main, outlineOffset: "2px" } : {}}
                          onDragOver={(e) => { e.preventDefault(); if (!thumbDropOver) setThumbDropOver(true); }}
                          onDragLeave={() => setThumbDropOver(false)}
                          onDrop={(e) => { e.preventDefault(); setThumbDropOver(false); const files = Array.from(e.dataTransfer.files || []).filter((f) => /^image\//.test(f.type)); if (files.length) uploadDeliverThumbs(files); }}>
                          <div className="grid grid-cols-3 gap-2 max-w-md">
                            {thumbs.map((t, ti) => (
                              <label key={t.key} className="relative aspect-video group cursor-pointer" title="クリックで差し替え">
                                {/* object-contain: 画像の縦横比が16:9でなくても切り取らず全体を見せる（coverだと勝手にクロップされ画角が合わない） */}
                                <img src={SHARE_API + "/api/file/" + t.key} alt="" className="w-full h-full object-contain bg-stone-100 rounded-md border border-stone-200" />
                                <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) replaceDeliverThumb(ti, f); e.target.value = ""; }} />
                                <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeDeliverThumb(ti); }} title="削除"
                                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-stone-700 text-white text-[11px] leading-none grid place-items-center opacity-70 hover:opacity-100 hover:bg-rose-500">×</button>
                              </label>
                            ))}
                            {thumbs.length < DELIVER_THUMB_MAX && (
                              <label className="aspect-video rounded-md border border-dashed border-stone-300 grid place-items-center cursor-pointer text-stone-400 hover:text-stone-600 hover:border-stone-400 text-xl leading-none">
                                +
                                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { uploadDeliverThumbs(e.target.files); e.target.value = ""; }} />
                              </label>
                            )}
                          </div>
                          <div className="text-[10px] text-stone-400 mt-1">{thumbs.length}/{DELIVER_THUMB_MAX}枚{thumbUp ? `・アップ中 ${thumbUp.i}/${thumbUp.n}（${thumbUp.pct}%）` : ""}</div>
                        </div>
                      ) : multiline ? (
                        <AutoTextarea value={m[key] || ""} onChange={(e) => setMeta(key, e.target.value)} placeholder={placeholder}
                          className="block w-full bg-transparent text-[13px] px-0 py-0.5 focus:outline-none placeholder:text-stone-300" minHeight={60} />
                      ) : (
                        <input value={m[key] || ""} onChange={(e) => setMeta(key, e.target.value)} placeholder={placeholder}
                          className="block w-full bg-transparent text-[13px] px-0 py-0.5 focus:outline-none placeholder:text-stone-300" />
                      )}
                      {/* URL欄はワンクリックで飛べるリンクを添える（入力欄のテキストは編集用に据え置き） */}
                      {(key === "deliverVideoUrl" || key === "deliverShorts") && (() => {
                        const urls = (m[key] || "").split("\n").map((s) => s.trim()).filter((s) => /^https?:\/\//.test(s));
                        if (!urls.length) return null;
                        // ショートはWorkerのギャラリーページ(/shorts/{snap})で全本まとめて再生できる。URLからsnapを逆引き
                        const gm = key === "deliverShorts" ? urls[0].match(/^(https?:\/\/[^/]+)\/api\/file\/f\/([a-z0-9]+)\//) : null;
                        return (
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {gm && (
                              <a href={gm[1] + "/shorts/" + gm[2]} target="_blank" rel="noreferrer" title="全ショートを1画面で再生・保存"
                                className="text-[10px] font-bold px-2 py-1 rounded-lg border border-rose-200 bg-rose-50 text-rose-500 hover:bg-rose-100 inline-flex items-center gap-1">
                                ↗ まとめて見る
                              </a>
                            )}
                            {urls.map((u, ui) => (
                              <a key={ui} href={u} target="_blank" rel="noreferrer" title={u}
                                className="text-[10px] font-bold px-2 py-1 rounded-lg border border-stone-200 text-stone-500 hover:bg-stone-50 hover:text-stone-700 inline-flex items-center gap-1">
                                ↗ {key === "deliverShorts" ? (urls.length > 1 ? "ショート" + (ui + 1) : "ショート") + "を開く" : "動画を開く"}
                              </a>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                );
              })}
            </section>
          </div>
          );
        })()}

      </main>
      </div>{/* /content wrapper */}

      {/* ===== サムネ目立ちテスト モーダル ===== */}
      {thumbTest && (() => {
        const t = thumbTest;
        const tp = (project.plans || []).find((p) => p.id === t.pid) || {};
        const cells = [...t.items];
        cells.splice(Math.min(t.myPos, cells.length), 0, { mine: true });
        return (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3" onClick={() => setThumbTest(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="px-5 py-3 flex items-center justify-between sticky top-0 z-10" style={{ background: theme.main, color: mainText }}>
                <h3 className="text-sm font-bold tracking-wider inline-flex items-center gap-1.5"><Icon name="sparkle" className="w-4 h-4" />目立ちテスト「{t.keyword}」</h3>
                <button onClick={() => setThumbTest(null)} className="w-7 h-7 rounded-lg grid place-items-center hover:bg-white/15"><Icon name="close" className="w-4 h-4" /></button>
              </div>
              <div className="p-4">
                {t.busy ? (
                  <div className="py-16 text-center text-stone-400 text-sm">競合サムネを集めています…</div>
                ) : (
                  <>
                    <p className="text-[12px] text-stone-500 mb-3">YouTubeの一覧に並んだ想定。この中にあなたのサムネが1枚混ざっています。<span className="font-bold">タイトルごとパッと目に入る？</span>　目立たなければ色・文字・構図を見直すサイン。</p>
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-3 gap-y-4">
                      {cells.map((c, i) => c.mine ? (
                        <div key="mine">
                          <div className="relative rounded-xl overflow-hidden transition-all" style={t.reveal ? { boxShadow: "0 0 0 3px " + theme.accent } : {}}>
                            {(t.myImage || tp.thumbImage)
                              ? <img src={t.myImage || tp.thumbImage} alt="" className="w-full aspect-video object-cover" />
                              : <div className="w-full aspect-video grid place-items-center bg-stone-200 text-[10px] text-stone-400">自作サムネ</div>}
                            {t.reveal && <span className="absolute top-1.5 left-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded text-white shadow" style={{ background: theme.accent }}>あなた</span>}
                          </div>
                          <div className="flex gap-2 mt-2">
                            {channelIconOf(curChannel)
                              ? <div className="w-9 h-9 rounded-full shrink-0 bg-stone-100 grid place-items-center text-lg leading-none">{channelIconOf(curChannel)}</div>
                              : user && user.picture
                                ? <img src={user.picture} alt="" className="w-9 h-9 rounded-full shrink-0 object-cover" referrerPolicy="no-referrer" />
                                : <div className="w-9 h-9 rounded-full shrink-0 grid place-items-center text-white text-xs font-bold" style={{ background: theme.accent }}>{(curChannel || "あ").slice(0, 1)}</div>}
                            <div className="min-w-0">
                              <div className="text-[13px] font-bold text-stone-900 leading-snug" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }} title={tp.title || tp.thumbText || ""}>{tp.title || tp.thumbText || "（タイトル未設定）"}</div>
                              <div className="text-[11px] text-stone-500 mt-0.5 truncate">{curChannel}</div>
                              <div className="text-[11px] text-stone-500 truncate">新着</div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <a key={c.vid} href={"https://www.youtube.com/watch?v=" + c.vid} target="_blank" rel="noreferrer" className="block">
                          <div className="relative rounded-xl overflow-hidden bg-stone-100">
                            <img src={"https://img.youtube.com/vi/" + c.vid + "/mqdefault.jpg"} alt="" className="w-full aspect-video object-cover" />
                            {parseDur(c.duration) && <span className="absolute bottom-1.5 right-1.5 text-[10px] font-bold text-white bg-black/80 px-1 py-0.5 rounded leading-none" style={{ fontFamily: mono }}>{parseDur(c.duration)}</span>}
                          </div>
                          <div className="flex gap-2 mt-2">
                            {c.avatar
                              ? <img src={c.avatar} alt="" className="w-9 h-9 rounded-full shrink-0 object-cover" referrerPolicy="no-referrer" />
                              : <div className="w-9 h-9 rounded-full shrink-0 bg-stone-200" />}
                            <div className="min-w-0">
                              <div className="text-[13px] font-bold text-stone-900 leading-snug" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }} title={decodeHtml(c.title)}>{decodeHtml(c.title)}</div>
                              <div className="text-[11px] text-stone-500 mt-0.5 truncate">{c.channel}</div>
                              <div className="text-[11px] text-stone-500 truncate">{fmtNum(c.views)}回視聴{c.publishedAt ? "・" + relTime(c.publishedAt) : ""}</div>
                            </div>
                          </div>
                        </a>
                      ))}
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button onClick={reshuffleThumbTest} className="text-[12px] font-bold px-4 py-2 rounded-lg border border-stone-200 hover:bg-stone-50 inline-flex items-center gap-1"><Icon name="refresh" className="w-3.5 h-3.5" />配置をシャッフル</button>
                      <button onClick={() => setThumbTest((x) => x && ({ ...x, reveal: !x.reveal }))} className="text-[12px] font-bold px-4 py-2 rounded-lg border border-stone-200 hover:bg-stone-50 inline-flex items-center gap-1"><Icon name={t.reveal ? "close" : "checkCircle"} className="w-3.5 h-3.5" />{t.reveal ? "答えを隠す" : "自分のを光らせる"}</button>
                      <button onClick={() => runThumbTest(t.pid, t.keyword)} className="text-[12px] font-bold px-4 py-2 rounded-lg shadow inline-flex items-center gap-1 ml-auto" style={{ background: theme.accent, color: accentText }}><Icon name="refresh" className="w-3.5 h-3.5" />競合を引き直す</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ===== Claude出力 取り込みモーダル ===== */}
      {showImport && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowImport(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 flex items-center justify-between" style={{ background: theme.main, color: mainText }}>
              <h3 className="text-sm font-bold tracking-wider">Claudeの出力を取り込む</h3>
              <button onClick={() => setShowImport(false)} className="w-7 h-7 rounded-lg grid place-items-center hover:bg-white/15"><Icon name="close" className="w-4 h-4" /></button>
            </div>
            <div className="p-5">
              <p className="text-[12px] text-stone-500 mb-2">
                Claudeが出力した原稿（<span className="font-bold" style={{ fontFamily: mono }}>【1】…【2】…</span> の形式）をそのまま貼り付けてください。番号がテーブルの <span className="font-bold" style={{ fontFamily: mono }}>#1 #2…</span> に対応します。
              </p>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={"【1】自己紹介\n◼︎ おはようございます！\nよろしくお願いします！\n\n【2】現在の活動について\n…"}
                className="w-full h-72 text-[13px] leading-relaxed border border-stone-200 rounded-xl p-3 focus:outline-none focus:border-stone-400 resize-y"
              />
              <div className="mt-3 flex justify-end gap-2">
                <button onClick={() => setShowImport(false)} className="text-xs font-bold px-4 py-2 rounded-lg border border-stone-200 hover:bg-stone-50">キャンセル</button>
                <button onClick={importFromClaude} disabled={!importText.trim()}
                  className="text-xs font-bold px-5 py-2 rounded-lg shadow disabled:opacity-40"
                  style={{ background: theme.accent, color: accentText }}>
                  取り込む
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== 構成台本まるごと取り込みモーダル（新規案件） ===== */}
      {showFullImport && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowFullImport(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 flex items-center justify-between" style={{ background: theme.main, color: mainText }}>
              <h3 className="text-sm font-bold tracking-wider">構成台本を取り込み{importTarget === "current" ? " → この案件を更新" : " → 新規案件"}</h3>
              <button onClick={() => setShowFullImport(false)} className="w-7 h-7 rounded-lg grid place-items-center hover:bg-white/15"><Icon name="close" className="w-4 h-4" /></button>
            </div>
            <div className="p-5">
              {/* 取込先の選択：新規案件 / 開いている案件を更新 */}
              <div className="flex items-center gap-1 p-1 mb-3 rounded-xl bg-stone-100 text-[12px] font-bold">
                <button onClick={() => setImportTarget("new")}
                  className={"flex-1 px-3 py-2 rounded-lg transition inline-flex items-center justify-center gap-1 " + (importTarget === "new" ? "bg-white shadow text-stone-800" : "text-stone-400 hover:text-stone-600")}>
                  <Icon name="plus" className="w-3.5 h-3.5" /> 新規案件として取り込む
                </button>
                <button onClick={() => setImportTarget("current")} disabled={!project}
                  className={"flex-1 px-3 py-2 rounded-lg transition disabled:opacity-40 inline-flex items-center justify-center gap-1 " + (importTarget === "current" ? "bg-white shadow text-stone-800" : "text-stone-400 hover:text-stone-600")}>
                  <Icon name="refresh" className="w-3.5 h-3.5" /> この案件を更新{project ? "（" + project.name + "）" : ""}
                </button>
              </div>
              <p className="text-[12px] text-stone-500 mb-2">
                <span className="font-bold inline-flex items-center gap-1" style={{ color: theme.accent }}><Icon name="sparkle" className="w-3.5 h-3.5" />なんでも放り込めばOK：</span>原稿・取材メモ・文字起こしを<span className="font-bold">そのまま</span>貼るか、ファイルを選ぶだけ。中身を自動判定して、生原稿ならAIが構成台本に整形、台本コピーTSVや <span style={{ fontFamily: mono }}>{"{ rows:[...] }"}</span> JSON ならそのまま取り込みます。<br />
                <span className="text-stone-400">ファイルは選んだ瞬間に自動で取り込み開始します。</span>
                {importTarget === "current" && <><br /><span className="font-bold text-amber-600 inline-flex items-center gap-1"><Icon name="warn" className="w-3.5 h-3.5" />更新モード：</span>取り込んだ内容で今の構成を上書きします（案件名・共有リンクは維持）。</>}
              </p>
              {/* ファイルから読み込む（TXT / CSV / Excel）*/}
              <input ref={importFileRef} type="file" accept=".txt,.csv,.tsv,.xlsx,.md,.json,text/plain,text/csv" onChange={onPickImportFile} className="hidden" />
              <div className="flex items-center gap-2 mb-2">
                <button onClick={() => importFileRef.current && importFileRef.current.click()}
                  className="text-[12px] font-bold px-3 py-2 rounded-lg border border-stone-200 hover:bg-stone-50 inline-flex items-center gap-1.5">
                  <Icon name="file" className="w-4 h-4" /> ファイルから読み込む
                </button>
                <span className="text-[11px] text-stone-400">TXT・CSV・Excel(.xlsx) 対応{importFileName ? "　／　" : ""}<span className="font-bold text-stone-500">{importFileName}</span></span>
              </div>
              <textarea
                value={fullImportText}
                onChange={(e) => setFullImportText(e.target.value)}
                placeholder={'{\n  "name": "永田晃聖さん｜オリックス不動産",\n  "channel": "オリックス不動産",\n  "meta": { "highlight": "…" },\n  "rows": [\n    { "kind": "location", "label": "出社", "time": "8:50" },\n    { "kind": "scene", "type": "訴求", "sec": 180, "label": "自己紹介", "script": "◼ …" }\n  ]\n}'}
                className="w-full h-72 text-[12px] leading-relaxed border border-stone-200 rounded-xl p-3 focus:outline-none focus:border-stone-400 resize-y"
                style={{ fontFamily: mono }}
              />
              <div className="mt-3 flex justify-end items-center gap-2">
                <button onClick={() => setShowFullImport(false)} className="text-xs font-bold px-4 py-2 rounded-lg border border-stone-200 hover:bg-stone-50 mr-auto">キャンセル</button>
                <button onClick={() => smartImport()} disabled={!fullImportText.trim() || aiParsing}
                  title="中身を自動判定して取り込む（生原稿はAI整形・JSON/台本コピーはそのまま）"
                  className="text-xs font-bold px-5 py-2 rounded-lg shadow disabled:opacity-40 inline-flex items-center gap-1"
                  style={{ background: theme.accent, color: accentText }}>
                  {aiParsing ? "取り込み中…" : <><Icon name="sparkle" className="w-3.5 h-3.5" />{importTarget === "current" ? "取り込んで更新" : "取り込む"}</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== マニュアル／決め事 モーダル（全体・チャンネル・案件）===== */}
      {showManual && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowManual(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 flex items-center justify-between shrink-0" style={{ background: theme.main, color: mainText }}>
              <h3 className="text-sm font-bold tracking-wider inline-flex items-center gap-1.5"><span>📖</span>マニュアル・決め事</h3>
              <button onClick={() => setShowManual(false)} className="w-7 h-7 rounded-lg grid place-items-center hover:bg-white/15"><Icon name="close" className="w-4 h-4" /></button>
            </div>
            <div className="px-5 pt-3 shrink-0 flex gap-1.5 flex-wrap">
              {[["case", "この案件", (project.manuals || []).length], ["channel", curChannel === DEFAULT_CHANNEL ? "チャンネル" : curChannel, (curChannelInfo.manuals || []).length], ["global", "全体の決め事", globalManuals.length]].map(([k, label, n]) => (
                <button key={k} onClick={() => setManualScope(k)}
                  className={"text-[12px] font-bold px-3 py-1.5 rounded-lg border " + (manualScope === k ? "text-white border-transparent" : "bg-white border-stone-200 text-stone-500")}
                  style={manualScope === k ? { background: theme.main } : {}}>{label}<span className="opacity-60 ml-1">{n}</span></button>
              ))}
            </div>
            <p className="px-5 pt-2 text-[11px] text-stone-400 shrink-0">{manualScope === "global" ? "全案件で共通のスタジオの決め事（テロップ・書き出し・命名規則など）。" : manualScope === "channel" ? "このクライアント（チャンネル）固有のルール。同じチャンネルの全案件で共有。" : "この案件だけの指示書・メモ。"}共有リンクを発行すると編集者・先方も閲覧できます。</p>
            <div className="p-5 overflow-y-auto">
              {manualScope === "global" && <LabChannelRules channel="編集マニュアル" main={theme.main} snapId={project.shareId} token={project.shareToken} upToken={project.shareUpToken} liveId={project.liveId} liveToken={project.liveToken}
                onAdopt={(t) => saveGlobalManuals([...globalManuals, { ...newManual("その他"), body: t }])} />}
              {manualScope === "global" && <ManualPanel entries={globalManuals} onChange={saveGlobalManuals} main={theme.main} accent={theme.accent} />}
              {manualScope === "channel" && curChannel !== DEFAULT_CHANNEL && <LabChannelRules channel={curChannel} main={theme.main}
                snapId={project.shareId} token={project.shareToken} upToken={project.shareUpToken}
                liveId={project.liveId} liveToken={project.liveToken}
                onAdopt={(t) => setChannelManuals([...(curChannelInfo.manuals || []), { ...newManual("その他"), body: t }])} />}
              {manualScope === "channel" && <ManualPanel entries={curChannelInfo.manuals || []} onChange={setChannelManuals} main={theme.main} accent={theme.accent} />}
              {manualScope === "case" && <ManualPanel entries={project.manuals || []} onChange={setCaseManuals} main={theme.main} accent={theme.accent} />}
            </div>
          </div>
        </div>
      )}

      {/* ===== AIアシスタント モーダル（生メッセージ→構成に反映）===== */}
      {showAssistant && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowAssistant(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 flex items-center justify-between" style={{ background: theme.main, color: mainText }}>
              <h3 className="text-sm font-bold tracking-wider inline-flex items-center gap-1.5"><Icon name="robot" className="w-4 h-4" />AIアシスタント — メッセージを構成に反映</h3>
              <button onClick={() => setShowAssistant(false)} className="w-7 h-7 rounded-lg grid place-items-center hover:bg-white/15"><Icon name="close" className="w-4 h-4" /></button>
            </div>
            <div className="p-5">
              <p className="text-[12px] text-stone-500 mb-2 leading-relaxed">
                先方・演者からの<span className="font-bold">LINEのメッセージ</span>や取材メモ、「冒頭もっと引き強く」みたいな<span className="font-bold">指示</span>を貼って送ると、AIが今開いている案件「<span className="font-bold">{project ? project.name : ""}</span>」の構成台本に反映します（住所・時間・メモ・シーン・原稿）。
              </p>
              <textarea
                value={assistantText}
                onChange={(e) => setAssistantText(e.target.value)}
                placeholder={"例）\n明日の撮影、10時に本社ビル集合でお願いします。駐車場は地下、受付で「撮影」と伝えてください。\n社長は釣りが趣味で、休日は必ず海に行くそうです。創業のきっかけは父の影響とのこと。"}
                className="w-full h-44 text-[13px] leading-relaxed border border-stone-200 rounded-xl p-3 focus:outline-none focus:border-stone-400 resize-y"
              />
              {assistantSummary && (
                <div className="mt-3 text-[12px] text-emerald-900 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 leading-relaxed whitespace-pre-wrap">
                  <span className="font-bold inline-flex items-center gap-1"><Icon name="checkCircle" className="w-3.5 h-3.5" />反映しました</span>{"\n" + assistantSummary}
                </div>
              )}
              <div className="mt-3 flex justify-end items-center gap-2">
                <button onClick={() => setShowAssistant(false)} className="text-xs font-bold px-4 py-2 rounded-lg border border-stone-200 hover:bg-stone-50 mr-auto">閉じる</button>
                <button onClick={runAssistant} disabled={!assistantText.trim() || assistantBusy || !project}
                  className="text-xs font-bold px-5 py-2 rounded-lg shadow disabled:opacity-40 inline-flex items-center gap-1"
                  style={{ background: theme.accent, color: accentText }}>
                  {assistantBusy ? "反映中…" : <><Icon name="sparkle" className="w-3.5 h-3.5" />構成に反映する</>}
                </button>
              </div>
              <p className="text-[10px] text-stone-400 mt-2">既存の内容は極力残して、関係する所だけ更新します。違ったら⌘Zや編集で直してね。</p>
            </div>
          </div>
        </div>
      )}

      {/* ===== AI校正チェック モーダル ===== */}
      {showReview && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowReview(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 flex items-center justify-between shrink-0" style={{ background: theme.main, color: mainText }}>
              <h3 className="text-sm font-bold tracking-wider inline-flex items-center gap-1.5"><Icon name="spellcheck" className="w-4 h-4" />AI校正チェック</h3>
              <button onClick={() => setShowReview(false)} className="w-7 h-7 rounded-lg grid place-items-center hover:bg-white/15"><Icon name="close" className="w-4 h-4" /></button>
            </div>
            <div className="p-5 overflow-y-auto">
              <p className="text-[12px] text-stone-500 mb-3 leading-relaxed">
                「<span className="font-bold">{project ? project.name : ""}</span>」の構成台本を、<span className="font-bold">誤字脱字</span>・<span className="font-bold">質問と回答の逆転</span>・<span className="font-bold">未記入の箇所</span>の3観点でチェックします。指摘をクリックすると該当シーンに移動します。
              </p>
              {reviewBusy ? (
                <div className="py-10 text-center text-[13px] text-stone-400">
                  <div className="inline-flex items-center gap-2"><Icon name="sparkle" className="w-4 h-4 animate-pulse" />チェック中…（10〜20秒ほど）</div>
                </div>
              ) : reviewResult ? (
                reviewResult.error ? (
                  <div className="text-[12px] text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">チェックに失敗しました：{reviewResult.error}</div>
                ) : reviewResult.issues.length === 0 ? (
                  <div className="text-[13px] text-emerald-900 bg-emerald-50 border border-emerald-100 rounded-lg px-4 py-3 inline-flex items-start gap-1.5">
                    <Icon name="checkCircle" className="w-4 h-4 shrink-0 mt-0.5" /><span>{reviewResult.summary || "大きな問題は見つかりませんでした。"}</span>
                  </div>
                ) : (
                  <div>
                    {reviewResult.summary && <p className="text-[12px] text-stone-600 mb-3">{reviewResult.summary}</p>}
                    <div className="text-[11px] text-stone-400 mb-2">{reviewResult.issues.length}件の指摘</div>
                    <ul className="space-y-2">
                      {reviewResult.issues.map((it, i) => {
                        const cat = it.category || "その他";
                        const col = cat === "誤字脱字" ? "#B45309" : cat === "質問と回答の逆転" ? "#9333EA" : cat === "未記入" ? "#0EA5E9" : "#6B7280";
                        return (
                          <li key={i}
                            onClick={() => jumpToRow(it.rowId)}
                            className={"border border-stone-200 rounded-xl px-3.5 py-2.5 " + (it.rowId ? "cursor-pointer hover:bg-stone-50" : "")}>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white" style={{ background: col }}>{cat}</span>
                              {it.sceneLabel && <span className="text-[11.5px] font-bold text-stone-700 truncate">{it.sceneLabel}</span>}
                              {it.rowId && <span className="text-[10px] text-stone-400 ml-auto shrink-0">クリックで移動 ↗</span>}
                            </div>
                            <div className="text-[12.5px] text-stone-700 leading-relaxed">{it.detail}</div>
                            {it.suggestion && <div className="text-[12px] text-emerald-800 mt-1 leading-relaxed">→ {it.suggestion}</div>}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )
              ) : (
                <div className="py-8 text-center text-[13px] text-stone-400">チェックを開始します…</div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-stone-100 flex justify-between items-center shrink-0">
              <button onClick={() => setShowReview(false)} className="text-xs font-bold px-4 py-2 rounded-lg border border-stone-200 hover:bg-stone-50">閉じる</button>
              <button onClick={runReview} disabled={reviewBusy || !project}
                className="text-xs font-bold px-5 py-2 rounded-lg shadow disabled:opacity-40 inline-flex items-center gap-1"
                style={{ background: theme.accent, color: accentText }}>
                <Icon name="refresh" className="w-3.5 h-3.5" />{reviewBusy ? "チェック中…" : "もう一度チェック"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== アカウント / ログイン モーダル ===== */}
      {showAccount && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowAccount(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 flex items-center justify-between" style={{ background: theme.main, color: mainText }}>
              <h3 className="text-sm font-bold tracking-wider inline-flex items-center gap-1.5"><Icon name="user" className="w-4 h-4" />アカウント</h3>
              <button onClick={() => setShowAccount(false)} className="w-7 h-7 rounded-lg grid place-items-center hover:bg-white/15"><Icon name="close" className="w-4 h-4" /></button>
            </div>
            <div className="p-5">
              {user ? (
                <div>
                  <div className="flex items-center gap-3">
                    {user.picture
                      ? <img src={user.picture} alt="" className="w-12 h-12 rounded-full" referrerPolicy="no-referrer" />
                      : <div className="w-12 h-12 rounded-full bg-stone-200 grid place-items-center text-stone-500"><Icon name="user" className="w-6 h-6" /></div>}
                    <div className="min-w-0">
                      <div className="text-sm font-bold truncate">{user.name}</div>
                      <div className="text-[12px] text-stone-500 truncate">{user.email}</div>
                    </div>
                  </div>
                  <div className="mt-3 text-[12px] text-emerald-800 bg-emerald-50 rounded-lg px-3 py-2 leading-relaxed flex items-start gap-1.5">
                    <Icon name="cloud" className="w-4 h-4 shrink-0 mt-0.5" /><span><span className="font-bold">クラウド同期中</span>。案件はこのアカウントに保存され、スマホ・PC どの端末でも同じ案件を開けます。</span>
                  </div>
                  <div className="mt-4 flex justify-end">
                    <button onClick={logout} disabled={authBusy} className="text-xs font-bold px-4 py-2 rounded-lg border border-stone-200 hover:bg-stone-50 disabled:opacity-40">ログアウト</button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="text-[12px] text-stone-600 mb-3 leading-relaxed space-y-2">
                    <div className="flex items-start gap-2"><Icon name="cloud" className="w-4 h-4 shrink-0 mt-0.5 text-stone-400" /><span><span className="font-bold">Googleアカウントで入る</span>と、自分の案件が<span className="font-bold">クラウドに保存</span>され、スマホでもPCでも同じ案件を開けます。</span></div>
                    <div className="flex items-start gap-2"><Icon name="user" className="w-4 h-4 shrink-0 mt-0.5 text-stone-400" /><span>案件は<span className="font-bold">自分だけのもの</span>。他の人には見えません。一緒に作りたい案件だけ、相手を招待して共有できます。</span></div>
                    <p className="text-stone-400 pl-6">ログインしなくても、この端末の中では今まで通り使えます。</p>
                  </div>
                  {GOOGLE_CLIENT_ID ? (
                    <div className="flex flex-col items-center py-2 min-h-[44px] gap-1.5">
                      <div ref={gbtnRef} />
                      <span className="text-[10px] text-stone-400">ボタンを押すだけ・1クリックで入れます</span>
                    </div>
                  ) : (
                    <div className="text-[12px] text-stone-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5 leading-relaxed">
                      <span className="inline-flex items-center gap-1 font-bold text-amber-800"><Icon name="warn" className="w-3.5 h-3.5" />ログインは準備中です</span><br />
                      もう少しで使えるようになります。今は端末内で保存されているので、このまま編集を続けてOKです。
                    </div>
                  )}
                  {authBusy && <div className="text-center text-[12px] text-stone-400 mt-2">ログイン中…</div>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== ホーム画面（入口・チャンネル一覧。中身はここから開かないと出ない） ===== */}
      {view === "home" && (
        <div className="fixed inset-0 z-[45] overflow-y-auto" style={{ background: "#E9E8E3" }}>
          <header className="sticky top-0 z-10 shadow-sm" style={{ background: theme.main, color: mainText }}>
            <div className="max-w-[1200px] mx-auto px-5 py-3 flex items-center gap-2">
              <img src="logo-header.png" alt="" className="w-8 h-8 rounded-lg" />
              <span className="font-black tracking-[0.08em] text-[15px]">ものがたりっち！</span>
              <div className="flex-1" />
              <button onClick={() => setShowAccount(true)} title={user ? user.name : "ログイン"}
                className="h-8 px-3 rounded-lg inline-flex items-center gap-1.5 text-[11px] font-bold border border-white/20 hover:bg-white/10">
                {user && user.picture ? <img src={user.picture} alt="" className="w-5 h-5 rounded-full" referrerPolicy="no-referrer" /> : <Icon name="user" className="w-4 h-4" />}
                <span className="max-w-[120px] truncate">{user ? user.name : "ログイン"}</span>
              </button>
            </div>
          </header>
          <main className="max-w-[1200px] mx-auto px-5 py-7">
            {/* 全案件 横断検索＋新規（1行に統合） */}
            <div className="flex items-center gap-2 mb-6">
            <div className="relative flex-1 min-w-0">
              <div className="relative z-30 flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 shadow-sm">
                <Icon name="search" className="w-4 h-4 text-stone-400 shrink-0" />
                <input value={caseSearch}
                  onFocus={primeSearch}
                  onChange={(e) => { setCaseSearch(e.target.value); searchNow(e.target.value); }}
                  onKeyDown={(e) => { if (e.key === "Escape") { setCaseSearch(""); setSearchHits(null); } }}
                  placeholder="全案件を横断検索（案件名・タイトル・ロケ名・原稿）"
                  className="flex-1 min-w-0 text-[13px] bg-transparent focus:outline-none" />
                {caseSearch && <button onClick={() => { setCaseSearch(""); setSearchHits(null); }} title="クリア" className="shrink-0 w-6 h-6 grid place-items-center rounded text-stone-400 hover:bg-stone-100"><Icon name="close" className="w-3.5 h-3.5" /></button>}
              </div>
              {searchHits != null && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setSearchHits(null)} />
                  <div className="absolute z-30 left-0 right-0 mt-1 rounded-xl border border-stone-200 bg-white shadow-xl max-h-[60vh] overflow-y-auto">
                    {searchHits.length === 0 ? (
                      <div className="px-4 py-3 text-[12px] text-stone-400">「{caseSearch}」にヒットなし</div>
                    ) : searchHits.map((h, i) => (
                      <button key={h.caseId + ":" + i} onClick={() => jumpToCaseRow(h.caseId, h.rowId)}
                        className="w-full text-left px-3 py-2 border-b border-stone-100 last:border-0 hover:bg-stone-50 flex flex-col gap-0.5">
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[10px] text-stone-400 shrink-0">{(channelIconOf(h.channel) || "📁") + h.channel}</span>
                          <span className="text-[13px] font-bold text-stone-700 truncate">{h.caseName || "（無題）"}</span>
                          {h.caseId === activeId && <span className="text-[9px] text-stone-400 shrink-0">表示中</span>}
                        </span>
                        {h.snippet && <span className="text-[11px] text-stone-500 truncate">{h.snippet}</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <button onClick={(e) => setAddMenu({ channel: DEFAULT_CHANNEL, x: e.clientX, y: e.clientY })}
              className="shrink-0 h-9 px-3.5 rounded-xl inline-flex items-center gap-1.5 text-[12px] font-bold text-white shadow-sm" style={{ background: theme.accent }}>
              <Icon name="plus" className="w-3.5 h-3.5" /> 新規案件
            </button>
            <button onClick={() => { const ch = window.prompt("新しいチャンネル（クライアント）名"); if (ch && ch.trim()) createChannel(ch.trim()); }}
              title="チャンネルを追加" className="shrink-0 h-9 px-3 rounded-xl inline-flex items-center gap-1 text-[12px] font-bold border border-stone-300 bg-white text-stone-500 hover:bg-stone-50">
              <Icon name="folder" className="w-3.5 h-3.5" />＋
            </button>
            </div>
            {!user && (
              <div className="mb-5 text-[12px] text-stone-600 bg-white border border-stone-200 rounded-xl px-4 py-3 flex items-start gap-2">
                <Icon name="cloud" className="w-4 h-4 shrink-0 mt-0.5 text-stone-400" />
                <span><span className="font-bold">ログインすると</span>案件がクラウドに保存され、どの端末でも開けます。<button onClick={() => setShowAccount(true)} className="font-bold underline" style={{ color: theme.main }}>ログイン</button></span>
              </div>
            )}

            {/* ===== 進行ボード（Flip Board D1の窓）：誰がどの案件のどの工程か・次の締切を一望。読み取り専用 ===== */}
            {board && board.length > 0 && (() => {
              const BALL = { editor: "編集", ak: "AK", client: "先方", talent: "演者" };
              const rows = boardAll ? board : board.filter((r) => (r.client || "") === (curChannel || "") || (r.title || "").includes(curChannel || "＿＿"));
              const shown = (boardAll || rows.length) ? rows : board; // チャンネル絞りで0件なら全件にフォールバック
              const overdue = board.filter((r) => r.next && r.next.days != null && r.next.days < 0).length;
              return (
                <div className="mb-7">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="text-[12px] font-bold flex items-center gap-2 text-stone-600">🗂 進行ボード<span className="text-stone-300 font-normal">{shown.length}</span>
                      {overdue > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-600">超過 {overdue}</span>}
                    </div>
                    <button onClick={() => setBoardAll((v) => !v)} className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-stone-300 bg-white text-stone-500 hover:bg-stone-50">
                      {boardAll ? "全部" : "このチャンネル"}
                    </button>
                    <span className="ml-auto text-[10px] text-stone-400">Flip Board連動・読み取り</span>
                  </div>
                  <div className="rounded-2xl border border-stone-200 bg-white divide-y divide-stone-100">
                    {(() => {
                      const rr = (r, dim) => {
                        const dl = r.next && r.next.days != null ? r.next.days : null;
                        const dc = dl == null ? "text-stone-300" : dl < 0 ? "text-rose-600" : dl <= 3 ? "text-amber-600" : "text-stone-400";
                        const dt = dl == null ? "—" : dl < 0 ? "-" + (-dl) + "d" : dl === 0 ? "今日" : "+" + dl + "d";
                        const row = (
                          <div className={"flex items-center gap-3 px-3.5 py-2 text-[12px]" + (dim ? " opacity-55" : "")}>
                            <span className={"shrink-0 w-[46px] text-right font-mono tabular-nums font-bold text-[11px] " + dc}>{dt}</span>
                            <span className="min-w-0 flex-1 truncate font-semibold text-stone-800">{r.title}</span>
                            <span className="shrink-0 text-[10px] text-stone-400">{(r.phase || "—") + (r.editor ? "・" + r.editor : "")}</span>
                          </div>
                        );
                        return r.mgId
                          ? <a key={r.caseId} href={shareUrl(r.mgId)} target="_blank" rel="noreferrer" className="block hover:bg-stone-50">{row}</a>
                          : <div key={r.caseId}>{row}</div>;
                      };
                      const act = shown.filter((r) => r.status !== "delivered");
                      const done = shown.filter((r) => r.status === "delivered");
                      return (<>
                        {act.map((r) => rr(r, false))}
                        {done.length > 0 && (
                          <button onClick={() => setBoardDone((v) => !v)} className="w-full text-left px-3.5 py-2 text-[11px] font-bold text-stone-400 hover:bg-stone-50">
                            {boardDone ? "▲ 納品済を隠す" : "▼ 納品済 " + done.length + "件"}
                          </button>
                        )}
                        {boardDone && done.map((r) => rr(r, true))}
                      </>);
                    })()}
                  </div>
                </div>
              );
            })()}

            {/* ===== 最近触った（クイックアクセス）。タスク管理(今日やること/確認待ち/期限)はFlip Boardに集約 ===== */}
            {(() => {
              const { recent } = homeSections;
              if (!index.length || !recent.length) return null;
              return (
                <div className="mb-7">
                  <div className="mb-5">
                    <div className="text-[12px] font-bold mb-2 flex items-center gap-2 text-stone-600">🕒 最近触った<span className="text-stone-300 font-normal">{recent.length}</span></div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">{recent.map(renderCaseCard)}</div>
                  </div>
                </div>
              );
            })()}

            <div className="text-[11px] font-bold tracking-[0.15em] text-stone-400 mb-2">チャンネル（{channelGroups.length}）</div>
            <div className="space-y-2.5">
              {channelGroups.map(({ channel, items }) => {
                const ci = channelInfo[channel] || {};
                return (
                  <div key={channel} className="bg-white border border-stone-200 rounded-xl px-4 py-2.5 shadow-sm"
                    onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ channel, x: e.clientX, y: e.clientY }); }}>
                    <div className="flex items-start gap-2">
                      <button onClick={() => openChannel(channel)} title="このチャンネルの企画一覧を開く" className="flex items-start gap-2 min-w-0 flex-1 text-left group/cn">
                        {channelIconOf(channel)
                          ? <span className="w-4 h-4 shrink-0 mt-0.5 grid place-items-center text-[14px] leading-none">{channelIconOf(channel)}</span>
                          : <svg className="w-4 h-4 shrink-0 mt-0.5 text-stone-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[14px] font-bold text-stone-800 truncate group-hover/cn:underline">{channel}</span>
                            <span className="text-[10px] text-stone-400 shrink-0">{items.length}案件</span>
                            {ci.shareId && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600 shrink-0">共有中</span>}
                            <span className="text-[11px] shrink-0 opacity-0 group-hover/cn:opacity-100 transition-opacity" style={{ color: theme.main }}>開く →</span>
                          </div>
                        </div>
                      </button>
                      <div className="flex gap-1 shrink-0">
                        <button onClick={(e) => setAddMenu({ channel, x: e.clientX, y: e.clientY })} title="この中に案件を追加" className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg border border-stone-200 hover:bg-stone-50 inline-flex items-center gap-1"><Icon name="plus" className="w-3 h-3" />案件</button>
                        {channel !== DEFAULT_CHANNEL && (
                          <button onClick={(e) => setChShareMenu({ channel, x: e.clientX, y: e.clientY })} disabled={chSharing} title="共有リンクを発行（見せる用／編集つきを選べます）" className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg border border-stone-200 hover:bg-stone-50 disabled:opacity-50">共有</button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {channelGroups.length === 0 && <p className="text-[12px] text-stone-400 text-center py-8">まだ案件がありません。上のボタンから作成してください。</p>}
            </div>
            <p className="text-[10px] text-stone-400 mt-6 text-center">案件をクリックすると編集画面が開きます。左上ロゴでいつでもここに戻れます。</p>
          </main>
        </div>
      )}

      {/* ===== 案件追加 タイプ選択メニュー ===== */}
      {addMenu && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setAddMenu(null)} />
          <div className="fixed z-[61] w-48 bg-white rounded-xl shadow-2xl border border-stone-200 overflow-hidden text-stone-700 py-1"
            style={{ left: Math.min(addMenu.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 200), top: addMenu.y }}>
            <div className="px-3 py-1.5 text-[10px] font-bold text-stone-400 truncate">{addMenu.channel} に追加</div>
            <button onClick={() => { const ch = addMenu.channel; setAddMenu(null); createProject(true, ch, "documentary"); }} className="w-full text-left px-3 py-2 hover:bg-stone-50 text-[12px] font-bold flex items-center gap-2"><span>🎬</span>一日密着</button>
            <button onClick={() => { const ch = addMenu.channel; setAddMenu(null); createProject(true, ch, "talk"); }} className="w-full text-left px-3 py-2 hover:bg-stone-50 text-[12px] font-bold flex items-center gap-2"><span>🎙️</span>トーク系</button>
          </div>
        </>
      )}

      {chShareMenu && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setChShareMenu(null)} />
          <div className="fixed z-[61] w-60 bg-white rounded-xl shadow-2xl border border-stone-200 overflow-hidden text-stone-700 py-1"
            style={{ left: Math.min(chShareMenu.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 250), top: chShareMenu.y }}>
            <div className="px-3 py-1.5 text-[10px] font-bold text-stone-400 truncate">{chShareMenu.channel} を共有</div>
            <button onClick={() => { const ch = chShareMenu.channel; setChShareMenu(null); publishChannel(ch, false); }} className="w-full text-left px-3 py-2 hover:bg-stone-50 flex items-start gap-2">
              <svg className="mt-0.5 shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></svg>
              <span><span className="text-[12px] font-bold block">見せる用に共有</span><span className="text-[10px] text-stone-400">読み取り専用。説明・確認用</span></span>
            </button>
            <button onClick={() => { const ch = chShareMenu.channel; setChShareMenu(null); publishChannel(ch, true); }} className="w-full text-left px-3 py-2 hover:bg-stone-50 flex items-start gap-2">
              <svg className="mt-0.5 shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={theme.accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
              <span><span className="text-[12px] font-bold block" style={{ color: theme.accent }}>編集つきで共有</span><span className="text-[10px] text-stone-400">先方がその場で全部編集できる</span></span>
            </button>
          </div>
        </>
      )}

      {/* ===== サイドバー チャンネル右クリックメニュー ===== */}
      {ctxMenu && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setCtxMenu(null)} onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }} />
          <div className="fixed z-[61] w-52 bg-white rounded-xl shadow-2xl border border-stone-200 overflow-hidden text-stone-700 py-1"
            style={{ left: Math.min(ctxMenu.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 220), top: ctxMenu.y }}>
            <div className="px-3 py-1.5 text-[10px] font-bold text-stone-400 truncate">{ctxMenu.channel}</div>
            {ctxMenu.channel !== DEFAULT_CHANNEL && (
              <>
                <button onClick={() => { const ch = ctxMenu.channel; setCtxMenu(null); publishChannel(ch, false); }} className="w-full text-left px-3 py-2 hover:bg-stone-50 text-[12px] font-bold flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></svg>
                  見せる用に共有（読取専用）
                </button>
                <button onClick={() => { const ch = ctxMenu.channel; setCtxMenu(null); publishChannel(ch, true); }} className="w-full text-left px-3 py-2 hover:bg-stone-50 text-[12px] font-bold flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                  編集つきで共有
                </button>
              </>
            )}
            <button onClick={() => { const ch = ctxMenu.channel; setCtxMenu(null); createProject(true, ch); }} className="w-full text-left px-3 py-2 hover:bg-stone-50 text-[12px] flex items-center gap-2"><Icon name="plus" className="w-3.5 h-3.5 text-stone-400" />この中に案件を追加</button>
            <button onClick={() => { const ch = ctxMenu.channel; setCtxMenu(null); renameChannel(ch); }} className="w-full text-left px-3 py-2 hover:bg-stone-50 text-[12px] flex items-center gap-2">✎ フォルダ名を変更</button>
            <button onClick={(e) => { const ch = ctxMenu.channel; const x = ctxMenu.x, y = ctxMenu.y; setCtxMenu(null); setIconPick({ channel: ch, x, y }); }} className="w-full text-left px-3 py-2 hover:bg-stone-50 text-[12px] flex items-center gap-2"><span>{channelIconOf(ctxMenu.channel) || "📁"}</span>アイコンを変更</button>
            {ctxMenu.channel !== DEFAULT_CHANNEL && (
              <div className="flex border-t border-stone-100 mt-1">
                <button onClick={() => { moveChannel(ctxMenu.channel, -1); setCtxMenu(null); }} className="flex-1 px-3 py-2 hover:bg-stone-50 text-[12px] inline-flex items-center justify-center gap-1"><Icon name="up" className="w-3.5 h-3.5" />上へ</button>
                <button onClick={() => { moveChannel(ctxMenu.channel, 1); setCtxMenu(null); }} className="flex-1 px-3 py-2 hover:bg-stone-50 text-[12px] inline-flex items-center justify-center gap-1 border-l border-stone-100"><Icon name="down" className="w-3.5 h-3.5" />下へ</button>
              </div>
            )}
            <button onClick={() => deleteChannel(ctxMenu.channel)} className="w-full text-left px-3 py-2 mt-1 border-t border-stone-100 hover:bg-red-50 text-[12px] font-bold text-red-500 flex items-center gap-2">
              <Icon name="trash" className="w-3.5 h-3.5" />フォルダごと削除
            </button>
          </div>
        </>
      )}

      {/* ===== 案件のチャンネル移動 ドロップダウン ===== */}
      {chanMenu && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setChanMenu(null)} onContextMenu={(e) => { e.preventDefault(); setChanMenu(null); }} />
          <div className="fixed z-[61] w-56 bg-white rounded-xl shadow-2xl border border-stone-200 overflow-hidden text-stone-700 py-1"
            style={{ left: Math.min(chanMenu.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 236), top: chanMenu.y }}>
            <div className="px-3 py-1.5 text-[10px] font-bold text-stone-400">移動先のチャンネルを選ぶ</div>
            <div className="max-h-72 overflow-y-auto">
              {channelOptions.map((c) => {
                const isCur = c === chanMenu.channel;
                return (
                  <button key={c} disabled={isCur}
                    onClick={() => { const id = chanMenu.id; setChanMenu(null); if (!isCur) setProjectChannel(id, c); }}
                    className={"w-full text-left px-3 py-2 text-[12px] flex items-center gap-2 " + (isCur ? "bg-stone-50 text-stone-400 cursor-default" : "hover:bg-stone-50")}>
                    <span className="w-4 shrink-0 text-center leading-none">{channelIconOf(c) || "📁"}</span>
                    <span className="truncate flex-1">{c}</span>
                    {isCur && <span className="text-[10px] text-stone-400 shrink-0">現在</span>}
                  </button>
                );
              })}
            </div>
            <button onClick={() => { const id = chanMenu.id; setChanMenu(null); setRenamingId(null); setChannelEditId(id); }}
              className="w-full text-left px-3 py-2 mt-1 border-t border-stone-100 hover:bg-stone-50 text-[12px] font-bold flex items-center gap-2">
              <Icon name="plus" className="w-3.5 h-3.5 text-stone-400" />新規フォルダに移動…
            </button>
          </div>
        </>
      )}

      {/* ===== 案件行 右クリックメニュー ===== */}
      {caseMenu && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setCaseMenu(null)} onContextMenu={(e) => { e.preventDefault(); setCaseMenu(null); }} />
          <div className="fixed z-[61] w-48 bg-white rounded-xl shadow-2xl border border-stone-200 overflow-hidden text-stone-700 py-1"
            style={{ left: Math.min(caseMenu.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 200), top: Math.min(caseMenu.y, (typeof window !== "undefined" ? window.innerHeight : 9999) - 220) }}>
            <button onClick={() => { const id = caseMenu.id; setCaseMenu(null); setChannelEditId(null); setRenamingId(id); }} className="w-full text-left px-3 py-2 hover:bg-stone-50 text-[12px] flex items-center gap-2"><span className="w-4 text-center">✎</span>名前変更</button>
            <button onClick={() => { const c = caseMenu; setCaseMenu(null); setChanMenu({ id: c.id, channel: c.channel, x: c.x, y: c.y }); }} className="w-full text-left px-3 py-2 hover:bg-stone-50 text-[12px] flex items-center gap-2"><span className="w-4 text-center">📁</span>チャンネル移動</button>
            <button onClick={() => { const id = caseMenu.id; setCaseMenu(null); duplicateProject(id); }} className="w-full text-left px-3 py-2 hover:bg-stone-50 text-[12px] flex items-center gap-2"><span className="w-4 text-center">⎘</span>複製</button>
            <button onClick={() => { const id = caseMenu.id; setCaseMenu(null); deleteProject(id); }} className="w-full text-left px-3 py-2 hover:bg-red-50 text-red-500 text-[12px] flex items-center gap-2 border-t border-stone-100"><Icon name="trash" className="w-3.5 h-3.5" />削除</button>
          </div>
        </>
      )}

      {/* ===== 構成テーブル 行の右クリックメニュー（上へ/下へ/追加/削除） ===== */}
      {rowMenu && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setRowMenu(null)} onContextMenu={(e) => { e.preventDefault(); setRowMenu(null); }} />
          <div className="fixed z-[61] w-48 bg-white rounded-xl shadow-2xl border border-stone-200 overflow-hidden text-stone-700 py-1"
            style={{ left: Math.min(rowMenu.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 200), top: Math.min(rowMenu.y, (typeof window !== "undefined" ? window.innerHeight : 9999) - 200) }}>
            <div className="flex border-b border-stone-100">
              <button onClick={() => { moveRow(rowMenu.idx, -1); setRowMenu(null); }} className="flex-1 px-3 py-2 hover:bg-stone-50 text-[12px] inline-flex items-center justify-center gap-1"><Icon name="up" className="w-3.5 h-3.5" />上へ</button>
              <button onClick={() => { moveRow(rowMenu.idx, 1); setRowMenu(null); }} className="flex-1 px-3 py-2 hover:bg-stone-50 text-[12px] inline-flex items-center justify-center gap-1 border-l border-stone-100"><Icon name="down" className="w-3.5 h-3.5" />下へ</button>
            </div>
            <button onClick={() => { const idx = rowMenu.idx, kind = rowMenu.kind, sceneType = rowMenu.sceneType; setRowMenu(null); insertBelow(idx, newScene(kind === "location" ? "解説系" : sceneType)); }} className="w-full text-left px-3 py-2 hover:bg-stone-50 text-[12px] flex items-center gap-2"><Icon name="plus" className="w-3.5 h-3.5 text-stone-400" />{rowMenu.kind === "location" ? "下にシーンを追加" : "下に行を追加"}</button>
            <button onClick={() => { const id = rowMenu.id; setRowMenu(null); deleteRow(id); }} className="w-full text-left px-3 py-2 mt-1 border-t border-stone-100 hover:bg-red-50 text-[12px] font-bold text-red-500 flex items-center gap-2"><Icon name="trash" className="w-3.5 h-3.5" />削除</button>
          </div>
        </>
      )}

      {/* ===== チャンネルアイコン 選択ポップオーバー ===== */}
      {iconPick && (
        <>
          <div className="fixed inset-0 z-[62]" onClick={() => setIconPick(null)} onContextMenu={(e) => { e.preventDefault(); setIconPick(null); }} />
          <div className="fixed z-[63] w-[244px] bg-white rounded-xl shadow-2xl border border-stone-200 p-2.5 text-stone-700"
            style={{ left: Math.min(iconPick.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 256), top: Math.min(iconPick.y, (typeof window !== "undefined" ? window.innerHeight : 9999) - 230) }}>
            <div className="px-1 pb-1.5 text-[10px] font-bold text-stone-400 truncate flex items-center justify-between">
              <span className="truncate">{iconPick.channel} のアイコン</span>
              {channelIconOf(iconPick.channel) && <button onClick={() => setChannelIcon(iconPick.channel, "")} className="shrink-0 text-stone-400 hover:text-stone-600 underline">なし</button>}
            </div>
            <div className="grid grid-cols-6 gap-0.5">
              {CHANNEL_ICONS.map((em) => (
                <button key={em} onClick={() => setChannelIcon(iconPick.channel, em === "📁" ? "" : em)}
                  className={"w-9 h-9 grid place-items-center rounded-lg text-[18px] hover:bg-stone-100 " + (channelIconOf(iconPick.channel) === em ? "bg-stone-100 ring-1 ring-stone-300" : "")}>{em}</button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ===== 共同編集 招待モーダル ===== */}
      {showInvite && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowInvite(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 flex items-center justify-between" style={{ background: theme.main, color: mainText }}>
              <h3 className="text-sm font-bold tracking-wider inline-flex items-center gap-1.5"><Icon name="user" className="w-4 h-4" />共同編集に招待</h3>
              <button onClick={() => setShowInvite(false)} className="w-7 h-7 rounded-lg grid place-items-center hover:bg-white/15"><Icon name="close" className="w-4 h-4" /></button>
            </div>
            <div className="p-5">
              {!user ? (
                <div className="text-center py-4">
                  <p className="text-[13px] text-stone-600 mb-3">共同編集にはログインが必要です。</p>
                  <button onClick={() => { setShowInvite(false); setShowAccount(true); }} className="text-xs font-bold px-5 py-2.5 rounded-lg shadow" style={{ background: theme.accent, color: accentText }}>ログインする</button>
                </div>
              ) : (() => {
                const isOwner = !project.collab || project.collabRole === "owner";
                const ownerEmail = (project.ownerEmail || user.email || "").toLowerCase();
                const members = (project.members || []).filter((m) => m !== ownerEmail);
                return (
                  <div>
                    <p className="text-[12px] text-stone-600 leading-relaxed mb-3">
                      「<span className="font-bold">{project.name}</span>」を、招待した人の<span className="font-bold">Googleアカウント</span>で<span className="font-bold">一緒に編集</span>できるようにします。招待された人はログインすると自分の案件一覧にこの案件が出ます。
                    </p>
                    {isOwner ? (
                      <div className="flex gap-2 mb-3">
                        <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} type="email"
                          onKeyDown={(e) => { if (e.key === "Enter") inviteMember(); }}
                          placeholder="招待する人のGmailアドレス"
                          className="flex-1 min-w-0 text-[13px] border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-400" />
                        <button onClick={inviteMember} disabled={inviteBusy || !inviteEmail.trim()}
                          className="text-xs font-bold px-4 py-2 rounded-lg shadow disabled:opacity-40 shrink-0" style={{ background: theme.accent, color: accentText }}>
                          {inviteBusy ? "…" : "招待"}
                        </button>
                      </div>
                    ) : (
                      <div className="text-[12px] text-stone-500 bg-stone-50 rounded-lg px-3 py-2 mb-3">この案件のオーナーは <span className="font-bold">{ownerEmail}</span> です。あなたは編集メンバーとして参加しています。</div>
                    )}
                    <div className="text-[11px] font-bold text-stone-400 mb-1.5">メンバー</div>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-[12.5px] px-2 py-1.5 rounded-lg bg-stone-50">
                        <span className="w-5 h-5 rounded-full grid place-items-center text-[10px] font-bold text-white shrink-0" style={{ background: theme.main }}>{(ownerEmail[0] || "?").toUpperCase()}</span>
                        <span className="truncate">{ownerEmail}</span>
                        <span className="ml-auto text-[10px] font-bold text-stone-400 shrink-0">オーナー</span>
                      </div>
                      {members.map((m) => (
                        <div key={m} className="flex items-center gap-2 text-[12.5px] px-2 py-1.5 rounded-lg border border-stone-100">
                          <span className="w-5 h-5 rounded-full grid place-items-center text-[10px] font-bold text-white shrink-0 bg-stone-400">{(m[0] || "?").toUpperCase()}</span>
                          <span className="truncate">{m}</span>
                          {isOwner && <button onClick={() => uninviteMember(m)} className="ml-auto text-[10px] font-bold text-stone-300 hover:text-red-500 shrink-0">外す</button>}
                        </div>
                      ))}
                      {members.length === 0 && <p className="text-[11px] text-stone-400 px-2">まだ他のメンバーはいません。</p>}
                    </div>
                    <p className="text-[10px] text-stone-400 mt-3 leading-relaxed">同時編集は最後の保存が優先されます。大きな変更は声を掛け合ってね。</p>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ===== 共有リンク発行モーダル ===== */}
      {shareModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShareModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 flex items-center justify-between" style={{ background: theme.main, color: mainText }}>
              <h3 className="text-sm font-bold tracking-wider">{shareModal.handoff ? ((shareModal.handoff.emoji || "📨") + " " + shareModal.handoff.label + "：リンク＋文面をコピーしました") : ((shareModal.ai ? "AIに読ませる用リンクを" : shareModal.live ? "編集用リンクを" : shareModal.planShare ? "企画の試写リンクを" : shareModal.channel ? "チャンネル共有リンクを" : "共有リンクを") + (shareModal.updated ? "更新しました" : "発行しました"))}</h3>
              <button onClick={() => setShareModal(null)} className="w-7 h-7 rounded-lg grid place-items-center hover:bg-white/15"><Icon name="close" className="w-4 h-4" /></button>
            </div>
            <div className="p-5">
              <p className="text-[12px] text-stone-500 mb-2">
                {shareModal.handoff
                  ? <>下の<span className="font-bold">文面（リンク入り）はもうコピー済み</span>。DiscordやLINEにそのまま貼るだけ。相手には<span className="font-bold">{(shareModal.handoff.tabs || []).map((t) => TAB_LABEL[t]).filter(Boolean).join("・")}</span>だけが見えます（その中で切替OK・読み取り専用）。内容を直したら押し直せば同じURLに反映。</>
                  : shareModal.ai
                  ? <>このURLを<span className="font-bold">Claude や ChatGPT に貼り付け</span>てください。構成台本の中身（JSON）をそのまま読み込めます。編集者向けの構成づくりや校正・変更点まとめを頼めます。<span className="text-stone-400">※ share.html ではなく中身データのリンク。内容を直したら押し直せば最新に。</span></>
                  : shareModal.live
                  ? <>このURLを渡すと、先方が<span className="font-bold">構成台本をその場で編集</span>できます（リアルタイム同時編集・ログイン不要）。あなたもこのリンクを開けば一緒に編集できます。<span className="font-bold text-rose-500">編集できる人全員に渡るので取り扱い注意。</span></>
                  : shareModal.planShare
                  ? <>このURLは<span className="font-bold">この企画の動画・素材・コメントだけ</span>の専用ページです。先方は動画を見て（0.5〜4倍速）、時間を指定してコメントできます。コメントは右上💬とアプリ内の企画カードに届きます。</>
                  : shareModal.channel && shareModal.editable
                  ? <>このURLで<span className="font-bold">チャンネルの全{shareModal.caseCount || 0}案件を先方がその場で編集</span>できます（企画・サムネ・構成台本すべて／ログイン不要／リアルタイム反映）。各案件を開いて「編集」から直せます。<span className="font-bold text-rose-500">編集できる人全員に渡るので取り扱い注意。</span>他のチャンネルは見えません。</>
                  : shareModal.channel
                  ? <>このURLで<span className="font-bold">チャンネルのコンセプト＋配下の{shareModal.caseCount || 0}案件</span>をまとめて見せられます（読み取り専用）。チーム共有やクライアント説明用に。</>
                  : shareModal.tab === "review"
                  ? <>このURLを先方に送ってください。<span className="font-bold">動画確認ページ（読み取り専用）</span>が開き、再生しながら時間を指定して修正コメントを書き込めます。コメントは右上💬と動画確認タブに届きます。</>
                  : shareModal.tab
                  ? <>このURLを先方に送ってください。<span className="font-bold">「{TAB_LABEL[shareModal.tab] || shareModal.tab}」だけ（読み取り専用）</span>が開きます。他のタブは表示されません。</>
                  : <>このURLを先方に送ってください。<span className="font-bold">案件まるごと（読み取り専用）</span>が開きます。各ページにコメント・修正依頼を書き込めます。</>}
              </p>
              <div className="flex items-center gap-2 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2">
                <input readOnly value={shareModal.url} className="flex-1 min-w-0 bg-transparent text-[12px] focus:outline-none" style={{ fontFamily: mono }}
                  onFocus={(e) => e.target.select()} />
                <button onClick={async () => { try { await navigator.clipboard.writeText(shareModal.url); showToast("URLをコピーしました"); } catch (e) {} }}
                  className="text-[11px] font-bold px-3 py-1.5 rounded-md shadow shrink-0" style={{ background: theme.accent, color: accentText }}>コピー</button>
              </div>
              {shareModal.handoff && shareModal.text && (
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold tracking-wider text-stone-400">送る文面（コピー済み）</span>
                    <button onClick={async () => { try { await navigator.clipboard.writeText(shareModal.text); showToast("文面をコピーしました"); } catch (e) {} }}
                      className="text-[10px] font-bold px-2 py-1 rounded-md border border-stone-200 hover:bg-stone-50">文面を再コピー</button>
                  </div>
                  <textarea readOnly value={shareModal.text} rows={4} onFocus={(e) => e.target.select()}
                    className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-[12px] text-stone-700 resize-none focus:outline-none" />
                </div>
              )}
              <div className="mt-3 flex justify-between items-center">
                <a href={shareModal.url} target="_blank" rel="noreferrer" className="text-[11px] font-bold underline" style={{ color: theme.main }}>プレビューを開く ↗</a>
                <span className="text-[10px] text-stone-400">内容を直したら「共有を更新」で同じURLに反映されます</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== 受け渡し（ラリー）プリセットのカスタマイズ ===== */}
      {showHandoffEdit && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowHandoffEdit(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 flex items-center justify-between sticky top-0 z-10" style={{ background: theme.main, color: mainText }}>
              <h3 className="text-sm font-bold tracking-wider">受け渡しのカスタマイズ</h3>
              <button onClick={() => setShowHandoffEdit(false)} className="w-7 h-7 rounded-lg grid place-items-center hover:bg-white/15"><Icon name="close" className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-[11px] text-stone-500 leading-relaxed">相手ごとに「見せるタブ・最初に開くタブ・送る文面」を決められます。文面の <code className="bg-stone-100 px-1 rounded">{"{url}"}</code> はリンクに、<code className="bg-stone-100 px-1 rounded">{"{name}"}</code> は案件名に置き換わります。</p>
              {handoffs.map((h, idx) => (
                <div key={h.id} className="border border-stone-200 rounded-xl p-3 space-y-2.5">
                  <div className="flex items-center gap-2">
                    <input value={h.emoji || ""} onChange={(e) => saveHandoffs(handoffs.map((x, i) => i === idx ? { ...x, emoji: e.target.value.slice(0, 2) } : x))}
                      className="w-10 text-center text-[15px] border border-stone-200 rounded-lg py-1.5" placeholder="📨" />
                    <input value={h.label} onChange={(e) => saveHandoffs(handoffs.map((x, i) => i === idx ? { ...x, label: e.target.value } : x))}
                      className="flex-1 text-[13px] font-bold border border-stone-200 rounded-lg px-3 py-1.5" placeholder="ボタン名（例：編集へ）" />
                    <button onClick={() => saveHandoffs(handoffs.filter((_, i) => i !== idx))} title="このプリセットを削除"
                      className="w-8 h-8 grid place-items-center rounded-lg text-stone-400 hover:bg-rose-50 hover:text-rose-500"><Icon name="trash" className="w-4 h-4" /></button>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-stone-400 mb-1">見せるタブ</div>
                    <div className="flex flex-wrap gap-1.5">
                      {HANDOFF_TAB_CHOICES.map((t) => {
                        const on = (h.tabs || []).includes(t);
                        return (
                          <button key={t} onClick={() => {
                            const tabs = on ? h.tabs.filter((x) => x !== t) : [...h.tabs, t];
                            const start = tabs.includes(h.start) ? h.start : (tabs[0] || "");
                            saveHandoffs(handoffs.map((x, i) => i === idx ? { ...x, tabs, start } : x));
                          }}
                            className={"text-[11px] font-bold px-2.5 py-1 rounded-full border " + (on ? "text-white border-transparent" : "text-stone-500 border-stone-200 hover:bg-stone-50")}
                            style={on ? { background: theme.accent } : {}}>{TAB_LABEL[t]}</button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-stone-400">最初に開く</span>
                    <select value={h.start || ""} onChange={(e) => saveHandoffs(handoffs.map((x, i) => i === idx ? { ...x, start: e.target.value } : x))}
                      className="text-[12px] border border-stone-200 rounded-lg px-2 py-1 bg-white">
                      {(h.tabs || []).map((t) => <option key={t} value={t}>{TAB_LABEL[t]}</option>)}
                    </select>
                  </div>
                  <textarea value={h.msg || ""} onChange={(e) => saveHandoffs(handoffs.map((x, i) => i === idx ? { ...x, msg: e.target.value } : x))} rows={3}
                    className="w-full border border-stone-200 rounded-lg px-3 py-2 text-[12px] text-stone-700 resize-none focus:outline-none" placeholder="送る文面（{url} と {name} が使えます）" />
                </div>
              ))}
              <div className="flex items-center justify-between pt-1">
                <button onClick={() => saveHandoffs([...handoffs, { id: "custom-" + Date.now(), emoji: "📨", label: "新しい受け渡し", tabs: ["review"], start: "review", msg: "{name}\n{url}" }])}
                  className="text-[12px] font-bold flex items-center gap-1" style={{ color: theme.main }}><Icon name="plus" className="w-4 h-4" />受け渡しを追加</button>
                <button onClick={() => { if (confirm("初期の3つ（編集へ／先方へ／演者へ）に戻す？")) saveHandoffs(HANDOFF_DEFAULTS.map((h) => ({ ...h, tabs: [...h.tabs] }))); }}
                  className="text-[11px] text-stone-400 hover:text-stone-600 underline">初期設定に戻す</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== ヒアリング：文字起こし取込モーダル ===== */}
      {hearingImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !hearingBusy && setHearingImport(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-2">
              <Icon name="sparkle" className="w-5 h-5" style={{ color: theme.accent }} />
              <h3 className="text-sm font-bold tracking-wider">文字起こしから自動でまとめる</h3>
            </div>
            <p className="text-[12px] text-stone-500 mb-3">取材・打ち合わせ・電話の<span className="font-bold">文字起こしやメモ</span>を貼り付けて。AIが各ヒアリング項目に振り分けて要約します。<span className="text-stone-400">※空欄の項目だけ埋めます（入力済みは上書きしません）。該当が無い項目は空のままにします。</span></p>
            <textarea autoFocus value={hearingImport.raw} onChange={(e) => setHearingImport({ raw: e.target.value })}
              placeholder="ここに文字起こし・取材メモを貼り付け…"
              className="w-full h-56 text-[13px] border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-400 resize-y leading-relaxed" />
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="text-[11px] text-stone-400">{(hearingImport.raw || "").length.toLocaleString()} 字</span>
              <div className="flex gap-2">
                <button onClick={() => setHearingImport(null)} disabled={hearingBusy} className="text-[12px] font-bold px-3 py-2 rounded-lg text-stone-500 hover:bg-stone-100 disabled:opacity-40">キャンセル</button>
                <button onClick={runHearingFill} disabled={hearingBusy || !(hearingImport.raw || "").trim()}
                  className="text-[12px] font-bold px-4 py-2 rounded-lg shadow disabled:opacity-40 inline-flex items-center gap-1.5" style={{ background: theme.accent, color: accentText }}>
                  {hearingBusy ? <><span className="inline-block w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />まとめてる…</> : <><Icon name="sparkle" className="w-3.5 h-3.5" />AIでまとめる</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== 動画確認・ファイル転送 モーダル ===== */}
      {showMediaModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !mediaBusy && setShowMediaModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 flex items-center justify-between sticky top-0 z-10" style={{ background: theme.main, color: mainText }}>
              <h3 className="text-sm font-bold tracking-wider">動画確認・ファイル転送</h3>
              <button onClick={() => !mediaBusy && setShowMediaModal(false)} className="w-7 h-7 rounded-lg grid place-items-center hover:bg-white/15"><Icon name="close" className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-5">
              {renderMediaBody(true)}
            </div>
          </div>
        </div>
      )}

      {/* 編集者向けヘルプAIチャット（chanLive or ライブ編集中に表示・自己ゲート） */}
      {renderHelpChat()}

      {/* ===== 先方コメント パネル（右ドロワー） ===== */}
      {showComments && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setShowComments(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="relative w-full max-w-sm h-full bg-white shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 flex items-center justify-between" style={{ background: theme.main, color: mainText }}>
              <h3 className="text-sm font-bold tracking-wider">先方コメント {openComments.length > 0 && <span className="ml-1 text-[11px] opacity-80">未対応 {openComments.length}</span>}</h3>
              <div className="flex items-center gap-1">
                <button onClick={() => fetchComments()} title="再読み込み" className="w-7 h-7 rounded-lg grid place-items-center hover:bg-white/15"><Icon name="refresh" className="w-4 h-4" /></button>
                <button onClick={() => setShowComments(false)} className="w-7 h-7 rounded-lg grid place-items-center hover:bg-white/15"><Icon name="close" className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2" style={{ background: "#F4F3EF" }}>
              {comments.length === 0 && (
                <p className="text-[12px] text-stone-400 text-center py-10">まだコメントはありません。<br />共有URLを先方に送ると、ここに届きます。</p>
              )}
              {[...comments].sort((a, b) => (a.resolved === b.resolved ? (a.createdAt < b.createdAt ? 1 : -1) : a.resolved ? 1 : -1)).map((c) => (
                <div key={c.id} className={"rounded-xl border p-3 " + (c.resolved ? "bg-stone-100 border-stone-200 opacity-70" : "bg-white border-stone-200 shadow-sm")}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full truncate max-w-[180px]" style={{ background: theme.main, color: mainText }}>
                      {c.sceneLabel || "全体"}
                    </span>
                    <span className="text-[10px] text-stone-400 shrink-0">{(c.createdAt || "").slice(5, 16).replace("T", " ")}</span>
                  </div>
                  <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words text-stone-800">{c.text}</p>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="text-[11px] text-stone-400">{c.author || "ゲスト"}</span>
                    <button onClick={() => resolveComment(c.id, !c.resolved)}
                      className={"text-[10px] font-bold px-2.5 py-1 rounded-full " + (c.resolved ? "bg-stone-200 text-stone-500" : "text-white")}
                      style={c.resolved ? {} : { background: "#10B981" }}>
                      {c.resolved ? "未対応に戻す" : "対応済にする"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-4 py-2.5 border-t border-stone-200 text-[10px] text-stone-400">
              コメントは先方が共有ページから投稿。撮影・原稿の修正に反映してね
            </div>
          </div>
        </div>
      )}

      {/* ===== 複数選択アクションバー ===== */}
      {selectedIds.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 pl-4 pr-2 py-2 rounded-full shadow-2xl"
          style={{ background: theme.main, color: mainText }}>
          <span className="text-[12px] font-bold mr-1">{selectedIds.length}件 選択中</span>
          <span className="text-[11px] opacity-70 mr-2 hidden sm:inline">左の番号をドラッグでまとめて移動</span>
          <button onClick={deleteSelected}
            className="text-[11px] font-bold px-3 py-1.5 rounded-full" style={{ background: "#DC2645", color: "#fff" }}>削除</button>
          <button onClick={clearSelection}
            className="text-[11px] font-bold px-3 py-1.5 rounded-full bg-white/15 hover:bg-white/25">選択解除</button>
        </div>
      )}

      {/* ===== AIチャットパネル（会話で台本を作る・磨く。提案→承認）===== */}
      {view === "editor" && aiChatEnabled && !chatOpen && (
        <button onClick={() => setChatOpen(true)} title="AIと話しながら台本を作る"
          className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full shadow-xl grid place-items-center text-2xl hover:scale-105 transition-transform"
          style={{ background: theme.main, color: mainText }}>
          🤖
        </button>
      )}
      {view === "editor" && aiChatEnabled && chatOpen && (
        <div className="fixed inset-y-0 right-0 z-40 w-full sm:w-[400px] bg-white shadow-2xl border-l border-stone-200 flex flex-col">
          {/* ヘッダ */}
          <div className="px-4 py-3 flex items-center gap-2 shrink-0" style={{ background: theme.main, color: mainText }}>
            <span className="text-lg">🤖</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold leading-tight">AIアシスタント</div>
              <div className="text-[10px] opacity-70 truncate">{project.format === "talk" ? "トーク系" : "一日密着"}・Bird Flip流で一緒に書く</div>
            </div>
            {chatMsgs.length > 0 && (
              <button onClick={clearChat} title="会話をクリア" className="w-7 h-7 rounded-lg grid place-items-center hover:bg-white/15 text-[11px]">🗑</button>
            )}
            <button onClick={() => setChatOpen(false)} title="閉じる" className="w-7 h-7 rounded-lg grid place-items-center hover:bg-white/15"><Icon name="close" className="w-4 h-4" /></button>
          </div>

          {/* メッセージ */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5 bg-stone-50">
            {chatMsgs.length === 0 && !chatBusy && (
              <div className="text-[12px] text-stone-400 leading-relaxed px-1 py-2">
                <p className="font-bold text-stone-500 mb-1.5">台本を一緒に作れます。例えば：</p>
                <ul className="space-y-1.5">
                  {["この文字起こし貼るね → 5シーンの台本にして", "#2の質問、知ってる感が出てる。素朴に直して", "冒頭に視聴者が思わず見ちゃう驚きを足して", "全体ざっと校正して気になる所教えて"].map((ex, i) => (
                    <li key={i}><button onClick={() => setChatInput(ex.replace(/^.+→ /, ""))} className="text-left w-full px-2.5 py-1.5 rounded-lg bg-white border border-stone-200 hover:border-stone-400 text-stone-600">{ex}</button></li>
                  ))}
                </ul>
                <p className="mt-2.5 text-[11px] text-stone-400">変更は<span className="font-bold">提案として</span>出る → ✅で反映。勝手には書き換えないよ。</p>
              </div>
            )}
            {chatMsgs.map((msg, i) => {
              if (msg.role === "system") return <div key={i} className="text-center text-[10px] text-stone-400 py-0.5">{msg.content}</div>;
              const mine = msg.role === "user";
              return (
                <div key={i} className={"flex " + (mine ? "justify-end" : "justify-start")}>
                  <div className={"max-w-[88%] text-[12.5px] leading-relaxed rounded-2xl px-3 py-2 whitespace-pre-wrap break-words " + (mine ? "rounded-br-sm" : "bg-white border border-stone-200 text-stone-700 rounded-bl-sm")}
                    style={mine ? { background: theme.accent, color: accentText } : undefined}>{msg.content}</div>
                </div>
              );
            })}
            {chatBusy && (
              <div className="flex justify-start"><div className="bg-white border border-stone-200 rounded-2xl rounded-bl-sm px-3 py-2 text-[12px] text-stone-400 inline-flex items-center gap-1">考え中<span className="animate-pulse">…</span></div></div>
            )}

            {/* 変更提案カード（承認待ち） */}
            {chatProposal && (
              <div className="rounded-xl border-2 bg-white p-3 shadow-sm" style={{ borderColor: theme.accent }}>
                <div className="text-[11px] font-bold mb-1 inline-flex items-center gap-1" style={{ color: theme.accent }}><Icon name="sparkle" className="w-3.5 h-3.5" />変更の提案</div>
                <p className="text-[12px] text-stone-700 leading-relaxed whitespace-pre-wrap">{chatProposal.summary || "台本を更新します。"}</p>
                <div className="text-[10px] text-stone-400 mt-1">{chatProposal.format === "talk" ? "トーク台本を更新" : "構成台本 全" + ((chatProposal.rows || []).length) + "行に更新"}</div>
                <div className="flex gap-2 mt-2.5">
                  <button onClick={applyProposal} className="flex-1 text-[12px] font-bold py-2 rounded-lg text-white" style={{ background: theme.accent, color: accentText }}>✅ この内容で反映</button>
                  <button onClick={() => setChatProposal(null)} className="text-[12px] font-bold px-3 py-2 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-500">却下</button>
                </div>
              </div>
            )}
            {/* 直前の反映を取り消す */}
            {chatUndo && !chatProposal && (
              <div className="flex justify-center">
                <button onClick={undoChat} className="text-[11px] font-bold px-3 py-1.5 rounded-full bg-stone-200 hover:bg-stone-300 text-stone-600 inline-flex items-center gap-1">↩️ 直前の反映を取り消す</button>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* 入力 */}
          <div className="shrink-0 border-t border-stone-200 p-2.5 bg-white">
            <div className="flex items-end gap-2">
              <textarea value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendChat(); } }}
                placeholder="依頼や相談を入力（⌘+Enterで送信）。素材を貼ってもOK"
                className="flex-1 min-w-0 text-[12.5px] border border-stone-200 rounded-xl px-3 py-2 max-h-40 resize-y focus:outline-none focus:border-stone-400" rows={2} />
              <button onClick={sendChat} disabled={chatBusy || !chatInput.trim()}
                className="shrink-0 w-10 h-10 rounded-xl grid place-items-center text-white disabled:opacity-30" style={{ background: theme.main, color: mainText }}>
                <Icon name="up" className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 text-sm px-5 py-2.5 rounded-full shadow-xl"
          style={{ background: theme.main, color: mainText }}>
          {toast}
        </div>
      )}

      {/* アップロード進捗（全画面共通の常時見えるカード）。どのタブに居ても・スクロールしていても見える */}
      {(mediaBusy || assetUp || thumbUp) && (() => {
        const label = mediaBusy || (assetUp ? "素材をアップロード中：" + assetUp.name : `サムネ画像をアップロード中（${thumbUp.i}/${thumbUp.n}）`);
        const pct = mediaBusy ? mediaProg : (assetUp ? assetUp.pct : thumbUp.pct);
        return (
          <div className="fixed bottom-6 right-6 z-50 w-[300px] max-w-[calc(100vw-3rem)] bg-white rounded-2xl shadow-2xl border border-stone-200 p-3.5">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full animate-pulse shrink-0" style={{ background: theme.accent }} />
              <span className="text-[12px] font-bold text-stone-700 truncate flex-1">{label}</span>
              <span className="text-[13px] font-bold tabular-nums shrink-0" style={{ color: theme.accent }}>{Math.round(pct || 0)}%</span>
            </div>
            <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-300" style={{ width: (pct || 0) + "%", background: theme.accent }} />
            </div>
            <div className="text-[10px] text-stone-400 mt-1.5">完了までこの画面を閉じないでね（タブ移動はOK）</div>
          </div>
        );
      })()}
    </div>
  );
}
