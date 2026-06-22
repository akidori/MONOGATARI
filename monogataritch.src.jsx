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
const newLocation = (name = "") => ({ id: uid(), kind: "location", label: name, address: "", time: "", note: "" });

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
const shareUrl = (id) => location.origin + location.pathname.replace(/[^/]*$/, "") + "share.html?id=" + id;

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
const newAsset = (category = "撮影素材", patch = {}) => ({ id: uid(), category, type: "file", key: "", url: "", name: "", size: 0, mime: "", planId: "", sceneId: "", createdAt: Date.now(), ...patch });

/* ===== マニュアル／決め事（全体・チャンネル・案件の3スコープ、分類付き） ===== */
const MANUAL_CATS = ["撮影", "編集", "サムネ", "テロップ", "構成", "音", "納品", "その他"];
const newManual = (cat = "その他") => ({ id: uid(), cat, title: "", body: "" });
const STORE_MANUALS_GLOBAL = "manuals-global-v1"; // 全体の決め事（window.storage＝ログイン時クラウド同期）

/* トーク系台本の中身（タイトルは企画・サムネと連携、ハイライト/冒頭/目次/本編/CTA） */
const newTalkBody = () => ({ id: uid(), heading: "", script: "" });
const newTalk = () => ({ highlight: "", intro: "", toc: [""], body: [newTalkBody()], cta: "" });
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
        ? { id: uid(), kind: "location", label: r.label || "", address: r.address || "", time: r.time || "", note: r.note || "" }
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

function AddressField({ loc, onChange }) {
  const ref = useRef(null);
  const acRef = useRef(null);
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
    return () => { cancelled = true; };
  }, []);
  const q = (loc.address || "").trim();
  const linked = !!loc.placeId || loc.lat != null;
  const mapHref = !q ? null
    : loc.placeId ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q) + "&query_place_id=" + encodeURIComponent(loc.placeId)
    : loc.lat != null ? "https://www.google.com/maps/search/?api=1&query=" + loc.lat + "," + loc.lng
    : "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
  return (
    <>
      <input
        ref={ref}
        value={loc.address}
        onChange={(e) => onChange({ address: e.target.value, placeId: "", lat: null, lng: null })}
        placeholder="住所・施設名で検索（例：東京タワー）"
        className="block w-full min-w-0 bg-transparent text-[12px] px-1 py-2 focus:outline-none placeholder:text-stone-300"
      />
      {q && (
        <a href={mapHref} target="_blank" rel="noreferrer" title={linked ? "連携済みの場所をGoogleマップで開く" : "Googleマップで開く"}
           className={"shrink-0 mr-2 text-[11px] font-bold px-2 py-1 rounded-md whitespace-nowrap inline-flex items-center gap-1 border active:scale-95 transition " + (linked ? "border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100" : "border-stone-200 text-stone-600 hover:bg-stone-50")}>
          <Icon name={linked ? "pin" : "map"} className="w-3.5 h-3.5 shrink-0" /> <span className="hidden sm:inline">{linked ? "連携済" : "地図"}</span>
        </a>
      )}
    </>
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
          {plan.shareId && <a href={shareUrl(plan.shareId)} target="_blank" rel="noreferrer" className="text-[11px] font-bold underline" style={{ color: main }}>リンクを開く ↗</a>}
        </div>
        <p className="text-[10px] text-stone-400 mt-1">この企画の動画・素材・コメントだけを先方に見せる専用リンク（案件丸ごとは右上「共有」）。</p>
      </div>
    </div>
  );
}

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

/* ===== 動画確認：Frame.io型 修正管理ボード（バージョン＋ステータス/カテゴリ/優先度/返信/フィルタ） ===== */
function ReviewBoard({ versions, comments, main, accent, accentText, busy, prog, onUploadVideo, onAddYouTube, onRemoveVersion, onRenameVersion, onPost, onUpdate, onReply, onDelete, userName }) {
  const mono = '"IBM Plex Mono",ui-monospace,monospace';
  const [selId, setSelId] = React.useState(versions[0] ? versions[0].id : null);
  const [filter, setFilter] = React.useState("全部");
  const [cat, setCat] = React.useState("編集");
  const [prio, setPrio] = React.useState("中");
  const [text, setText] = React.useState("");
  const [yt, setYt] = React.useState("");
  const [replyText, setReplyText] = React.useState({});
  const vref = React.useRef(null);
  const [rate, setRate] = React.useState(1);
  const [cur, setCur] = React.useState(0);
  React.useEffect(() => { if (!versions.some((v) => v.id === selId)) setSelId(versions[0] ? versions[0].id : null); }, [versions.map((v) => v.id).join(",")]);
  const sel = versions.find((v) => v.id === selId) || versions[0] || null;
  const vKey = sel ? (sel.uid || sel.key || sel.url || "") : "";
  const fmtTC = (s) => { s = Math.max(0, +s || 0); const m = Math.floor(s / 60), sec = Math.floor(s % 60), cs = Math.floor((s * 100) % 100); return m + ":" + String(sec).padStart(2, "0") + "." + String(cs).padStart(2, "0"); };
  const belongs = (c) => sel && (c.versionId === sel.id || (c.videoKey || "") === vKey || (sel.uid && c.videoKey === sel.uid) || (sel.key && c.videoKey === sel.key));
  const verComments = comments.filter(belongs);
  const counts = CMT_STATUSES.reduce((o, s) => { o[s] = verComments.filter((c) => cstat(c) === s).length; return o; }, {});
  const seek = (t) => { if (sel && sel.type !== "youtube" && vref.current) { vref.current.currentTime = +t || 0; const p = vref.current.play(); if (p && p.catch) p.catch(() => {}); } };
  const isMp4 = sel && sel.type !== "youtube";
  const streamPending = sel && sel.type === "stream" && !sel.ready;
  // Cloudflare Stream(HLS) を hls.js で attach（Safariはネイティブ）
  React.useEffect(() => {
    if (!sel || sel.type !== "stream" || !sel.ready || !sel.hls || !vref.current) return;
    const video = vref.current; let hls;
    if (video.canPlayType("application/vnd.apple.mpegurl")) { video.src = sel.hls; }
    else { loadHls().then((Hls) => { if (Hls && Hls.isSupported()) { hls = new Hls(); hls.loadSource(sel.hls); hls.attachMedia(video); } else { video.src = sel.hls; } }); }
    return () => { if (hls) hls.destroy(); };
  }, [sel && sel.id, sel && sel.ready, sel && sel.hls]);
  const filtered = verComments.filter((c) => filter === "全部" ? true : filter === "高優先度" ? c.priority === "高" : CMT_STATUSES.includes(filter) ? cstat(c) === filter : CMT_CATEGORIES.includes(filter) ? (c.category || "その他") === filter : true)
    .sort((a, b) => (a.timecode || 0) - (b.timecode || 0));
  const submit = () => { const t = text.trim(); if (!t || !sel) return; onPost({ versionId: sel.id, videoKey: vKey, timecode: isMp4 && vref.current ? vref.current.currentTime : null, text: t, category: cat, priority: prio, status: "未対応" }); setText(""); };

  if (!versions.length) {
    return (
      <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-6 text-center">
        <div className="text-[13px] font-bold text-stone-600 mb-1">確認用の動画を追加</div>
        <p className="text-[11px] text-stone-400 mb-4">初稿・修正版をアップすると、0.5〜4倍速で試写しながら修正コメントを管理できます。</p>
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
    );
  }
  const rates = [0.5, 1, 1.5, 2, 3, 4];
  return (
    <div>
      {/* バージョンタブ */}
      <div className="flex items-center gap-1.5 mb-3 overflow-x-auto pb-1">
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
        <label className="shrink-0 px-2.5 py-1.5 rounded-lg text-[12px] font-bold border border-dashed border-stone-300 text-stone-500 hover:bg-stone-50 cursor-pointer">
          ＋版
          <input type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) onUploadVideo(f); e.target.value = ""; }} />
        </label>
      </div>
      {/* 修正サマリー */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {CMT_STATUSES.map((s) => (
          <span key={s} className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: CMT_STATUS_COLOR[s].bg, color: CMT_STATUS_COLOR[s].fg }}>{s} {counts[s]}</span>
        ))}
        <div className="flex-1" />
        <button onClick={() => { if (window.confirm(sel.label + " を削除しますか？（コメントは残ります）")) onRemoveVersion(sel.id); }} className="text-[11px] text-stone-400 hover:text-rose-500 font-bold">この版を削除</button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4">
        {/* 左：プレイヤー */}
        <div>
          <div className="rounded-xl overflow-hidden bg-black grid place-items-center" style={{ aspectRatio: "16/9" }}>
            {sel.type === "youtube"
              ? <iframe src={"https://www.youtube.com/embed/" + (ytIdFromUrl(sel.url) || "")} className="w-full h-full" style={{ border: 0 }} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
              : streamPending
                ? <div className="text-center text-white/80 px-4"><div className="text-[13px] font-bold mb-1">⚙️ 軽量版に変換中…{sel.pct ? " " + Math.round(sel.pct) + "%" : ""}</div><div className="text-[11px] opacity-70">完了すると回線が細くてもサクサク再生できます（数分）。このまま待つか、後で開いてOK。</div></div>
                : sel.type === "stream"
                  ? <video ref={vref} controls playsInline preload="auto" onTimeUpdate={(e) => setCur(e.target.currentTime)} className="w-full h-full bg-black" />
                  : <video ref={vref} src={sel.key ? (SHARE_API + "/api/file/" + sel.key) : sel.url} controls playsInline preload="auto" onTimeUpdate={(e) => setCur(e.target.currentTime)} className="w-full h-full bg-black" />}
          </div>
          {isMp4 && (
            <div className="flex items-center gap-1 mt-2 flex-wrap">
              <span className="text-[11px] font-bold tabular-nums px-2 py-1 rounded" style={{ background: "#1C1C1E", color: "#fff", fontFamily: mono }}>{fmtTC(cur)}</span>
              <span className="text-[10px] text-stone-400 ml-1 mr-0.5">速度</span>
              {rates.map((r) => (
                <button key={r} onClick={() => { if (vref.current) vref.current.playbackRate = r; setRate(r); }}
                  className={"text-[11px] px-1.5 py-0.5 rounded border " + (rate === r ? "text-white" : "border-stone-200 text-stone-500")} style={rate === r ? { background: main, borderColor: main, fontFamily: mono } : { fontFamily: mono }}>{r}x</button>
              ))}
            </div>
          )}
          {/* 新規修正コメント */}
          <div className="mt-3 rounded-xl border border-stone-200 bg-white p-3">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              {isMp4 && <span className="text-[11px] font-bold tabular-nums px-2 py-0.5 rounded" style={{ background: accent, color: accentText, fontFamily: mono }}>{fmtTC(cur)} に</span>}
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
                    <input value={replyText[c.id] || ""} onChange={(e) => setReplyText((m) => ({ ...m, [c.id]: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") { onReply(c.id, replyText[c.id]); setReplyText((m) => ({ ...m, [c.id]: "" })); } }} placeholder="返信…" className="flex-1 min-w-0 text-[11px] border border-stone-200 rounded-lg px-2 py-1 focus:outline-none" />
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
export default function App() {
  const [index, setIndex] = useState([]);       // [{id,name,createdAt}]
  const [activeId, setActiveId] = useState(null);
  const [project, setProject] = useState(null);  // 現在編集中の案件データ
  const [channelInfo, setChannelInfo] = useState({}); // {channelName: {name,url,concept,target,purpose,competitors[]}}
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState("");
  const [hoverId, setHoverId] = useState(null);
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
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
  const [aiMenu, setAiMenu] = useState(false);             // AIボタンのメニュー（校正/反映）
  const [thumbTest, setThumbTest] = useState(null);        // サムネ目立ちテスト {pid, keyword, myImage, items[], myPos, busy, reveal}
  const [thumbPick, setThumbPick] = useState({});          // {pid: idx} 目立ちテストの対象サムネ（既定=最初の非空）
  const [caseSearch, setCaseSearch] = useState("");        // 全案件横断検索クエリ
  const [searchHits, setSearchHits] = useState(null);      // null=閉, []=ヒットなし, [...]=結果
  const searchIndexRef = useRef({});                       // {id: 検索インデックス}（前計算キャッシュ）
  const [ctxMenu, setCtxMenu] = useState(null);            // サイドバー チャンネル右クリックメニュー {channel,x,y}
  const [iconPick, setIconPick] = useState(null);          // チャンネルアイコン選択ポップオーバー {channel,x,y}
  const [addMenu, setAddMenu] = useState(null);            // 案件追加のタイプ選択 {channel,x,y}
  const [chShareMenu, setChShareMenu] = useState(null);    // チャンネル共有の種類選択（読取専用/編集つき）{channel,x,y}
  const [view, setView] = useState("home");                // "home"(入口・一覧) | "editor"(案件編集)
  const [showInvite, setShowInvite] = useState(false);     // 共同編集の招待モーダル
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [renamingId, setRenamingId] = useState(null);
  const [channelEditId, setChannelEditId] = useState(null); // チャンネル変更中の案件id（新規フォルダ名の入力用）
  const [chanMenu, setChanMenu] = useState(null);          // 案件のチャンネル移動ドロップダウン {id, channel, x, y}
  const [collapsed, setCollapsed] = useState({});           // {channel: true} で折りたたみ
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [dragIds, setDragIds] = useState(null);             // 複数行ドラッグ中のid配列
  const [selectedIds, setSelectedIds] = useState([]);       // 複数選択中の行id
  const [painting, setPainting] = useState(false);          // チェック欄ドラッグ選択中
  const [isNarrow, setIsNarrow] = useState(false);          // スマホ幅（操作列を隠す等）
  const lastSelRef = useRef(null);                          // shift範囲選択の起点
  /* 共有・コメント */
  const [shareModal, setShareModal] = useState(null);       // {url, id} or null
  const [sharing, setSharing] = useState(false);
  const [chSharing, setChSharing] = useState(false);        // チャンネル丸ごと共有の発行中
  const [comments, setComments] = useState([]);             // 現案件の先方コメント
  const [showComments, setShowComments] = useState(false);
  const saveTimer = useRef(null);
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
  const [globalManuals, setGlobalManuals] = useState([]);    // 全体の決め事（スタジオ共通）
  const [showManual, setShowManual] = useState(false);       // マニュアルモーダル
  const [manualScope, setManualScope] = useState("case");    // global | channel | case

  /* フォント */
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700;900&family=IBM+Plex+Mono:wght@400;600;700&display=swap";
    document.head.appendChild(link);
  }, []);

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
      const firstId = idx[0].id;
      const r = await window.storage.get(STORE_PROJ(firstId));
      const data = r && r.value ? migrateProject(JSON.parse(r.value)) : newProjectData(idx[0].name);
      setActiveId(firstId); setProject(data);
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
    saveTimer.current = setTimeout(() => { saveProjectData(project); }, 700);
    return () => clearTimeout(saveTimer.current);
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
  const saveGlobalManuals = (next) => { setGlobalManuals(next); try { window.storage.set(STORE_MANUALS_GLOBAL, JSON.stringify(next)); } catch (e) {} };
  const setChannelManuals = (next) => updateChannelInfo({ manuals: next });
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
  const saveProjectData = async (data0) => {
    if (!data0) return;
    const data = { ...data0, updatedAt: Date.now() };
    // collab かつログイン中のみクラウドへ。未ログイン(ログアウト後)は個人ストレージへフォールバック保存（silent fail防止）
    if (data.collab && MG_SESSION) {
      try { await authFetch("/api/collab/upsert", { id: data.id, project: data }); }
      catch (e) { console.error("collab保存", e); try { await window.storage.set(STORE_PROJ(data.id), JSON.stringify(data)); } catch (_) {} }
    } else {
      try { if (typeof window.storage !== "undefined") await window.storage.set(STORE_PROJ(data.id), JSON.stringify(data)); } catch (e) { console.error(e); }
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
      const url = location.origin + location.pathname.replace(/[^/]*$/, "") + "share.html?ch=" + d.id;
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
  const switchProject = async (id) => {
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
    } catch (e) { showToast("案件を開けませんでした：" + (e.message || e)); }
  };

  /* ホームの案件カードから開く＝概要タブに着地（作業の入口） */
  const openCase = async (id) => { await switchProject(id); setTab("overview"); };

  const createProject = async (template = true, channel = DEFAULT_CHANNEL, format = "documentary") => {
    const n = index.length + 1;
    const data = newProjectData((format === "talk" ? "トーク案件" : "案件") + n, channel, format);
    if (!template && format !== "talk") data.rows = [];
    const idx = [...index, { id: data.id, name: data.name, channel: data.channel, createdAt: data.createdAt }];
    try {
      if (project) await saveProjectData(project);
      await window.storage.set(STORE_PROJ(data.id), JSON.stringify(data));
    } catch (e) {}
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
    const idx = [...index, { id: data.id, name: data.name, channel: data.channel, createdAt: data.createdAt }];
    if (project) await saveProjectData(project);
    try { await window.storage.set(STORE_PROJ(data.id), JSON.stringify(data)); } catch (e) {}
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
    setTab("script");
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
        } catch (e) {}
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
        } catch (e) {}
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
  const publishShare = async () => {
    if (!project) return;
    setSharing(true);
    try {
      const res = await fetch(SHARE_API + "/api/publish", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: { ...project, channelInfo: curChannelInfo, manualsGlobal: globalManuals }, prevId: project.shareId || null, token: project.shareToken || null }),
      });
      const data = await res.json();
      if (!data.id) throw new Error(data.error || "発行失敗");
      const next = { ...project, shareId: data.id, shareToken: data.token || project.shareToken };
      setProject(next);
      try { await window.storage.set(STORE_PROJ(next.id), JSON.stringify(next)); } catch (e) {}
      const url = shareUrl(data.id);
      setShareModal({ id: data.id, url, updated: !!project.shareId });
      try { await navigator.clipboard.writeText(url); } catch (e) {}
      setSharing(false);
      return data.id;
    } catch (e) { showToast("共有リンクの発行に失敗：" + (e.message || e)); }
    setSharing(false);
    return null;
  };
  /* ===== 共有URL：タブ別／案件まるごと ===== */
  /* アプリのタブ → share.html のペイン名 */
  const TAB_SHARE_PANE = { plan: "plan", script: "script", kouban: "kouban", review: "video", concept: "concept", assets: "files" };
  const buildShareUrl = (id, t) => { const pane = t ? TAB_SHARE_PANE[t] : ""; return shareUrl(id) + (pane ? "&tab=" + pane : ""); };
  /* t を渡すとそのタブだけ／省略で案件まるごと。未発行なら発行してからコピー */
  const copyShareUrl = async (t) => {
    let id = project.shareId;
    if (!id) { id = await publishShare(); if (!id) return; }
    const u = buildShareUrl(id, t);
    try { await navigator.clipboard.writeText(u); showToast((t ? "このタブの" : "案件まるごとの") + "共有URLをコピーしたよ"); } catch (e) { setShareModal({ id, url: u, updated: true }); }
  };
  const TAB_LABEL = { overview: "概要", plan: "企画・サムネ", script: "構成台本", kouban: "香盤表", assets: "素材管理", review: "動画確認", concept: "チャンネル" };

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
  const uploadToR2 = async (file, planId = "", onProgress = null) => {
    // R2マルチパートは最大1万パート。500GB級でも収まるようチャンクを動的に（48〜90MB、Worker body上限内）
    const CHUNK = Math.min(90 * 1024 * 1024, Math.max(48 * 1024 * 1024, Math.ceil(file.size / 9000)));
    const extra = { token: project.shareToken, retention, planId };
    const cr = await fetch(SHARE_API + "/api/file/mpu/create", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snap: project.shareId, name: file.name, size: file.size, mime: file.type || "application/octet-stream", ...extra }),
    });
    const cd = await cr.json();
    if (!cd.uploadId) throw new Error(cd.error || "開始に失敗");
    const total = Math.max(1, Math.ceil(file.size / CHUNK));
    const parts = [];
    for (let i = 0; i < total; i++) {
      const start = i * CHUNK, blob = file.slice(start, Math.min(file.size, start + CHUNK));
      let etag = null, lastErr;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          etag = await new Promise((res, rej) => {
            const xhr = new XMLHttpRequest();
            xhr.open("PUT", SHARE_API + "/api/file/mpu/part?key=" + encodeURIComponent(cd.key) + "&uploadId=" + encodeURIComponent(cd.uploadId) + "&part=" + (i + 1));
            xhr.upload.onprogress = (e) => { if (e.lengthComputable) (onProgress || setMediaProg)(Math.min(100, Math.round((start + e.loaded) / file.size * 100))); };
            xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) { try { res(JSON.parse(xhr.responseText).etag); } catch (_) { rej(new Error("part応答不正")); } } else rej(new Error("part失敗(" + xhr.status + ")")); };
            xhr.onerror = () => rej(new Error("通信エラー"));
            xhr.send(blob);
          });
          break;
        } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); }
      }
      if (etag == null) throw lastErr || new Error("part失敗");
      parts.push({ partNumber: i + 1, etag });
    }
    const fr = await fetch(SHARE_API + "/api/file/mpu/complete", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snap: project.shareId, key: cd.key, uploadId: cd.uploadId, parts, name: file.name, size: file.size, mime: file.type || "application/octet-stream", ...extra }),
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
      const next = { ...project, plans: project.plans.map((p) => (p.id === planId ? { ...p, shareId: data.id, shareToken: data.token || p.shareToken } : p)) };
      await saveProject(next);
      const url = shareUrl(data.id);
      setShareModal({ id: data.id, url, updated: !!pl.shareId, planShare: true });
      try { await navigator.clipboard.writeText(url); } catch (e) {}
    } catch (e) { showToast("企画の試写リンク発行に失敗：" + (e.message || e)); }
    setSharing(false);
  };
  /* mp4 を動画として登録（onProgress指定時はカード内バー、未指定はモーダルの共通バー） */
  const uploadVideo = async (file, target = "project", onProgress = null) => {
    if (!project.shareId) { showToast("先に共有リンクを発行してね"); return; }
    if (!/^video\//.test(file.type) && !/\.(mp4|mov|m4v|webm)$/i.test(file.name)) { showToast("動画ファイルを選んでね"); return; }
    if (!onProgress) { setMediaBusy("動画をアップロード中…"); setMediaProg(0); }
    try {
      const meta = await uploadToR2(file, target === "project" ? "" : target, onProgress);
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
    if (!project.shareId) { showToast("先に共有リンクを発行してね"); return; }
    if (!onProgress) { setMediaBusy("アップロード中…"); setMediaProg(0); }
    try {
      const meta = await uploadToR2(file, target === "project" ? "" : target, onProgress);
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
  const uploadAsset = async (file, category = "撮影素材") => {
    if (!project.shareId) { showToast("先に確認用URLを発行してね（ヘッダーの共有）"); return; }
    setAssetUp({ cat: category, name: file.name, pct: 0 });
    try {
      const meta = await uploadToR2(file, "", (p) => setAssetUp({ cat: category, name: file.name, pct: p }));
      const isVideo = /^video\//.test(file.type) || /\.(mp4|mov|m4v|webm)$/i.test(file.name);
      setAssets((arr) => [newAsset(category, { type: isVideo ? "mp4" : "file", key: meta.key, name: meta.name, size: meta.size || file.size, mime: meta.mime || file.type }), ...arr]);
      showToast(category + "に追加したよ");
    } catch (e) { showToast("アップロードに失敗：" + (e.message || e)); }
    setAssetUp(null);
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
  const moveAsset = (id, category) => setAssets((arr) => arr.map((x) => (x.id === id ? { ...x, category } : x)));
  const assetUrl = (a) => a.type === "youtube" ? a.url : (a.key ? (SHARE_API + "/api/file/" + a.key) : a.url);
  const fmtSize = (n) => { n = Number(n) || 0; if (n >= 1e9) return (n / 1e9).toFixed(1) + "GB"; if (n >= 1e6) return (n / 1e6).toFixed(1) + "MB"; if (n >= 1e3) return Math.round(n / 1e3) + "KB"; return n + "B"; };

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
          <p className="text-[10px] text-stone-400 mt-1.5">先方も共有ページの「ファイル」タブから素材をアップできるよ（2GBまで）。</p>
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
  const setVersions = (updater) => setProject((p) => { const rv = (p.review && p.review.versions) || []; const next = typeof updater === "function" ? updater(rv) : updater; return { ...p, review: { versions: next, comments: (p.review && p.review.comments) || [] } }; });
  const addVersionFromVideo = async (vobj, name) => {
    setVersions((arr) => {
      const label = "v" + (arr.length + 1);
      const v = { id: uid(), label, name: name || label, type: vobj.type, key: vobj.key || "", url: vobj.url || "", uid: vobj.uid || "", hls: vobj.hls || "", ready: vobj.type === "stream" ? !!vobj.ready : true, createdAt: Date.now(), createdBy: (user && user.name) || "ディレクター" };
      // 素材管理の「確認用動画」にもミラー（DLは元のR2マスター）
      setAssets((as) => [newAsset("確認用動画", { type: vobj.type === "youtube" ? "youtube" : "mp4", key: vobj.key || "", url: vobj.url || "", name: v.name, versionId: v.id }), ...as]);
      return [...arr, v];
    });
  };
  /* Stream変換状況をポーリングして hls を埋める */
  const pollStreamReady = async (sid, tries = 0) => {
    if (tries > 80) return; // 約7分で打ち切り
    try {
      const r = await fetch(SHARE_API + "/api/stream/" + sid);
      const d = await r.json();
      if (d.ready && d.hls) { setVersions((arr) => arr.map((x) => (x.uid === sid ? { ...x, ready: true, hls: d.hls, pct: 100 } : x))); return; }
      setVersions((arr) => arr.map((x) => (x.uid === sid ? { ...x, pct: d.pct || x.pct } : x)));
    } catch (e) {}
    setTimeout(() => pollStreamReady(sid, tries + 1), 5000);
  };
  const uploadVersionVideo = async (file, onProgress = null) => {
    if (!project.shareId) { showToast("先に確認用URLを発行してね"); return; }
    if (!/^video\//.test(file.type) && !/\.(mp4|mov|m4v|webm)$/i.test(file.name)) { showToast("動画ファイルを選んでね"); return; }
    setMediaBusy("動画をアップロード中…"); setMediaProg(0);
    try {
      const meta = await uploadToR2(file, "", onProgress);
      // Streamへ取り込み（自動で軽量化）。無効/失敗ならR2直再生にフォールバック
      let v = null;
      try {
        const r = await fetch(SHARE_API + "/api/stream/copy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ snap: project.shareId, token: project.shareToken, key: meta.key, name: file.name }) });
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
    await addVersionFromVideo({ type: "youtube", url: "https://www.youtube.com/watch?v=" + vid }, "YouTube版");
    showToast("バージョンを追加したよ");
  };
  const removeVersion = async (vid) => {
    const v = reviewVersions().find((x) => x.id === vid);
    setVersions((arr) => arr.filter((x) => x.id !== vid));
    setAssets((as) => as.filter((a) => a.versionId !== vid));
    if (v && v.key) { try { await fetch(SHARE_API + "/api/file/" + v.key + "?snap=" + project.shareId + "&token=" + encodeURIComponent(project.shareToken), { method: "DELETE" }); } catch (e) {} }
    if (v && v.uid) { try { await fetch(SHARE_API + "/api/stream/" + v.uid + "?snap=" + project.shareId + "&token=" + encodeURIComponent(project.shareToken), { method: "DELETE" }); } catch (e) {} }
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

  const { tcs, clocks, totalEst, totalTarget, totalChars, locations, sceneNos, sceneLocDone } = useMemo(() => {
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
    return { tcs, clocks, totalEst: acc, totalTarget: tt, totalChars: tc, locations, sceneNos, sceneLocDone };
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
    const lines = [["順番", "予定時刻", "ロケーション", "住所", "シーン数", "想定尺", "メモ"].join("\t")];
    locations.forEach((loc, i) => {
      lines.push([i + 1, esc(loc.time), esc(loc.label), esc(loc.address), loc.scenes.length, fmtJP(loc.dur), esc(loc.note)].join("\t"));
    });
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      showToast("香盤表をコピーしました");
    } catch { showToast("コピーに失敗しました"); }
  };

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
  const cardHead = (label) => (
    <div className="px-4 py-2 flex items-center gap-2 border-b border-stone-100">
      <span className="w-1.5 h-4 rounded-full" style={{ background: theme.accent }} />
      <h2 className="text-[12px] font-bold tracking-wider text-stone-600">{label}</h2>
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
          width: 248,
          background: "#15181D",
          color: "#fff",
          transform: sidebarOpen ? "translateX(0)" : "translateX(-248px)",
          transition: "transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
          willChange: "transform",
        }}>
        <div className="px-3 py-2.5 border-b border-white/10">
          <button onClick={() => setView("home")} title="ホーム（チャンネル一覧）へ"
            className="w-full flex items-center gap-2 px-1.5 py-1 rounded-lg hover:bg-white/10 transition-colors">
            <img src="icon-192.png" alt="" className="w-7 h-7 rounded-lg shrink-0" />
            <span className="font-black tracking-[0.08em] text-[14px]">ものがたりっち！</span>
            <svg className="w-4 h-4 ml-auto text-white/40 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>
          </button>
        </div>
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
        <div className="px-3 pb-2">
          <button onClick={() => { setImportTarget("new"); setImportFileName(""); setFullImportText(""); setShowFullImport(true); }}
            title="JSON / 構成台本コピー / TXT・CSV・Excel から取り込み（新規 or 現案件更新）"
            className="w-full inline-flex items-center justify-center gap-1 text-[11px] font-bold py-2 rounded-lg bg-white/10 hover:bg-white/20">
            <Icon name="download" className="w-4 h-4" /> 構成台本を取り込み
          </button>
        </div>

        {/* チャンネル名サジェスト用 */}
        <datalist id="mg-channels">
          {channelOptions.map((c) => <option key={c} value={c} />)}
        </datalist>

        {/* ===== チャンネル → 案件 ネスト ===== */}
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {channelGroups.map(({ channel, items }) => {
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
                    {channel !== DEFAULT_CHANNEL && (<>
                      <button title="フォルダを上へ" onClick={(e) => { e.stopPropagation(); moveChannel(channel, -1); }} className="w-5 h-5 grid place-items-center rounded hover:bg-white/20"><Icon name="up" className="w-3 h-3" /></button>
                      <button title="フォルダを下へ" onClick={(e) => { e.stopPropagation(); moveChannel(channel, 1); }} className="w-5 h-5 grid place-items-center rounded hover:bg-white/20"><Icon name="down" className="w-3 h-3" /></button>
                    </>)}
                    <button title="このチャンネルに案件を追加（タイプ選択）" onClick={(e) => { e.stopPropagation(); setAddMenu({ channel, x: e.clientX, y: e.clientY }); }} className="w-5 h-5 grid place-items-center rounded hover:bg-white/20">{<Icon name="plus" className="w-3.5 h-3.5" />}</button>
                    <button title={channel === DEFAULT_CHANNEL ? "このフォルダに名前を付ける（クライアント名など）" : "フォルダ名を変更"} onClick={(e) => { e.stopPropagation(); renameChannel(channel); }} className="w-5 h-5 grid place-items-center rounded hover:bg-white/20 text-[10px]">✎</button>
                  </div>
                </div>

                {/* 案件リスト */}
                {!isCollapsed && items.map((p) => {
                  const active = p.id === activeId;
                  return (
                    <div key={p.id}
                      className={"group/p rounded-lg mb-0.5 ml-3 pl-2.5 pr-2 py-1.5 cursor-pointer transition-colors border-l border-white/10 " + (active ? "" : "hover:bg-white/5")}
                      style={active ? { background: "rgba(255,255,255,0.12)" } : {}}
                      onClick={() => switchProject(p.id)}>
                      <div className="flex items-center gap-2">
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
                        <div className="flex gap-0.5 opacity-0 group-hover/p:opacity-100 transition-opacity shrink-0">
                          <button title="チャンネル（フォルダ）を移動" onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setChanMenu({ id: p.id, channel: p.channel || DEFAULT_CHANNEL, x: r.left, y: r.bottom + 4 }); }} className="w-5 h-5 grid place-items-center rounded hover:bg-white/20">
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>
                          </button>
                          <button title="この案件を上へ（同じフォルダ内）" onClick={(e) => { e.stopPropagation(); moveCaseInChannel(p.id, -1); }} className="w-5 h-5 grid place-items-center rounded hover:bg-white/20"><Icon name="up" className="w-3 h-3" /></button>
                          <button title="この案件を下へ（同じフォルダ内）" onClick={(e) => { e.stopPropagation(); moveCaseInChannel(p.id, 1); }} className="w-5 h-5 grid place-items-center rounded hover:bg-white/20"><Icon name="down" className="w-3 h-3" /></button>
                          <button title="名前変更" onClick={(e) => { e.stopPropagation(); setRenamingId(p.id); }} className="w-5 h-5 grid place-items-center rounded hover:bg-white/20 text-[10px]">✎</button>
                          <button title="複製" onClick={(e) => { e.stopPropagation(); duplicateProject(p.id); }} className="w-5 h-5 grid place-items-center rounded hover:bg-white/20 text-[10px]">⎘</button>
                          <button title="削除" onClick={(e) => { e.stopPropagation(); deleteProject(p.id); }} className="w-5 h-5 grid place-items-center rounded hover:bg-red-500/40"><Icon name="trash" className="w-3 h-3" /></button>
                        </div>
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
        <div className="px-3 py-2 border-t border-white/10 text-[10px] text-white/40">
          {index.length}件の案件・自動保存
        </div>
      </aside>

      {/* サイドバー開閉オーバーレイ（モバイル・フェード） */}
      <div
        className={"fixed inset-0 z-30 bg-black/40 sm:hidden transition-opacity duration-300 ease-out " + (sidebarOpen ? "opacity-100" : "opacity-0 pointer-events-none")}
        onClick={() => setSidebarOpen(false)} />

      {/* ===== コンテンツ（サイドバー分シフト） ===== */}
      <div className="pb-28" style={{ marginLeft: sidebarOpen && !isNarrow ? 248 : 0, transition: "margin-left 0.3s cubic-bezier(0.22, 1, 0.36, 1)" }}>

      {/* ===== ツールバー ===== */}
      <header className="sticky top-0 z-20 shadow-lg" style={{ background: theme.main, color: mainText }}>
        <div className="max-w-[1500px] mx-auto px-3 sm:px-4 pt-2.5 pb-1.5 flex items-center gap-2 sm:gap-3 flex-wrap">
          <button onClick={() => setSidebarOpen((s) => !s)} title="案件リスト"
            className="w-8 h-8 rounded-lg grid place-items-center border border-white/20 hover:bg-white/10 shrink-0">
            <Icon name="menu" className="w-[18px] h-[18px]" />
          </button>
          <input
            value={project.name}
            onChange={(e) => renameProject(project.id, e.target.value)}
            className="bg-transparent font-bold tracking-wide text-[14px] focus:outline-none focus:bg-white/10 rounded px-1.5 py-1 min-w-0 max-w-[200px]"
            style={{ color: mainText }}
            title="案件名（クリックで編集）"
          />
          {/* カテゴリ（クライアント／チャンネル）— クリックで変更 */}
          {editHeaderChannel ? (
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
          <div className="flex items-baseline gap-1.5 px-2.5 sm:px-3 py-1 rounded-lg" style={{ background: "rgba(0,0,0,0.25)", fontFamily: mono }}>
            <span className="text-[9px] tracking-widest opacity-60">TOTAL</span>
            <span className="text-base sm:text-xl font-bold tabular-nums leading-none">{fmt(totalEst)}</span>
            <span className="hidden sm:inline text-[10px] opacity-50">{totalChars.toLocaleString()}字</span>
            <span className="hidden sm:inline text-[10px] tabular-nums opacity-50 ml-1 pl-1.5 border-l border-white/20" title="各シーンの秒数の合計（シーン尺）">シーン {fmt(totalTarget)}</span>
          </div>
          <label className="flex items-center gap-1 text-[11px] opacity-80">
            <input type="number" min="3" max="8" step="0.5" value={project.rate}
              onChange={(e) => setProject((p) => ({ ...p, rate: Number(e.target.value) || 5 }))}
              className="w-11 sm:w-12 bg-black/25 border border-white/20 rounded-md px-1 sm:px-1.5 py-1 text-center focus:outline-none focus:border-white/60"
              style={{ fontFamily: mono, color: mainText }} />
            <span className="hidden sm:inline">字/秒</span>
          </label>
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
              <div className="absolute right-0 top-full mt-1 z-50 w-60 bg-white rounded-xl shadow-2xl border border-stone-200 overflow-hidden text-stone-700">
                <div className="px-3 pt-2 pb-1 text-[10px] font-bold tracking-wider text-stone-400">確認用URLをコピー（読み取り専用）</div>
                {TAB_SHARE_PANE[tab] && (
                  <button onClick={() => { setShareMenu(false); copyShareUrl(tab); }} className="w-full text-left px-3 py-2.5 hover:bg-stone-50 text-[12px] font-bold flex items-center gap-2">
                    <Icon name="folder" className="w-4 h-4 shrink-0 text-stone-500" />
                    このタブだけ共有<span className="text-[10px] text-stone-400 font-normal ml-auto truncate max-w-[80px]">{TAB_LABEL[tab]}</span>
                  </button>
                )}
                <button onClick={() => { setShareMenu(false); copyShareUrl(); }} className="w-full text-left px-3 py-2.5 hover:bg-stone-50 text-[12px] font-bold flex items-center gap-2 border-b border-stone-100">
                  <Icon name="share" className="w-4 h-4 shrink-0 text-stone-500" />
                  案件まるごと共有<span className="text-[10px] text-stone-400 font-normal ml-auto">全タブ見れる</span>
                </button>
                <button onClick={() => { setShareMenu(false); publishShare(); }} className="w-full text-left px-3 py-2.5 hover:bg-stone-50 text-[12px] font-bold flex items-center gap-2 border-b border-stone-100">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></svg>
                  {project.shareId ? "確認用リンクを最新に更新" : "確認用リンクを発行"}<span className="text-[10px] text-stone-400 font-normal ml-auto">読み取り専用</span>
                </button>
                <button onClick={() => { setShareMenu(false); publishShareLive(); }} className="w-full text-left px-3 py-2.5 hover:bg-stone-50 text-[12px] font-bold flex items-center gap-2 border-b border-stone-100">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                  {project.liveId ? "編集用リンクを更新" : "編集用リンクを発行"}<span className="text-[10px] text-stone-400 font-normal ml-auto">同時編集</span>
                </button>
                <button onClick={() => { setShareMenu(false); setShowMediaModal(true); }} className="w-full text-left px-3 py-2.5 hover:bg-stone-50 text-[12px] font-bold flex items-center gap-2 border-b border-stone-100">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m22 8-6 4 6 4V8Z" /><rect x="2" y="6" width="14" height="12" rx="2" /></svg>
                  動画確認・ファイル転送
                </button>
                <button onClick={() => { setShareMenu(false); (project.format === "talk" ? exportTalkText : exportScriptTSV)(); }} className="w-full text-left px-3 py-2.5 hover:bg-stone-50 text-[12px] font-bold flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 012-2h10" /></svg>
                  台本コピー{project.format === "talk" ? "（テキスト）" : "（TSV）"}
                </button>
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
          {[["overview", "note", "概要", "概要"], ["plan", "image", "企画・サムネ", "企画"], ["script", "file", "構成台本", "台本"], ...(project.format === "talk" ? [] : [["kouban", "map", "香盤表", "香盤"]]), ["assets", "folder", "素材管理", "素材"], ["review", "video", "動画確認", "動画"], ["concept", "user", "チャンネル", "CH"]].map(([k, ic, label, short]) => (
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

        {/* ================= チャンネルコンセプトタブ ================= */}
        {tab === "concept" && (
          <div className="max-w-[1000px] mx-auto">
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

        {/* ================= 全案件 横断検索バー（本編上部） ================= */}
        {tab === "script" && (
          <div className="relative mb-3 max-w-[900px] mx-auto">
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
        )}

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
              {cardHead("ハイライト（冒頭フック）")}
              <ScriptCell value={m.highlight} onChange={(v) => setMeta("highlight", v)} accent={theme.accent} placeholder="冒頭フックの原稿・テロップ案など（空行でEnter → ◼︎ 自動挿入）" />
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
                          {!isNarrow && (
                          <td className="pt-2 align-middle">
                            <div className={"flex items-center justify-end gap-0.5 pr-2 transition-opacity " + (hoverId === r.id ? "opacity-100" : "opacity-0")}>
                              <button className={opBtn} title="上へ" onClick={() => moveRow(idx, -1)}><Icon name="up" className="w-3.5 h-3.5" /></button>
                              <button className={opBtn} title="下へ" onClick={() => moveRow(idx, 1)}><Icon name="down" className="w-3.5 h-3.5" /></button>
                              <button className={opBtn} title="下にシーンを追加" onClick={() => insertBelow(idx, newScene("解説系"))}><Icon name="plus" className="w-3.5 h-3.5" /></button>
                              <button className={opBtn + " hover:bg-red-100 hover:text-red-500"} title="削除" onClick={() => deleteRow(r.id)}><Icon name="trash" className="w-3.5 h-3.5" /></button>
                            </div>
                          </td>
                          )}
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
                              className={"shrink-0 w-6 h-6 grid place-items-center rounded-md transition-colors " + (r.done ? "bg-emerald-500 text-white" : "bg-stone-100 text-stone-400 hover:bg-stone-200")}>
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
                        {!isNarrow && (
                        <td className="align-top py-1.5 pr-2">
                          <div className={"flex items-center justify-end gap-0.5 transition-opacity " + (hoverId === r.id ? "opacity-100" : "opacity-0")}>
                            <button className={opBtn} title="上へ" onClick={() => moveRow(idx, -1)}><Icon name="up" className="w-3.5 h-3.5" /></button>
                            <button className={opBtn} title="下へ" onClick={() => moveRow(idx, 1)}><Icon name="down" className="w-3.5 h-3.5" /></button>
                            <button className={opBtn} title="下に行を追加" onClick={() => insertBelow(idx, newScene(r.type))}><Icon name="plus" className="w-3.5 h-3.5" /></button>
                            <button className={opBtn + " hover:bg-red-100 hover:text-red-500"} title="削除" onClick={() => deleteRow(r.id)}><Icon name="trash" className="w-3.5 h-3.5" /></button>
                          </div>
                        </td>
                        )}
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
                        className={"shrink-0 w-6 h-6 grid place-items-center rounded-md transition-colors " + (r.done ? "bg-emerald-500 text-white" : "bg-stone-100 text-stone-400")}>
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
                  {m.shootDate || "撮影日未設定"}・{locations.length}ロケーション・本編想定 {fmt(totalEst)}・シーン尺 {fmt(totalTarget)}
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

                    {/* 右：ロケーションカード */}
                    <div className={"relative flex-1 min-w-0 mb-3 rounded-xl border overflow-visible transition-all duration-200 " + (loc.done ? "border-stone-200 bg-stone-100 opacity-60" : (loc.peak ? "border-2 bg-white shadow-md" : "border-stone-200 bg-white shadow-sm"))}
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
                ))}
              </div>
            </section>
            <p className="text-[11px] text-stone-400 leading-relaxed">
              時刻・住所・メモはこの画面で入力（構成台本と自動で連動）　／　↑↓でロケーションごと順番を入れ替え（配下のシーンも一緒に動きます）　／　右上のボタンで香盤表だけをスプシ用にコピーできます
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

        {/* ================= 概要タブ（案件の入口・現在地） ================= */}
        {tab === "overview" && (
          <div className="max-w-[820px] mx-auto px-1 sm:px-0 py-1 space-y-4">
            {/* 現在地：ステータス */}
            <div className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <h2 className="text-[14px] font-bold text-stone-800">いまの状態</h2>
                <span className="text-[11px] text-stone-400">最終更新 {project.updatedAt ? new Date(project.updatedAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</span>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-4">
                {STATUSES.map((s) => {
                  const on = (project.status || "未着手") === s; const col = STATUS_COLOR[s];
                  return (
                    <button key={s} onClick={() => setProject((p) => ({ ...p, status: s }))}
                      className={"px-3 py-1.5 rounded-full text-[12px] font-bold transition-all " + (on ? "ring-2 ring-offset-1" : "opacity-60 hover:opacity-100")}
                      style={{ background: col.bg, color: col.fg, ...(on ? { boxShadow: "0 0 0 2px " + col.fg } : {}) }}>{s}</button>
                  );
                })}
              </div>
              <label className="block mb-3">
                <span className="text-[11px] font-bold text-stone-500">次にやること</span>
                <input value={project.nextAction || ""} onChange={(e) => setProject((p) => ({ ...p, nextAction: e.target.value }))}
                  placeholder="例：参考動画を追加 / 撮影素材をアップロード / 初稿を確認 …"
                  className="mt-1 w-full text-[13px] border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-400" />
              </label>
              <label className="block">
                <span className="text-[11px] font-bold text-stone-500">締切</span>
                <input type="date" value={project.deadline || ""} onChange={(e) => setProject((p) => ({ ...p, deadline: e.target.value }))}
                  className="mt-1 block text-[13px] border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-400" />
              </label>
            </div>
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
          <div className="max-w-[920px] mx-auto px-1 sm:px-0 py-1">
            <p className="text-[12px] text-stone-500 mb-3">撮影素材とテンプレ素材を<span className="font-bold">この案件に一元管理</span>。確認用動画は「動画確認」タブで管理します。</p>
            {!project.shareId && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-[12px] text-amber-800 mb-3">
                ファイルを上げるには先に<span className="font-bold">確認用URLの発行</span>が必要です（保存先R2の確保のため）。
                <button onClick={() => publishShare()} className="ml-2 text-[11px] font-bold px-3 py-1 rounded-lg shadow" style={{ background: theme.accent, color: accentText }}>確認用URLを発行</button>
              </div>
            )}
            <div className="space-y-4">
              {ASSET_CATEGORIES.map((cat) => {
                const items = (project.assets || []).filter((a) => a.category === cat);
                const uping = assetUp && assetUp.cat === cat;
                return (
                  <section key={cat} className="rounded-2xl border border-stone-200 bg-white p-4">
                    <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                      <h3 className="text-[13px] font-bold text-stone-800">{ASSET_CAT_ICON[cat]} {cat} <span className="text-stone-400 font-normal">{items.length}</span></h3>
                      <label className={"text-[11px] font-bold px-2.5 py-1.5 rounded-lg shadow cursor-pointer " + (project.shareId ? "" : "opacity-40 pointer-events-none")} style={{ background: theme.main, color: "#fff" }}>
                        ＋ファイル
                        <input type="file" multiple className="hidden" onChange={(e) => { const fs = Array.from(e.target.files || []); fs.forEach((f) => uploadAsset(f, cat)); e.target.value = ""; }} />
                      </label>
                    </div>
                    <p className="text-[10px] text-stone-400 mb-2">{ASSET_CAT_DESC[cat]}</p>
                    {uping && (
                      <div className="mb-2 rounded-lg bg-stone-50 border border-stone-200 px-3 py-2">
                        <div className="text-[11px] text-stone-600 flex items-center gap-2"><span className="truncate flex-1">⬆ {assetUp.name}</span><span className="font-bold tabular-nums">{assetUp.pct}%</span></div>
                        <div className="mt-1 h-1.5 bg-stone-200 rounded overflow-hidden"><div className="h-full transition-all" style={{ width: assetUp.pct + "%", background: theme.accent }} /></div>
                      </div>
                    )}
                    {items.length === 0 ? (
                      <p className="text-[11px] text-stone-400 py-2">{uping ? "" : "まだありません"}</p>
                    ) : (
                      <ul className="divide-y divide-stone-100">
                        {items.map((a) => (
                          <li key={a.id} className="flex items-center gap-2 py-2 text-[12px]">
                            <span className="shrink-0">{a.type === "youtube" ? "▶️" : a.type === "mp4" ? "🎬" : "📄"}</span>
                            <a href={assetUrl(a)} target="_blank" rel="noreferrer" className="flex-1 min-w-0 truncate text-stone-700 hover:underline">{a.name || "(無題)"}</a>
                            {a.size ? <span className="shrink-0 text-stone-400">{fmtSize(a.size)}</span> : null}
                            <select value={a.category} onChange={(e) => moveAsset(a.id, e.target.value)} className="shrink-0 border border-stone-200 rounded px-1 py-0.5 text-[10px] text-stone-500">
                              {ASSET_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <button onClick={() => { if (window.confirm("この素材を削除しますか？")) removeAsset(a.id); }} className="shrink-0 text-stone-300 hover:text-rose-500"><Icon name="trash" className="w-4 h-4" /></button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>
            {mediaBusy && <div className="mt-3 text-[12px] text-stone-500">{mediaBusy} {mediaProg ? mediaProg + "%" : ""}</div>}
          </div>
        )}

        {/* ================= 動画確認タブ（Frame.io型 修正管理＋バージョン） ================= */}
        {tab === "review" && (() => {
          const evs = reviewVersions().length ? reviewVersions()
            : (project.assets || []).filter((a) => a.category === "確認用動画").map((a, i) => ({ id: a.id, label: "v" + (i + 1), name: a.name, type: a.type, key: a.key, url: a.url, createdAt: a.createdAt }));
          return (
          <div className="max-w-5xl mx-auto px-1 sm:px-0 py-2">
            <div className="mb-3 flex items-end justify-between gap-2 flex-wrap">
              <div>
                <h2 className="text-[15px] font-bold text-stone-800">動画確認（試写・修正管理）</h2>
                <p className="text-[12px] text-stone-500 mt-0.5">初稿/修正版をバージョン管理。止めた位置に修正コメント（カテゴリ・優先度・ステータス・返信）。OKが出たらそれが納品。</p>
              </div>
              <button onClick={() => copyShareUrl("review")} disabled={sharing}
                className="text-[11px] font-bold px-3 py-2 rounded-lg shadow shrink-0 inline-flex items-center gap-1.5 text-white disabled:opacity-50" style={{ background: theme.accent, color: accentText }}>
                <Icon name="share" className="w-3.5 h-3.5" />{project.shareId ? "クライアント確認URLをコピー" : "確認用URLを発行してコピー"}
              </button>
            </div>
            <ReviewBoard
              versions={evs} comments={comments} main={theme.main} accent={theme.accent} accentText={accentText}
              busy={mediaBusy} prog={mediaProg} userName={(user && user.name) || "ディレクター"}
              onUploadVideo={(f) => uploadVersionVideo(f)} onAddYouTube={(u) => addVersionYouTube(u)}
              onRemoveVersion={(id) => removeVersion(id)} onRenameVersion={(id, n) => renameVersion(id, n)}
              onPost={(b) => postReviewComment(b)} onUpdate={(cid, p) => updateComment(cid, p)} onReply={(cid, t) => addCommentReply(cid, t)} onDelete={(cid) => deleteComment(cid)} />
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
              {manualScope === "global" && <ManualPanel entries={globalManuals} onChange={saveGlobalManuals} main={theme.main} accent={theme.accent} />}
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
            <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-2">
              <img src="icon-192.png" alt="" className="w-8 h-8 rounded-lg" />
              <span className="font-black tracking-[0.08em] text-[15px]">ものがたりっち！</span>
              <div className="flex-1" />
              <button onClick={() => setShowAccount(true)} title={user ? user.name : "ログイン"}
                className="h-8 px-3 rounded-lg inline-flex items-center gap-1.5 text-[11px] font-bold border border-white/20 hover:bg-white/10">
                {user && user.picture ? <img src={user.picture} alt="" className="w-5 h-5 rounded-full" referrerPolicy="no-referrer" /> : <Icon name="user" className="w-4 h-4" />}
                <span className="max-w-[120px] truncate">{user ? user.name : "ログイン"}</span>
              </button>
            </div>
          </header>
          <main className="max-w-3xl mx-auto px-4 py-7">
            {!user && (
              <div className="mb-5 text-[12px] text-stone-600 bg-white border border-stone-200 rounded-xl px-4 py-3 flex items-start gap-2">
                <Icon name="cloud" className="w-4 h-4 shrink-0 mt-0.5 text-stone-400" />
                <span><span className="font-bold">ログインすると</span>案件がクラウドに保存され、どの端末でも開けます。<button onClick={() => setShowAccount(true)} className="font-bold underline" style={{ color: theme.main }}>ログイン</button></span>
              </div>
            )}
            <div className="flex items-center gap-2 mb-5 flex-wrap">
              <button onClick={(e) => setAddMenu({ channel: DEFAULT_CHANNEL, x: e.clientX, y: e.clientY })}
                className="h-10 px-4 rounded-xl inline-flex items-center gap-1.5 text-[12px] font-bold text-white shadow" style={{ background: theme.accent }}>
                <Icon name="plus" className="w-4 h-4" /> 新規案件
              </button>
              <button onClick={() => { const ch = window.prompt("新しいチャンネル（クライアント）名"); if (ch && ch.trim()) createChannel(ch.trim()); }}
                className="h-10 px-4 rounded-xl inline-flex items-center gap-1.5 text-[12px] font-bold border border-stone-300 bg-white text-stone-600 shadow-sm hover:bg-stone-50">
                <Icon name="folder" className="w-4 h-4" /> チャンネルを追加
              </button>
            </div>

            {/* ===== 作業の入口：今日やること / 確認待ち / 期限が近い / 最近触った ===== */}
            {(() => {
              const { todo, review, due, recent } = homeSections;
              const Section = ({ title, accent, items, empty }) => (
                <div className="mb-5">
                  <div className="text-[12px] font-bold mb-2 flex items-center gap-2" style={{ color: accent || "#57534E" }}>{title}<span className="text-stone-300 font-normal">{items.length}</span></div>
                  {items.length === 0 ? <p className="text-[11px] text-stone-400">{empty}</p> : <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">{items.map(renderCaseCard)}</div>}
                </div>
              );
              const anyWork = todo.length || review.length || due.length || recent.length;
              if (!index.length) return null;
              return (
                <div className="mb-7">
                  {todo.length > 0 && <Section title="📌 今日やること" items={todo} empty="" />}
                  {review.length > 0 && <Section title="👀 確認待ち" accent="#DC2645" items={review} empty="" />}
                  {due.length > 0 && <Section title="⏰ 期限が近い" accent="#D97706" items={due} empty="" />}
                  {recent.length > 0 && <Section title="🕒 最近触った" items={recent} empty="" />}
                  {!anyWork && <p className="text-[12px] text-stone-400 bg-white border border-stone-200 rounded-xl px-4 py-5 text-center">いまは「次にやること」が登録された案件がありません。<br />各案件の<span className="font-bold">概要</span>タブでステータスと次の一手を入れると、ここに並びます。</p>}
                </div>
              );
            })()}

            <div className="text-[11px] font-bold tracking-[0.15em] text-stone-400 mb-2">チャンネル（{channelGroups.length}）</div>
            <div className="space-y-2.5">
              {channelGroups.map(({ channel, items }) => {
                const ci = channelInfo[channel] || {};
                return (
                  <div key={channel} className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm"
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
                          {(ci.concept || ci.target) && <div className="text-[11px] text-stone-500 mt-0.5 line-clamp-1">{ci.concept || ci.target}</div>}
                        </div>
                      </button>
                      <div className="flex gap-1 shrink-0">
                        <button onClick={(e) => setAddMenu({ channel, x: e.clientX, y: e.clientY })} title="この中に案件を追加" className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg border border-stone-200 hover:bg-stone-50 inline-flex items-center gap-1"><Icon name="plus" className="w-3 h-3" />案件</button>
                        {channel !== DEFAULT_CHANNEL && (
                          <button onClick={(e) => setChShareMenu({ channel, x: e.clientX, y: e.clientY })} disabled={chSharing} title="共有リンクを発行（見せる用／編集つきを選べます）" className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg border border-stone-200 hover:bg-stone-50 disabled:opacity-50">共有</button>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2.5">
                      {items.length === 0 && <span className="text-[11px] text-stone-300">案件がありません。「＋案件」から追加</span>}
                      {items.slice(0, 6).map((it) => (
                        <button key={it.id} onClick={() => switchProject(it.id)}
                          className="text-[11px] font-medium text-stone-600 bg-stone-100 hover:bg-stone-200 rounded-lg px-2.5 py-1.5 inline-flex items-center gap-1 max-w-[200px]">
                          {it.collab && <Icon name="user" className="w-3 h-3 shrink-0 text-stone-400" />}
                          <span className="truncate">{it.name}</span>
                        </button>
                      ))}
                      {items.length > 6 && <button onClick={() => openChannel(channel)} className="text-[11px] font-bold text-stone-400 hover:text-stone-600 px-2 py-1.5">他{items.length - 6}件 →</button>}
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
              <h3 className="text-sm font-bold tracking-wider">{(shareModal.live ? "編集用リンクを" : shareModal.planShare ? "企画の試写リンクを" : shareModal.channel ? "チャンネル共有リンクを" : "共有リンクを") + (shareModal.updated ? "更新しました" : "発行しました")}</h3>
              <button onClick={() => setShareModal(null)} className="w-7 h-7 rounded-lg grid place-items-center hover:bg-white/15"><Icon name="close" className="w-4 h-4" /></button>
            </div>
            <div className="p-5">
              <p className="text-[12px] text-stone-500 mb-2">
                {shareModal.live
                  ? <>このURLを渡すと、先方が<span className="font-bold">構成台本をその場で編集</span>できます（リアルタイム同時編集・ログイン不要）。あなたもこのリンクを開けば一緒に編集できます。<span className="font-bold text-rose-500">編集できる人全員に渡るので取り扱い注意。</span></>
                  : shareModal.planShare
                  ? <>このURLは<span className="font-bold">この企画の動画・素材・コメントだけ</span>の専用ページです。先方は動画を見て（0.5〜4倍速）、時間を指定してコメントできます。コメントは右上💬とアプリ内の企画カードに届きます。</>
                  : shareModal.channel && shareModal.editable
                  ? <>このURLで<span className="font-bold">チャンネルの全{shareModal.caseCount || 0}案件を先方がその場で編集</span>できます（企画・サムネ・構成台本すべて／ログイン不要／リアルタイム反映）。各案件を開いて「編集」から直せます。<span className="font-bold text-rose-500">編集できる人全員に渡るので取り扱い注意。</span>他のチャンネルは見えません。</>
                  : shareModal.channel
                  ? <>このURLで<span className="font-bold">チャンネルのコンセプト＋配下の{shareModal.caseCount || 0}案件</span>をまとめて見せられます（読み取り専用）。チーム共有やクライアント説明用に。</>
                  : <>このURLを先方に送ってください。<span className="font-bold">構成台本（読み取り専用）</span>が開き、各シーンにコメント・修正依頼を書き込めます。書き込まれたコメントは右上のコメントボタンに届きます。</>}
              </p>
              <div className="flex items-center gap-2 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2">
                <input readOnly value={shareModal.url} className="flex-1 min-w-0 bg-transparent text-[12px] focus:outline-none" style={{ fontFamily: mono }}
                  onFocus={(e) => e.target.select()} />
                <button onClick={async () => { try { await navigator.clipboard.writeText(shareModal.url); showToast("URLをコピーしました"); } catch (e) {} }}
                  className="text-[11px] font-bold px-3 py-1.5 rounded-md shadow shrink-0" style={{ background: theme.accent, color: accentText }}>コピー</button>
              </div>
              <div className="mt-3 flex justify-between items-center">
                <a href={shareModal.url} target="_blank" rel="noreferrer" className="text-[11px] font-bold underline" style={{ color: theme.main }}>プレビューを開く ↗</a>
                <span className="text-[10px] text-stone-400">内容を直したら「共有を更新」で同じURLに反映されます</span>
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
    </div>
  );
}
