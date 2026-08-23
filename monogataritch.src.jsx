import React, { useState, useEffect, useRef, useMemo, useCallback, startTransition } from "react";
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Panel, useReactFlow, BackgroundVariant, Handle, Position, applyNodeChanges, NodeResizeControl, ResizeControlVariant } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { buildStyledRuns, toggleInlineMarker } from "./src/inline-format.js";

/* ============================================================
   ものがたりっち！ — 一日密着ドキュメンタリー構成ツール
   v4: 構成台本 + 香盤表 / 時間表記切替 / テーマカラー変更
   ============================================================ */

/* シーン種別の色トークン（2026-08-23 AK仕様「白を主役にした淡い色分け」）。
   color=ピル文字 / bg=ピル背景 / borderColor=ピル枠・罫線 / dot=ドット＆カード左線 / card=カード極薄背景。
   本文・見出しには種別色を使わない（色は分類のため、重要度のためには使わない） */
const SECTION_TYPES = {
  "インサート": { full: "インサート（3~5秒）",   target: 5,   color: "#D94D4D", bg: "#FFF0F0", borderColor: "#F6CCCC", dot: "#EB5D5D", card: "#FFF7F7" },
  "ブリッジ":   { full: "ブリッジ（5~10秒）",    target: 10,  color: "#B58A16", bg: "#FFF8D8", borderColor: "#F2E3A6", dot: "#DBAF32", card: "#FFFDF4" },
  "VLOG":      { full: "VLOG（15~30秒）",       target: 30,  color: "#D8762B", bg: "#FFF2E5", borderColor: "#F7D6B6", dot: "#ED8D43", card: "#FFF9F3" },
  "解説系":     { full: "解説系（30秒~1分）",    target: 60,  color: "#3277D4", bg: "#EAF3FF", borderColor: "#CFE1FA", dot: "#4A91EB", card: "#F5F9FF" },
  "訴求":      { full: "訴求（2~3分）",         target: 180, color: "#348C53", bg: "#EAF8EE", borderColor: "#CBEBD5", dot: "#4CAF6B", card: "#F5FBF7" },
};
const TYPE_KEYS = Object.keys(SECTION_TYPES);

const uid = () => Math.random().toString(36).slice(2, 10);
const newScene = (type = "解説系", label = "") => ({ id: uid(), kind: "scene", label, type, sec: null, tc: null, script: "" });
const newLocation = (name = "") => ({ id: uid(), kind: "location", label: name, address: "", time: "", note: "", travelBy: "", travelCost: null });
/* ロケの撮影日（1=1日目）。未設定は1日目扱い（既存データ互換） */
const dayOf = (r) => { const d = Number(r && r.day); return Number.isFinite(d) && d >= 1 ? Math.floor(d) : 1; };
/* ロケ名先頭の撮影日マーカーを抽出。「2日目」「【2日目】品川駅」「2日目：東京」「DAY2 会場」→ {day, rest}。
   「2日目の振り返り」のような普通の語は区切り文字が無いので拾わない。無ければ null */
const parseDayMarker = (s) => {
  const t = (s || "").trim();
  const m = t.match(/^[【\[（(]\s*(?:DAY\s*(\d+)|(\d+)\s*日目)\s*[】\]）)]\s*[:：・、\/／\-—]?\s*(.*)$/i)
    || t.match(/^(?:DAY\s*(\d+)|(\d+)\s*日目)(?:[\s:：・、\/／\-—]+|$)(.*)$/i);
  if (!m) return null;
  const day = Number(m[1] || m[2]);
  if (!(day >= 1)) return null;
  return { day: Math.floor(day), rest: (m[3] || "").trim() };
};

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
/* 離脱時にまだ書けていなかった案件の退避先（1案件ぶんだけ持つ）。次回ロードで本体より新しければ復元する。
   自動保存は3秒デバウンス＋クラウド往復なので、直前の打鍵は「まだどこにも無い」瞬間が必ずある。 */
const UNSAVED_KEY = "mg:unsaved-v1";
/* 変更履歴。案件本体とは別キーに置く＝本体を太らせない（本体は素材やサムネのdataURLで既に重い）。
   「直したのに前の値に戻ってる」が起きた時に、いつ何が何から何へ変わったかを後から追えるようにする。 */
const STORE_HIST = (id) => "monogataritch-hist-" + id;
const HIST_MAX = 300;
/* 履歴を取る対象のフラット化。key＝安定した識別子（行はid基準なので並べ替えでズレない） */
const histSnapshot = (p) => {
  const o = {};
  if (!p) return o;
  const put = (k, label, v) => { o[k] = { label, v: v == null ? "" : String(v) }; };
  put("name", "案件名", p.name);
  const plans = p.plans || [];
  plans.forEach((pl, i) => {
    const sfx = plans.length > 1 ? "（企画案" + (i + 1) + "）" : "";
    put("plan" + i + ".title", "タイトル" + sfx, pl.title);
    put("plan" + i + ".thumbText", "サムネ文言①" + sfx, pl.thumbText);
    put("plan" + i + ".thumbText2", "サムネ文言②" + sfx, pl.thumbText2);
  });
  put("meta.highlight", "ハイライト（冒頭フック）", (p.meta || {}).highlight);
  (p.rows || []).forEach((r) => {
    if (!r || !r.id) return;
    const nm = (r.label || "").trim();
    const tag = nm ? "（" + (nm.length > 18 ? nm.slice(0, 18) + "…" : nm) + "）" : "";
    if (r.kind === "location") { put("row." + r.id + ".label", "ロケ名" + tag, r.label); return; }
    put("row." + r.id + ".label", "内容" + tag, r.label);
    put("row." + r.id + ".script", "原稿" + tag, r.script);
  });
  return o;
};
const emptyChannelInfo = () => ({ name: "", url: "", concept: "", target: "", purpose: "", competitors: [], icon: "", clientNotes: "", manuals: [], promanUrl: "", manualUrl: "", checklistUrl: "" });
/* チャンネルアイコンに選べる絵文字 */
const CHANNEL_ICONS = ["📁","🎬","🎥","🎙️","🎤","📺","🎮","📷","🎨","💡","🔥","⭐","🚀","💼","🏆","⚽","🏀","🍳","💪","🐦","🐱","🐶","🌸","🌙","🎯","💰","📚","🧠","❤️","✨","🎸","🍜","🧳","👑","🛠️","🌍"];
const emptyCompetitor = () => ({ url: "", vid: "", name: "", subs: 0, note: "" });

/* 共有＋コメント Worker。localStorage("mg:shareApi") で上書き可（ローカル検証用） */
const SHARE_API = (() => {
  try { const o = localStorage.getItem("mg:shareApi"); if (o) return o.replace(/\/$/, ""); } catch (e) {}
  return "https://mg-share.aki-surf89315.workers.dev";
})();
const shareUrl = (id, r) => location.origin + location.pathname.replace(/[^/]*$/, "") + "share.html?id=" + id + (r ? "&r=" + encodeURIComponent(r) : "");
/* 編集用リンク（?live=）に &tab=script が付いていたら、そのタブだけ触らせる。
   ※UI上の絞り込み＝相手にどこを直してほしいか迷わせないためのもの。トークン自体は文書全体の編集権を持つ */
const LIVE_ONLY_TABS = (() => {
  try {
    const sp = new URLSearchParams(location.search);
    if (!sp.get("live") && !sp.get("ch")) return null;
    const raw = (sp.get("tabs") || sp.get("tab") || "").split(",").map((s) => s.trim()).filter(Boolean);
    return raw.length ? raw : null;
  } catch (e) { return null; }
})();

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
  if (!res.ok) {
    let d = null; try { d = await res.json(); } catch (_) {}
    const e = new Error((d && d.error) || "通信エラー");
    e.code = res.status; e.data = d;   // 409競合など、呼び出し側がボディを使えるように添付
    throw e;
  }
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
  { id: "editor", emoji: "✂️", label: "編集者へ", tabs: ["review", "script", "kouban", "assets", "manual"], start: "review", upload: true,
    msg: "{name}、構成・香盤・素材まとめました！編集よろしくお願いします🙏\n完成動画は「動画」タブから直接アップできます（大容量OK）。\n{url}\n\n編集の決め事はページ内の「マニュアル」タブにまとめてあります。初めての方は先に目を通してください。" },
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
  { id: uid(), title: "物語の骨組み（ストーリースパイン）", items:
    STORY_FRAMEWORKS.spine.steps.map((s) => hearingItem(s.n + " " + s.phrase, s.hint)) },
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
      // 未知のフィールド（納品完了タブのdeliverXXXなど、ここに列挙されていないもの）を黙って落とさない。
      // 2026-08-17発覚：deliverThumbImages等がここに無かったせいでプロジェクト再読み込みのたびに消えていた事故の再発防止
      ...meta,
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
    mindmapNotes: (p.mindmapNotes && typeof p.mindmapNotes === "object") ? p.mindmapNotes : {},
    mindmapPos: (p.mindmapPos && typeof p.mindmapPos === "object") ? p.mindmapPos : {},
    mindmapWidth: (p.mindmapWidth && typeof p.mindmapWidth === "object") ? p.mindmapWidth : {},
    transcriptRaw: p.transcriptRaw || "",
    updatedAt: p.updatedAt || p.createdAt || Date.now(),
  };
};

/* ===== 企画・サムネ：YouTube参考動画まわりのヘルパー ===== */
const emptyRef = () => ({ url: "", vid: "", title: "", channel: "", views: 0, subs: 0, likes: 0, uploadDate: "", duration: "" });
const newPlan = () => ({ id: uid(), title: "", thumbText: "", thumbText2: "", note: "", refs: [emptyRef(), emptyRef(), emptyRef(), emptyRef(), emptyRef()], thumbImages: [], video: null, files: [], shareId: null, shareToken: null });
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
  const titles = (meta && meta.titles) || [], thumbs = (meta && meta.thumbs) || [], thumbs2 = (meta && meta.thumbs2) || [];
  let last = -1;
  const n = Math.max(titles.length, thumbs.length, thumbs2.length);
  for (let i = 0; i < n; i++) if ((titles[i] || "").trim() || (thumbs[i] || "").trim() || (thumbs2[i] || "").trim()) last = i;
  const out = [];
  for (let i = 0; i <= last; i++) out.push({ ...newPlan(), title: titles[i] || "", thumbText: thumbs[i] || "", thumbText2: thumbs2[i] || "" });
  return out;
};
const applyTitlesToPlans = (plans, titles, thumbs, thumbs2) => {
  const arr = (plans || []).map((p) => ({ ...p }));
  const n = Math.max((titles || []).length, (thumbs || []).length, (thumbs2 || []).length);
  for (let i = 0; i < n; i++) {
    const t = (titles || [])[i], th = (thumbs || [])[i], th2 = (thumbs2 || [])[i];
    if (!t && !th && !th2) continue;
    while (arr.length <= i) arr.push(newPlan());
    if (t) arr[i].title = t;
    if (th) arr[i].thumbText = th;
    if (th2) arr[i].thumbText2 = th2;
  }
  return arr;
};
const metaTitlesFromPlans = (plans) => {
  const ps = plans || [];
  const slot = (i, f) => (ps[i] && ps[i][f]) || "";
  return {
    titles: [slot(0, "title"), slot(1, "title"), slot(2, "title")],
    thumbs: [slot(0, "thumbText"), slot(1, "thumbText"), slot(2, "thumbText")],
    thumbs2: [slot(0, "thumbText2"), slot(1, "thumbText2"), slot(2, "thumbText2")],
  };
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
  const thumbs2 = (meta.thumbs2 && meta.thumbs2.length ? meta.thumbs2 : ["", "", ""]).slice(0, 3);
  while (titles.length < 3) titles.push("");
  while (thumbs.length < 3) thumbs.push("");
  while (thumbs2.length < 3) thumbs2.push("");
  return {
    name: obj.name || "",
    channel: obj.channel || "",
    meta: { shootDate: meta.shootDate || "", place: meta.place || "", titles, thumbs, thumbs2, highlight: meta.highlight || "" },
    theme: obj.theme && obj.theme.main ? { ...DEFAULT_THEME, ...obj.theme } : { ...DEFAULT_THEME },
    rate: Number(obj.rate) || 5,
    timeFormat: obj.timeFormat === "jp" ? "jp" : "tc",
    // ロケの撮影日：明示の day > ロケ名先頭の「【2日目】」等マーカー > 直前ロケの日を引き継ぎ（密着は日単位で連続するため）。
    // 名前がマーカーだけのロケ行（「2日目」等）は区切りとして扱い、行自体は残さない（TSV経路と同じ挙動）
    rows: (() => {
      let curDay = 1;
      return (obj.rows || []).map((r) => {
        if (r.kind === "location") {
          const dm = parseDayMarker(r.label);
          let day = Number(r.day) >= 1 ? Math.floor(Number(r.day)) : (dm ? dm.day : null);
          if (day >= 1) curDay = day; else day = curDay;
          if (dm && !dm.rest) return null;
          const label = dm ? dm.rest : (r.label || "");
          return { id: uid(), kind: "location", label, address: r.address || "", time: r.time || "", note: r.note || "", travelBy: r.travelBy || "", travelCost: r.travelCost === 0 || r.travelCost ? Number(r.travelCost) : null, day };
        }
        return { id: uid(), kind: "scene", label: r.label || "", type: TYPE_KEYS.includes(r.type) ? r.type : (typeFromText(r.type) || "解説系"), sec: r.sec === 0 || r.sec ? Number(r.sec) : null, script: r.script || "" };
      }).filter(Boolean);
    })(),
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
  let curDay = 1; // 「2日目」区切り行以降のロケに付ける撮影日
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
      if (c1 === "サムネ案②" || c1 === "サムネ案2") { meta.thumbs2 = [vals[0] || "", vals[1] || "", vals[2] || ""]; continue; }
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
    // 撮影日マーカー：「2日目」だけの行（区切り行）、または「【2日目】品川駅」のようにロケ名の頭に付いた形。以降のロケに day を付ける
    const dm = inTable && locName ? parseDayMarker(locName) : null;
    if (dm) {
      curDay = dm.day;
      if (dm.rest) rows.push({ kind: "location", label: dm.rest, time: /\d/.test(locTime) ? locTime : "", day: curDay });
      continue;
    }
    if (inTable && locName) { rows.push({ kind: "location", label: locName, time: /\d/.test(locTime) ? locTime : "", day: curDay }); continue; }
  }
  if (!rows.length) return null;
  return normalizeImport({ meta, rows });
};

const countChars = (s) => (s || "").replace(/\s/g, "").length;
const fmtJP = (sec) => { const s = Math.round(sec); return Math.floor(s / 60) + "分" + String(s % 60).padStart(2, "0") + "秒"; };
const fmtTC = (sec) => { const s = Math.round(sec); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
const sectionOf = (type) => SECTION_TYPES[type] || SECTION_TYPES["解説系"];
/* #RRGGBB に透明度を付ける（分類色を「薄く」使う用） */
const hexA = (hex, a) => { const h = (hex || "#888888").replace("#", ""); const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16); return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")"; };
const targetOf = (r) => (r.sec != null && r.sec !== "" ? Number(r.sec) : sectionOf(r.type).target);

/* 物語フレームワーク：ロケブロックを各型のステップに比例配分して、物語の骨の穴を可視化する */
const STORY_FRAMEWORKS = {
  spine: {
    label: "ストーリースパイン",
    steps: [
      { n: "①", phrase: "昔々、あるところに", hint: "主人公の日常と世界観" },
      { n: "②", phrase: "毎日", hint: "退屈だが安定したルーティン" },
      { n: "③", phrase: "しかし、ある日", hint: "日常を壊す事件・トラブル" },
      { n: "④", phrase: "このせいで", hint: "生じた新たな課題・欲求" },
      { n: "⑤", phrase: "そのため", hint: "課題を解決するための行動" },
      { n: "⑥", phrase: "そのせいで", hint: "行動の結果生じた新たな困難" },
      { n: "⑦", phrase: "ついに", hint: "最終決断・クライマックス" },
      { n: "⑧", phrase: "それ以来", hint: "成長して迎える新たな日常" },
    ],
  },
  pixar: {
    label: "ピクサー理論",
    steps: [
      { n: "①", phrase: "日常", hint: "主人公の日常と世界観" },
      { n: "②", phrase: "喪失", hint: "何かを失う・欠落が生まれる" },
      { n: "③", phrase: "敵対", hint: "障害・敵との対立" },
      { n: "④", phrase: "気づき", hint: "内面の変化・悟り" },
      { n: "⑤", phrase: "統合", hint: "変化を受け入れた新たな自分" },
    ],
  },
  kishotenketsu: {
    label: "起承転結",
    steps: [
      { n: "起", phrase: "起", hint: "導入・状況説明" },
      { n: "承", phrase: "承", hint: "展開・掘り下げ" },
      { n: "転", phrase: "転", hint: "転換・山場" },
      { n: "結", phrase: "結", hint: "結末・まとめ" },
    ],
  },
  threeAct: {
    label: "三幕構成",
    steps: [
      { n: "Ⅰ", phrase: "設定", hint: "人物と世界の提示" },
      { n: "Ⅱ", phrase: "対立", hint: "葛藤・障害との格闘" },
      { n: "Ⅲ", phrase: "解決", hint: "クライマックスと結末" },
    ],
  },
};
/* beat i（全M個）を、K ステップのフレームワークへ比例配分したときのステップ index */
const phaseOf = (i, m, k) => Math.min(k - 1, Math.floor((i * k) / Math.max(m, 1)));
/* 各ロケブロックがどのステップ（起/承/転/結…）に属すか。
   既定は比例配分だが、ロケ行の `spine[fwKey]` に手動割り当てがあればそれを優先する。
   帯が飛び飛びにならないよう、前のブロックより手前のステップには戻さない（単調増加にクランプ）。 */
const phaseSeq = (beats, K, fwKey, overrides) => {
  const out = [];
  let last = 0;
  for (let i = 0; i < beats.length; i++) {
    const ov = overrides ? overrides[beats[i].id] : null;
    let p = (ov != null && ov >= 0 && ov < K) ? ov : phaseOf(i, beats.length, K);
    if (p < last) p = last;
    out.push(p);
    last = p;
  }
  return out;
};
/* project.rows → ロケブロック単位の beat 配列（原稿の埋まり具合と撮影完了で骨の状態を出す） */
/* 背骨のノードに出す「話してる内容」＝シーンの内容見出し。無ければ原稿の頭を切って使う */
const sceneGist = (r) => {
  const lab = (r.label || "").trim();
  if (lab) return lab;
  const s = (r.script || "").replace(/\*\*/g, "").replace(/!!/g, "").replace(/^[◼■]\s*/gm, "").trim();
  if (!s) return "";
  const first = s.split("\n").map((x) => x.trim()).find(Boolean) || "";
  return first.length > 18 ? first.slice(0, 18) + "…" : first;
};
/* 原稿の「◼︎ 質問」行＋続く地の文（回答）をQ&Aペアに分解（マインドマップのQ&Aサブノード用。データは増やさず既存の原稿を読むだけ） */
const parseQA = (script) => {
  const lines = (script || "").replace(/\*\*/g, "").replace(/!!/g, "").split("\n");
  const pairs = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.trim();
    const m = /^[◼■]︎?\s*(.*)$/.exec(line);
    if (m) { cur = { q: m[1].trim(), a: "" }; pairs.push(cur); }
    else if (cur && line) cur.a = (cur.a ? cur.a + " " : "") + line;
  }
  return pairs.filter((p) => p.q);
};
const deriveSpineBeats = (rows) => {
  const beats = [];
  let cur = null;
  for (const r of rows || []) {
    if (r.kind === "location") {
      cur = { id: r.id, label: r.label || "（無題ロケ）", locDone: !!r.done, scenes: 0, filled: 0, items: [] };
      beats.push(cur);
    } else {
      if (!cur) { cur = { id: null, label: "（冒頭）", locDone: false, scenes: 0, filled: 0, items: [] }; beats.push(cur); }
      cur.scenes++;
      const has = countChars(r.script) > 0;
      if (has) cur.filled++;
      cur.items.push({ id: r.id, text: sceneGist(r) || "（無題）", filled: has });
    }
  }
  return beats;
};
/* ロケ行＋その配下シーンを1ブロックとして切り出す（背骨のD&D並べ替え用。beatsと1:1で対応） */
const spineBlocks = (rows) => {
  const blocks = [];
  let cur = null;
  for (const r of rows || []) {
    if (r.kind === "location") { cur = { rows: [r] }; blocks.push(cur); }
    else { if (!cur) { cur = { rows: [] }; blocks.push(cur); } cur.rows.push(r); }
  }
  return blocks;
};
const spineStatus = (b) => (b.scenes === 0 || b.filled === 0) ? "gap" : (b.filled === b.scenes ? "done" : "part");

/* ============================================================
   マインドマップ（Studio OS Phase 1実装の移植、2026-08-15）
   構成台本タブの「物語の背骨」帯と同じデータ（deriveSpineBeats/phaseSeq/STORY_FRAMEWORKS）を
   使い、Section=スパインの各ステップ、Scene=そのステップに属するシーン、として木構造で可視化する。
   表示専用（このReact側で新たにビジネスロジックを実装しない。フィルタ・尺計算は既存関数を再利用）。
   ============================================================ */
const MM_SECTION_ACCENTS = ["#3B82F6", "#8B5CF6", "#10B981", "#F59E0B", "#EC4899", "#06B6D4", "#DC2645", "#71717A"];

// project.rows + 選択中のフレームワークから、ステップ単位のsections配列を組み立てる。
// シーンの尺は既存のtotalEst計算式（文字数÷読み上げ速度、無ければ種別の目安秒数）をそのまま使う
// （worker/src/index.jsのGET /api/public/summary/:projIdへ移植済みのものと同じ式）。
function buildMindmapSections(rows, spineFw, rate, notes) {
  const beats = deriveSpineBeats(rows);
  const blocks = spineBlocks(rows);
  const fw = STORY_FRAMEWORKS[spineFw] || STORY_FRAMEWORKS.spine;
  const K = fw.steps.length;
  const overrides = {};
  (rows || []).forEach((r) => { if (r.kind === "location" && r.spine && r.spine[spineFw] != null) overrides[r.id] = r.spine[spineFw]; });
  const phases = phaseSeq(beats, K, spineFw, overrides);
  // 各ステップは常に表示（シーン0件でも）＝台本を書く前の「ここで何を話すか」メモ入力先として使えるように
  const sections = fw.steps.map((step, i) => ({ id: "phase" + i, label: step.phrase, hint: step.hint || "", note: (notes && notes[spineFw + ":phase" + i]) || "", rows: [] }));
  let sceneNo = 0;
  const r = rate || 5;
  beats.forEach((beat, i) => {
    const phaseIdx = phases[i] ?? 0;
    const block = blocks[i];
    (block ? block.rows : []).forEach((row) => {
      if (row.kind !== "scene") return;
      sceneNo++;
      const target = (row.sec != null && row.sec !== "") ? Number(row.sec) : ((SECTION_TYPES[row.type] || SECTION_TYPES["解説系"]).target);
      const chars = countChars(row.script);
      const durSec = chars > 0 ? chars / r : target;
      sections[phaseIdx].rows.push({
        id: row.id, label: sceneGist(row) || "（無題）", kind: "scene",
        sceneType: row.type || "解説系", sceneNo, durSec, qa: parseQA(row.script),
      });
    });
  });
  const totalScenes = sceneNo;
  const totalEstSec = sections.reduce((a, s) => a + s.rows.reduce((aa, rr) => aa + rr.durSec, 0), 0);
  return { sections, totalScenes, totalEstSec };
}

function mmContentSignature({ totalScenes, sections }) {
  return totalScenes + "|" + sections.map((s) => s.id + ":" + s.label + ":" + s.rows.map((rr) => rr.id + "." + rr.label + "." + rr.sceneType + "." + Math.round(rr.durSec) + "." + (rr.qa || []).length + "." + (rr.qa || []).map((p) => p.q.length + "-" + p.a.length).join(",")).join(",")).join("||");
}

const mmFmtSec = (sec) => { const s = Math.round(sec || 0); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };

function MmProjectNode({ data }) {
  return (
    <div className="rounded-2xl px-4 py-3 min-w-[150px]" style={{ background: "#13233a", color: "#fff", boxShadow: "0 4px 16px rgba(0,0,0,.10)" }}>
      <div className="text-[13px] font-bold">{data.title || "（無題）"}</div>
      <div className="text-[9.5px] mt-1" style={{ color: "rgba(255,255,255,.7)" }}>総尺 {mmFmtSec(data.totalEstSec)} ・ シーン数 {data.totalScenes}</div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}
function MmSectionNode({ data }) {
  return (
    <div className="w-full cursor-default transition-opacity" style={{ opacity: data.dimmed ? 0.38 : 1 }}>
      <Handle type="target" position={Position.Left} style={{ top: 36, opacity: 0 }} />
      <div className="pb-2" style={{ borderBottom: "3px solid " + data.accent }}>
        <div className="text-[13px] font-bold text-stone-700">{data.label || "未分類"}</div>
        <div className="text-[9.5px] text-stone-400 mt-0.5">{data.rows.length}シーン ・ {mmFmtSec(data.rows.reduce((a, r) => a + r.durSec, 0))}</div>
      </div>
      <BufferedTextarea value={data.note || ""} onChange={(v) => data.onNoteChange && data.onNoteChange(data.id, v)}
        placeholder="ここで何を話すか…" rows={2}
        className="nodrag nowheel mt-1.5 w-full text-[10.5px] leading-snug text-stone-600 bg-transparent border-0 border-b border-stone-200 rounded-none px-0 py-1 resize-y focus:outline-none focus:border-stone-400 placeholder:text-stone-300" />
      <button onClick={() => data.onAddScene && data.onAddScene(data.id)} title="このメモを元に構成台本へシーンを作る"
        className="nodrag mt-1.5 text-[10px] font-bold text-stone-400 hover:text-stone-700 border-b border-dashed border-stone-300 hover:border-stone-400 transition-colors">
        ＋シーン追加
      </button>
      <Handle type="source" position={Position.Right} style={{ top: 36, opacity: 0 }} />
    </div>
  );
}
/* シーンの中の質問1行分。別ノードではなくシーンノード内のリスト項目として描画する
   （2026-08-17：Q&Aをノードごとに分けると全体把握しづらいとの指摘を受けて統合） */
function MmQaRow({ pair, qi, rowId, selId, editId, editVal, onSelect, onStartEdit, onEditChange, onCommitEdit, onEditAnswer, onNodeClick }) {
  const qaId = "qa:" + rowId + ":" + qi;
  const selected = selId === qaId;
  const editing = editId === qaId;
  const inputRef = useRef(null);
  useEffect(() => { if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [editing]);
  return (
    <div className="pt-1 mt-1 border-t border-stone-100 first:mt-0 first:pt-0 first:border-t-0 cursor-pointer group/qa"
      onClick={(e) => { e.stopPropagation(); onSelect && onSelect(qaId); }}
      onDoubleClick={(e) => { e.stopPropagation(); onStartEdit && onStartEdit(qaId); }}>
      <div className="flex items-start gap-1">
        <span className="text-[10px] font-bold shrink-0" style={{ color: "#B8860B" }}>◼︎</span>
        {editing ? (
          <input ref={inputRef} className="nodrag flex-1 min-w-0 text-[10.5px] font-bold focus:outline-none bg-transparent"
            style={{ color: "#B8860B" }} value={editVal} onChange={(e) => onEditChange && onEditChange(e.target.value)}
            onBlur={() => onCommitEdit && onCommitEdit()}
            onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} />
        ) : (
          <span className={"text-[10.5px] font-bold flex-1 min-w-0" + (selected ? "" : " line-clamp-1")} style={{ color: "#B8860B" }}>{pair.q || "（無題の質問）"}</span>
        )}
        <button onClick={(e) => { e.stopPropagation(); onNodeClick && onNodeClick(rowId); }} title="台本のこの質問へ"
          className="nodrag shrink-0 text-stone-300 opacity-0 group-hover/qa:opacity-100 hover:text-stone-600 text-[10px] leading-none px-0.5 transition-opacity">→</button>
      </div>
      {selected && (
        <BufferedTextarea value={pair.a || ""} onChange={(v) => onEditAnswer && onEditAnswer(rowId, qi, v)}
          placeholder="回答（セリフ）を入力…" rows={3}
          className="nodrag nowheel w-full mt-1 text-[10px] leading-snug text-stone-500 bg-transparent border-0 focus:outline-none resize-none placeholder:text-stone-300"
          onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} />
      )}
    </div>
  );
}
function MmSceneNode({ data }) {
  const editing = data.editing;
  const selected = data.selected;
  const inputRef = useRef(null);
  useEffect(() => { if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [editing]);
  return (
    <div className="w-full cursor-pointer group transition-opacity" style={{ opacity: data.dimmed ? 0.38 : 1 }}
      onClick={(e) => { e.stopPropagation(); data.onSelect && data.onSelect(data.id); }}
      onDoubleClick={(e) => { e.stopPropagation(); data.onStartEdit && data.onStartEdit(data.id); }}>
      <NodeResizeControl position="right" variant={ResizeControlVariant.Line} color={data.accent} minWidth={200} maxWidth={560}
        style={{ borderColor: data.accent }} className="nodrag opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
        onResizeEnd={(e, params) => data.onResizeWidth && data.onResizeWidth(data.nodeId, Math.round(params.width))} />
      <Handle type="target" position={Position.Left} style={{ top: 38, opacity: 0 }} />
      <div className="pb-2 transition-colors" style={{ borderBottom: (selected ? "3px solid " : "1.5px solid ") + data.accent }}>
        <div className="flex items-center gap-1">
          {data.sceneNo != null && <span className="text-[9px] font-bold text-stone-400 tabular-nums shrink-0">{String(data.sceneNo).padStart(2, "0")}</span>}
          {editing ? (
            <input ref={inputRef} className="nodrag flex-1 min-w-0 text-[12.5px] font-bold text-stone-700 focus:outline-none bg-transparent"
              value={data.editVal} onChange={(e) => data.onEditChange && data.onEditChange(e.target.value)}
              onBlur={() => data.onCommitEdit && data.onCommitEdit()}
              onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} />
          ) : (
            <span className="text-[12.5px] font-bold" style={{ color: selected ? data.accent : "#44403c" }}>{data.label || "（無題）"}</span>
          )}
          {data.qaCount > 0 && (
            <button onClick={(e) => { e.stopPropagation(); data.onToggleFold && data.onToggleFold(data.id); }}
              title={data.folded ? "Q&Aを開く" : "Q&Aを畳む"}
              className="nodrag shrink-0 text-stone-300 hover:text-stone-600 text-[9.5px] font-bold px-1 rounded transition-colors">
              {data.folded ? "▸" + data.qaCount : "▾"}
            </button>
          )}
          <button onClick={(e) => { e.stopPropagation(); data.onNodeClick && data.onNodeClick(data.id); }} title="台本のこのシーンへ"
            className="nodrag ml-auto shrink-0 text-stone-300 opacity-0 group-hover:opacity-100 hover:text-stone-600 text-[11px] leading-none px-0.5 transition-opacity">→</button>
        </div>
        <div className="text-[9.5px] text-stone-400 mt-1">{data.sceneType} ・ {mmFmtSec(data.durSec)}</div>
      </div>
      {!data.folded && (data.qa || []).length > 0 && (
        <div className="mt-1">
          {data.qa.map((pair, qi) => (
            <MmQaRow key={qi} pair={pair} qi={qi} rowId={data.id}
              selId={data.selId} editId={data.editId} editVal={data.editVal}
              onSelect={data.onSelect} onStartEdit={data.onStartEdit} onEditChange={data.onEditChange}
              onCommitEdit={data.onCommitEdit} onEditAnswer={data.onAnswerChange} onNodeClick={data.onNodeClick} />
          ))}
        </div>
      )}
      {!data.folded && (
        <button onClick={(e) => { e.stopPropagation(); data.onAddQuestionHere && data.onAddQuestionHere(data.id); }}
          className="nodrag mt-1.5 text-[9.5px] font-bold text-stone-300 opacity-0 group-hover:opacity-100 hover:text-stone-600 transition-opacity">
          ＋質問追加
        </button>
      )}
      <Handle type="source" position={Position.Right} style={{ top: 38, opacity: 0 }} />
    </div>
  );
}
const MM_NODE_TYPES = { mmProjectNode: MmProjectNode, mmSectionNode: MmSectionNode, mmSceneNode: MmSceneNode };

// テキスト量からノードの行数を見積もる（マインドマップのノードは原稿の長さに応じて縦に伸ばしたいので、
// dagreに渡す高さもここで概算する。ピクセル完全一致は狙わず、詰まって重ならない程度の余裕を持たせる）
function mmEstLines(text, charsPerLine) {
  const s = String(text || "");
  if (!s) return 1;
  let total = 0;
  s.split("\n").forEach((line) => { total += Math.max(1, Math.ceil(line.length / charsPerLine)); });
  return Math.max(1, total);
}
function mmBuildGraph({ deliverableTitle, totalEstSec, totalScenes, sections, foldedRows }) {
  const g = new dagre.graphlib.Graph();
  // P0（2026-08-17 MindNode風UI改修）：親子・兄弟の間隔をコンパクト化。ranksep=世代間の横距離、nodesep=兄弟の縦距離
  g.setGraph({ rankdir: "LR", nodesep: 56, ranksep: 52 });
  g.setDefaultEdgeLabel(() => ({}));
  const nodes = [], edges = [];
  const ROOT_ID = "project";
  const rootDim = { width: 190, height: 76 };
  g.setNode(ROOT_ID, rootDim);
  nodes.push({ id: ROOT_ID, type: "mmProjectNode", position: { x: 0, y: 0 }, width: rootDim.width, height: rootDim.height, data: { title: deliverableTitle, totalEstSec, totalScenes } });
  sections.forEach((sec, i) => {
    const secId = "section:" + sec.id;
    const accent = MM_SECTION_ACCENTS[i % MM_SECTION_ACCENTS.length];
    // MindNode風：ルートから枝分かれした瞬間からセクションの色を引き継ぎ、配下のシーン・Q&Aまで同じ色の線でつなぐ
    // 幹は太く、末端に向かうほど細く（Tapered Branches。SVGの可変幅パスまではやらず、階層ごとの段階的な線幅で近似）
    g.setNode(secId, { width: 220, height: 64 });
    g.setEdge(ROOT_ID, secId);
    nodes.push({ id: secId, type: "mmSectionNode", position: { x: 0, y: 0 }, width: 220, height: 64, data: { ...sec, accent } });
    // opacityを付けると、同じ根元を共有する枝同士が重なる幹の部分で半透明が重なって色が濁って「線が切れて見える」原因になるため不透明にする
    edges.push({ id: "e-" + ROOT_ID + "-" + secId, source: ROOT_ID, target: secId, style: { stroke: accent, strokeWidth: 4 } });
    sec.rows.forEach((row) => {
      const rowId = "row:" + row.id;
      const labelLines = mmEstLines(row.label, 19);
      const qa = row.qa || [];
      const qaCount = qa.length;
      const folded = !!(foldedRows && foldedRows.has(row.id));
      // 全体把握しづらいとの指摘（2026-08-17）：Q&Aを別ノード群にせず、シーンノード内の質問リストとして1個にまとめる。
      // 折りたたみ中・空欄なら0、それ以外は1問=約19pxの見積り（選択展開時の実高さとはズレるが軽微なので追随しない＝毎クリックでの再レイアウトを避ける）
      const qaListHeight = (folded || qaCount === 0) ? 0 : qaCount * 19 + 8;
      const rowDim = { width: 300, height: 78 + Math.max(0, labelLines - 2) * 15 + qaListHeight };
      g.setNode(rowId, rowDim);
      g.setEdge(secId, rowId);
      nodes.push({ id: rowId, type: "mmSceneNode", position: { x: 0, y: 0 }, width: rowDim.width, height: rowDim.height, data: { ...row, accent, nodeId: rowId, qa, qaCount, folded } });
      edges.push({ id: "e-" + secId + "-" + rowId, source: secId, target: rowId, style: { stroke: accent, strokeWidth: 3 } });
    });
  });
  dagre.layout(g);
  nodes.forEach((n) => { const pos = g.node(n.id); if (pos) n.position = { x: pos.x - pos.width / 2, y: pos.y - pos.height / 2 }; });
  return { nodes, edges };
}

function MmCanvas({ deliverableTitle, totalEstSec, totalScenes, sections, onNodeClick, onNoteChange, onAddScene, onRenameScene, onAddSceneAfter, onEditQuestion, onEditAnswer, posMap, onPosChange, onClearPos, widthMap, onWidthChange, onDeleteScene, onDeleteQuestion, onAddQuestion, onUndo, onRedo }) {
  const { fitView } = useReactFlow();
  const prevSigRef = useRef(null);
  const skipNextFitRef = useRef(false);
  const signature = useMemo(() => mmContentSignature({ totalScenes, sections }), [totalScenes, sections]);
  // シーン配下のQ&Aだけ折りたたみ開閉できる（MindNodeのfolding相当。台本データ自体は変えない一時的な表示状態）
  // 既定は全シーンQ&A折りたたみ＝骨組み（ロケ・スパイン・シーン）だけの見通しの良い状態からスタート。
  // 実プロジェクト（20シーン超×複数Q&A）だと全展開は文字が潰れて読めなくなるため（2026-08-17指摘）。
  // 新規に追加したQ&Aはこの初期化には含まれないので自動的に開いたまま見える
  const [foldedRows, setFoldedRows] = useState(() => {
    const s = new Set();
    sections.forEach((sec) => sec.rows.forEach((r) => { if ((r.qa || []).length) s.add(r.id); }));
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });
  const toggleFold = useCallback((rowId) => {
    setFoldedRows((prev) => { const next = new Set(prev); if (next.has(rowId)) next.delete(rowId); else next.add(rowId); return next; });
  }, []);
  // シーンに質問を追加。折りたたみ中なら開いてから追加し、そのまま選択・編集状態にする（「＋ノード」パネルボタン／シーン内「＋質問追加」共通）
  const addQuestionTo = useCallback((rowId) => {
    if (!rowId || isQA(rowId) || !onAddQuestion) return;
    setFoldedRows((prev) => { if (!prev.has(rowId)) return prev; const next = new Set(prev); next.delete(rowId); return next; });
    const qi = onAddQuestion(rowId);
    if (qi != null) { const qaId = "qa:" + rowId + ":" + qi; setSelId(qaId); setEditId(qaId); setEditVal(""); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onAddQuestion]);
  const { nodes: builtNodes, edges: builtEdges } = useMemo(() => {
    const graph = mmBuildGraph({ deliverableTitle, totalEstSec, totalScenes, sections, foldedRows });
    graph.nodes.forEach((n) => { if (n.type === "mmSceneNode") n.data.onNodeClick = onNodeClick; });
    return graph;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, foldedRows]);
  // ノート本文はここで毎レンダー最新値を差し込む（signatureに含めない＝入力中にdagre再配置してノードが動かないように）
  const noteById = useMemo(() => { const m = {}; sections.forEach((s) => { m[s.id] = s.note || ""; }); return m; }, [sections]);
  const labelById = useMemo(() => { const m = {}; sections.forEach((s) => s.rows.forEach((r) => { m[r.id] = r.label; })); return m; }, [sections]);
  const qaQById = useMemo(() => { const m = {}; sections.forEach((s) => s.rows.forEach((r) => (r.qa || []).forEach((p, qi) => { m["qa:" + r.id + ":" + qi] = p.q; }))); return m; }, [sections]);
  const isQA = (id) => typeof id === "string" && id.startsWith("qa:");
  const origValFor = (id) => (isQA(id) ? qaQById[id] : labelById[id]) || "";
  // MindNode風のノード選択・インライン編集・Enter/Tabで兄弟シーン追加（Studio OS PRD Phase）
  const [selId, setSelId] = useState(null);
  const [editId, setEditId] = useState(null);
  const [editVal, setEditVal] = useState("");
  const startEdit = (id) => { setSelId(id); setEditId(id); setEditVal(origValFor(id)); };
  const commitEdit = () => {
    if (editId) {
      const v = editVal.trim();
      if (v !== origValFor(editId)) {
        if (isQA(editId)) {
          const m = /^qa:(.+):(\d+)$/.exec(editId);
          if (m && onEditQuestion) onEditQuestion(m[1], +m[2], v);
        } else if (onRenameScene) onRenameScene(editId, v);
      }
    }
    setEditId(null);
  };
  useEffect(() => {
    const onKey = (e) => {
      // input/textarea内（インライン編集中や取材メモ欄）ではブラウザ標準のUndo/文字削除を優先し、横取りしない
      const typingInField = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !typingInField) {
        e.preventDefault();
        if (e.shiftKey) onRedo && onRedo(); else onUndo && onUndo();
        return;
      }
      if (e.key === "Escape") {
        // 編集破棄。取り消し後にinputがDOMから外れてblurが飛んでもコミットされないよう、
        // editValを元の値に戻してから閉じる（onBlurの遅延commitを無害化）
        if (editId) { setEditVal(origValFor(editId)); setEditId(null); e.preventDefault(); }
        else if (selId) { setSelId(null); e.preventDefault(); }
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selId && !typingInField) {
        e.preventDefault();
        if (isQA(selId)) {
          const m = /^qa:(.+):(\d+)$/.exec(selId);
          if (m && onDeleteQuestion) onDeleteQuestion(m[1], +m[2]);
        } else if (onDeleteScene) onDeleteScene(selId);
        setSelId(null); setEditId(null);
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && selId) {
        e.preventDefault();
        if (editId === selId) commitEdit();
        if (isQA(selId) || !onAddSceneAfter) return;   // Q&Aノードでの兄弟追加は未対応（シーンのみ）
        skipNextFitRef.current = true;
        const newId = onAddSceneAfter(selId, "");
        if (newId) { setSelId(newId); setEditId(newId); setEditVal(""); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId, editId, editVal, labelById, qaQById, onAddSceneAfter, onRenameScene, onEditQuestion, onDeleteScene, onDeleteQuestion, onUndo, onRedo]);
  const onResizeWidth = useCallback((nodeId, w) => { onWidthChange && onWidthChange(nodeId, w); }, [onWidthChange]);
  // フォーカスモード簡易版：ノードを選択すると、その枝（同じaccent色）以外を薄く沈める
  const accentBySelId = useMemo(() => {
    const m = {};
    builtNodes.forEach((n) => {
      if (n.type !== "mmSceneNode") return;
      m[n.data.id] = n.data.accent;
      (n.data.qa || []).forEach((_, qi) => { m["qa:" + n.data.id + ":" + qi] = n.data.accent; });
    });
    return m;
  }, [builtNodes]);
  const activeAccent = selId ? accentBySelId[selId] : null;
  const nodes = useMemo(() => builtNodes.map((n) => {
    const pos = (posMap && posMap[n.id]) || n.position;
    const width = (widthMap && widthMap[n.id]) || n.width;
    const dimmed = !!(activeAccent && n.data && n.data.accent && n.data.accent !== activeAccent);
    if (n.type === "mmSectionNode") return { ...n, position: pos, width, data: { ...n.data, note: noteById[n.data.id] || "", onNoteChange, onAddScene, dimmed } };
    if (n.type === "mmSceneNode") return { ...n, position: pos, width, data: { ...n.data, selected: n.data.id === selId, editing: n.data.id === editId, editVal, selId, editId, onSelect: setSelId, onStartEdit: startEdit, onEditChange: setEditVal, onCommitEdit: commitEdit, onResizeWidth, onToggleFold: toggleFold, onAnswerChange: onEditAnswer, onAddQuestionHere: addQuestionTo, dimmed } };
    return { ...n, position: pos, width };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [builtNodes, noteById, onNoteChange, onAddScene, selId, editId, editVal, posMap, widthMap, onResizeWidth, onEditAnswer, toggleFold, addQuestionTo, activeAccent]);
  const edges = useMemo(() => builtEdges.map((e) => {
    const dimmed = !!(activeAccent && e.style && e.style.stroke && e.style.stroke !== activeAccent);
    return dimmed ? { ...e, style: { ...e.style, opacity: 0.25 } } : e;
  }), [builtEdges, activeAccent]);
  // ドラッグ中の見た目はReact Flow内のローカルstateで持ち、ドロップ確定時にonPosChangeで親（プロジェクトデータ）へ永続化する
  const [liveNodes, setLiveNodes] = useState(nodes);
  useEffect(() => { setLiveNodes(nodes); }, [nodes]);
  const onNodesChange = useCallback((changes) => { setLiveNodes((nds) => applyNodeChanges(changes, nds)); }, []);
  const onNodeDragStop = useCallback((e, node) => { onPosChange && onPosChange(node.id, node.position); }, [onPosChange]);
  const handleAlign = useCallback(() => {
    if (onClearPos) onClearPos(builtNodes.map((n) => n.id));
    requestAnimationFrame(() => fitView({ duration: 300, padding: 0.15 }));
  }, [onClearPos, builtNodes, fitView]);
  // 「＋ノード」パネルボタン：選択中のシーンに質問を追加してそのまま編集開始。シーン未選択時は何もしない
  const handleAddNode = useCallback(() => { addQuestionTo(selId); }, [selId, addQuestionTo]);
  useEffect(() => {
    if (prevSigRef.current !== signature) {
      prevSigRef.current = signature;
      const skip = skipNextFitRef.current;
      skipNextFitRef.current = false;
      if (!skip) requestAnimationFrame(() => fitView({ duration: 300, padding: 0.15 }));
    }
  }, [signature, fitView]);
  return (
    <ReactFlow nodes={liveNodes} edges={edges} nodeTypes={MM_NODE_TYPES} fitView minZoom={0.25} maxZoom={2.5}
      onNodesChange={onNodesChange} onNodeDragStop={onNodeDragStop}
      panOnScroll zoomOnScroll={false} panOnScrollMode="free" zoomOnPinch
      onPaneClick={() => { setSelId(null); setEditId(null); }}
      proOptions={{ hideAttribution: true }} defaultEdgeOptions={{ type: "smoothstep", pathOptions: { borderRadius: 20 } }}>
      <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#D8D5CB" style={{ opacity: 0.35 }} />
      <Panel position="top-left">
        <button onClick={handleAddNode} disabled={!selId || isQA(selId)} title={selId && !isQA(selId) ? "選択中のシーンに質問ノードを追加" : "先にシーンを選んでください"}
          className="nodrag bg-white border border-stone-200 rounded-lg shadow-sm text-[10.5px] font-bold text-stone-500 hover:text-stone-800 hover:border-stone-400 disabled:opacity-40 disabled:hover:text-stone-500 disabled:hover:border-stone-200 px-2 py-1.5 transition-colors">
          ＋ノード
        </button>
      </Panel>
      <Controls showInteractive={false} position="top-left" style={{ marginTop: 44 }} />
      <Panel position="top-left" style={{ marginTop: 176 }}>
        <button onClick={handleAlign} title="ドラッグで動かした位置・幅をリセットして自動整列に戻す"
          className="nodrag bg-white border border-stone-200 rounded-lg shadow-sm text-[10.5px] font-bold text-stone-500 hover:text-stone-800 hover:border-stone-400 px-2 py-1.5 transition-colors">
          整列
        </button>
      </Panel>
      <MiniMap pannable zoomable position="top-right" style={{ background: "#fff" }} />
    </ReactFlow>
  );
}
function MindmapView({ height, ...props }) {
  if (!(props.sections || []).length) return <div className="text-[12px] text-stone-400 py-2">物語の背骨でフレームワークを選ぶと表示されます</div>;
  return (
    <div style={{ height: height || 480 }}>
      <ReactFlowProvider><MmCanvas {...props} /></ReactFlowProvider>
    </div>
  );
}

const textOn = (hex) => {
  try {
    const h = hex.replace("#", "");
    const f = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const r = parseInt(f.slice(0, 2), 16), g = parseInt(f.slice(2, 4), 16), b = parseInt(f.slice(4, 6), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "#1A1A1A" : "#FFFFFF";
  } catch { return "#FFFFFF"; }
};

/* ---------- 原稿セル：行頭「・」→◼︎変換 + 質問行（◼︎始まり）をアクセント色・太字で表示 ---------- */
/* ===== ピクトグラム（ライン系SVG・currentColorで配色追従）===== */
const Icon = React.memo(function Icon({ name, className = "w-4 h-4", style, strokeWidth = 1.8 }) {
  const c = { className, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth, strokeLinecap: "round", strokeLinejoin: "round", style, "aria-hidden": true };
  switch (name) {
    case "pin": return (<svg {...c}><path d="M12 21s6-5.3 6-10A6 6 0 1 0 6 11c0 4.7 6 10 6 10z" /><circle cx="12" cy="11" r="2.2" /></svg>);
    case "note": return (<svg {...c}><path d="M12 20H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9l5 5v3" /><path d="M14 4v5h5" /><path d="M8 13h5M8 16h3" /></svg>);
    case "map": return (<svg {...c}><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" /><path d="M9 4v14M15 6v14" /></svg>);
    case "download": return (<svg {...c}><path d="M12 4v10m0 0 4-4m-4 4-4-4" /><path d="M5 18h14" /></svg>);
    case "file": return (<svg {...c}><path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8l-5-5z" /><path d="M14 3v5h5" /></svg>);
    case "copy": return (<svg {...c}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></svg>);
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
    case "upload": return (<svg {...c}><path d="M12 14V4m0 0L8 8m4-4 4 4" /><path d="M5 18h14" /></svg>);
    case "gear": return (<svg {...c}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01A1.7 1.7 0 0 0 10 4.09V4a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01A1.7 1.7 0 0 0 20.91 10H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" /></svg>);
    case "mic": return (<svg {...c}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /></svg>);
    case "book": return (<svg {...c}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>);
    default: return null;
  }
});

/* 入力内容に応じて高さが伸びる textarea（全文が常に見える） */
function AutoTextarea({ value, onChange, placeholder, className, minHeight = 80, onBlur, title }) {
  const ref = useRef(null);
  const resize = (el) => { if (!el) return; el.style.height = "auto"; el.style.height = Math.max(minHeight, el.scrollHeight) + "px"; };
  // 親へは合成イベント({target:{value}})で渡す＝呼び出し側のe.target.value流儀を維持
  const [val, set, flush, ime] = useBufferedField(value, (nv) => onChange({ target: { value: nv } }));
  useEffect(() => { resize(ref.current); }, [val]);
  return (
    <textarea ref={ref} {...ime} value={val} placeholder={placeholder} className={className} title={title}
      style={{ overflow: "hidden", resize: "none", minHeight }}
      onChange={(e) => { set(e.target.value); resize(e.target); }}
      onBlur={(e) => { flush(e); if (onBlur) onBlur(e); }} />
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
  const composing = useRef(false); // IME変換中（日本語入力の未確定文字列がある）
  const echoUntil = useRef(0);     // 親へ流した値が返ってくるのを待つ期限。この間は外部値で巻き戻さない
  const cbRef = useRef(onChange);
  cbRef.current = onChange;
  const valRef = useRef(norm);
  valRef.current = val;
  // 外部から値が変わったら取り込む。ただし**打鍵中のユーザー入力より外部値を優先しない**。
  // ここが「入力してる間に文章が消える」の主犯だった（2026-07-31）：
  //   IME変換中／未送信の打鍵がある最中に、共同編集の全文ブロードキャストや自動再発行の
  //   再レンダーが古い value を運んでくると、pending を捨てて setVal で上書きしていた＝
  //   打っている本人の文字が目の前で消える。変換中と未送信中は外部値を無視し、
  //   flush 後（pending=null）に改めて取り込む。
  useEffect(() => {
    if (norm === sent.current) { echoUntil.current = 0; return; }   // 自分が送った値のエコー＝親が追いついた
    if (composing.current) return;       // 変換確定前に value を差し替えると変換ごと壊れる
    if (pending.current != null) return; // 打鍵中＝本人の入力が最新。外部値は捨てる
    // 親へ流した直後（=pendingはもう空）だが、親のstateはまだ古いまま届くことがある。
    // 親への反映は startTransition の低優先度レンダーなので、重い案件では数百ms〜遅れる。
    // その隙に古い norm を採用すると、打ち終わった文字が目の前で巻き戻る（2026-08-08 AK報告）。
    // 親が新しい値を返してくるまで（最長3秒）は外部値を採らない。
    if (Date.now() < echoUntil.current) return;
    if (norm === valRef.current) return;
    setVal(norm); sent.current = norm;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, [norm]);
  const flush = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (composing.current) return;       // 未確定文字列を親へ流さない（確定時に改めて流す）
    if (pending.current != null && pending.current !== sent.current) {
      const nv = pending.current;
      sent.current = nv;
      echoUntil.current = Date.now() + 3000;   // 親が追いつくまで外部値を無視（上限3秒＝AI反映等は3秒後に必ず入る）
      // 親(巨大state)への反映は低優先度レンダーで＝打鍵再開時にコミット描画へ割り込める
      startTransition(() => cbRef.current(nv));
    }
    pending.current = null;
  };
  const set = (nv) => {
    // controlled input は onChange ごとに value と同じローカルstateを更新する必要がある。
    // 変換中に setVal を止めると、React が古い value をDOMへ書き戻し、未確定文字列を
    // ローマ字のまま確定させたり入力自体を巻き戻したりする。親の巨大stateへの反映だけを
    // compositionEnd まで止め、画面上のローカル値は変換中も常にDOMへ追従させる。
    pending.current = nv;
    if (timer.current) clearTimeout(timer.current);
    setVal(nv);
    if (composing.current) return;       // 親へのdebounceは確定後にまとめて開始する
    timer.current = setTimeout(flush, delay);
  };
  // IMEハンドラ。入力要素に {...ime} で挿すこと（textarea/input 全部）。
  const ime = {
    onCompositionStart: () => { composing.current = true; if (timer.current) { clearTimeout(timer.current); timer.current = null; } },
    onCompositionEnd: (e) => {
      composing.current = false;
      const nv = e && e.target ? e.target.value : null;
      if (nv != null) { setVal(nv); pending.current = nv; }
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, delay);
    },
  };
  useEffect(() => () => { composing.current = false; flush(); }, []); // アンマウント時に未送信分を確定
  return [val, set, flush, ime];
}

function BufferedTextarea({ value, onChange, onBlur, ...rest }) {
  const [val, set, flush, ime] = useBufferedField(value, onChange);
  return <textarea {...rest} {...ime} value={val}
    onChange={(e) => set(e.target.value)}
    onBlur={(e) => { flush(); if (onBlur) onBlur(e); }} />;
}

function BufferedInput({ value, onChange, onBlur, ...rest }) {
  const [val, set, flush, ime] = useBufferedField(value, onChange);
  return <input {...rest} {...ime} value={val}
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

/* 原稿セルのメモ化比較：関数props(onChange)は毎レンダー再生成されるので無視する。
   onChangeの中身は全て setProject の関数型更新＝古いクロージャが呼ばれても安全。 */
const cellPropsEqual = (a, b) =>
  a.value === b.value && a.placeholder === b.placeholder && a.accent === b.accent &&
  a.fontSize === b.fontSize && a.className === b.className && a.minHeight === b.minHeight &&
  a.lineHeight === b.lineHeight && a.qaGutter === b.qaGutter;

const ScriptCell = React.memo(function ScriptCell({ value, onChange, placeholder, accent = "#E63946", fontSize = 13, lineHeight = 1.45, qaGutter = false }) {
  const taRef = useRef(null);
  const [focused, setFocused] = useState(false);
  const [val, set, flush, ime] = useBufferedField(value, onChange);
  const textStyle = {
    fontFamily: "inherit",
    fontSize,
    // 原稿の複数行が「空行」に見えない密度。表示層とtextareaで必ず同じ値を使う。
    lineHeight,
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    wordBreak: "break-word",
  };

  /* 選択範囲をマーカーで囲む（太字/赤文字） */
  const wrap = (mk) => {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const next = toggleInlineMarker(val || "", s, e, mk);
    set(next.value);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = next.start;
      ta.selectionEnd = next.end;
    });
  };

  const handleKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === "b" || e.key === "B")) { e.preventDefault(); wrap("**"); return; }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "h" || e.key === "H")) { e.preventDefault(); wrap("!!"); return; }
  };

  /* ◼︎（質問行）の作り方（2026-08-23 AK指示で変更）：
     旧＝フォーカス時や空行Enterで「◼︎ 」を勝手に挿入 → 「勝手に◼︎と赤文字になる」と不評のため廃止。
     新＝行頭に「・」を打った瞬間だけ「◼︎ 」に置き換える（・はJISキーボードで打ちやすい）。
     IME変換中は触らない（確定時 compositionEnd で改めて判定）。 */
  const composingRef = useRef(false);
  const bulletToQ = (ta) => {
    if (!ta || composingRef.current) return false;
    const v = ta.value;
    const pos = ta.selectionStart;
    if (ta.selectionEnd !== pos) return false;
    const lineStart = v.lastIndexOf("\n", pos - 1) + 1;
    if (v.slice(lineStart, pos) !== "・") return false;
    const nv = v.slice(0, lineStart) + "◼︎ " + v.slice(pos);
    set(nv);
    const caret = lineStart + 3;
    requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = caret; });
    return true;
  };
  const handleChange = (e) => {
    set(e.target.value);
    bulletToQ(e.target);
  };
  const imeWrapped = {
    onCompositionStart: (e) => { composingRef.current = true; ime.onCompositionStart(e); },
    onCompositionEnd: (e) => { composingRef.current = false; ime.onCompositionEnd(e); bulletToQ(e.target); },
  };

  const handleFocus = () => { setFocused(true); };

  /* 表示レイヤー（2026-08-23 色ルール改定）：
     - 質問行（◼︎始まり）＝ ◼︎ だけ種別色、質問本文は黒(#171A1F)・600。全文を赤にしない
     - ★始まりの行（採用候補・使いたい発言）＝ #B27A24・500
     - !!赤!! は従来どおり赤。太字/ウェイトは blur 後のみ（編集中は透明textareaと字幅を揃える）
     太字/赤文字は全文を run 化してから行に流すので、改行をまたぐ ** でも崩れない */
  const runs = buildStyledRuns(val || "");
  /* 行の役割：q=質問（◼︎始まり）/ star=★採用候補 / a=質問の直後に来る最初の本文行（回答の頭）/ null */
  const lineFlags = (() => {
    const lines = runs.map((r) => r.text).join("").split("\n");
    let pendingA = false;
    return lines.map((l) => {
      if (/^\s*◼/.test(l)) { pendingA = true; return "q"; }
      if (/^\s*★/.test(l)) return "star";
      if (pendingA && l.trim()) { pendingA = false; return "a"; }
      return null;
    });
  })();
  const styleFor = (r, flag) => {
    if (r.marker) return { opacity: 0 }; // マーカー文字は幅だけ確保して非表示（下の透明textareaと文字数を合わせる）
    const st = {};
    if (r.red) st.color = "#DC2645";
    else if (flag === "q") st.color = "#171A1F";
    else if (flag === "star") st.color = "#5F5138";
    if (!focused && r.bold) st.fontWeight = 800;
    else if (!focused && flag === "q") st.fontWeight = 600;
    else if (!focused && flag === "star") st.fontWeight = 500;
    return st;
  };
  /* Q./A. ラベル（qaGutter時）：textarea外の疑似UI。absolute＝行内の幅を1pxも取らない＝
     selectionStart/End・カーソル位置に一切影響しない。本文データにも文字を足さない。
     行頭で static position を使うので、その行の上端に揃う（line-heightを親と同じpx値にして上下中央） */
  const lineBoxPx = Math.round(fontSize * lineHeight);
  const gutterLabel = (flag, k) => {
    if (!qaGutter || (flag !== "q" && flag !== "a")) return null;
    const isQ = flag === "q";
    return (
      <span key={"g" + k} aria-hidden className="absolute select-none pointer-events-none"
        style={{ left: 10, fontSize: 11.5, fontWeight: isQ ? 700 : 500, lineHeight: lineBoxPx + "px", letterSpacing: "0.02em", color: isQ ? "#347ED6" : "#727985", fontFamily: "inherit" }}>
        {isQ ? "Q." : "A."}
      </span>
    );
  };
  const nodes = [];
  let li = 0, key = 0;
  const startLine = () => { const g = gutterLabel(lineFlags[li], key++); if (g) nodes.push(g); };
  startLine();
  runs.forEach((r) => {
    r.text.split("\n").forEach((p, idx) => {
      if (idx > 0) { nodes.push("\n"); li++; startLine(); }
      if (!p) return;
      const flag = lineFlags[li];
      const m = flag === "q" && !r.marker ? /^(\s*[◼■]\uFE0E?)([\s\S]*)$/.exec(p) : null;
      if (m) {
        // ◼︎ は種別色。Q.ラベルがある時は薄くして二重に主張させない（幅は保つ）
        nodes.push(<span key={key++} style={{ ...styleFor(r, flag), color: accent, opacity: qaGutter ? 0.35 : 1 }}>{m[1]}</span>);
        if (m[2]) nodes.push(<span key={key++} style={styleFor(r, flag)}>{m[2]}</span>);
      } else if (flag === "star" && !r.marker) {
        const sm = /^(\s*★)([\s\S]*)$/.exec(p);
        if (sm) {
          nodes.push(<span key={key++} style={{ ...styleFor(r, flag), color: "#B7812C" }}>{sm[1]}</span>);
          if (sm[2]) nodes.push(<span key={key++} style={styleFor(r, flag)}>{sm[2]}</span>);
        } else nodes.push(<span key={key++} style={styleFor(r, flag)}>{p}</span>);
      } else {
        nodes.push(<span key={key++} style={styleFor(r, flag)}>{p}</span>);
      }
    });
  });
  const padLeft = qaGutter ? 36 : undefined;

  const fmtBtn = "w-6 h-6 grid place-items-center rounded-md bg-white border border-stone-200 shadow-sm hover:bg-stone-50 text-[12px] leading-none";

  return (
    <div className="relative">
      {focused && (
        <div className="absolute -top-3.5 right-1 z-10 flex gap-1" onMouseDown={(e) => e.preventDefault()}>
          <button type="button" onClick={() => wrap("**")} title="太字（⌘B）" className={fmtBtn} style={{ fontWeight: 800 }}>B</button>
          <button type="button" onClick={() => wrap("!!")} title="赤文字（⌘⇧H）" className={fmtBtn} style={{ color: "#DC2645", fontWeight: 800 }}>A</button>
        </div>
      )}
      <div aria-hidden className="px-3 py-2" style={{ ...textStyle, minHeight: 38, color: "#2A2E34", paddingLeft: padLeft }}>
        {val ? nodes : <span className="text-stone-300">{placeholder || "クリックして原稿を入力（行頭に「・」で ◼︎ 質問行）"}</span>}
        {"\u200b"}
      </div>
      <textarea
        ref={taRef}
        {...imeWrapped}
        value={val}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={() => { setFocused(false); flush(); }}
        spellCheck={false}
        className="absolute inset-0 w-full h-full resize-none bg-transparent px-3 py-2 focus:outline-none"
        style={{ ...textStyle, color: "transparent", caretColor: "#1C1C1E", paddingLeft: padLeft }}
      />
    </div>
  );
}, cellPropsEqual);

/* 太字(**)・赤文字(!!)の装飾に対応し、内容に合わせて高さが伸びる入力欄。
   ScriptCellと同じマークアップ（⌘B / ⌘⇧H・ツールバーB/A）だが、構成台本特有の◼︎質問行の自動処理は持たない。
   ヒアリング等の自由記述で「全文が見える＋太字・色付け」を使いたい箇所向け。 */
const RichCell = React.memo(function RichCell({ value, onChange, placeholder, className = "", minHeight = 44, fontSize = 13, lineHeight = 1.45 }) {
  const taRef = useRef(null);
  const [focused, setFocused] = useState(false);
  const [val, set, flush, ime] = useBufferedField(value, (nv) => onChange({ target: { value: nv } }));
  const textStyle = { fontFamily: "inherit", fontSize, lineHeight, whiteSpace: "pre-wrap", overflowWrap: "break-word", wordBreak: "break-word" };
  const wrap = (mk) => {
    const ta = taRef.current; if (!ta) return;
    const next = toggleInlineMarker(val || "", ta.selectionStart, ta.selectionEnd, mk);
    set(next.value);
    requestAnimationFrame(() => { ta.focus(); ta.selectionStart = next.start; ta.selectionEnd = next.end; });
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
    const st = r.marker ? { opacity: 0 } : {}; // マーカー文字は幅だけ確保して非表示（下の透明textareaと文字数を合わせる）
    if (!r.marker) { if (r.red) st.color = "#DC2645"; if (!focused && r.bold) st.fontWeight = 800; }
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
      <textarea ref={taRef} {...ime} value={val}
        onChange={(e) => set(e.target.value)} onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); flush(); }}
        spellCheck={false}
        className="absolute inset-0 w-full h-full resize-none bg-transparent px-3 py-2 focus:outline-none"
        style={{ ...textStyle, color: "transparent", caretColor: "#1C1C1E" }} />
    </div>
  );
}, cellPropsEqual);

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
  const seek = (t) => { if (isMp4 && vref.current) { vref.current.currentTime = +t || 0; vref.current.pause(); setCur(+t || 0); } };
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
  // 共通も客別も“読み物”として整形表示（1行ずつ採用ボタンにすると読めない＝マニュアルとして使えない）。
  const isCommon = (channel || "").trim() === "編集マニュアル";
  if (!data.fixed && !data.distilled) return null;
  return (
    <div className="rounded-xl border mb-3 overflow-hidden" style={{ borderColor: main + "55", background: main + "0c" }}>
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 px-3 py-2 text-left">
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full text-white shrink-0" style={{ background: main }}>🧪 Flip-LAB</span>
        <span className="text-[12.5px] font-bold text-stone-800">{isCommon ? "編集マニュアル" : channel + " 編集ルール"}</span>
        <span className="ml-auto text-[10px] text-stone-400 shrink-0">{data.updated ? data.updated.slice(0, 10) : ""} {open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 border-t border-stone-200/60 pt-2 max-h-[56vh] overflow-y-auto mg-scroll">
          <div className="lab-md" style={{ "--lab": main }}>
            <style>{`
              .lab-md h3{font-size:14px;font-weight:700;color:#292524;margin:18px 0 7px;padding-bottom:5px;border-bottom:2px solid #e7e5e4}
              .lab-md h3:first-child{margin-top:2px}
              .lab-md h4{font-size:12.5px;font-weight:700;color:#44403c;margin:12px 0 5px}
              .lab-md p{font-size:12.5px;color:#44403c;margin:5px 0;line-height:1.85}
              .lab-md ul{padding-left:18px;margin:5px 0;list-style:disc}
              .lab-md li{font-size:12.5px;color:#44403c;margin:2px 0;line-height:1.75}
              .lab-md strong{color:var(--lab)}
              .lab-md code{background:#f5f5f4;border-radius:4px;padding:1px 5px;font-size:11.5px}
              .lab-md .wiz-tbl{overflow-x:auto;border:1px solid #e7e5e4;border-radius:10px;margin:8px 0}
              .lab-md .wiz-tbl table{border-collapse:collapse;width:100%;min-width:520px;font-size:11.5px}
              .lab-md .wiz-tbl th{background:#1c1917;color:#fff;padding:6px 9px;text-align:left;white-space:nowrap;font-weight:600}
              .lab-md .wiz-tbl td{border-top:1px solid #f0efee;padding:6px 9px;vertical-align:top;line-height:1.6;color:#44403c}
              .lab-md .wiz-tbl tr:nth-child(even) td{background:#fafaf9}
            `}</style>
            {data.fixed && <div className="mb-3"><div className="text-[10.5px] font-bold text-stone-500 mb-1 tracking-wide">確定ルール（人が設定・厳守）</div><div dangerouslySetInnerHTML={{ __html: wizMdHtml(data.fixed) }} /></div>}
            {data.distilled && <div>{!isCommon && <div className="text-[10.5px] font-bold text-stone-500 mb-1.5 tracking-wide">学習した傾向（確認コメントから自動蒸留）</div>}<div dangerouslySetInnerHTML={{ __html: wizMdHtml(data.distilled) }} /></div>}
          </div>
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
/* 縦ショート自動生成（たてがた君）＝納品段階で使う自己完結パネル。納品完了タブに置く。 */
function ShortsPanel({ videoKey, shareId, shareToken, onEnsureShare, onCopyGalleryUrl, accent, templateId, onTemplateChange }) {
  const [busy, setBusy] = React.useState(false);
  const [jobs, setJobs] = React.useState([]);
  const [items, setItems] = React.useState([]);
  // たてがた君の見た目テンプレ一覧（自社/演者色・フォント・境界線・カスタム全部）をWorker経由で取得。
  // IDを人間に直接入力させる旧仕様は「IDって何？」の詰まりを生んだため廃止（2026-08-18指摘）。
  const [shortsTemplates, setShortsTemplates] = React.useState(null); // null=読み込み中
  React.useEffect(() => {
    fetch(SHARE_API + "/api/shorts/templates").then((r) => r.json())
      .then((d) => setShortsTemplates((d && d.templates) || []))
      .catch(() => setShortsTemplates([]));
  }, []);
  // ダウンロードしないと中身が見えないのは非効率との指摘（2026-08-17）：クリックでその場再生できるプレビューを追加
  const [previewIdx, setPreviewIdx] = React.useState(null);
  // 先方に切り抜きショートをまとめて送るための共有URL（2026-08-20：個別URLでなく全部まとめて1本欲しい、との指摘で
  // 個別リンクから統合ギャラリーページ（/shorts/{snap}?r=<rtok>、全本を再生・DLできる）へ変更）。
  const [galleryCopied, setGalleryCopied] = React.useState(false);
  const copyGalleryUrl = async () => {
    if (!onCopyGalleryUrl) return;
    const ok = await onCopyGalleryUrl();
    if (ok !== false) { setGalleryCopied(true); setTimeout(() => setGalleryCopied(false), 1800); }
  };
  // ポーリングに世代管理を導入（2026-08-21 Codex調査で判明したバグ対策）。
  // 旧実装はキャンセル機構が無く、案件を切り替えても古いポーリングが動き続け、
  // 後から届く古い応答（生成中だった時点のスナップショット）が新しい案件の表示を
  // 上書きしていた（「昨日完了したはずのショートが今日また生成中に見える」の原因）。
  // gen（世代番号）を持たせ、shareId/shareToken変更時やアンマウント時に世代を進めて
  // 古いチェーンを無効化する。fetch失敗時も古いpending/processingを握り続けない。
  const pollGenRef = React.useRef(0);
  const pollList = React.useCallback((snap, token, tries = 0) => {
    pollGenRef.current += 1;
    const gen = pollGenRef.current;
    const step = async (n) => {
      if (n > 80 || gen !== pollGenRef.current) return;
      try {
        const r = await fetch(SHARE_API + "/api/shorts/list/" + snap + "?token=" + encodeURIComponent(token || ""), { cache: "no-store" });
        if (gen !== pollGenRef.current) return;
        const d = await r.json();
        if (gen !== pollGenRef.current) return;
        if (d && !d.error) {
          setItems(d.shorts || []); setJobs(d.jobs || []);
          if (!(d.jobs || []).some((j) => j.status === "pending" || j.status === "processing")) return;
        } else {
          setJobs((js) => js.filter((j) => j.status !== "pending" && j.status !== "processing"));
          return;
        }
      } catch (e) {
        if (gen !== pollGenRef.current) return;
        setJobs((js) => js.filter((j) => j.status !== "pending" && j.status !== "processing"));
        return;
      }
      setTimeout(() => step(n + 1), 5000);
    };
    step(tries);
  }, []);
  React.useEffect(() => {
    if (shareId) pollList(shareId, shareToken, 0);
    return () => { pollGenRef.current += 1; };
  }, [shareId, shareToken, pollList]);
  const running = jobs.some((j) => j.status === "pending" || j.status === "processing");
  const enqueue = async () => {
    if (!videoKey || busy || running) return;
    setBusy(true);
    try {
      const sh = await onEnsureShare();
      if (!sh) { setBusy(false); return; }
      const r = await fetch(SHARE_API + "/api/shorts/enqueue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ snap: sh.id, token: sh.token, videoKey, templateId: templateId || "" }) });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "登録に失敗しました");
      pollList(sh.id, sh.token, 0);
    } catch (e) { setJobs((js) => [{ id: "err_" + Date.now(), status: "error", error: String((e && e.message) || e) }, ...js]); }
    setBusy(false);
  };
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-3 mb-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-[12px] font-bold text-stone-600">🎬 たてがた君（縦ショート自動生成）</div>
        <div className="flex-1" />
        {items.length > 0 && (
          <button onClick={copyGalleryUrl}
            title="生成した全ショートをまとめて見せる先方用URLをコピー（開くだけで再生・DLできます）"
            className="text-[11px] font-bold px-3 py-1.5 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 inline-flex items-center gap-1">
            <Icon name="copy" className="w-3.5 h-3.5" />{galleryCopied ? "コピーしました" : "共有URL"}
          </button>
        )}
        <button onClick={enqueue} disabled={!videoKey || busy || running}
          title={!videoKey ? "先に動画確認で完成版をアップしてください" : running ? "既に生成中です" : "納品動画から縦型ショートを自動生成"}
          className="text-[11px] font-bold px-3 py-1.5 rounded-lg text-white disabled:opacity-50" style={{ background: accent }}>
          {busy || running ? "生成中…" : "ショート生成"}
        </button>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap mt-2">
        <span className="text-[10px] font-bold text-stone-400 shrink-0">見た目テンプレ</span>
        {shortsTemplates === null ? (
          <span className="text-[11px] text-stone-400">読み込み中…</span>
        ) : (
          <select value={templateId || ""} onChange={(e) => onTemplateChange && onTemplateChange(e.target.value)}
            className="text-[11px] border border-stone-200 rounded-lg px-2 py-1 bg-white text-stone-600 max-w-full">
            <option value="">既定（自動）</option>
            {shortsTemplates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        )}
      </div>
      {!videoKey && <div className="text-[11px] text-stone-400 mt-1.5">動画確認タブで完成版動画をアップすると、ここからショートを生成できます。</div>}
      {(busy || jobs.length > 0 || items.length > 0) && (
        <div className="mt-2">
          {busy && <div className="text-[11px] text-stone-500">📤 リクエストを送信中…</div>}
          {running && <div className="text-[11px] text-stone-500">⏳ 生成中…（Macでの処理待ち／実行中。数分かかることがあります）</div>}
          {(() => {
            // 過去に失敗したジョブが履歴に残っていても、その後成功していれば古いエラーは消す
            // （2026-08-20：再デプロイに巻き込まれて一度失敗→再実行で成功、というケースでUIにエラーが残り続けた）。
            // 直近のジョブがerrorの時だけ表示する。
            const latest = [...jobs].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))[0];
            return latest && latest.status === "error"
              ? <div className="text-[11px] text-rose-500">⚠️ {latest.error || "生成に失敗しました"}</div> : null;
          })()}
          {items.length > 0 && (
            <ul className="flex flex-wrap gap-2 mt-1.5">
              {items.map((f, i) => (
                <li key={f.key}>
                  <button onClick={() => setPreviewIdx(i)}
                    className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 inline-flex items-center gap-1">
                    🎬 {f.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {previewIdx != null && items[previewIdx] && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setPreviewIdx(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-2.5 flex items-center justify-between border-b border-stone-100">
              <span className="text-[12px] font-bold text-stone-700 truncate">{items[previewIdx].name}</span>
              <button onClick={() => setPreviewIdx(null)} className="shrink-0 w-6 h-6 rounded-lg grid place-items-center text-stone-400 hover:bg-stone-100"><Icon name="close" className="w-4 h-4" /></button>
            </div>
            <video key={items[previewIdx].key} controls autoPlay className="w-full max-h-[70vh] bg-black" src={SHARE_API + "/api/file/" + items[previewIdx].key} />
            <div className="px-4 py-2.5 flex items-center justify-between gap-2 border-t border-stone-100">
              <div className="flex items-center gap-1.5">
                <button onClick={() => setPreviewIdx((i) => Math.max(0, i - 1))} disabled={previewIdx === 0}
                  className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-stone-200 text-stone-500 hover:bg-stone-50 disabled:opacity-30">← 前</button>
                <button onClick={() => setPreviewIdx((i) => Math.min(items.length - 1, i + 1))} disabled={previewIdx === items.length - 1}
                  className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-stone-200 text-stone-500 hover:bg-stone-50 disabled:opacity-30">次 →</button>
              </div>
              <a href={SHARE_API + "/api/file/" + items[previewIdx].key + "?dl=1"} target="_blank" rel="noreferrer"
                className="text-[11px] font-bold px-3 py-1.5 rounded-lg text-white inline-flex items-center gap-1" style={{ background: accent }}>
                <Icon name="download" className="w-3.5 h-3.5" />ダウンロード
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* Q&A分解機能（Q7改定 Phase A・2026-08-15）: 動画確認の完了済みコメントを証跡として記録するUI。
   AIによる要約・パターン抽出はまだ無い（AK確認: 今回は証跡層のみ）。手動ボタン起点、resolved済みのみ対象。 */
function QaEvidencePanel({ projId, accent, accentText }) {
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [candidates, setCandidates] = React.useState(null); // null=未取得
  const [checked, setChecked] = React.useState({});
  const [savedCount, setSavedCount] = React.useState(null);
  const [msg, setMsg] = React.useState("");

  const loadSavedCount = async () => {
    try { const r = await authFetch("/api/qa-evidence/list", { projId }); setSavedCount((r.evidence || []).length); }
    catch (e) {}
  };
  React.useEffect(() => { if (projId) loadSavedCount(); }, [projId]);

  const openPanel = async () => {
    setOpen(true); setLoading(true); setMsg("");
    try {
      const r = await authFetch("/api/qa-evidence/candidates", { projId });
      const cs = r.candidates || [];
      setCandidates(cs);
      // 2026-08-15 QA中に発見: 全件デフォルト選択＋一覧がスクロール式だと、見えていない項目まで
      // まとめて確定してしまう事故が起きた（実案件で47件を誤確定）。「人間が確認してから記録する」
      // というPhase Aの設計意図にも反するため、初期状態は何も選択しない（明示的な選択を必須にする）。
      setChecked({});
    } catch (e) { setMsg("取得できませんでした：" + e.message); }
    finally { setLoading(false); }
  };

  const selectedCount = (candidates || []).filter((c) => checked[c.commentId]).length;
  const selectAll = () => setChecked(Object.fromEntries((candidates || []).map((c) => [c.commentId, true])));
  const selectNone = () => setChecked({});

  const confirm = async () => {
    const items = (candidates || []).filter((c) => checked[c.commentId]);
    if (!items.length) { setMsg("選択されていません"); return; }
    setLoading(true); setMsg("");
    try {
      await authFetch("/api/qa-evidence/confirm", { projId, items });
      setMsg(items.length + "件を証跡として確定しました");
      setCandidates((cs) => (cs || []).filter((c) => !checked[c.commentId]));
      await loadSavedCount();
    } catch (e) { setMsg("保存できませんでした：" + e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="mt-4 rounded-2xl border border-stone-200 p-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="text-[12px] font-bold text-stone-700">ナレッジ化（Q&A証跡）</div>
          <p className="text-[11px] text-stone-400 mt-0.5">
            対応完了のコメントをQ&A証跡として記録します（AI要約は無く、コメント本文と返信をそのまま記録）。
            {savedCount != null && <span> 確定済み {savedCount}件</span>}
          </p>
        </div>
        <button onClick={openPanel} disabled={loading}
          className="h-8 px-3 rounded-lg text-[11px] font-bold text-white shadow disabled:opacity-50"
          style={{ background: accent, color: accentText }}>
          このレビューをナレッジ化
        </button>
      </div>
      {open && (
        <div className="mt-2.5 border-t border-stone-100 pt-2.5">
          {loading && candidates == null ? (
            <p className="text-[11px] text-stone-400">読み込み中…</p>
          ) : (candidates && candidates.length) ? (
            <>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-stone-400">対応完了・未確定 {candidates.length}件（記録するものだけ選んでください）</span>
                <span className="flex items-center gap-2">
                  <button onClick={selectAll} className="text-[10px] font-bold text-stone-500 underline">全選択</button>
                  <button onClick={selectNone} className="text-[10px] font-bold text-stone-500 underline">全解除</button>
                </span>
              </div>
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {candidates.map((c) => (
                  <label key={c.commentId} className="flex items-start gap-2 text-[11px] p-1.5 rounded-lg hover:bg-stone-50 cursor-pointer">
                    <input type="checkbox" className="mt-0.5" checked={!!checked[c.commentId]}
                      onChange={(e) => setChecked((m) => ({ ...m, [c.commentId]: e.target.checked }))} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-500 inline-block mb-0.5">{c.category}</div>
                      <div className="text-stone-700">Q: {c.question}</div>
                      <div className="text-stone-400">A: {c.answer}</div>
                    </div>
                  </label>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <button onClick={confirm} disabled={loading || !selectedCount}
                  className="h-7 px-3 rounded-lg text-[11px] font-bold text-white disabled:opacity-50" style={{ background: accent, color: accentText }}>
                  {loading ? "保存中…" : `選択した${selectedCount}件を証跡として確定`}
                </button>
                <button onClick={() => setOpen(false)} className="h-7 px-3 rounded-lg text-[11px] font-bold text-stone-500 border border-stone-200">閉じる</button>
              </div>
            </>
          ) : candidates && !candidates.length ? (
            <p className="text-[11px] text-stone-400">対応完了かつ未確定のコメントはありません</p>
          ) : null}
          {msg && <p className="text-[11px] text-stone-500 mt-1.5">{msg}</p>}
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
  const [showOldVers, setShowOldVers] = React.useState(false);  // 旧版タブの折りたたみ（既定=最新のみ表示）
  const onDropVideo = (e) => { e.preventDefault(); setDropOver(false); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f && (f.type.startsWith("video/") || /\.(mp4|mov|m4v|webm)$/i.test(f.name || ""))) onUploadVideo(f); };
  const onDragOverVideo = (e) => { e.preventDefault(); if (!dropOver) setDropOver(true); };
  const [filter, setFilter] = React.useState("全部");
  const [cat, setCat] = React.useState("編集");
  const [prio, setPrio] = React.useState("中");
  const [text, setText] = React.useState("");
  const [yt, setYt] = React.useState("");
  const [replyText, setReplyText] = React.useState({});
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
    if (sel && sel.type === "youtube") { const p = ytPlayerRef.current; if (p && p.seekTo) { p.seekTo(+t || 0, true); if (p.pauseVideo) p.pauseVideo(); setCur(+t || 0); } return; }
    if (vref.current) { vref.current.currentTime = +t || 0; vref.current.pause(); setCur(+t || 0); }
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
        {(() => {
          const latestId = versions.length ? versions[versions.length - 1].id : null;
          const shown = showOldVers ? versions : versions.filter((v) => v.id === latestId || v.id === sel.id);
          const hidden = versions.filter((v) => !shown.some((x) => x.id === v.id));
          const openOf = (vv) => comments.filter((c) => (c.versionId === vv.id || (c.videoKey || "") === (vv.key || vv.url || "")) && cstat(c) !== "完了").length;
          const hiddenOpen = hidden.reduce((n, vv) => n + openOf(vv), 0);
          return (<React.Fragment>
            {hidden.length > 0 && (
              <button onClick={() => setShowOldVers(true)}
                className="shrink-0 px-2.5 py-1.5 rounded-lg text-[12px] font-bold border bg-white text-stone-500 border-stone-200 hover:bg-stone-50"
                title="過去のバージョンを表示">
                旧版 {hidden.length} ▸
                {hiddenOpen > 0 && <span className="ml-1 text-[10px] px-1.5 rounded-full text-white" style={{ background: accent }}>{hiddenOpen}</span>}
              </button>
            )}
            {showOldVers && versions.length > 1 && (
              <button onClick={() => setShowOldVers(false)}
                className="shrink-0 px-2 py-1.5 rounded-lg text-[12px] font-bold text-stone-400 hover:text-stone-600" title="旧版を隠す">◂ 隠す</button>
            )}
            {shown.map((v) => {
              const on = v.id === sel.id;
              const open = openOf(v);
              return (
                <button key={v.id} onClick={() => setSelId(v.id)}
                  className={"shrink-0 px-3 py-1.5 rounded-lg text-[12px] font-bold border " + (on ? "text-white" : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50")}
                  style={on ? { background: main, borderColor: main } : {}}>
                  {v.label}<span className="font-normal opacity-80 ml-1">{v.name && v.name !== v.label ? v.name : ""}</span>
                  {open > 0 && <span className="ml-1.5 text-[10px] px-1.5 rounded-full" style={{ background: on ? "rgba(255,255,255,.25)" : accent, color: "#fff" }}>{open}</span>}
                </button>
              );
            })}
          </React.Fragment>);
        })()}
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
        <button onClick={() => { if (window.confirm(sel.label + " を削除しますか？（7日間はゴミ箱から復元できます。コメントは残ります）")) onRemoveVersion(sel.id); }} className="text-[11px] text-stone-400 hover:text-rose-500 font-bold">この版を削除</button>
      </div>
      <VersionTrashPanel items={trashedVersions} onRestore={onRestoreVersion} />
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
              <span className="text-[10px] text-stone-400 ml-2">Enter/Space=再生停止　←→=5秒（Shiftで1秒）</span>
              {sel.key && (
                <a href={SHARE_API + "/api/file/" + sel.key + "?dl=1"} target="_blank" rel="noreferrer"
                  title="この版のオリジナルmp4（アップした元データそのまま）をダウンロード"
                  className="ml-auto text-[11px] font-bold px-3 py-1.5 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 inline-flex items-center gap-1 shrink-0">
                  ⬇ 元mp4をDL
                </a>
              )}
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
          <div className="space-y-2 max-h-[60vh] overflow-y-auto mg-scroll pr-1">
            {filtered.length === 0 && <p className="text-[11px] text-stone-400 py-4 text-center">修正はありません</p>}
            {filtered.map((c) => {
              const st = cstat(c);
              return (
                <div key={c.id} className="rounded-xl border border-stone-200 bg-white p-2.5">
                  <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                    <button onClick={() => onUpdate(c.id, { status: st === "完了" ? "未対応" : "完了" })} title={st === "完了" ? "対応済みを解除" : "対応済みにする"} className={"w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 text-[11px] font-bold leading-none " + (st === "完了" ? "text-white" : "border-stone-300 text-transparent hover:border-emerald-400 hover:text-emerald-400")} style={st === "完了" ? { background: "#16A34A", borderColor: "#16A34A" } : {}}>✓</button>
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

const MIGRATED_WIZARD_QUESTIONS = [
  [1, "いま、何を企画しようとしているのか？", "まず表層の建前を出す"],
  [2, "それをやらないと、何が困るのか？", "願望ではなく欠落・痛みから掘る"],
  [3, "本当に理解したい対象は、人か、状態か、構造か？", "属性から認知状態へ移す"],
  [4, "この企画の種は、どの出来事から来ているのか？", "抽象から具体的な原体験へ戻す"],
  [5, "複数の出来事に共通する構造は何か？", "企画の背骨を見つける"],
  [6, "その構造の奥で、世界をどんな場所だと思っているか？", "無意識の世界モデルを言葉にする"],
  [7, "相手の身体は何に反応するのか？", "思考より手前の一次反応まで降りる"],
  [8, "この企画が壊そうとしている思い込みは何か？", "敵を人物ではなく古い認識に置く"],
  [9, "受け手の世界モデルは、どこで矛盾しているか？", "すでにある揺れを特定する"],
  [10, "受け手の世界モデルは、どこからどこへ更新されるか？", "認識のBefore/Afterを明示する"],
  [11, "この企画の成果として、本当は何を欲しているか？", "数字の下にある本音の指標を定める"],
  [12, "これは一度きりの企画か、それとも実験場か？", "継続して検証する装置として考える"],
  [13, "受け手は、誰に何と言ってこれを差し出すか？", "共有の連鎖を設計する"],
].map(([num, text, hint]) => ({ num: "Q" + num, text, hint }));

function WizardPane({ project, setProject, theme, setTab }) {
  const wiz = project.wizard || newWizard();
  const m = wiz.meta || {};
  const ans = wiz.answers || {};
  const [questions, setQuestions] = useState(MIGRATED_WIZARD_QUESTIONS);
  const [qErr, setQErr] = useState("");
  const [qIdx, setQIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [genErr, setGenErr] = useState("");
  const [sugBusy, setSugBusy] = useState(false);
  const [view, setView] = useState("form"); // AI生成は廃止（コピペでClaudeへ）。常にフォーム
  const [copied, setCopied] = useState(false);
  const taRef = useRef(null);

  // 質問テンプレはFlip-LABからObsidianへ移行済み。実行時に旧Workerへ問い合わせない。
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
  // 質問13＋回答＋前提を丸ごとコピー → Claudeに貼って骨を作ってもらう運用（AI消費を自前で持たない）
  const copyForClaude = async () => {
    const metaText = [["演者・対象", m.performer], ["ジャンル・業種", m.genre], ["撮影想定", m.shoot], ["想定尺", m.length]]
      .filter(([, v]) => (v || "").trim()).map(([k, v]) => "・" + k + "：" + v).join("\n");
    const qa = (questions || []).map((qq) => "Q" + qq.num + "（" + qq.text + "）\n→ " + ((ans[qq.num] || "").trim() || "（未回答・現場で埋める）")).join("\n\n");
    const text =
      "以下は密着ドキュメンタリーの取材メモです。この前提と13の質問への回答をもとに、視聴維持を意識した密着台本の骨（ロケ／シーン割り／各シーンで演者に投げる質問）を作ってください。\n\n" +
      "■案件の前提\n" + (metaText || "（未記入）") + "\n\n■認識OS 13の質問と回答\n" + qa;
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch (e) {}
  };
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

      {/* リード文 */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <p className="text-[12px] text-stone-500">認識OSの<span className="font-bold">13の質問</span>。思いつく範囲で埋めたら<span className="font-bold" style={{ color: theme.accent }}>「Claudeにコピー」</span>で丸ごとコピー → Claudeに貼れば、密着台本の骨（シーン割り・現場で投げる質問・訴求の置き場所）を作れます。空欄は現場で埋める質問リストに。</p>
      </div>

      {view === "form" && (
        <>
          {/* 案件の前提 */}
          <div className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <h2 className="text-[13px] font-bold text-stone-800">案件の前提<span className="ml-2 text-[10px] font-normal text-stone-400">埋めるほどコピー内容が濃くなります（空欄でもOK）</span></h2>
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
                    : <button onClick={copyForClaude} className="text-[12px] font-bold px-5 py-2 rounded-lg text-white shadow-sm inline-flex items-center gap-1.5" style={{ background: theme.accent }}><Icon name="sparkle" className="w-3.5 h-3.5" />{copied ? "コピーした！" : "Claudeにコピー"}</button>}
                </div>
              </div>
            </div>
          )}

          {/* コピーバー：質問＋回答をClaudeに持っていく */}
          {questions && (
            <div className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5 flex items-center justify-between gap-3 flex-wrap sticky bottom-2 shadow-sm">
              <div className="text-[12px] text-stone-500"><span className="font-bold text-stone-700">{answered}</span> / {total} 問 回答済み{answered < total && <span className="text-stone-400">　空欄は現場で埋める質問リストになります</span>}</div>
              <button onClick={copyForClaude} className="text-[13px] font-bold px-5 py-2.5 rounded-lg text-white shadow-sm inline-flex items-center gap-2" style={{ background: theme.accent }}>
                <Icon name="sparkle" className="w-4 h-4" />{copied ? "コピーした！Claudeに貼ってね" : "質問＋回答をClaudeにコピー"}
              </button>
            </div>
          )}
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
  const activeIdRef = useRef(null);   // 常に最新のactiveId。アップロード等の非同期処理が完了した時点で
  activeIdRef.current = activeId;     // 案件を切り替えられていないか判定するのに使う（closureのactiveIdは開始時点で固定される）
  const [project, setProject] = useState(null);  // 現在編集中の案件データ
  const [channelInfo, setChannelInfo] = useState({}); // {channelName: {name,url,concept,target,purpose,competitors[]}}
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState("");
  const [highlightCollapsed, setHighlightCollapsed] = useState(() => { try { return localStorage.getItem("mg:hlCollapsed") !== "0"; } catch (e) { return true; } }); // 既定=最小化・状態記憶
  const [spineOpen, setSpineOpen] = useState(() => { try { return localStorage.getItem("mg:spineOpen") === "1"; } catch (e) { return false; } }); // 既定=最小化・状態記憶
  // マインドマップ（Studio OS Phase 1実装の移植・2026-08-15）。Studio OS内では構成台本タブの
  // 独自編集UI廃止（Q10）に伴い表示先を失い退役していたが、AK「理想はものがたりっち内に入れて
  // アプデしたい」の方針により、こちらの構成台本タブへ「物語の背骨」の下の折りたたみセクションとして
  // 移植する。データは既存のdeliverableSpineBeats/phaseSeq/STORY_FRAMEWORKSをそのまま使い、
  // マインドマップ専用のコピーは持たない（表示専用、Business LogicはReact側に新規実装しない）。
  const [mmOpen, setMmOpen] = useState(() => { try { return localStorage.getItem("mg:mmOpen") === "1"; } catch (e) { return false; } });
  const [prepView, setPrepView] = useState("hearing"); // 取材メモタブ内の切替：聞き取りシート / 質問ウィザード
  const [hearingTocActive, setHearingTocActive] = useState(null);
  const [collapsedFolders, setCollapsedFolders] = useState({}); // 素材管理：フォルダ(シーン)ごとの開閉
  const toggleSpine = () => setSpineOpen((v) => { const nv = !v; try { localStorage.setItem("mg:spineOpen", nv ? "1" : "0"); } catch (e) {} return nv; });
  const toggleMm = () => setMmOpen((v) => { const nv = !v; try { localStorage.setItem("mg:mmOpen", nv ? "1" : "0"); } catch (e) {} return nv; });
  const toggleHighlight = () => setHighlightCollapsed((v) => { const nv = !v; try { localStorage.setItem("mg:hlCollapsed", nv ? "1" : "0"); } catch (e) {} return nv; });
  // PC縦タブレールの sticky 追従用にヘッダー実高さを測る（flex-wrapで高さ可変のため固定値にしない）
  const headerRef = useRef(null);
  const [headerH, setHeaderH] = useState(56);
  useEffect(() => {
    const el = headerRef.current; if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setHeaderH(el.offsetHeight));
    ro.observe(el); setHeaderH(el.offsetHeight);
    return () => ro.disconnect();
  }, []);
  const [spineFw, setSpineFwState] = useState(() => { try { return localStorage.getItem("mg:spineFw") || "spine"; } catch (e) { return "spine"; } });
  const setSpineFw = (k) => { setSpineFwState(k); try { localStorage.setItem("mg:spineFw", k); } catch (e) {} };
  // マインドマップ専用のUndo/Redo（⌘Z/⌘⇧Z）。rows・メモ・位置・幅をまとめて1スナップショットとして積む
  const mmUndoRef = useRef([]);
  const mmRedoRef = useRef([]);
  const mmSnapshot = () => ({ rows: project.rows, mindmapNotes: project.mindmapNotes, mindmapPos: project.mindmapPos, mindmapWidth: project.mindmapWidth });
  const pushMmUndo = () => { mmUndoRef.current = [...mmUndoRef.current.slice(-49), mmSnapshot()]; mmRedoRef.current = []; };
  const mmUndo = () => {
    const snap = mmUndoRef.current.pop();
    if (!snap) return;
    mmRedoRef.current.push(mmSnapshot());
    setProject((p) => ({ ...p, ...snap }));
  };
  const mmRedo = () => {
    const snap = mmRedoRef.current.pop();
    if (!snap) return;
    mmUndoRef.current.push(mmSnapshot());
    setProject((p) => ({ ...p, ...snap }));
  };
  // マインドマップの各ステップに「ここで何を話すか」を書けるメモ（フレームワーク別にキー分離、台本の行はまだ作らない＝Phase1）
  const setMindmapNote = (sectionId, text) => {
    pushMmUndo();
    setProject((p) => ({ ...p, mindmapNotes: { ...(p.mindmapNotes || {}), [spineFw + ":" + sectionId]: text } }));
  };
  // マインドマップのノード手動配置（D&D）。フレームワーク別にキー分離してmindmapNotesと同じ規約に揃える
  const setMindmapPos = (nodeId, pos) => {
    pushMmUndo();
    setProject((p) => ({ ...p, mindmapPos: { ...(p.mindmapPos || {}), [spineFw + ":" + nodeId]: pos } }));
  };
  // ノード幅の手動調整（D&Dリサイズ）。位置と同じキー規約
  const setMindmapWidth = (nodeId, w) => {
    pushMmUndo();
    setProject((p) => ({ ...p, mindmapWidth: { ...(p.mindmapWidth || {}), [spineFw + ":" + nodeId]: w } }));
  };
  // 「整列」は位置・幅の手動調整を両方リセットして自動レイアウトに戻す（Undo対象外＝いつでも手動配置に戻せるため）
  const clearMindmapPos = (nodeIds) => {
    setProject((p) => {
      const nextPos = { ...(p.mindmapPos || {}) };
      const nextWidth = { ...(p.mindmapWidth || {}) };
      nodeIds.forEach((id) => { delete nextPos[spineFw + ":" + id]; delete nextWidth[spineFw + ":" + id]; });
      return { ...p, mindmapPos: nextPos, mindmapWidth: nextWidth };
    });
  };
  const [spineDrag, setSpineDrag] = useState(null);          // 背骨のD&D {from, over}（ロケブロックごと並べ替え）
  const [deliverBusy, setDeliverBusy] = useState(false);
  const [saveState, setSaveState] = useState("ok");   // ok | error（クラウド保存の状態。回線断のsilent lost可視化）
  const [showTheme, setShowTheme] = useState(false);
  // 選択ページはリロードしても保持（ツリービューの「現在地が消えない」ため）。共有/ライブの?tab=指定が最優先。
  const [tab, setTab] = useState(() => { try { return localStorage.getItem("mg:tab") || "overview"; } catch (_) { return "overview"; } }); // overview | plan | script | kouban | assets | review | deliver | concept
  // タブ切替時にmainへ入場フェードを付け直す（remountなし＝状態・スクロール副作用ゼロ）
  const mainRef = useRef(null);
  useEffect(() => {
    const el = mainRef.current; if (!el) return;
    el.classList.remove("mg-tab-in");
    void el.offsetWidth; // reflowでアニメ再発火
    el.classList.add("mg-tab-in");
  }, [tab]);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [showFullImport, setShowFullImport] = useState(false);
  const [fullImportText, setFullImportText] = useState("");
  const [aiParsing, setAiParsing] = useState(false);
  const [importTarget, setImportTarget] = useState("new"); // "new" = 新規案件 / "current" = 開いている案件を更新
  const [importFileName, setImportFileName] = useState("");
  const importFileRef = useRef(null);
  const [importValidation, setImportValidation] = useState(null); // { isValid: bool, error: string, format: 'json' | 'text' | null }
  const [sidebarOpen, setSidebarOpen] = useState(() => { try { return window.self === window.top; } catch (e) { return true; } });  // Fボード埋め込み時は初期閉じ（左ツリーとダブらせない）
  const [user, setUser] = useState(null);                   // ログイン中のGoogleユーザー（null=未ログイン）
  const [showAccount, setShowAccount] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [cfStream, setCfStream] = useState({ loading: false, connected: false, accountName: "", legacyAllowed: false });
  const [cfBusy, setCfBusy] = useState(false);
  const [connections, setConnections] = useState(null);
  const [connectionsOpen, setConnectionsOpen] = useState(true);
  const gbtnRef = useRef(null);
  const [showAssistant, setShowAssistant] = useState(false);
  const [assistantText, setAssistantText] = useState("");
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantSummary, setAssistantSummary] = useState("");
  const [transcriptBusy, setTranscriptBusy] = useState(false);
  const [transcriptStep, setTranscriptStep] = useState(null); // "skeleton" | "fillqa" | null（ボタンごとの進行中表示）
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
  const [shareAudience, setShareAudience] = useState(null); // 動画共有先の選択（先方／編集者）
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
  const [secEdit, setSecEdit] = useState(null);             // Scene Row の尺をクリック編集中のシーンid
  const [collapsed, setCollapsed] = useState({});           // {channel: true} で折りたたみ
  /* ===== サイドバーのツリービュー化（2026-07-31）=====
     案件一覧と工程タブが左右2本のレールに分かれていて、現在地を掴むのに視線を横移動させられていた。
     チャンネル → 案件 → 案件内ページ を1本のツリーに畳んで、本文の幅も広げる。
     展開状態・選択ページ・サイドバー幅はリロードしても残す（毎回開き直す手間を消す）。 */
  const [treeOpen, setTreeOpen] = useState(() => { try { return JSON.parse(localStorage.getItem("mg:treeOpen") || "{}") || {}; } catch (_) { return {}; } });
  const [sidebarW, setSidebarW] = useState(() => { const n = parseInt(localStorage.getItem("mg:sidebarW") || "", 10); return (n >= 220 && n <= 420) ? n : 280; });
  const [caseQuery, setCaseQuery] = useState("");           // 案件名の絞り込み（案件が増えても探せる）
  const resizingRef = useRef(false);
  useEffect(() => { try { localStorage.setItem("mg:treeOpen", JSON.stringify(treeOpen)); } catch (_) {} }, [treeOpen]);
  useEffect(() => { try { localStorage.setItem("mg:tab", tab); } catch (_) {} }, [tab]);
  /* 保存した選択ページが今の案件に存在しない場合の正規化。
     例：密着案件で「取材メモ」を開いたままトーク案件を開くと、その案件に取材メモは無い＝
     ツリーのどこも選ばれておらず本文も空、という迷子になる（縦レールを廃止したので逃げ道が無い）。 */
  useEffect(() => {
    if (!project) return;
    const talk = project.format === "talk";
    const valid = ["overview", "regulations", "plan", ...(talk ? [] : ["hearing"]), "script", ...(talk ? [] : ["mindmap"]), ...(talk ? [] : ["kouban"]), "assets", "review", "deliver", "concept"]
      .filter((k) => !LIVE_ONLY_TABS || LIVE_ONLY_TABS.includes(k));
    if (!valid.includes(tab)) setTab(valid[0] || "overview");
  }, [project && project.format, project && project.id, tab]);
  useEffect(() => { try { localStorage.setItem("mg:sidebarW", String(sidebarW)); } catch (_) {} }, [sidebarW]);
  // サイドバー幅のドラッグ。ポインタイベントをwindowで拾う＝速く動かしても外れない
  useEffect(() => {
    const onMove = (e) => { if (!resizingRef.current) return; e.preventDefault(); setSidebarW(Math.max(220, Math.min(420, e.clientX))); };
    const onUp = () => { if (!resizingRef.current) return; resizingRef.current = false; document.body.style.cursor = ""; document.body.style.userSelect = ""; };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, []);
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [dragIds, setDragIds] = useState(null);             // 複数行ドラッグ中のid配列
  const [dragCaseId, setDragCaseId] = useState(null);        // サイドバー：ドラッグ中の案件id
  const [dragOverCaseId, setDragOverCaseId] = useState(null); // サイドバー：ドラッグ先の案件id
  const [selectedIds, setSelectedIds] = useState([]);       // 複数選択中の行id
  const [painting, setPainting] = useState(false);          // チェック欄ドラッグ選択中
  const [isNarrow, setIsNarrow] = useState(false);          // スマホ幅（操作列を隠す等）
  /* 構成台本の見せ方。"stack"＝上下積み（原稿が全幅・既定）／"table"＝旧・横並びテーブル。
     表は左5列で520px使って原稿が右半分に寄り、縦に長い行ほど左が空白になって読みづらかった。 */
  const [scriptLayout, setScriptLayout] = useState(() => {
    try { return localStorage.getItem("mg:scriptLayout") === "table" ? "table" : "stack"; } catch (e) { return "stack"; }
  });
  const stacked = isNarrow || scriptLayout === "stack";
  const toggleScriptLayout = () => setScriptLayout((v) => {
    const nx = v === "table" ? "stack" : "table";
    try { localStorage.setItem("mg:scriptLayout", nx); } catch (e) {}
    return nx;
  });
  // 構成台本タブ：台本の編集画面／マインドマップの表示切替（Phase3）
  const [scriptView, setScriptView] = useState("table");
  const lastSelRef = useRef(null);                          // shift範囲選択の起点
  /* ヒアリング：文字起こし取込 */
  const [hearingImport, setHearingImport] = useState(null); // { raw } モーダル開いてる時 or null
  const [hearingBusy, setHearingBusy] = useState(false);
  /* 共有・コメント */
  const [shareModal, setShareModal] = useState(null);       // {url, id} or null
  const [preflight, setPreflight] = useState(null);         // MONOGATARI内の公開前チェック画面
  const [preflightBusy, setPreflightBusy] = useState(false);
  const [studioRegs, setStudioRegs] = useState({ rules: [] }); // Studio OSで承認済みのregulation_rules（PRD実装順⑥、openPublishPreflightで都度取得）
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
  /* KV書込み枠（無料枠1,000回/日）の枯渇対策。2026-07-27に実際に枯れて、
     その日の編集がまるごと保存されず消えた（矢内さん案件）。原因は
     ①0.7秒デバウンスの案件保存 ②4秒デバウンスの共有自動再発行(1回2書込)
     ③枯れた後も8秒毎に無限リトライして枠を焼き続ける、の3つ。 */
  const lastSaveSigRef = useRef("");     // 直前に保存した内容の指紋。同じ内容は書かない
  const histBaseRef = useRef(null);      // 履歴の比較基準（直近に保存した時点のスナップショット）
  const histCacheRef = useRef({ id: "", entries: null }); // 現案件の履歴（毎回読みに行かない）
  const [histOpen, setHistOpen] = useState(false);
  const [histList, setHistList] = useState([]);
  const lastChSaveRef = useRef("");      // チャンネル設定の直前保存内容（同上）
  const quotaUntilRef = useRef(0);       // 上限に当たった→このtimestampまで書込を一切止める（UTC0時＝JST9時にリセット）
  const retryDelayRef = useRef(8000);    // 保存リトライの間隔（失敗ごとに倍→最大10分）
  const liveWS = useRef(null);          // リアルタイム編集の WebSocket
  const lastRemoteRef = useRef("");     // 直近に受信した project JSON（自分の送信エコー抑止）
  const liveSendTimer = useRef(null);
  const liveOwnerRef = useRef(false);   // ライブ編集中の自分＝案件所有者（本体コピーを持つ）か。所有者ならライブ中も本体へ追従保存する
  const liveCollabRef = useRef(false);  // 上記所有がcollab案件（本体保存の宛先が /api/collab/upsert）か
  const liveOwnSaveTimer = useRef(null);
  const collabBaseRef = useRef({});     // {id:{updatedAt, base}} collab保存の競合検知用＝最後に見たサーバ版
  /* 動画確認＋ファイル転送 */
  const [showMediaModal, setShowMediaModal] = useState(false); // 動画/ファイル登録モーダル
  const [mediaTarget, setMediaTarget] = useState("project");   // 動画/ファイルの対象 "project"|planId
  const [ytInput, setYtInput] = useState("");                // YouTube URL入力
  const [retention, setRetention] = useState(90);            // アップロードの保存期限（日）。0=無期限
  const [mediaBusy, setMediaBusy] = useState("");            // アップロード中の表示メッセージ
  const [mediaProg, setMediaProg] = useState(0);             // アップロード進捗 0-100
  // 動画確認への動画アップロードを直列化するキュー。mediaBusy/mediaProgは1個の共有stateなので
  // 同時に2本上げると先に終わった方の setMediaBusy("") が後発の進捗表示を消し、
  // 「アップロードできていないように見える」事故になる（2026-08-19判明）。直列化して1本ずつ確実に進める。
  const uploadQueueRef = useRef(Promise.resolve());
  const uploadQueuePendingRef = useRef(0);   // 待ち行列の本数（2本目以降を上げたときの案内表示用）
  const [assetUp, setAssetUp] = useState(null);              // 素材管理のアップ進捗 {cat, name, pct}
  const [thumbUp, setThumbUp] = useState(null);               // 納品完了タブのサムネ画像アップ進捗 {pct}
  const [thumbDropOver, setThumbDropOver] = useState(false);   // 納品完了タブのサムネ画像D&D中フラグ
  // サムネの全画面プレビュー（2026-08-19 AK「サムネ見づらい。クリックで拡大・全画面で」）
  // {items:[{key,label}], idx}。Esc=閉じる / ←→=前後。差し替えは画像クリックから「差替」ボタンへ分離
  const [thumbLightbox, setThumbLightbox] = useState(null);
  useEffect(() => {
    if (!thumbLightbox) return;
    const onKey = (e) => {
      if (e.key === "Escape") setThumbLightbox(null);
      if (e.key === "ArrowRight") setThumbLightbox((lb) => lb && { ...lb, idx: (lb.idx + 1) % lb.items.length });
      if (e.key === "ArrowLeft") setThumbLightbox((lb) => lb && { ...lb, idx: (lb.idx - 1 + lb.items.length) % lb.items.length });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [!!thumbLightbox]);
  const shareUpTokRef = useRef("");                          // 編集者用アップロードトークン（&up=）。publish応答から取得
  const shareReadTokRef = useRef("");                        // 閲覧用トークン（&r=）。新方式snapの共有URLに必須。publish応答から取得
  const shareTokenRef = useRef("");                          // 直近publishのshareToken。setProjectが非同期なのでアップ直後に最新tokenを引くため
  const [globalManuals, setGlobalManuals] = useState([]);    // 全体の決め事（スタジオ共通）
  const [sched, setSched] = useState(null);                  // Flip Board(D1正本)から引いた日程スライス＝編集者ビューの進行ストリップ。読み取り専用
  const [showManual, setShowManual] = useState(false);       // マニュアルモーダル
  const [manualScope, setManualScope] = useState("channel"); // global | channel | case（基本はクライアント単位）

  /* フォント */
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700;900&family=IBM+Plex+Mono:wght@400;600;700&display=swap";
    document.head.appendChild(link);
  }, []);

  /* インポートテキストのリアルタイムバリデーション */
  useEffect(() => {
    const text = fullImportText.trim();
    if (!text) {
      setImportValidation(null);
      return;
    }
    // JSONとして試す
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        JSON.parse(text);
        setImportValidation({ isValid: true, format: "json", error: null });
        return;
      } catch (e) {
        setImportValidation({ isValid: false, format: "json", error: `JSON形式エラー: ${e.message}` });
        return;
      }
    }
    // TSV/プレーンテキスト（自動判定で処理可能）
    setImportValidation({ isValid: true, format: "text", error: null });
  }, [fullImportText]);

  /* インポートダイアログのドラッグ&ドロップ対応 */
  const handleImportDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };
  const handleImportDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length > 0) {
      importFileRef.current = { files };
      onPickImportFile({ target: { files } });
    }
  };

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

      // Studio OS連携: 新規案件の自動作成（?new=1&title=...&token=...）。既存indexの有無を問わず
      // 最優先で処理する（indexが空＝初回起動のブラウザでも動く必要があるため、この後の
      // 「indexが無ければ初期案件を作る」分岐より前に置く）。
      // Studio OS側に未紐付けのDeliverableがある時、Studio OSがこのURLを新規タブで開く。
      // ここで案件を作成し、Studio OSへ新規案件idを一方向Webhookで報告する（Studio OSはこの結果を
      // 受けてdeliverables.mgProjectIdを更新するだけ・ものがたりっち側の認証を肩代わりする経路は
      // 作らない設計）。報告後はURLを?case=<新id>へ置き換え、以後は通常の?case=経路で開ける。
      let urlNew = null;
      try { urlNew = new URLSearchParams(location.search).get("new"); } catch (e) {}
      if (urlNew === "1") {
        const sp = new URLSearchParams(location.search);
        const title = (sp.get("title") || "新規案件").slice(0, 200);
        const token = sp.get("token") || "";
        const data = newProjectData(title);
        try {
          await window.storage.set(STORE_PROJ(data.id), JSON.stringify(data));
          const newIdx = [...(idx || []).map((x) => ({ ...x, channel: x.channel || DEFAULT_CHANNEL })), { id: data.id, name: data.name, channel: data.channel, createdAt: data.createdAt }];
          setIndex(newIdx); await persistIndex(newIdx);
          setActiveId(data.id); setProject(data); setTab("overview"); setView("editor"); setLoaded(true);
          try { history.replaceState(null, "", location.pathname + "?case=" + encodeURIComponent(data.id)); } catch (e) {}
          if (token) {
            fetch("https://studio-os-5dm.pages.dev/api/v1/public/mg-link", {
              method: "POST", headers: { "content-type": "application/json" },
              body: JSON.stringify({ token, mgProjectId: data.id }),
            }).then((r) => r.json()).then(async (linked) => {
              const gateToken = linked && linked.data && linked.data.gateToken;
              if (!gateToken) return;
              const linkedProject = { ...data, studioGateToken: gateToken };
              setProject(linkedProject);
              await window.storage.set(STORE_PROJ(data.id), JSON.stringify(linkedProject));
            }).catch((e) => console.error("Studio OSへの紐付け報告に失敗", e));
          }
        } catch (e) { showToast("案件を作成できませんでした（通信）。回線を確認してもう一度お試しください"); setLoaded(true); }
        return;
      }

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
          if (data) {
            const gateToken = new URLSearchParams(location.search).get("gateToken");
            if (gateToken) {
              data.studioGateToken = gateToken;
              try { await window.storage.set(STORE_PROJ(hitId), JSON.stringify(data)); } catch (e) {}
            }
            setActiveId(hitId); setProject(data); setView("editor");
            // Studio OS連携: ?tab=でタブ直接指定（香盤表/動画確認/納品等への1クリック遷移用）
            // 不正値は下の「保存した選択ページの正規化」useEffectがoverviewへ補正するので、
            // ここでは軽くホワイトリスト検証するのみ
            const wantTab = new URLSearchParams(location.search).get("tab");
            if (wantTab && ["overview", "plan", "hearing", "script", "mindmap", "kouban", "assets", "review", "deliver", "concept"].includes(wantTab)) {
              setTab(wantTab);
            }
            setLoaded(true); return;
          }
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

  const loadCfStreamStatus = async () => {
    if (!MG_SESSION) { setCfStream({ loading: false, connected: false, accountName: "", legacyAllowed: false }); return; }
    setCfStream((s) => ({ ...s, loading: true }));
    try {
      const [r, ar] = await Promise.all([
        fetch(SHARE_API + "/api/cf/status", { headers: { Authorization: "Bearer " + MG_SESSION } }),
        fetch(SHARE_API + "/api/account/connections", { headers: { Authorization: "Bearer " + MG_SESSION } }),
      ]);
      const d = await r.json();
      setCfStream({ loading: false, connected: !!d.connected, accountName: d.accountName || "", legacyAllowed: !!d.legacyAllowed });
      if (ar.ok) setConnections(await ar.json());
    } catch (e) { setCfStream((s) => ({ ...s, loading: false })); }
  };
  const connectCloudflare = async () => {
    if (!MG_SESSION) { showToast("先にGoogleでログインしてください"); return; }
    setCfBusy(true);
    try {
      const r = await fetch(SHARE_API + "/api/cf/connect/start", {
        method: "POST", headers: { Authorization: "Bearer " + MG_SESSION, "Content-Type": "application/json" }, body: "{}",
      });
      const d = await r.json();
      if (!r.ok || !d.url) throw new Error(d.error || "接続を開始できません");
      location.href = d.url;
    } catch (e) { showToast("Cloudflare接続：" + (e.message || e)); setCfBusy(false); }
  };
  const disconnectCloudflare = async () => {
    if (!window.confirm("自分のCloudflare Streamとの接続を解除しますか？\n既にアップロード済みの動画はCloudflare側に残ります。")) return;
    setCfBusy(true);
    try {
      const r = await fetch(SHARE_API + "/api/cf/connect", { method: "DELETE", headers: { Authorization: "Bearer " + MG_SESSION } });
      if (!r.ok) throw new Error("解除に失敗しました");
      setCfStream({ loading: false, connected: false, accountName: "", legacyAllowed: false });
      setConnections((c) => c ? { ...c, video: { ...(c.video || {}), connected: false, owner: "未接続", accountName: "" } } : c);
      showToast("Cloudflare Streamの接続を解除しました");
    } catch (e) { showToast(e.message || String(e)); }
    setCfBusy(false);
  };

  /* 初期読み込み：保存済みログインを復元してから読み込む */
  useEffect(() => {
    (async () => {
      try {
        const t = localStorage.getItem(AUTH_TOKEN_KEY), us = localStorage.getItem(AUTH_USER_KEY);
        if (t && us) { MG_SESSION = t; setUser(JSON.parse(us)); setActiveStorage(true); }
      } catch (e) {}
      const cfResult = new URLSearchParams(location.search).get("cf");
      if (cfResult) {
        const clean = new URL(location.href); clean.searchParams.delete("cf"); clean.searchParams.delete("message");
        history.replaceState(null, "", clean.pathname + clean.search + clean.hash);
        setTimeout(() => showToast(cfResult === "connected" ? "自分のCloudflare Streamを接続しました" : "Cloudflare Streamを接続できませんでした"), 100);
      }
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

  useEffect(() => {
    if (user && MG_SESSION) loadCfStreamStatus();
    else { setCfStream({ loading: false, connected: false, accountName: "", legacyAllowed: false }); setConnections(null); }
  }, [user && user.sub]);

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
        // updatedAt を送信時に打刻する（2026-08-18・Codex指摘）。ゲスト編集は saveProjectData を通らず
        // 打刻ゼロだったため、DOスナップの updatedAt が実際より古く見え、鮮度比較で共同編集分を潰す穴になっていた
        try { if (liveWS.current && liveWS.current.readyState === 1) liveWS.current.send(JSON.stringify({ t: "full", project: { ...cleanProj(project), updatedAt: Date.now() } })); } catch (e) {}
        // live中はここでしか止まった瞬間を拾えない（通常モードのrecordHistoryはproject.live=trueだと丸ごとスキップされる）。
        // これが抜けていたため、共同編集中にタイトル/ハイライトがマージで消えても履歴に何も残らなかった（08-23 森川さん案件）。
        recordHistory(project);
      }, 400);
      // 所有者なら本体（クラウド保存）も10秒デバウンスで追従させる（2026-08-18）。
      // 旧実装はライブ中の保存を完全停止＝「DOだけが正本」で、DO消滅・別リンク閲覧・共有スナップ再発行が
      // すべて古い版を見る穴だった（08-08 森川さん案件で実測2.4日ズレ）。
      if (liveOwnerRef.current) {
        clearTimeout(liveOwnSaveTimer.current);
        liveOwnSaveTimer.current = setTimeout(() => {
          const p = projectLiveRef.current;
          if (!p || !p.live || !liveOwnerRef.current) return;
          const { live, ...rest } = p;   // liveフラグは本体に持ち込まない（通常モードの誤判定防止）
          // collab案件はcollabフラグを立てて保存＝saveProjectDataが /api/collab/upsert へ振り分ける
          Promise.resolve(saveProjectData(liveCollabRef.current ? { ...rest, collab: true } : rest)).catch(() => {});
        }, 10000);
      }
      return () => clearTimeout(liveSendTimer.current);
    }
    clearTimeout(saveTimer.current);
    // 0.7秒→3秒。打鍵が0.7秒止まるたびに1書込していたのがKV枠枯渇の主因のひとつ。
    // 案件切替/タブ閉じ/共有発行の直前には別途フラッシュ保存が走るので、遅くしても取りこぼさない。
    saveTimer.current = setTimeout(async () => {
      // クラウド保存の成否を握る。失敗したら pendingSaveRef に退避して「未保存」表示＋裏で再送し続ける。
      const sig = JSON.stringify(cleanProj(project));
      if (sig === lastSaveSigRef.current && !pendingSaveRef.current) return;   // 中身が変わってなければ書かない
      if (Date.now() < quotaUntilRef.current) { pendingSaveRef.current = project; setSaveState("quota"); return; }
      const ok = await saveProjectData(project);
      if (ok === false) { pendingSaveRef.current = project; setSaveState(Date.now() < quotaUntilRef.current ? "quota" : "error"); }
      else {
        pendingSaveRef.current = null; lastSaveSigRef.current = sig; setSaveState("ok"); recordHistory(project);
        // 発行済みの同時編集リンク（DO）にも同じ内容を押し込む（2026-08-18・置き去りDO対策）。
        // 本体だけ直してDOが古いままだと、編集リンクを開いた人が昔の版を見る。失敗しても本体保存は成立済みなので握りつぶす。
        if (project.liveId && project.liveToken && !project.live) {
          fetch(SHARE_API + "/api/live/" + encodeURIComponent(project.liveId) + "/push", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ k: project.liveToken, project: { ...cleanProj(project), updatedAt: Date.now() } }),
          }).catch(() => {});
        }
      }
    }, 3000);
    return () => clearTimeout(saveTimer.current);
  }, [project, loaded]);

  /* 離脱時フラッシュ（2026-08-08）。
     自動保存は3秒デバウンス＋クラウド往復なので、打鍵直後に ⌘Q／タブを閉じる／アプリを隠す をやると
     その編集はどこにも書かれず消える。無言で消えるので「直したのに前の値に戻ってる」に見える
     （森川さん案件でタイトルの修正が1件消失）。beforeunload等のハンドラは今まで1つも無かった。
     ・visibilitychange(hidden) / pagehide で即書込
     ・fetch は keepalive＝ページが破棄されたあともブラウザが送り切る
     ・送る前に localStorage へも退避し、次回ロードで本体より新しければ復元（ネットが死んでても残す） */
  const projectLiveRef = useRef(null);
  projectLiveRef.current = project;
  useEffect(() => {
    const flush = () => {
      const p = projectLiveRef.current;
      if (!p) return;
      if (p.live) {
        // ライブ編集中の離脱：デバウンス残りの最後の打鍵を即時送信（2026-08-18）。
        // まずWSで即send（ブラウザはunload時もバッファ送出をベストエフォートで行う）。
        // keepalive fetch は64KB上限があるため、小さい案件のときだけ保険として併用する（Codex指摘）
        try {
          const wire = JSON.stringify({ t: "full", project: { ...cleanProj(p), updatedAt: Date.now() } });
          if (liveWS.current && liveWS.current.readyState === 1) liveWS.current.send(wire);
          if (p.liveId && p.liveToken) {
            const body = JSON.stringify({ k: p.liveToken, project: { ...cleanProj(p), updatedAt: Date.now() } });
            if (body.length < 60000) fetch(SHARE_API + "/api/live/" + encodeURIComponent(p.liveId) + "/push", {
              method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body,
            }).catch(() => {});
          }
        } catch (e) {}
        return;
      }
      let sig;
      try { sig = JSON.stringify(cleanProj(p)); } catch (e) { return; }
      if (sig === lastSaveSigRef.current) return;                // 保存済みと同じ内容なら何もしない
      lastSaveSigRef.current = sig;
      clearTimeout(saveTimer.current);
      const data = { ...p, updatedAt: Date.now() };
      const json = JSON.stringify(data);
      try { localStorage.setItem(UNSAVED_KEY, JSON.stringify({ id: data.id, at: data.updatedAt, project: data })); } catch (e) {}
      const done = () => { try { localStorage.removeItem(UNSAVED_KEY); } catch (e) {} };
      if (MG_SESSION) {
        const path = data.collab ? "/api/collab/upsert" : "/api/kv/set";
        const body = data.collab ? { id: data.id, project: data } : { key: STORE_PROJ(data.id), value: json };
        try {
          fetch(SHARE_API + path, {
            method: "POST", keepalive: true,
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + MG_SESSION },
            body: JSON.stringify(body),
          }).then((r) => { if (r && r.ok) done(); }, () => {});
        } catch (e) {}
      } else {
        try { localStorage.setItem("mg:" + STORE_PROJ(data.id), json); done(); } catch (e) {}
      }
    };
    const onVis = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVis);
    return () => { window.removeEventListener("pagehide", flush); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  /* クラウド保存の失敗を自動リトライ。失敗するたび間隔を倍にする（8秒→最大10分）。
     旧実装は固定8秒の無限リトライで、KV上限に当たった後もリセットまで数千回叩き続けて枠を焼いていた。 */
  useEffect(() => {
    let stopped = false, timer = null;
    const schedule = (ms) => { clearTimeout(timer); timer = setTimeout(run, ms); };
    const run = async () => {
      if (stopped) return;
      const p = pendingSaveRef.current;
      if (!p) { retryDelayRef.current = 8000; return schedule(8000); }
      if (typeof navigator !== "undefined" && navigator.onLine === false) return schedule(8000);
      if (Date.now() < quotaUntilRef.current) { setSaveState("quota"); return schedule(60000); } // 上限中は一切叩かない
      const ok = await saveProjectData(p);
      if (ok !== false) { pendingSaveRef.current = null; setSaveState("ok"); retryDelayRef.current = 8000; return schedule(8000); }
      retryDelayRef.current = Math.min(retryDelayRef.current * 2, 600000);
      schedule(retryDelayRef.current);
    };
    schedule(8000);
    const onOnline = () => { retryDelayRef.current = 8000; schedule(500); };
    if (typeof window !== "undefined") window.addEventListener("online", onOnline);
    return () => { stopped = true; clearTimeout(timer); if (typeof window !== "undefined") window.removeEventListener("online", onOnline); };
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
    // 4秒→60秒。旧設定だと編集中ずっと4秒おきに再発行し、1回2書込×15回/分でKV枠(1,000/日)を30分程度で焼き切っていた。
    // 先方の共有ページへの反映が最大1分遅れるだけで、実害はない（手動の「共有」ボタンは即時発行のまま）。
    republishTimer.current = setTimeout(() => {
      if (Date.now() < quotaUntilRef.current) return;   // 保存上限中はスナップも叩かない
      publishShare(true).catch(() => {});
    }, 60000); // サイレント＝AKは意識しない
    return () => clearTimeout(republishTimer.current);
  }, [project, loaded]);

  /* チャンネルコンセプトの自動保存 */
  const chSaveTimer = useRef(null);
  useEffect(() => {
    if (!loaded) return;
    clearTimeout(chSaveTimer.current);
    chSaveTimer.current = setTimeout(async () => {
      const js = JSON.stringify(channelInfo);
      if (js === lastChSaveRef.current) return;              // 中身が同じなら書かない
      if (Date.now() < quotaUntilRef.current) return;        // KV書込上限中は叩かない
      try { if (typeof window.storage !== "undefined") { await window.storage.set(STORE_CHANNELS, js); lastChSaveRef.current = js; } }
      catch (e) { console.error("チャンネル保存エラー", e); noteSaveError(e); }
    }, 3000);   // 0.7秒→3秒（案件保存と同じ理由）
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
  // マニュアルの正本はObsidian。ものがたりっち内の案件コピーだけを保存する。
  const saveGlobalManuals = (next) => { setGlobalManuals(next); try { window.storage.set(STORE_MANUALS_GLOBAL, JSON.stringify(next)); } catch (e) {} };
  const setChannelManuals = (next) => { updateChannelInfo({ manuals: next }); };
  const setCaseManuals = (next) => setProject((p) => ({ ...p, manuals: next }));

  /* 現在の案件のチャンネルのコンセプト情報を取得／更新 */
  const curChannel = project ? (project.channel || DEFAULT_CHANNEL) : DEFAULT_CHANNEL;
  // live編集リンクで開いた編集者はチャンネルストアが空＝発行時に案件へ同梱した channelInfo をフォールバックに使う
  // （これが無いと概要タブのチャンネル基本情報・プロマネ/マニュアル/チェックリストURLが編集者に見えない）
  const curChannelInfo = { ...emptyChannelInfo(), name: curChannel, ...((project && project.channelInfo) || {}), ...(channelInfo[curChannel] || {}) };
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
  /* Cloudflare KVの1日書込上限に当たったか判定し、当たっていたら次のリセット（UTC0時＝JST9時）まで書込を封じる。
     ここで止めないと、失敗リトライ自体が枠を焼き続けて翌日も即死する。 */
  const noteSaveError = (e) => {
    const m = ((e && e.message) || "").toString();
    if (!/limit exceeded|rate limit|429/i.test(m)) return false;
    const d = new Date();
    quotaUntilRef.current = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0);
    setSaveState("quota");
    return true;
  };
  /* collab案件の取得＋競合検知の基準(base)記録。collab/get はここを通すこと */
  const collabGet = async (id) => {
    const r = await authFetch("/api/collab/get", { id });
    if (r && r.project) collabBaseRef.current[id] = { updatedAt: r.updatedAt || 0, base: { ...r.project, id, collab: true } };
    return r;
  };
  const saveProjectData = async (data0) => {
    if (!data0) return true;
    const data = { ...data0, updatedAt: Date.now() };
    // collab かつログイン中のみクラウドへ。未ログイン(ログアウト後)は個人ストレージへフォールバック保存（silent fail防止）
    if (data.collab && MG_SESSION) {
      // 競合検知つき保存（2026-08-18）。従来はlast-write-wins＝相手の保存を黙って上書きしていた。
      // baseUpdatedAt（最後に見たサーバ版）を添えて送り、サーバがより新しければ409+現物が返る→3方向マージして再保存
      try {
        const entry = collabBaseRef.current[data.id] || {};
        const r = await authFetch("/api/collab/upsert", { id: data.id, project: data, baseUpdatedAt: entry.updatedAt || 0 });
        collabBaseRef.current[data.id] = { updatedAt: (r && r.updatedAt) || Date.now(), base: data };
        return true;
      }
      catch (e) {
        if (e.code === 409 && e.data && e.data.project) {
          try {
            const entry = collabBaseRef.current[data.id] || {};
            const remote = { ...e.data.project, id: data.id };
            const merged = { ...merge3(entry.base || null, data, remote), id: data.id, collab: true };
            const r2 = await authFetch("/api/collab/upsert", { id: data.id, project: merged, baseUpdatedAt: e.data.updatedAt || 0 });
            collabBaseRef.current[data.id] = { updatedAt: (r2 && r2.updatedAt) || Date.now(), base: merged };
            // 画面へも統合結果を反映。保存中に打った字は base=data との再マージで温存する
            setProject((cur) => (cur && cur.id === data.id ? { ...merge3(data, cur, merged), collab: true } : cur));
            showToast("他のメンバーの編集と統合しました");
            return true;
          } catch (e2) { console.error("collab競合マージ", e2); noteSaveError(e2); return false; }
        }
        console.error("collab保存", e); if (!noteSaveError(e)) { try { await window.storage.set(STORE_PROJ(data.id), JSON.stringify(data)); } catch (_) {} } return false;
      }
    } else {
      try { if (typeof window.storage !== "undefined") await window.storage.set(STORE_PROJ(data.id), JSON.stringify(data)); return true; } catch (e) { console.error(e); noteSaveError(e); return false; }
    }
  };

  /* 保存が通るたびに、前回保存時点との差分を履歴へ積む。
     ここに置くのは「保存できた内容」だけを履歴にするため（打鍵の途中経過は残さない）。 */
  const recordHistory = async (p) => {
    if (!p || !p.id) return;
    const prev = histBaseRef.current;
    const snap = histSnapshot(p);
    histBaseRef.current = { id: p.id, snap };
    if (!prev || prev.id !== p.id) return;      // 案件を開いた直後は基準を作るだけ
    const a = prev.snap, at = Date.now(), add = [];
    Object.keys(snap).forEach((k) => {
      const before = a[k] ? a[k].v : null;
      if (before == null) return;               // 新しく増えた行＝変更ではない
      if (before === snap[k].v) return;
      if (!before.trim()) return;               // 空→入力は履歴にしない（ノイズ）
      add.push({ at, key: k, label: snap[k].label, before, after: snap[k].v });
    });
    Object.keys(a).forEach((k) => {             // 消えた行は before だけ残す＝原稿ごと消えたのを追える
      if (snap[k] || !a[k].v.trim()) return;
      add.push({ at, key: k, label: a[k].label + "／行ごと削除", before: a[k].v, after: "" });
    });
    if (!add.length) return;
    try {
      let cur = histCacheRef.current.id === p.id ? histCacheRef.current.entries : null;
      if (!cur) cur = await loadHistory(p.id);
      const next = [...add, ...cur].slice(0, HIST_MAX);   // 新しいものが先頭
      histCacheRef.current = { id: p.id, entries: next };
      setHistList(next);
      await window.storage.set(STORE_HIST(p.id), JSON.stringify({ v: 1, entries: next }));
    } catch (e) { console.error("履歴の保存", e); }
  };
  const loadHistory = async (id) => {
    try { const r = await window.storage.get(STORE_HIST(id)); const d = JSON.parse(r.value); return (d && d.entries) || []; }
    catch (e) { return []; }
  };
  const openHistory = async () => {
    setHistOpen(true);
    if (histCacheRef.current.id === activeId && histCacheRef.current.entries) { setHistList(histCacheRef.current.entries); return; }
    const e = await loadHistory(activeId);
    histCacheRef.current = { id: activeId, entries: e };
    setHistList(e);
  };
  /* 履歴の1件を「変更前」に戻す。key から場所を復元する（行はidで引くので並べ替え後でも当たる） */
  const restoreHistory = (h) => {
    if (!h || !project) return;
    const k = h.key;
    let m;
    if (k === "name") { renameProject(project.id, h.before); }
    else if ((m = /^plan(\d+)\.(title|thumbText|thumbText2)$/.exec(k))) {
      const i = Number(m[1]);
      setPlanField(i, m[2], h.before);
    }
    else if (k === "meta.highlight") setMeta("highlight", h.before);
    else if ((m = /^row\.(.+)\.(label|script)$/.exec(k))) {
      if (!(project.rows || []).some((r) => r.id === m[1])) { showToast("この行はもう無いので戻せない（本文はコピーできる）"); return; }
      updateRow(m[1], { [m[2]]: h.before });
    }
    else { showToast("この項目は自動で戻せない"); return; }
    setHistOpen(false);
    showToast(h.label + " を戻した");
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
      const blockedNames = [];
      for (const x of entries) {
        let p = null;
        try {
          if (x.id === activeId && project) p = project;
          else if (x.collab) { const r = await collabGet(x.id); p = r.project ? { ...r.project, id: x.id, collab: true } : null; }
          else { const r = await window.storage.get(STORE_PROJ(x.id)); if (r && r.value) p = JSON.parse(r.value); }
        } catch (e) {}
        if (!p) continue;
        // 08-22 AK指示: チャンネル一括共有（複数案件を1つのURLでまとめて見せる）は個別案件の
        // 公開前チェックリストを素通りしていたため、発行前に案件ごとにStudio OSのゲートを確認する。
        // 1件でも未完了ならチャンネル全体の発行を止め、案件名を挙げて個別に完了させる（トーストは
        // 1件ずつ出すとうるさいのでsilent、最後にまとめて1回だけ出す）。
        if (!(await checkPublishGate(p, true))) { blockedNames.push(x.name); continue; }
        // 編集共有：案件ごとに live 文書を発行（既存があれば現在の内容で再シード）して編集リンクを得る
        if (editable) {
          try {
            const lr = await fetch(SHARE_API + "/api/live/create", {
              method: "POST", headers: { "Content-Type": "application/json", ...(MG_SESSION ? { Authorization: "Bearer " + MG_SESSION } : {}) },
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
      if (blockedNames.length) throw new Error(blockedNames.join("・") + " が公開前チェック未完了です。各案件を開き「共有」から確認を完了してください");
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
        const r = await collabGet(id);
        const data = { ...migrateProject(r.project), id, collab: true, collabRole: r.role, ownerEmail: r.ownerEmail, members: r.members };
        setActiveId(id); setProject(data); setTab("script");
      } else {
        const r = await window.storage.get(STORE_PROJ(id));
        const data = r && r.value ? migrateProject(JSON.parse(r.value)) : newProjectData("案件");
        // 一覧の名前が正（ユーザーが見て付けた名前）。過去のリネームで本体だけ旧名の案件を開いた時に治す
        if (entry && entry.name && data.name !== entry.name) data.name = entry.name;
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
    if (m.thumbs2 && m.thumbs2.some(Boolean)) meta.thumbs2 = m.thumbs2;
    const plans = ((m.titles && m.titles.some(Boolean)) || (m.thumbs && m.thumbs.some(Boolean)) || (m.thumbs2 && m.thumbs2.some(Boolean)))
      ? applyTitlesToPlans(project.plans, m.titles, m.thumbs, m.thumbs2) : project.plans;
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
      // トーク系は build_talk の結果を適用（2026-08-18実装）。既存bodyのidは見出し一致→同位置の順で引き継ぐ
      if (project.format === "talk") {
        const rt = d.project.talk || {};
        const pt = project.talk || {};
        const prevBody = Array.isArray(pt.body) ? pt.body : [];
        const body = (Array.isArray(rt.body) ? rt.body : []).map((x, i) => {
          const prev = prevBody.find((b) => (b.heading || "") === (x.heading || "")) || prevBody[i];
          return { id: prev ? prev.id : uid(), heading: x.heading || "", script: x.script || "" };
        });
        const talk = {
          highlight: rt.highlight != null ? rt.highlight : pt.highlight || "",
          intro: rt.intro != null ? rt.intro : pt.intro || "",
          toc: Array.isArray(rt.toc) && rt.toc.length ? rt.toc : (Array.isArray(pt.toc) ? pt.toc : [""]),
          body: body.length ? body : prevBody,
          cta: rt.cta != null ? rt.cta : pt.cta || "",
        };
        const data = { ...project, talk };
        setProject(data);
        try { await window.storage.set(STORE_PROJ(data.id), JSON.stringify(data)); } catch (e) {}
        setAssistantSummary(d.summary || "台本に反映しました。");
        setAssistantText("");
        showToast("AIがトーク台本に反映しました");
        return;
      }
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
        if (out.day == null && prev.day != null) out.day = prev.day;
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
      if (m.thumbs2 && m.thumbs2.some(Boolean)) meta.thumbs2 = m.thumbs2;
      const plans = ((m.titles && m.titles.some(Boolean)) || (m.thumbs && m.thumbs.some(Boolean)) || (m.thumbs2 && m.thumbs2.some(Boolean)))
        ? applyTitlesToPlans(project.plans, m.titles, m.thumbs, m.thumbs2) : project.plans;
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

  /* 取材メモの文字起こし本文（永続化。①②で使い回す） */
  const setTranscriptRaw = (v) => setProject((p) => ({ ...p, transcriptRaw: v }));
  /* ①文字起こし→骨組み（ロケ・時刻・シーンの型のみ、原稿は空）。マインドマップは並び順から自動でスパインに乗るので、これだけで確認できる状態になる */
  const runSkeletonGenerate = async () => {
    const raw = (project.transcriptRaw || "").trim();
    if (!raw || !project || transcriptBusy) return;
    if ((project.rows || []).length && !window.confirm("今の構成台本を、文字起こしから作った骨組みで上書きします。\n（原稿本文はまだ書きません。ロケ・時刻・シーンの型だけ）\n\nよろしいですか？")) return;
    setTranscriptBusy(true); setTranscriptStep("skeleton");
    try {
      const res = await fetch(SHARE_API + "/api/skeleton", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw }),
      });
      const d = await res.json();
      if (!res.ok || !d.project) throw new Error(d.error || "骨組み生成に失敗しました");
      const parsed = normalizeImport(d.project);
      const meta = { ...project.meta };
      if (parsed.meta.shootDate) meta.shootDate = parsed.meta.shootDate;
      if (parsed.meta.place) meta.place = parsed.meta.place;
      const data = { ...project, name: project.name || d.project.name || project.name, channel: project.channel || d.project.channel || project.channel, meta, rows: parsed.rows };
      setProject(data);
      try { await window.storage.set(STORE_PROJ(data.id), JSON.stringify(data)); } catch (e) {}
      showToast("骨組みを作ったよ（" + parsed.rows.filter((r) => r.kind === "scene").length + "シーン）。マインドマップで確認してね");
    } catch (e) {
      showToast("骨組み生成に失敗：" + (e.message || e));
    } finally { setTranscriptBusy(false); setTranscriptStep(null); }
  };
  /* ②骨組み済みの構成台本へ、同じ文字起こしからQ&A原稿を書き込む（構造は変えずscriptだけ埋まる） */
  const runFillQa = async () => {
    const raw = (project.transcriptRaw || "").trim();
    if (!raw || !project || !(project.rows || []).length || transcriptBusy) return;
    setTranscriptBusy(true); setTranscriptStep("fillqa");
    try {
      const res = await fetch(SHARE_API + "/api/fillqa", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, raw }),
      });
      const d = await res.json();
      if (!res.ok || !d.project) throw new Error(d.error || "原稿の生成に失敗しました");
      const parsed = normalizeImport(d.project);
      const data = { ...project, rows: parsed.rows };
      setProject(data);
      try { await window.storage.set(STORE_PROJ(data.id), JSON.stringify(data)); } catch (e) {}
      showToast((d.summary ? d.summary + "｜" : "") + "Q&A原稿を書き込んだよ");
    } catch (e) {
      showToast("Q&A生成に失敗：" + (e.message || e));
    } finally { setTranscriptBusy(false); setTranscriptStep(null); }
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
      let transcript = null, transcriptUpdatedAt = 0;
      if (project.shareId) {
        try {
          const tr = await fetch(SHARE_API + "/api/transcript/" + project.shareId + "?token=" + encodeURIComponent(project.shareToken || "")).then((r) => r.json());
          if (tr && Array.isArray(tr.segments) && tr.segments.length) { transcript = tr.segments; transcriptUpdatedAt = tr.updatedAt || 0; }
        } catch (e) {}
      }
      const res = await fetch(SHARE_API + "/api/deliver", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(transcript ? { project, transcript } : { project }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "生成に失敗しました");
      // 生成結果を1つのpatchに集約。setMeta（非同期反映）に頼らず、この場で確実にクラウド保存する。
      const patch = { deliverChapters: chapters, deliverTitle: d.title || "", deliverTitle2: d.title2 || "", deliverDescription: d.description || "", deliverHashtags: d.hashtags || "" };
      if (transcript && (d.chapters || "").trim()) { patch.deliverChapters = d.chapters.trim(); patch.deliverChaptersTranscriptAt = transcriptUpdatedAt || Date.now(); }
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
        let segs = null, segsUpdatedAt = 0;
        try {
          const tr = await fetch(SHARE_API + "/api/transcript/" + snap + "?token=" + encodeURIComponent(token)).then((x) => x.json());
          if (tr && Array.isArray(tr.segments) && tr.segments.length) { segs = tr.segments; segsUpdatedAt = tr.updatedAt || 0; }
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
            setMeta("deliverChaptersTranscriptAt", segsUpdatedAt || Date.now());
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
  /* 納品完了タブのタイトル＝構成台本（企画・サムネのタイトル案①＝plans[0].title）と連動。
     手入力で差し替えたら追従を止める（動画URLの自動追従と同じ「まだ自動か」判定パターン）。 */
  const lastSyncedDeliverTitleRef = useRef(null);
  useEffect(() => {
    if (tab !== "deliver" || !project) return;
    const planTitle = ((project.plans && project.plans[0] && project.plans[0].title) || "").trim();
    const curTitle = ((project.meta || {}).deliverTitle || "").trim();
    if (!planTitle) return;
    if (!curTitle || curTitle === lastSyncedDeliverTitleRef.current) {
      if (curTitle !== planTitle) setMeta("deliverTitle", planTitle);
      lastSyncedDeliverTitleRef.current = planTitle;
    }
  }, [tab, activeId, project && project.plans && project.plans[0] && project.plans[0].title]);

  /* 指摘の対象シーンへスクロール＋一時ハイライト */
  const jumpToRow = (rowId) => {
    if (!rowId) return;
    setTab("script");
    setScriptView("table");   // マインドマップ表示中にジャンプした時も台本編集画面へ戻す
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
    const plansLC = plans.map((p) => (p.title || "") + " " + (p.thumbText || "") + " " + (p.thumbText2 || "")).join(" ").toLowerCase();
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
    if (m.thumbs2 && m.thumbs2.some(Boolean)) meta.thumbs2 = m.thumbs2;
    const base = { ...project, meta };
    if (prop.name) base.name = prop.name;
    if (prop.channel) base.channel = prop.channel;
    if ((m.titles && m.titles.some(Boolean)) || (m.thumbs && m.thumbs.some(Boolean)) || (m.thumbs2 && m.thumbs2.some(Boolean))) base.plans = applyTitlesToPlans(project.plans, m.titles, m.thumbs, m.thumbs2);
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
        if (out.day == null && prev.day != null) out.day = prev.day;
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
  const jumpToHearing = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("ring-2", "ring-offset-2");
    el.style.setProperty("--tw-ring-color", theme.accent);
    setTimeout(() => { el.classList.remove("ring-2", "ring-offset-2"); el.style.removeProperty("--tw-ring-color"); }, 1200);
  };
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
    const { titles, thumbs, thumbs2 } = metaTitlesFromPlans(project.plans);
    const cm = project.meta || {};
    if (JSON.stringify((cm.titles || []).slice(0, 3)) === JSON.stringify(titles)
      && JSON.stringify((cm.thumbs || []).slice(0, 3)) === JSON.stringify(thumbs)
      && JSON.stringify((cm.thumbs2 || []).slice(0, 3)) === JSON.stringify(thumbs2)) return;
    setProject((p) => (p ? { ...p, meta: { ...p.meta, titles, thumbs, thumbs2 } } : p));
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
          if (x.collab) { const r = await collabGet(x.id); data = { ...migrateProject(r.project), id: x.id, collab: true, collabRole: r.role, ownerEmail: r.ownerEmail, members: r.members }; }
          else { const r = await window.storage.get(STORE_PROJ(x.id)); data = r && r.value ? migrateProject(JSON.parse(r.value)) : null; }
          if (data && !cancelled) setBoardCache((c) => ({ ...c, [x.id]: data }));
        } catch (e) { if ((e && e.message) === "nf" && !cancelled) setBrokenIds((b) => ({ ...b, [x.id]: true })); }
      }
    })();
    return () => { cancelled = true; };
  }, [tab, curChannel, activeId, index, loaded, project && project.id]);

  /* ホーム／レギュレーション一覧では全案件本体を読み込む（取れたものから順次）。
     レギュレーション一覧のクライアント／チャンネル別グルーピング表示（caseData経由でmanuals件数
     を出す）が全案件のboardCacheを必要とするため。 */
  useEffect(() => {
    if (!loaded || (view !== "home" && tab !== "regulations")) return;
    let cancelled = false;
    (async () => {
      for (const x of index) {
        if (x.id === activeId || boardCache[x.id]) continue;
        try {
          let data = null;
          if (x.collab) { const r = await collabGet(x.id); data = { ...migrateProject(r.project), id: x.id, collab: true }; }
          else { const r = await window.storage.get(STORE_PROJ(x.id)); data = r && r.value ? migrateProject(JSON.parse(r.value)) : null; }
          if (data && !cancelled) setBoardCache((c) => ({ ...c, [x.id]: data }));
        } catch (e) { if ((e && e.message) === "nf" && !cancelled) setBrokenIds((b) => ({ ...b, [x.id]: true })); }
      }
    })();
    return () => { cancelled = true; };
  }, [view, tab, index, loaded]);
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
  /* ボード上の案件のタイトル / サムネ文言を編集（案件名とは独立） */
  const updateBoardTitle = (id, field, val) => {
    if (id === activeId) {
      setProject((p) => { const plans = [...(p.plans || [])]; plans[0] = { ...(plans[0] || newPlan()), [field]: val }; return { ...p, plans }; });
      return;
    }
    setBoardCache((c) => { const d = c[id]; if (!d) return c; const plans = [...(d.plans || [])]; plans[0] = { ...(plans[0] || newPlan()), [field]: val }; return { ...c, [id]: { ...d, plans } }; });
    saveBoardCaseSoon(id);
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
      const data = { ...base, format: fmt, plans: [{ ...pl, id: uid() }], meta: { ...base.meta, titles: [pl.title || "", "", ""], thumbs: [pl.thumbText || "", "", ""], thumbs2: [pl.thumbText2 || "", "", ""] } };
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
      if (next.collab) { try { const r = await collabGet(next.id); setActiveId(next.id); setProject({ ...migrateProject(r.project), id: next.id, collab: true, collabRole: r.role, ownerEmail: r.ownerEmail, members: r.members }); } catch (e) {} }
      else { const r = await window.storage.get(STORE_PROJ(next.id)); setActiveId(next.id); setProject(r && r.value ? migrateProject(JSON.parse(r.value)) : newProjectData(next.name)); }
    }
    showToast(entry.collab && entry.role !== "owner" ? "共有から退出しました" : "案件を削除しました");
  };

  const renameProject = (id, name) => {
    const idx = index.map((x) => (x.id === id ? { ...x, name } : x));
    setIndex(idx); persistIndex(idx);
    if (id === activeId && project) setProject((p) => ({ ...p, name }));
    else {
      // 非アクティブ案件は本体データにも書き戻す。indexだけ変えると本体が旧名のまま残り、
      // 書き出しファイル名が旧名（複製元）で出る＝「別案件が出力される」ように見える事故になる
      (async () => {
        try {
          const r = await window.storage.get(STORE_PROJ(id));
          if (r && r.value) await window.storage.set(STORE_PROJ(id), JSON.stringify({ ...JSON.parse(r.value), name }));
        } catch (e) {}
      })();
    }
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
        if (first.collab) { const r = await collabGet(first.id); setActiveId(first.id); setProject({ ...migrateProject(r.project), id: first.id, collab: true, collabRole: r.role, ownerEmail: r.ownerEmail, members: r.members }); }
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
  /* ライブ編集の3方向マージ（2026-07-31）。
     旧実装は受信した全文で setProject を丸ごと置き換えていた＝相手の送信が届いた瞬間、
     自分が直前に打った内容（相手がまだ知らない分）が巻き戻って消えていた。AKの
     「入力してる間に文章が消える」の主因のひとつ。
     base=前回受信した相手の状態／local=今の自分／remote=今届いた相手 で突き合わせ、
       ・自分だけが変えた項目 → 自分を残す
       ・相手だけが変えた項目 → 相手を取る
       ・両方が同じ項目を変えた → 相手を取る（真の衝突のみ従来通りlast-write-wins）
     配列は id を持つ要素だけ id で対応付ける（行の並べ替え・追加・削除も拾う）。 */
  const merge3 = (base, local, remote) => {
    if (local === remote) return remote;
    if (JSON.stringify(local) === JSON.stringify(remote)) return remote;
    const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
    const hasId = (a) => Array.isArray(a) && a.length > 0 && a.every((x) => isObj(x) && x.id != null);
    const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
    if (Array.isArray(local) && Array.isArray(remote) && hasId(local) && hasId(remote)) {
      const bA = Array.isArray(base) ? base : [];
      const bm = new Map(bA.filter((x) => isObj(x) && x.id != null).map((x) => [x.id, x]));
      const lm = new Map(local.map((x) => [x.id, x]));
      const rm = new Map(remote.map((x) => [x.id, x]));
      const out = [];
      // 相手の並び順を土台にする（並べ替えは相手優先＝last-write-wins）
      for (const r of remote) {
        const l = lm.get(r.id);
        if (l === undefined) {
          // 自分の手元に無い行。baseにあった＝自分が消した行なので、相手が触っていなければ削除を維持する。
          // （ここを無条件に採用すると、消した行が受信のたびに蘇って送り返される）
          if (bm.has(r.id) && same(r, bm.get(r.id))) continue;
          out.push(r); continue;                       // 相手が足した/変えた行は採用
        }
        out.push(merge3(bm.get(r.id), l, r));
      }
      // 自分がこのセッションで足した行（相手にはまだ無い）は消さずに末尾へ残す
      for (const l of local) if (!rm.has(l.id) && !bm.has(l.id)) out.push(l);
      return out;
    }
    // id を持たない配列（titles/thumbs/目次など位置に意味がある配列）。
    // 丸ごと remote 採用にすると、別の要素を触っただけで自分の編集が消える。
    if (Array.isArray(local) && Array.isArray(remote)) {
      if (same(remote, base) && !same(local, base)) return local;   // 変えたのは自分だけ
      if (same(local, base)) return remote;                          // 変えたのは相手だけ
      const bA = Array.isArray(base) ? base : [];
      if (local.length === remote.length) {                          // 長さが同じなら位置ごとに突き合わせる
        return remote.map((rv, i) => merge3(bA[i], local[i], rv));
      }
      return remote;                                                 // 増減している＝並び自体が変わったので相手を採用
    }
    if (isObj(local) && isObj(remote)) {
      const b = isObj(base) ? base : {};
      const out = {};
      for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) {
        const lv = local[k], rv = remote[k], bv = b[k];
        if (!(k in remote)) { // 相手には無いキー
          if (k in b) continue;            // 相手が消した → 消えたまま
          out[k] = lv; continue;           // 自分が足した → 残す
        }
        if (!(k in local)) {
          // 自分に無いキー。baseにあった＝自分が消したので、相手が変えていなければ削除を維持
          if (k in b && same(rv, bv)) continue;
          out[k] = rv; continue;
        }
        out[k] = merge3(bv, lv, rv);
      }
      return out;
    }
    // スカラー（文字列・数値・null等）
    if (same(remote, base) && !same(local, base)) return local;  // 変えたのは自分だけ
    return remote;                                               // それ以外は相手を採用
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
        const base = lastRemoteRef.current;               // 前回受信＝両者が知っていた状態
        lastRemoteRef.current = JSON.stringify(cleanProj(proj));
        if (m.t === "init") { setActiveId(liveId); inited = true; }
        // init（接続直後）は自分の状態が無いのでそのまま採用。以降の full は3方向マージ＝
        // 自分の直前の打鍵を相手のブロードキャストで巻き戻さない。
        if (m.t === "init") {
          setProject({ ...proj, live: true, liveId, liveToken: token });
          // 置き去りDO対策（2026-08-18）：所有者なら本体コピーと鮮度を比べ、本体が新しければそちらを正とする。
          // 採用した本体はこの後の自動保存（liveブランチ）が全員へブロードキャストするので、開いた瞬間に全員が最新化される。
          liveOwnerRef.current = false; liveCollabRef.current = false;
          if (MG_SESSION && proj.id && typeof window.storage !== "undefined") {
            (async () => {
              try {
                let own = null;
                // collab正本を先に照会する（保存失敗時の個人ストレージ退避コピーが所有判定を乗っ取り、
                // 書き戻し先が個人側へ誤ルーティングされるのを防ぐ＝Codex指摘）
                try { const c = await collabGet(proj.id); if (c && c.project) { own = migrateProject(c.project); liveCollabRef.current = true; } } catch (e) {}
                if (!own) {
                  try { const r = await window.storage.get(STORE_PROJ(proj.id)); if (r && r.value) own = migrateProject(JSON.parse(r.value)); } catch (e) {}
                }
                if (!own) return;
                liveOwnerRef.current = true;
                if ((own.updatedAt || 0) > (proj.updatedAt || 0)) {
                  // 丸ごと置換でなく3方向マージ（base=DO版）：本体で変えた項目だけをDO版へ接ぎ木する。
                  // DO側にしか無い共同編集（updatedAt打刻が無かった旧セッション分）を全消ししないため
                  setProject((cur) => {
                    if (!cur || cur.liveId !== liveId) return cur;
                    // base=DO初期値 / local=本体 / remote=現在値。storage.get待機中に届いた共同編集や
                    // 自分の打鍵（=現在値に反映済み）を消さず、本体の新しい項目だけ接ぎ木する（Codex二周目指摘）
                    const grafted = merge3(cleanProj(proj), cleanProj(own), cleanProj(cur));
                    return { ...grafted, live: true, liveId, liveToken: token };
                  });
                }
              } catch (e) {}
            })();
          }
        }
        else setProject((cur) => {
          if (!cur) return { ...proj, live: true, liveId, liveToken: token };
          let b = null; try { b = base ? JSON.parse(base) : null; } catch (_) { b = null; }
          const merged = merge3(b, cleanProj(cur), cleanProj(proj));
          return { ...merged, live: true, liveId, liveToken: token };
        });
        // 「このタブだけ編集」リンクはそのタブに着地させる（他タブはtabItemsから消える）
        if (m.t === "init" && LIVE_ONLY_TABS && LIVE_ONLY_TABS[0]) setTab(LIVE_ONLY_TABS[0]);
        if (m.t === "init") setLoaded(true);
      }
    };
    ws.onclose = () => { if (liveWS.current === ws) liveWS.current = null; if (!inited) { setView("home"); setLoaded(true); loadAll(); showToast("編集リンクが無効か、期限切れの可能性があります"); } };
    ws.onerror = () => {};
  };
  // 編集用（リアルタイム）リンクを発行。onlyTab を渡すとそのタブだけ触れる編集リンクになる
  const publishShareLive = async (onlyTab) => {
    if (!project) return;
    setSharing(true);
    try {
      const res = await fetch(SHARE_API + "/api/live/create", {
        method: "POST", headers: { "Content-Type": "application/json", ...(MG_SESSION ? { Authorization: "Bearer " + MG_SESSION } : {}) },
        body: JSON.stringify({ project: { ...cleanProj(project), channelInfo: curChannelInfo }, prevLiveId: project.liveId || null, editToken: project.liveToken || null }),
      });
      const data = await res.json();
      if (!data.liveId) throw new Error(data.error || "発行失敗");
      const next = { ...project, liveId: data.liveId, liveToken: data.editToken };
      setProject(next);
      try { if (!next.collab && typeof window.storage !== "undefined") await window.storage.set(STORE_PROJ(next.id), JSON.stringify(next)); } catch (e) {}
      const url = location.origin + location.pathname.replace(/[^/]*$/, "") + "index.html?live=" + data.liveId
        + (onlyTab ? "&tab=" + encodeURIComponent(onlyTab) : "") + "#k=" + data.editToken;
      setShareModal({ id: data.liveId, url, updated: !!project.liveId, live: true, tab: onlyTab || "" });
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
      // ID/トークンが変わった時だけ即時保存する。旧実装は無条件だったので、自動再発行のたびに
      // 「値が1つも変わっていない案件」をKVへ丸ごと書き直していた（再発行1回につき+1書込）。
      const idsChanged = next.shareId !== project.shareId || next.shareToken !== project.shareToken
        || next.shareUpToken !== project.shareUpToken || next.shareReadToken !== project.shareReadToken;
      if (idsChanged) { try { await window.storage.set(STORE_PROJ(next.id), JSON.stringify(next)); } catch (e) {} }
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
  const TAB_SHARE_PANE = { overview: "concept", plan: "plan", hearing: "hearing", script: "script", kouban: "kouban", review: "video", concept: "concept", assets: "files", deliver: "deliver", manual: "manual" };
  const buildShareUrl = (id, t) => { const pane = t ? TAB_SHARE_PANE[t] : ""; return shareUrl(id, project.shareReadToken || shareReadTokRef.current) + (pane ? "&tab=" + pane : ""); };
  const hashGateValue = async (value) => {
    const bytes = new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value || null));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  };
  /* pを渡すと任意の案件（チャンネル一括共有で読み込んだ他案件など）に対して計算できる。
     省略時は現在開いている project（従来通りの挙動）。 */
  const publishArtifactHashes = async (p) => {
    const pr = p || project;
    const meta = pr.meta || {};
    const thumbs = Array.isArray(meta.deliverThumbImages) ? meta.deliverThumbImages : [];
    const activeVideos = reviewVersions(pr).filter((v) => v && !v.trashedAt).map((v) => ({ id: v.id, key: v.key, url: v.url, uid: v.uid, label: v.label }));
    return {
      structure: await hashGateValue({ plans: pr.plans || [], rows: pr.rows || [], talk: pr.talk || null }),
      video: await hashGateValue({ deliverVideoUrl: meta.deliverVideoUrl || "", versions: activeVideos }),
      thumbnail: await hashGateValue(thumbs),
      title: await hashGateValue(meta.deliverTitle || ""),
      description: await hashGateValue(meta.deliverDescription || ""),
    };
  };
  /* silent=trueはチャンネル一括共有の事前チェックなど、案件ごとにトーストを出したくない場面用。
     pを渡すと現在開いていない案件も検査できる（publishArtifactHashesと同じ理由）。 */
  const checkPublishGate = async (p, silent = false) => {
    const pr = p || project;
    if (!pr.studioGateToken) {
      if (!silent) showToast("Studio OSの公開ゲートが未接続です。Studio OSの案件画面から接続してください");
      return false;
    }
    const artifactHashes = await publishArtifactHashes(pr);
    try {
      const res = await fetch("https://studio-os-5dm.pages.dev/api/v1/public/publish-gate/check", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ mgProjectId: pr.id, gateToken: pr.studioGateToken, artifactHashes }),
      });
      const payload = await res.json();
      const result = payload && payload.data;
      if (!res.ok || !result || !result.allowShare) {
        if (!silent) {
          const first = result && Array.isArray(result.checks) ? result.checks.find((c) => c.result !== "pass") : null;
          showToast("公開チェック：" + ((result && result.result) || "UNKNOWN") + " — " + ((first && first.reason) || "Studio OSで承認を確認してください"));
        }
        return false;
      }
      if (!silent) showToast("公開チェック PASS：承認済みの版と一致しました");
      return true;
    } catch (e) {
      if (!silent) showToast("公開チェックに接続できないためURL生成を停止しました");
      return false;
    }
  };
  const HUMAN_PREFLIGHT = [
    ["talent", "出演者・クライアントの最新意向を確認した"],
    ["separate", "本編・サムネ・タイトル・概要欄を別々に確認した"],
    ["corrections", "過去の修正指示とNG事項を反映した"],
    ["privacy", "個人情報・家族・場所・センシティブ情報を確認した"],
  ];
  const APPLIED_PREFLIGHT_RULES = [
    ["ブランド", "本人が何者として認識されたいかという現在のブランドを最優先する", "全社"],
    ["プライバシー", "居住地・住所・家族・個人情報は、明示承認なしに公開しない", "全社"],
    ["センシティブ", "医療・ワクチン・過去のトラウマは、本編と広告訴求を切り分ける", "全社"],
    ["サムネ・タイトル", "センシティブ情報をサムネ・タイトルの主訴求にしない", "全社"],
    ["個別承認", "本編・サムネ・タイトル・概要欄は、それぞれ個別に承認する", "全社"],
    ["表現", "CTRより出演者の信頼を優先し、煽り・センセーショナル表現を避ける", "全社"],
    ["過去修正", "一度共有されたNG事項と過去の修正内容を全工程へ反映する", "全社"],
    ["再承認", "承認後に変更した成果物は、変更後の版で再承認する", "全社"],
  ];
  /* 08-22 AK指示: レギュレーション一覧に並ぶだけの読み物では公開前チェックとして機能しないため、
     全社共通(APPLIED_PREFLIGHT_RULES+globalManuals)・クライアント共通(curChannelInfo.manuals)・
     案件固有(project.manuals)を1件ずつのチェック項目としてこの下のpreflightモーダルへ合流させる。
     全社ルールは配列インデックス、決め事はuid()のidをキーにして、他の項目と混ざらないようprefixする。 */
  const REG_DECISION_LABEL = { deny: "禁止", allow: "許可", approval_required: "要承認確認" };
  const regulationChecklist = [
    ...APPLIED_PREFLIGHT_RULES.map(([cat, rule], i) => ({ key: "pf" + i, scope: "全社", cat, title: rule, body: "" })),
    ...(globalManuals || []).map((m) => ({ key: "gm:" + m.id, scope: "全社", cat: m.cat || "全社ルール", title: m.title || "名称未設定", body: m.body || "" })),
    ...(curChannelInfo.manuals || []).map((m) => ({ key: "cm:" + m.id, scope: curChannel, cat: m.cat || "クライアントルール", title: m.title || "名称未設定", body: m.body || "" })),
    ...((project && project.manuals) || []).map((m) => ({ key: "pm:" + m.id, scope: "この案件", cat: m.cat || "案件ルール", title: m.title || "名称未設定", body: m.body || "" })),
    // 08-22 AK指示（PRD実装順⑥）: Studio OSで登録・承認済みのregulation_rulesもここへ合流させる。
    // openPublishPreflightがproject.studioGateTokenを使って都度取得しstudioRegsへ保存している。
    ...(studioRegs.rules || []).map((r) => ({ key: "sr:" + r.id, scope: "Studio OS", cat: r.category, title: `${r.title}（${REG_DECISION_LABEL[r.decision] || r.decision}）`, body: r.description || "" })),
  ];
  /* resumeを渡すと、チェック完了直後にその関数を呼び直して元々やろうとしていた共有処理を続行する
     （08-22 AK指示: 納品タブだけでなく全ての共有経路をこのチェックリストに通すため、
     どの共有操作から呼ばれても戻れるようにresumeで汎用化した）。 */
  const openPublishPreflight = async (resume) => {
    const saved = (project.meta && project.meta.publishHumanChecks) || {};
    setPreflight({ checks: saved, concerns: [], acknowledged: {}, summary: "", knowledgeVersion: "obsidian-human-documentary-1.0", error: "", resume: resume || null });
    setPreflightBusy(true);
    // PRD実装順⑥: Studio OSで承認済みのregulation_rulesを取得してチェックリストへ合流させる。
    // 失敗してもローカルのmanualsベースのチェックリストは動くので、ここは静かに諦める。
    if (project.studioGateToken) {
      fetch("https://studio-os-5dm.pages.dev/api/v1/public/regulations?mg_project_id=" + encodeURIComponent(project.id) + "&gate_token=" + encodeURIComponent(project.studioGateToken))
        .then((r) => r.json()).then((d) => { if (d && d.data) setStudioRegs(d.data); })
        .catch(() => {});
    }
    try {
      const r = await fetch(SHARE_API + "/api/preflight", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "AIチェックに失敗しました");
      setPreflight((p) => ({ ...p, concerns: d.concerns || [], summary: d.summary || "", knowledgeVersion: d.knowledgeVersion || p.knowledgeVersion }));
    } catch (e) { setPreflight((p) => ({ ...p, error: e.message || String(e) })); }
    finally { setPreflightBusy(false); }
  };
  const toggleHumanPreflight = (key) => setPreflight((p) => {
    const checks = { ...p.checks, [key]: !p.checks[key] };
    setMeta("publishHumanChecks", checks);
    return { ...p, checks };
  });
  const finishPublishPreflight = async () => {
    if (!preflight || HUMAN_PREFLIGHT.some(([k]) => !preflight.checks[k])) return showToast("人が確認する4項目を完了してください");
    if (regulationChecklist.some((r) => !preflight.checks[r.key])) return showToast("レギュレーションのチェックが残っています");
    if (preflight.error) return showToast("AIチェックが完了していないためURL生成を停止しました");
    if ((preflight.concerns || []).some((c) => c.severity === "block")) return showToast("要修正の項目があります。内容を直してもう一度チェックしてください");
    if ((preflight.concerns || []).some((c) => !preflight.acknowledged[c.id])) return showToast("AIが見つけた懸念点を確認してください");
    if (!project.studioGateToken) return showToast("この案件のStudio OS連携情報がありません。案件を開き直してください");
    setPreflightBusy(true);
    try {
      const artifactHashes = await publishArtifactHashes();
      const r = await fetch("https://studio-os-5dm.pages.dev/api/v1/public/publish-gate/approve", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ mgProjectId: project.id, gateToken: project.studioGateToken, artifactHashes }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error?.message || "承認記録を保存できませんでした");
      const resume = preflight.resume;
      setPreflight(null);
      if (resume) await resume();
    } catch (e) { showToast("公開前チェックを完了できませんでした：" + (e.message || e)); }
    finally { setPreflightBusy(false); }
  };
  /* t を渡すとそのタブだけ／省略で案件まるごと。未発行なら発行してからコピー。
     08-22 AK指示: 従来は納品(deliver)/動画確認(review)/案件まるごとの3経路だけがゲート対象で、
     構成台本・香盤表・素材などタブ単体の共有は素通りしていた。共有はどの経路でも「先方にこの
     案件の中身を見せる」行為として同じリスクを持つため、tの値に関わらず全経路をゲートする。 */
  const copyShareUrl = async (t, preflightDone = false, audience = "") => {
    if (t === "review" && !audience) { setShareAudience("review"); return; }
    if (!preflightDone && !(await checkPublishGate())) return openPublishPreflight(() => copyShareUrl(t, true, audience));
    const had = !!project.shareId;
    // 既存リンクでも必ず再発行してから渡す。動画確認の版など最新状態をスナップに反映するため
    // （これが無いと「URLをコピーするだけ」になり、追加した確認動画が共有ページに出ず別動画にフォールバックする）
    const id = await publishShare(true);
    if (!id) return;
    const u = buildShareUrl(id, t);
    setShareModal({ id, url: u, updated: had, tab: t || "" });
    try { await navigator.clipboard.writeText(u); showToast((t ? "このタブの" : "案件まるごとの") + "共有URLを更新してコピーしたよ"); } catch (e) {}
  };
  /* 切り抜きショートだけをまとめて見せる先方用URL（mg-share workerの /shorts/{snap}?r=<rtok> ギャラリー
     ページ、全本を1画面で再生・DLできる）。ShortsPanelの「共有URL」ボタンから呼ばれる。
     戻り値がfalseならコピー失敗（ShortsPanel側でボタンの「コピーしました」表示を出さない）。
     08-22 AK指示: これも先方に見せるURLである以上、他の共有経路と同じく公開前チェックを通す。 */
  const copyShortsGalleryUrl = async (preflightDone = false) => {
    if (!preflightDone && !(await checkPublishGate())) { openPublishPreflight(() => copyShortsGalleryUrl(true)); return false; }
    const id = await publishShare(true);
    if (!id) return false;
    const rtok = project.shareReadToken || shareReadTokRef.current || "";
    const u = SHARE_API + "/shorts/" + id + (rtok ? "?r=" + encodeURIComponent(rtok) : "");
    try { await navigator.clipboard.writeText(u); showToast("切り抜きショートまとめての共有URLをコピーしたよ"); return true; }
    catch (e) { window.prompt("このURLをコピーしてください", u); return false; }
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
  const TAB_LABEL = { overview: "概要", plan: "企画・サムネ", hearing: "取材メモ", wizard: "取材メモ", script: "構成台本", kouban: "香盤表", assets: "素材管理", review: "動画確認", deliver: "納品完了", concept: "チャンネル", manual: "適用レギュレーション" };
  /* タブ共有バー（全タブ共通・右上に固定表示）のボタン文言 */
  const TAB_SHARE_LABEL = { overview: "コンセプトを共有", plan: "企画を共有", hearing: "ヒアリングを共有", script: "台本を共有", kouban: "香盤表を共有", assets: "編集者用リンク（DL+アップ）", review: "確認URLをコピー", deliver: "納品セットを共有" };
  const HANDOFF_TAB_CHOICES = ["review", "manual", "script", "kouban", "assets", "plan", "hearing", "concept", "deliver"]; // 受け渡しで選べるタブ
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
    if (!cd.uploadId || !cd.uploadCap) throw new Error(cd.error || "開始に失敗");
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
            xhr.open("PUT", SHARE_API + "/api/file/mpu/part?key=" + encodeURIComponent(cd.key) + "&uploadId=" + encodeURIComponent(cd.uploadId) + "&part=" + (i + 1) + "&cap=" + encodeURIComponent(cd.uploadCap));
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
      body: JSON.stringify({ snap: sid, key: cd.key, uploadId: cd.uploadId, uploadCap: cd.uploadCap, parts, name: file.name, size: file.size, mime: file.type || "application/octet-stream", ...extra }),
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
      const meta = await uploadToR2(file, "", (p) => setAssetUp({ cat: category, name: (batch ? `[${batch.i}/${batch.n}] ` : "") + file.name, pct: p }), sh.id, sh.token, { retention: 90 });
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
  // 納品完了タブ：サムネ画像アップロード（候補は最大6枚・実際に使うのは最大3枚）
  const DELIVER_THUMB_MAX = 6;
  const DELIVER_THUMB_USE_MAX = 3;
  const deliverThumbs = () => (m.deliverThumbImages && Array.isArray(m.deliverThumbImages)) ? m.deliverThumbImages : (m.deliverThumbImage ? [m.deliverThumbImage] : []);
  // useフィールドが無い（アップ済みの旧データ）は先頭3枚を使用中扱いにする＝移行直後もいきなり全部「未選択」にならない
  const deliverThumbUsed = (t, idx) => (t.use !== undefined ? t.use : idx < DELIVER_THUMB_USE_MAX);
  const toggleDeliverThumbUse = (idx) => {
    const cur = deliverThumbs();
    const t = cur[idx]; if (!t) return;
    const nowUsed = deliverThumbUsed(t, idx);
    if (!nowUsed) {
      const usedCount = cur.filter((x, i) => deliverThumbUsed(x, i)).length;
      if (usedCount >= DELIVER_THUMB_USE_MAX) { showToast(`使用は最大${DELIVER_THUMB_USE_MAX}枚まで。他を候補に戻してから選んでね`); return; }
    }
    setMeta("deliverThumbImages", cur.map((x, i) => (i === idx ? { ...x, use: !nowUsed } : x)));
  };
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
    const targetId = activeIdRef.current;
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
      await addVersionFromVideo(targetId, v, (u.name || "編集者アップ"));
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
      // 回収するものが無い時は setVersions を呼ばない。呼ぶと中身が同じでも project の参照が毎回変わり、
      // 45秒ごとの自己修復だけで案件保存が走っていた（＝案件を開いて放置するだけで1,920書込/日）。
      const cur = reviewVersions();
      const has = (v) => cur.some((x) => (v.uid && x.uid === v.uid) || (v.key && x.key === v.key));
      const add = cand.filter((v) => !has(v));
      if (!add.length) return;
      console.log("[mg] snapから版を回収:", add.map((v) => v.label).join(","));
      setVersions((arr) => {
        const has2 = (v) => arr.some((x) => (v.uid && x.uid === v.uid) || (v.key && x.key === v.key));
        const add2 = cand.filter((v) => !has2(v));
        return add2.length ? [...arr, ...add2.map((v) => ({ ...v }))] : arr;
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

  // 進行ストリップ：Flip Board(D1正本)から担当案件の日程スライスを引く。未公開(shareId無し)/未リンクは出さない（窓表示・読み取り専用）
  React.useEffect(() => {
    // 2026-08-21廃止: 進行・納品状態はStudio OSで確認する。
    setSched(null);
    return;
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
        if (v.streamOwner === "user" && MG_SESSION) pollOwnStreamReady(v.uid);
        else pollStreamReady(v.uid);
      }
    }
  };
  React.useEffect(() => { if (tab === "review" && project) resumeStreamPolls(false); }, [tab, project && project.id]);
  /* 納品完了タブを開くたびに、完成動画の文字起こしが後から出来ていないか確認し、出来ていれば目次だけ静かに実尺版へ差し替える。
     「自動生成」直後の20分ポーリングはタブを閉じると死んで目次が更新されないまま=silent failになる（2026-08-17指摘）。
     次に開いた時に必ず追いつく形にして、タブを開きっぱなしにする必要をなくす。 */
  React.useEffect(() => {
    if (tab !== "deliver" || !project || !project.shareId || project.format === "talk") return;
    let cancelled = false;
    (async () => {
      try {
        const tr = await fetch(SHARE_API + "/api/transcript/" + project.shareId + "?token=" + encodeURIComponent(project.shareToken || "")).then((r) => r.json());
        if (cancelled || !tr || !Array.isArray(tr.segments) || !tr.segments.length) return;
        const lastUsed = (project.meta || {}).deliverChaptersTranscriptAt || 0;
        if ((tr.updatedAt || 0) <= lastUsed) return; // すでにこの文字起こしで作り直し済み
        const res = await fetch(SHARE_API + "/api/deliver", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project, transcript: tr.segments }),
        });
        const d = await res.json();
        if (cancelled || !res.ok || !(d.chapters || "").trim()) return;
        setMeta("deliverChapters", d.chapters.trim());
        setMeta("deliverChaptersTranscriptAt", tr.updatedAt || Date.now());
        showToast("完成動画の文字起こしができていたので、目次を実尺版に自動更新しました");
      } catch (e) {}
    })();
    return () => { cancelled = true; };
  }, [tab, project && project.id, project && project.shareId]);

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
  const reviewVersions = (p) => { const pr = p || project; return (pr && pr.review && Array.isArray(pr.review.versions)) ? pr.review.versions : []; };
  const activeReviewVersions = () => reviewVersions().filter((v) => !v.trashedAt);
  const trashedReviewVersions = () => reviewVersions().filter((v) => v.trashedAt);
  const setVersions = (updater) => setProject((p) => { const rv = (p.review && p.review.versions) || []; const next = typeof updater === "function" ? updater(rv) : updater; return { ...p, review: { versions: next, comments: (p.review && p.review.comments) || [] } }; });
  // targetId＝アップロードを開始した時点でアクティブだった案件。アップロード完了までの間に
  // 別タブ（別案件）へ切り替えられていることがあり、そのままsetProjectで書くと「今アクティブな
  // （切替先の）案件」に版が混ざる（2026-08-19 複数案件で同時並行アップロードした動画が1タブに
  // まとまって入る事故）。完了時点のactiveIdRefと比較し、切り替えられていたら該当案件のデータを
  // 読み直してからそちらへ書く。
  const addVersionFromVideo = async (targetId, vobj, name) => {
    const buildNext = (p) => {
      const rv = (p.review && p.review.versions) || [];
      // 採番は「配列長+1」だと削除や競合でv3が2個できる（2026-07-07 近川さんで実発生）→既存最大番号+1
      const maxN = rv.reduce((mx, v) => { const m = /^v(\d+)$/.exec(v.label || ""); return m ? Math.max(mx, +m[1]) : mx; }, 0);
      const label = "v" + (maxN + 1);
      const v = { id: uid(), label, name: name || label, type: vobj.type, key: vobj.key || "", url: vobj.url || "", uid: vobj.uid || "", hls: vobj.hls || "", streamOwner: vobj.streamOwner || "", ready: vobj.type === "stream" ? !!vobj.ready : true, createdAt: Date.now(), createdBy: (user && user.name) || "ディレクター" };
      // 素材管理の「確認用動画」にもミラー（DLは元のR2マスター）
      const asset = newAsset("確認用動画", { type: vobj.type === "youtube" ? "youtube" : "mp4", key: vobj.key || "", url: vobj.url || "", name: v.name, versionId: v.id });
      return { ...p, review: { versions: [...rv, v], comments: (p.review && p.review.comments) || [] }, assets: [asset, ...(Array.isArray(p.assets) ? p.assets : [])] };
    };
    if (targetId === activeIdRef.current) {
      // setProjectの結果（本当に確定した最新project）をこのPromiseで受け取る。closureのprojectを使うと
      // 3秒デバウンス保存が通る前にリロード/離脱されたときに版が消える（2026-08-19 動画確認消失事故）ので、
      // ここで確実に即保存する。
      const next = await new Promise((resolve) => { setProject((p) => { const np = buildNext(p); resolve(np); return np; }); });
      try {
        const ok = await saveProjectData(next);
        if (ok !== false) { lastSaveSigRef.current = JSON.stringify(cleanProj(next)); pendingSaveRef.current = null; setSaveState("ok"); }
        else { pendingSaveRef.current = next; setSaveState(Date.now() < quotaUntilRef.current ? "quota" : "error"); }
      } catch (e) { pendingSaveRef.current = next; setSaveState("error"); }
      return;
    }
    // 切り替え済み：boardCacheは古い可能性があるので必ずストレージから読み直してから追記する
    const entry = index.find((x) => x.id === targetId);
    let base = null;
    try {
      if (entry && entry.collab) {
        const r = await collabGet(targetId);
        base = { ...migrateProject(r.project), id: targetId, collab: true, collabRole: r.role, ownerEmail: r.ownerEmail, members: r.members };
      } else {
        const r = await window.storage.get(STORE_PROJ(targetId));
        base = r && r.value ? migrateProject(JSON.parse(r.value)) : null;
      }
    } catch (e) {}
    if (!base) { showToast("アップロード先の案件を読み込めず、保存できませんでした"); return; }
    const next = buildNext(base);
    setBoardCache((c) => ({ ...c, [targetId]: next }));
    try { await saveProjectData(next); showToast("「" + ((entry && entry.name) || "他の案件") + "」に動画を追加したよ（切替先ではなく元の案件に保存）"); }
    catch (e) { showToast("保存に失敗しました：" + (e.message || e)); }
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
  /* 利用者自身のCloudflare Streamを確認。OAuth tokenはWorker内だけで使い、ブラウザへ出さない。 */
  const pollOwnStreamReady = async (sid, tries = 0) => {
    if (tries > 100) { setVersions((arr) => arr.map((x) => (x.uid === sid && !x.ready ? { ...x, streamFailed: true } : x))); return; }
    try {
      const r = await fetch(SHARE_API + "/api/cf/stream/" + encodeURIComponent(sid), { headers: { Authorization: "Bearer " + MG_SESSION } });
      const d = await r.json();
      if (d.ready && d.hls) {
        setVersions((arr) => arr.map((x) => (x.uid === sid ? { ...x, ready: true, hls: d.hls, pct: 100, streamFailed: false, streamOwner: "user" } : x)));
        return;
      }
      if (d.state === "error") { setVersions((arr) => arr.map((x) => (x.uid === sid ? { ...x, streamFailed: true } : x))); return; }
      setVersions((arr) => arr.map((x) => (x.uid === sid ? { ...x, pct: d.pct || x.pct } : x)));
    } catch (e) {}
    setTimeout(() => pollOwnStreamReady(sid, tries + 1), 5000);
  };
  /* TUS: 動画本体はブラウザ→利用者自身のStreamへ直送。Worker/R2の容量・帯域を消費しない。 */
  const uploadToOwnStream = async (file, onProgress = null) => {
    const r = await fetch(SHARE_API + "/api/cf/stream/upload", {
      method: "POST",
      headers: { Authorization: "Bearer " + MG_SESSION, "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, size: file.size, mime: file.type || "video/mp4" }),
    });
    const d = await r.json();
    if (!r.ok || !d.uploadUrl || !d.uid) throw new Error(d.error || "Streamアップロードを開始できません");
    const CHUNK = 50 * 1024 * 1024; // Cloudflare推奨50MiB。256KiBの倍数。
    let offset = 0;
    while (offset < file.size) {
      const blob = file.slice(offset, Math.min(file.size, offset + CHUNK));
      let nextOffset = null, lastErr = null;
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          nextOffset = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("PATCH", d.uploadUrl);
            xhr.timeout = 180000;
            xhr.setRequestHeader("Tus-Resumable", "1.0.0");
            xhr.setRequestHeader("Upload-Offset", String(offset));
            xhr.setRequestHeader("Content-Type", "application/offset+octet-stream");
            xhr.upload.onprogress = (e) => {
              if (e.lengthComputable) (onProgress || setMediaProg)(Math.min(100, Math.round((offset + e.loaded) / file.size * 100)));
            };
            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) resolve(+(xhr.getResponseHeader("Upload-Offset") || offset + blob.size));
              else reject(new Error("Stream送信失敗(" + xhr.status + ")"));
            };
            xhr.onerror = () => reject(new Error("Streamへの通信エラー"));
            xhr.ontimeout = () => reject(new Error("Streamへの送信が止まりました"));
            xhr.send(blob);
          });
          break;
        } catch (e) {
          lastErr = e;
          // 現在offsetをHEADで取り直して、成功済みチャンクを二重送信しない。
          try {
            const hr = await fetch(d.uploadUrl, { method: "HEAD", headers: { "Tus-Resumable": "1.0.0" } });
            if (hr.ok) offset = +(hr.headers.get("Upload-Offset") || offset);
          } catch (_) {}
          if (attempt < 5) await new Promise((ok) => setTimeout(ok, Math.min(30000, 2000 * Math.pow(2, attempt))));
        }
      }
      if (nextOffset == null) throw lastErr || new Error("Stream送信に失敗しました");
      offset = nextOffset;
    }
    return { type: "stream", uid: d.uid, key: "", ready: false, streamOwner: "user" };
  };
  // mediaBusy/mediaProgは1個の共有stateなので、2本目を上げ始めると先に終わった方の
  // setMediaBusy("")が後発の進捗表示を消してしまい「アップロードできていない」ように見える
  // （2026-08-19判明）。転送だけ直列キューに通して1本ずつ確実に進める。
  // ただし targetId／sh（共有ID）／projLive は「今アクティブな案件」に依存する値なので、
  // キューで待たされている間に案件タブを切り替えられると取り違える（2026-08-19 ゆかり先生タブに
  // 聖良さん分が混入する形で実際に再発）。これらは必ずクリック直後＝キューに積む前に確定させる。
  const uploadVersionVideo = async (file, onProgress = null) => {
    if (!/^video\//.test(file.type) && !/\.(mp4|mov|m4v|webm)$/i.test(file.name)) { showToast("動画ファイルを選んでね"); return; }
    // 保存が通っていない状態で上げると、R2への転送は成功するのに版そのものが保存されず、
    // 画面を切り替えた瞬間に消える（＝GB単位を上げ直すハメになる）。上げる前に必ず止める。
    if (Date.now() < quotaUntilRef.current || pendingSaveRef.current) {
      const go = window.confirm("いま案件の保存がサーバーに通っていません。\n\nこのまま動画を上げても、追加した版は保存されず、画面を切り替えた時点で消えます（アップロードの時間だけ無駄になります）。\n\nそれでも続けますか？");
      if (!go) return;
    }
    const targetId = activeIdRef.current;
    const projLive = !!project.live;
    const sh = await ensureShare(); if (!sh) return;   // 確認用URLは動画アップの副産物として自動発行（先に手で発行させない）
    const queued = uploadQueuePendingRef.current > 0;
    uploadQueuePendingRef.current += 1;
    if (queued) showToast("前の動画のアップロードが終わり次第、続けて上げます");
    const run = uploadQueueRef.current.then(() => uploadVersionVideoImpl(file, onProgress, targetId, sh, projLive)).finally(() => { uploadQueuePendingRef.current -= 1; });
    uploadQueueRef.current = run.catch(() => {});
    return run;
  };
  const uploadVersionVideoImpl = async (file, onProgress, targetId, sh, projLive) => {
    setMediaBusy("動画をアップロード中…"); setMediaProg(0);
    try {
      // 接続済みユーザーは自分のStreamへ直接送る。AKのR2/Streamには一切保存しない。
      if (user && cfStream.connected) {
        const own = await uploadToOwnStream(file, onProgress);
        await addVersionFromVideo(targetId, own, file.name);
        pollOwnStreamReady(own.uid);
        showToast("自分のCloudflare Streamへアップしました。軽量版を準備中…");
        setMediaBusy("");
        return;
      }
      // 一般利用者をAKのR2/Streamへ暗黙フォールバックさせない。費用分離を必ず守る。
      // 例外＝live編集リンクで開いている編集者：所有者の案件への完成動画アップなので所有者のR2/Streamに保存
      // （share.htmlの&up=編集者アップと同じ設計。ここを塞ぐと「編集権限なのに動画が上げられない」）
      if (!cfStream.legacyAllowed && !projLive) {
        // 2026-08-23 勇人さん事故：Bird Flipの編集者が直接ログイン→初回自動生成の「案件1」に動画を上げようとして
        // ここで弾かれ「Stream接続しろ」としか言われず、YouTube限定公開で回避した。ここに来る人の大半は
        // 「依頼主の案件に上げたい人」なので、まず正しい入口（依頼主から受け取る編集リンク）を案内し、
        // 自分の案件として使う人だけStream接続へ誘導する。アカウント画面を勝手に開くのもやめる（混乱の元）。
        // トーストは2.2秒で消えて読めないので、ここだけは読み切れるダイアログで出す
        try {
          window.alert(
            "この案件はあなた個人の案件のため、ここには動画を上げられません。\n\n"
            + "依頼された案件の動画は、依頼主（ディレクター）から受け取った「編集リンク」で案件を開いてアップしてください（依頼主側に保存されます）。\n\n"
            + (user ? "自分の案件として動画を使う場合は、アカウント画面で自分のCloudflare Streamを接続してください。" : "自分の案件として使う場合はGoogleログイン後、アカウント画面で自分のCloudflare Streamを接続してください。")
          );
        } catch (e) {}
        throw new Error("編集リンクから開いた案件にアップしてください");
      }
      // 確認用バージョン＝納品URLにもなる金看板。保存期限で消えると先方に渡したURLが死ぬため無期限固定
      const meta = await uploadToR2(file, "", onProgress, sh.id, sh.token, { retention: 90 });
      // Streamへ取り込み（自動で軽量化）。無効/失敗ならR2直再生にフォールバック
      let v = null;
      try {
        const r = await fetch(SHARE_API + "/api/stream/copy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ snap: sh.id, token: sh.token, key: meta.key, name: file.name }) });
        const d = await r.json();
        if (d.uid) v = { type: "stream", uid: d.uid, key: meta.key, ready: false };
      } catch (e) {}
      if (!v) v = { type: "mp4", key: meta.key };
      await addVersionFromVideo(targetId, v, file.name);
      if (v.type === "stream") { pollStreamReady(v.uid); showToast("アップ完了。変換中…（少し待つと軽く再生できる）"); }
      else showToast("バージョンを追加したよ（Stream未設定のためR2直再生）");
    }
    catch (e) { showToast("アップロードに失敗：" + (e.message || e)); }
    setMediaBusy("");
  };
  const addVersionYouTube = async (rawUrl) => {
    const vid = ytIdFromUrl(rawUrl); if (!vid) { showToast("YouTubeのURLが正しくないみたい"); return; }
    const targetId = activeIdRef.current;
    const sh = await ensureShare(); if (!sh) return;   // 共有URLが無ければ自動発行（追加した版がそのまま確認URLに出るように）
    await addVersionFromVideo(targetId, { type: "youtube", url: "https://www.youtube.com/watch?v=" + vid }, "YouTube版");
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
  /* 物語の背骨：このロケブロックを起/承/転/結…のどのステップに置くかを手で決める（比例配分の上書き）。
     step に null を渡すと自動（比例配分）に戻す。フレームワークごとに別々に覚える */
  const setSpinePhase = (locId, fwKey, step) => setRows((rows) => rows.map((r) => {
    if (r.id !== locId || r.kind !== "location") return r;
    const sp = { ...(r.spine || {}) };
    if (step == null) delete sp[fwKey]; else sp[fwKey] = step;
    return { ...r, spine: sp };
  }));
  const clearSpinePhases = (fwKey) => setRows((rows) => rows.map((r) => {
    if (r.kind !== "location" || !r.spine || r.spine[fwKey] == null) return r;
    const sp = { ...r.spine }; delete sp[fwKey];
    return { ...r, spine: sp };
  }));
  /* マインドマップ Phase2：ステップのメモを種に、構成台本へ実際のシーン行を作る。
     そのフェーズに既存のロケブロックがあれば末尾に追加。無ければ新規ロケを作り、
     行の並び順（phaseSeqは行順で単調増加という前提）を崩さない位置へ挿し込む。 */
  const addSceneFromMindmap = (sectionId) => {
    pushMmUndo();
    const phaseIdx = +String(sectionId).replace("phase", "");
    const fw = STORY_FRAMEWORKS[spineFw] || STORY_FRAMEWORKS.spine;
    const noteText = (project.mindmapNotes && project.mindmapNotes[spineFw + ":" + sectionId]) || "";
    const rows = project.rows || [];
    const beats = deriveSpineBeats(rows);
    const overrides = {};
    rows.forEach((r) => { if (r.kind === "location" && r.spine && r.spine[spineFw] != null) overrides[r.id] = r.spine[spineFw]; });
    const phases = phaseSeq(beats, fw.steps.length, spineFw, overrides);
    const newRow = { ...newScene("解説系", ""), script: noteText };
    let targetBeatIdx = -1;
    for (let i = 0; i < beats.length; i++) { if (phases[i] === phaseIdx && beats[i].scenes > 0) targetBeatIdx = i; }
    if (targetBeatIdx >= 0) {
      const beat = beats[targetBeatIdx];
      const lastItemId = beat.items.length ? beat.items[beat.items.length - 1].id : null;
      const anchorId = lastItemId || beat.id;
      const insertIdx = anchorId ? rows.findIndex((r) => r.id === anchorId) : -1;
      if (insertIdx >= 0) insertBelow(insertIdx, newRow); else setRows((rs) => [...rs, newRow]);
    } else {
      let insertBeforeRowId = null;
      for (let i = 0; i < beats.length; i++) { if (phases[i] > phaseIdx && beats[i].id) { insertBeforeRowId = beats[i].id; break; } }
      const newLoc = { id: uid(), kind: "location", label: (fw.steps[phaseIdx] && fw.steps[phaseIdx].phrase) || "新規ロケ", address: "", time: "", note: "", spine: { [spineFw]: phaseIdx } };
      setRows((rs) => {
        const next = [...rs];
        const pos = insertBeforeRowId ? next.findIndex((r) => r.id === insertBeforeRowId) : next.length;
        next.splice(pos < 0 ? next.length : pos, 0, newLoc, newRow);
        return next;
      });
    }
    jumpToRow(newRow.id);
  };
  /* マインドマップのノード操作（MindNode風）：Enter/Tabで選択中シーンの直後に兄弟シーンを追加。
     台本タブへは移動しない＝マインドマップに留まったまま連続入力できるように。新規行idを同期で返す */
  const addSceneAfter = (rowId, label) => {
    pushMmUndo();
    const rows = project.rows || [];
    const idx = rows.findIndex((r) => r.id === rowId);
    if (idx < 0) return null;
    const row = newScene("解説系", label || "");
    insertBelow(idx, row);
    return row.id;
  };
  const renameSceneLabel = (rowId, label) => { pushMmUndo(); updateRow(rowId, { label }); };
  /* マインドマップのQ&Aサブノード：qi番目の「◼︎ 質問」行だけを書き換える（回答・他の質問行はそのまま） */
  const patchQuestion = (rowId, qi, newQ) => {
    const row = (project.rows || []).find((r) => r.id === rowId);
    if (!row) return;
    const lines = (row.script || "").split("\n");
    let seen = -1, targetLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*[◼■]/.test(lines[i])) { seen++; if (seen === qi) { targetLine = i; break; } }
    }
    if (targetLine < 0) return;
    pushMmUndo();
    lines[targetLine] = "◼︎ " + newQ;
    updateRow(rowId, { script: lines.join("\n") });
  };
  /* マインドマップのQ&Aサブノード：qi番目の質問に続く回答（セリフ）部分を丸ごと1行に置き換える */
  const patchAnswer = (rowId, qi, newA) => {
    const row = (project.rows || []).find((r) => r.id === rowId);
    if (!row) return;
    const lines = (row.script || "").split("\n");
    const qLineIdxs = [];
    lines.forEach((l, i) => { if (/^\s*[◼■]/.test(l)) qLineIdxs.push(i); });
    const start = qLineIdxs[qi];
    if (start == null) return;
    const end = qLineIdxs[qi + 1] != null ? qLineIdxs[qi + 1] : lines.length;
    pushMmUndo();
    const next = [...lines.slice(0, start + 1), newA, ...lines.slice(end)];
    updateRow(rowId, { script: next.join("\n") });
  };
  // マインドマップからのシーン削除（Delete/Backspaceキー）
  const deleteSceneFromMindmap = (rowId) => { pushMmUndo(); deleteRow(rowId); };
  /* マインドマップからのQ&A削除：qi番目の「◼︎ 質問」行から次の◼︎行の手前（無ければ末尾）までを丸ごと除去 */
  const deleteQuestionFromMindmap = (rowId, qi) => {
    const row = (project.rows || []).find((r) => r.id === rowId);
    if (!row) return;
    const lines = (row.script || "").split("\n");
    const qLineIdxs = [];
    lines.forEach((l, i) => { if (/^\s*[◼■]/.test(l)) qLineIdxs.push(i); });
    const start = qLineIdxs[qi];
    if (start == null) return;
    const end = qLineIdxs[qi + 1] != null ? qLineIdxs[qi + 1] : lines.length;
    pushMmUndo();
    lines.splice(start, end - start);
    updateRow(rowId, { script: lines.join("\n") });
  };
  /* マインドマップの「＋ノード」ボタン：選択中のシーンに空の質問行を追加し、そのまま編集開始できるよう新しいqiを返す */
  const addQuestionToScene = (rowId) => {
    const row = (project.rows || []).find((r) => r.id === rowId);
    if (!row) return null;
    pushMmUndo();
    const script = row.script || "";
    // parseQAは質問が空文字だとペアごと除外してノードが出てこないため、仮テキストを入れておく（編集開始時に選択状態で上書きできる）
    const next = script + (script && !script.endsWith("\n") ? "\n" : "") + "◼︎ 新しい質問";
    updateRow(rowId, { script: next });
    const qLineIdxs = []; next.split("\n").forEach((l, i) => { if (/^\s*[◼■]/.test(l)) qLineIdxs.push(i); });
    return qLineIdxs.length - 1;
  };
  /* 物語の背骨：ロケブロック（ロケ行＋配下シーン）ごとD&Dで並べ替え。from/to は beats のindex */
  const moveSpineBlock = (from, to) => setRows((rows) => {
    const blocks = spineBlocks(rows);
    if (from == null || to == null || from === to) return rows;
    if (from < 0 || from >= blocks.length || to < 0 || to > blocks.length) return rows;
    const next = [...blocks];
    const [b] = next.splice(from, 1);
    next.splice(Math.max(0, Math.min(to, next.length)), 0, b);   // 落とした位置＝そのブロックの新しい並び順
    return next.flatMap((x) => x.rows);
  });

  /* ---- 複数選択 ---- */
  const isSelected = (id) => selectedIds.includes(id);
  const clearSelection = () => { setSelectedIds([]); lastSelRef.current = null; };
  // 選択したシーンの原稿をプレーンテキスト化（装飾記号 **太字/!!赤 を除去）。コピー・txt保存で共用。
  const selectedScriptText = () => {
    const rows = (project.rows || []).filter((r) => r.kind === "scene" && selectedIds.includes(r.id));
    const clean = (s) => (s || "").replace(/\*\*/g, "").replace(/!!/g, "").trim();
    return { n: rows.length, text: rows.map((r) => (r.label ? "【" + r.label + "】\n" : "") + clean(r.script)).join("\n\n").trim() };
  };
  const copySelectedScripts = async () => {
    const { n, text } = selectedScriptText();
    if (!text) { showToast("選択した原稿が空です"); return; }
    try { await navigator.clipboard.writeText(text); showToast(n + "件の原稿をコピーしました（プレーン）"); }
    catch (e) { showToast("コピーに失敗しました"); }
  };
  // 選択した原稿を .txt でダウンロード → Claude等にファイルとしてドラッグすれば「空の添付」にならず確実に読める。
  const downloadSelectedScripts = () => {
    const { n, text } = selectedScriptText();
    if (!text) { showToast("選択した原稿が空です"); return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    a.download = (project.name || "原稿") + "_原稿.txt";
    a.click();
    showToast(n + "件の原稿を.txtで保存しました");
  };
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
  /* ===== 目次レール（全タブ共通） =====
     見出しに付けた data-toc と、素の <h2> を本文からかき集めて右端の細い縦レールにする。
     タブごとに目次を作り込まない＝カードやタブを足しても勝手に目次へ載る（作り忘れが起きない）。
     幅は10px相当のレールだけ。ラベルはホバー時にオーバーレイで出す＝本文を狭めない。 */
  const [tocItems, setTocItems] = useState([]);
  const [tocActive, setTocActive] = useState(null);
  const tocSig = useRef("");
  useEffect(() => {
    const scan = () => {
      const root = mainRef.current;
      if (!root) return;
      const items = [];
      Array.prototype.forEach.call(root.querySelectorAll("[data-toc], h2"), (el, i) => {
        const attr = el.getAttribute("data-toc");
        // data-toc を持つ見出しの中の <h2> は同じ場所なので二重に数えない
        if (attr == null && el.closest("[data-toc]")) return;
        const label = (attr != null ? attr : (el.textContent || "")).trim().replace(/\s+/g, " ").slice(0, 30);
        if (!label) return;
        if (!el.id) el.id = "toc-anchor-" + i;
        items.push({ id: el.id, label, group: el.hasAttribute("data-toc-group") });
      });
      const sig = items.map((x) => x.id + ":" + x.label + (x.group ? "*" : "")).join("|");
      if (sig === tocSig.current) return;
      tocSig.current = sig;
      setTocItems(items);
    };
    const t = setTimeout(scan, 150);
    return () => clearTimeout(t);
  }, [tab, prepView, project, isNarrow]);
  useEffect(() => {
    if (!tocItems.length) { setTocActive(null); return; }
    let raf = 0;
    const sync = () => {
      raf = 0;
      let cur = null;
      tocItems.forEach((it) => { const el = document.getElementById(it.id); if (el && el.getBoundingClientRect().top <= headerH + 60) cur = it.id; });
      setTocActive((p) => (p === cur ? p : cur));
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(sync); };
    window.addEventListener("scroll", on, { passive: true });
    sync();
    return () => { window.removeEventListener("scroll", on); if (raf) cancelAnimationFrame(raf); };
  }, [tocItems, headerH]);
  const jumpToToc = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    window.scrollTo({ top: Math.max(0, window.scrollY + el.getBoundingClientRect().top - (headerH + 16)), behavior: "smooth" });
    setTocActive(id);
  };

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

  const { tcs, clocks, totalEst, totalTarget, totalChars, totalTravel, locations, sceneNos, sceneLocDone, dayStarts, maxDay } = useMemo(() => {
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
    const dayStarts = {};    // ロケid → 撮影日（日が切り替わる先頭ロケのみ）
    let prevLocDay = null;
    let noInDay = 0;         // その撮影日の中でのロケ通し番号
    const rows = (project && project.rows) ? project.rows : [];
    const rate = (project && project.rate) ? project.rate : 5;
    for (const r of rows) {
      // 手入力の開始時刻(TC)があればそこから積み上げ直す
      if (r.tc != null && r.tc !== "" && !isNaN(Number(r.tc))) acc = Number(r.tc);
      tcs[r.id] = acc;
      if (r.kind === "location") {
        const d = dayOf(r);
        if (prevLocDay === null || d !== prevLocDay) {
          dayStarts[r.id] = d;
          noInDay = 0;
          if (prevLocDay !== null) anchorClock = null; // 日をまたいだら実時刻の積み上げをリセット
        }
        prevLocDay = d;
        noInDay += 1;
        cur = { ...r, scenes: [], dur: 0, secSum: 0, tcIn: acc, dayNo: d, noInDay };
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
    // 交通費合計：先頭ロケ・「前ロケと同じ場所」・日をまたぐ区間は移動が存在しないので除外
    const totalTravel = locations.reduce((a, l, i) => a + (i > 0 && locations[i - 1].dayNo === l.dayNo && !samePlace(locations[i - 1], l) ? (Number(l.travelCost) || 0) : 0), 0);
    const maxDay = locations.reduce((a, l) => Math.max(a, l.dayNo || 1), 1);
    return { tcs, clocks, totalEst: acc, totalTarget: tt, totalChars: tc, totalTravel, locations, sceneNos, sceneLocDone, dayStarts, maxDay };
  }, [project]);

  /* ロケ見出しの撮影日セレクタ（1日目/2日目…）。dark=濃色ヘッダー上に置く時 */
  const dayPickerEl = (r, dark) => (
    <select
      value={dayOf(r)}
      onChange={(e) => updateRow(r.id, { day: Number(e.target.value) })}
      onClick={(e) => e.stopPropagation()}
      title="このロケの撮影日。日を分けると構成台本・香盤表が1日目/2日目で区切られる（時刻の積み上げ・移動も日ごとにリセット）"
      className={"shrink-0 self-center rounded-md text-[10px] font-bold px-1.5 py-1 appearance-none cursor-pointer focus:outline-none text-center " + (dark ? "bg-white/10 hover:bg-white/20" : "bg-stone-100 hover:bg-stone-200 text-stone-600")}
      style={dark ? { color: mainText, fontFamily: mono, opacity: dayOf(r) > 1 || maxDay > 1 ? 1 : 0.55 } : { fontFamily: mono }}>
      {Array.from({ length: Math.min(9, Math.max(2, maxDay + 1)) }, (_, i) => i + 1).map((d) => (
        <option key={d} value={d} style={{ color: "#1A1A1A" }}>{d}日目</option>
      ))}
    </select>
  );

  /* 日の区切りバナー（複数日のときだけ台本・香盤表に出す）。
     どこからどこまでが同じ撮影日かを一目にする＝フルワイド帯。1日目=メイン色/2日目以降=アクセント色で色から区別 */
  const dayBannerEl = (d) => {
    const dayLocs = locations.filter((l) => l.dayNo === d);
    const secs = dayLocs.reduce((a, l) => a + l.dur, 0);
    const first = d === 1;
    return (
      <div data-toc={"撮影 " + d + "日目"} data-toc-group="1"
        className="rounded-xl px-4 py-2.5 flex items-center gap-3 shadow-md" style={{ background: first ? theme.main : theme.accent, color: first ? mainText : accentText }}>
        <Icon name="video" className="w-4 h-4 shrink-0" />
        <span className="text-[15px] font-black tracking-[0.2em] whitespace-nowrap">撮影 {d}日目</span>
        <span className="text-[11px] font-bold opacity-75 whitespace-nowrap">{dayLocs.length}ロケ・{fmtJP(secs)}</span>
        <div className="flex-1 h-0.5 rounded-full" style={{ background: "currentColor", opacity: 0.25 }} />
      </div>
    );
  };

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
    const th2 = m.thumbs2 || [];
    if (th2.some(Boolean)) lines.push(["", "サムネ案②", esc(th2[0]), esc(th2[1]), esc(th2[2])].join("\t"));
    lines.push(["", "ハイライト", esc(m.highlight)].join("\t"));
    lines.push("");
    lines.push(["時間", "ロケーション", "内容", "シーン", "秒数", "所要時間", "文字数", "原稿"].join("\t"));
    let acc = 0;
    let prevDay = null;
    for (const r of project.rows) {
      if (r.kind === "location") {
        // 複数日撮影のときは日の区切り行を入れる（取り込み時に day として復元される）
        const d = dayOf(r);
        if (maxDay > 1 && d !== prevDay) lines.push(["", d + "日目", "", "", "", "", "", ""].join("\t"));
        prevDay = d;
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
  // 台本を CSV / txt でダウンロード（共有メニューから。装飾記号 **//!! は除去）
  const scriptClean = (s) => (s || "").replace(/\*\*/g, "").replace(/!!/g, "").trim();
  const dlFile = (name, text, mime) => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: mime })); a.download = name; a.click(); };
  const exportScriptCSV = () => {
    const q = (s) => { const v = (s || "").toString(); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const rows = [["時間", "ロケーション", "内容", "シーン", "秒数", "文字数", "原稿"]];
    let acc = 0, prevDay = null;
    for (const r of project.rows) {
      if (r.kind === "location") { const d = dayOf(r); if (maxDay > 1 && d !== prevDay) rows.push(["", d + "日目", "", "", "", "", ""]); prevDay = d; rows.push(["", r.label || "", "", "", "", "", ""]); }
      else { const t = sectionOf(r.type), target = targetOf(r), chars = countChars(r.script), dur = chars / project.rate; rows.push([fmt(acc), "", r.label || "", t.full, target, chars || "", scriptClean(r.script)]); acc += chars > 0 ? dur : target; }
    }
    dlFile((project.name || "構成台本") + ".csv", "﻿" + rows.map((row) => row.map(q).join(",")).join("\n"), "text/csv;charset=utf-8");
    showToast("構成台本をCSVで保存しました");
  };
  const exportScriptTxt = () => {
    const m = project.meta, L = [];
    if (m.titles && m.titles[0]) L.push("【タイトル】" + m.titles[0]);
    if (m.highlight) L.push("【ハイライト】\n" + scriptClean(m.highlight));
    let prevDay = null;
    for (const r of project.rows) {
      if (r.kind === "location") { const d = dayOf(r); if (maxDay > 1 && d !== prevDay) L.push("\n=== " + d + "日目 ==="); prevDay = d; L.push("\n■ " + (r.label || "")); }
      else { const t = sectionOf(r.type); L.push("\n【" + (r.label || "") + "】（" + t.full + "）\n" + scriptClean(r.script)); }
    }
    dlFile((project.name || "構成台本") + "_台本.txt", L.join("\n").trim(), "text/plain;charset=utf-8");
    showToast("構成台本をtxtで保存しました");
  };
  /* 構成表まるごとをプレーンテキストでクリップボードへ（時間・内容・シーン・原稿）。ファイル保存を挟まず即貼り付け用 */
  const copyKouseiText = async () => {
    if (project.format === "talk") { await exportTalkText(); return; }
    const L = [];
    let acc = 0, prevDay = null;
    for (const r of project.rows) {
      if (r.kind === "location") { const d = dayOf(r); if (maxDay > 1 && d !== prevDay) L.push("\n=== " + d + "日目 ==="); prevDay = d; L.push("\n■ " + (r.label || "")); }
      else {
        const t = sectionOf(r.type), chars = countChars(r.script), dur = chars / project.rate;
        L.push("\n" + fmt(acc) + "　" + (r.label || "") + "（" + t.full + "）");
        const sc = scriptClean(r.script);
        if (sc) L.push(sc);
        acc += chars > 0 ? dur : targetOf(r);
      }
    }
    try { await navigator.clipboard.writeText(L.join("\n").trim()); showToast("構成をコピーしました"); }
    catch (e) { showToast("コピーに失敗しました"); }
  };

  const exportKoubanTSV = async () => {
    const esc = (s) => {
      const v = (s || "").toString();
      return /[\t\n"]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    const multi = maxDay > 1;
    const lines = [[...(multi ? ["日"] : []), "順番", "予定時刻", "ロケーション", "住所", "シーン数", "想定尺", "移動手段", "交通費", "メモ"].join("\t")];
    locations.forEach((loc, i) => {
      const dayStart = i === 0 || dayStarts[loc.id] != null; // 日の先頭ロケ＝移動区間なし
      const noMove = dayStart || samePlace(locations[i - 1], loc);
      lines.push([...(multi ? [loc.dayNo + "日目"] : []), multi ? loc.noInDay : i + 1, esc(loc.time), esc(loc.label), esc(loc.address), loc.scenes.length, fmtJP(loc.dur), noMove ? (dayStart ? "" : "（同じ場所）") : esc(loc.travelBy), noMove || loc.travelCost == null ? "" : loc.travelCost, esc(loc.note)].join("\t"));
    });
    if (totalTravel > 0) lines.push([...(multi ? [""] : []), "", "", "", "", "", "", "合計", totalTravel, ""].join("\t"));
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
        <div className="flex-1 overflow-y-auto mg-scroll px-3 py-3 space-y-2 bg-stone-50">
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
    // 取り込み前の状態をスナップ＝「↩️ 直前の反映を取り消す」で取り込みごと戻せる（取り込んだら戻れない問題の解消）
    setChatUndo({ rows: project.rows, talk: project.talk, meta: project.meta, name: project.name, channel: project.channel, plans: project.plans });
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
  /* data-toc＝右端の目次レールが拾う目印。カード見出しは全タブ共通なので、ここに付ければ
     どのタブでも自動で目次が生える（個別タブに目次を作り込まない＝増改築でズレない） */
  const cardHead = (label, right, onClick) => (
    <div onClick={onClick} data-toc={typeof label === "string" ? label : undefined}
      className={"px-4 py-2 flex items-center gap-2 border-b border-stone-100 " + (onClick ? "cursor-pointer select-none hover:bg-stone-50 transition-colors" : "")}>
      <span className="w-1.5 h-4 rounded-full" style={{ background: theme.accent }} />
      <h2 className="text-[12px] font-bold tracking-wider text-stone-600 flex-1">{label}</h2>
      {right}
    </div>
  );

  // 工程タブ：モバイル横バーとPC縦レールで共有（重複防止）
  const tabItemsAll = [["overview", "note", "概要", "概要"], ["plan", "image", "企画・サムネ", "企画"], ...(project.format === "talk" ? [] : [["hearing", "chat", "取材メモ", "取材"]]), ["script", "file", "構成台本", "台本"], ...(project.format === "talk" ? [] : [["mindmap", "share", "マインドマップ", "MM"]]), ...(project.format === "talk" ? [] : [["kouban", "map", "香盤表", "香盤"]]), ["assets", "folder", "素材管理", "素材"], ["review", "video", "動画確認", "動画"], ["deliver", "checkCircle", "納品完了", "納品"]];
  // 「このタブだけ編集」リンク（?live=..&tab=..）で開かれた時は、そのタブ以外を出さない
  const tabItemsLimited = LIVE_ONLY_TABS ? tabItemsAll.filter((t) => LIVE_ONLY_TABS.includes(t[0])) : null;
  const tabItems = (tabItemsLimited && tabItemsLimited.length) ? tabItemsLimited : tabItemsAll;
  /* ツリー用：案件（index行）の中のページ一覧。開いている案件は実データの format を使い、
     まだ開いていない案件は index の format（無ければ密着）で組む＝開く前でも中身が見える。 */
  const pagesFor = (row) => {
    if (row && row.id === activeId) return tabItems;
    const talk = row && row.format === "talk";
    const list = tabItemsAll.filter(([k]) => !talk || (k !== "hearing" && k !== "kouban"));
    // 「このタブだけ編集」リンク中は、どの案件の枝でも許可タブ以外を出さない（制限の抜け道を作らない）
    return LIVE_ONLY_TABS ? list.filter(([k]) => LIVE_ONLY_TABS.includes(k)) : list;
  };
  // ツリーからページを選ぶ：別案件なら開いてからそのページへ着地
  const openPage = async (id, key) => {
    if (id !== activeId) await switchProject(id);
    setTab(key);
    setView("editor");
  };
  const toggleCaseOpen = (id) => setTreeOpen((o) => ({ ...o, [id]: !(o[id] !== undefined ? o[id] : id === activeId) }));
  const isCaseOpen = (id) => (treeOpen[id] !== undefined ? !!treeOpen[id] : id === activeId);

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
          width: sidebarW,
          background: "#15181D",
          color: "#fff",
          display: (() => { try { return window.self !== window.top ? "none" : ""; } catch (e) { return ""; } })(),  // Fボード埋め込み時はサイドバー自体を出さない（左タブ二重防止）
          transform: sidebarOpen ? "translateX(0)" : "translateX(-" + sidebarW + "px)",
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
              <div className="mg-pop absolute left-3 right-3 top-full mt-1 z-50 bg-white border border-stone-200 rounded-xl shadow-2xl overflow-hidden" style={{ transformOrigin: "top left" }}>
                <div className="px-3 pt-2 pb-1 text-[10px] font-bold text-white/40">どのタイプの台本？</div>
                <button onClick={() => createProject(true, DEFAULT_CHANNEL, "documentary")} className="w-full text-left px-3 py-2.5 hover:bg-white/10 flex items-start gap-2">
                  <Icon name="video" className="w-4 h-4 shrink-0 mt-0.5 text-white/60" />
                  <span><span className="block text-[12px] font-bold text-white">一日密着</span><span className="block text-[10px] text-white/45">ロケ・シーン構成のドキュメンタリー</span></span>
                </button>
                <button onClick={() => createProject(true, DEFAULT_CHANNEL, "talk")} className="w-full text-left px-3 py-2.5 hover:bg-white/10 flex items-start gap-2 border-t border-white/10">
                  <Icon name="mic" className="w-4 h-4 shrink-0 mt-0.5 text-white/60" />
                  <span><span className="block text-[12px] font-bold text-white">トーク系</span><span className="block text-[10px] text-white/45">ハイライト/冒頭/目次/本編/CTA構成</span></span>
                </button>
              </div>
            </>
          )}
        </div>
        </>)}

        {/* 案件の絞り込み（件数が増えてもスクロールで探さない） */}
        {!chanLive && index.length > 6 && (
          <div className="px-3 pb-2">
            <input value={caseQuery} onChange={(e) => setCaseQuery(e.target.value)} placeholder="案件を検索"
              className="w-full bg-white/10 text-[11.5px] text-white placeholder-white/35 rounded-lg px-2.5 py-1.5 focus:outline-none focus:bg-white/15" />
          </div>
        )}

        {/* チャンネル名サジェスト用 */}
        <datalist id="mg-channels">
          {channelOptions.map((c) => <option key={c} value={c} />)}
        </datalist>

        {/* ===== チャンネル → 案件 ネスト ===== */}
        <div className="mg-scroll flex-1 overflow-y-auto px-2 pb-3">
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
          ) : channelGroups.map(({ channel, items: allItems }) => {
            // 検索中は一致した案件だけ／一致ゼロのチャンネルは畳まず消す（探し物だけが残る）
            const q = caseQuery.trim().toLowerCase();
            const items = q ? allItems.filter((x) => (x.name || "").toLowerCase().includes(q)) : allItems;
            if (q && !items.length && !channel.toLowerCase().includes(q)) return null;
            const hasActive = items.some((x) => x.id === activeId);
            // 既定はすべて畳む（開いている案件のチャンネルだけ自動展開）。タップで開閉（アコーディオン＝1つだけ開く）
            // 検索中は畳まない（ヒットしたのに見えない、を防ぐ）
            const isCollapsed = caseQuery.trim() ? false : (collapsed[channel] !== undefined ? !!collapsed[channel] : !hasActive);
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
                    <div key={p.id}>
                    <div
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
                        {/* 開閉：この案件の中のページ（概要〜納品完了）を出し入れする */}
                        <button title={isCaseOpen(p.id) ? "ページを隠す" : "ページを表示"}
                          onClick={(e) => { e.stopPropagation(); toggleCaseOpen(p.id); }}
                          className="w-3.5 shrink-0 text-white/40 text-[10px] grid place-items-center hover:text-white/80 transition-transform"
                          style={{ transform: isCaseOpen(p.id) ? "none" : "rotate(-90deg)" }}>▾</button>
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
                    {/* 案件内ページ（ツリーの葉）。ここが工程タブの新しい住所＝右の縦レールは廃止した */}
                    {isCaseOpen(p.id) && (
                      <div className="ml-[26px] mb-1.5 pl-1.5 border-l border-white/10">
                        {pagesFor(p).map(([k, ic, label]) => {
                          const on = active && tab === k;
                          return (
                            <button key={k} onClick={(e) => { e.stopPropagation(); openPage(p.id, k); }} title={label}
                              className={"w-full text-left rounded-md px-2 py-1 mb-px flex items-center gap-1.5 text-[11.5px] transition-colors " + (on ? "font-bold" : "text-white/55 hover:bg-white/5 hover:text-white/85")}
                              style={on ? { background: "rgba(255,255,255,0.14)", color: "#fff" } : {}}>
                              <span className="w-0.5 h-3.5 rounded-full shrink-0" style={{ background: on ? theme.accent : "transparent" }} />
                              <Icon name={ic} className="w-3.5 h-3.5 shrink-0" style={on ? { color: theme.accent } : {}} />
                              <span className="truncate">{label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="px-3 py-2 border-t border-white/10 flex flex-col gap-0.5">
          <button onClick={() => { setView("editor"); setTab("regulations"); setSidebarOpen(false); }}
            className={"flex items-center gap-2 text-[12px] font-bold px-2.5 py-2 rounded-lg text-left w-full transition-colors " + (tab === "regulations" ? "bg-white/15 text-white" : "text-white/80 hover:bg-white/10")}
            title="全社・クライアント・案件例外のレギュレーションをまとめて確認">
            <Icon name="book" className="w-4 h-4 shrink-0" />
            <span>レギュレーション一覧</span>
          </button>
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
        {/* 保存できていない事実を正直に出す。旧実装はKV書込上限で落ちていても「電波待ち」と表示していて、
            回線のせいだと誤認したまま編集を続け、その日の作業が丸ごと消えた（2026-07-27 矢内さん案件）。 */}
        <div className={"px-3 py-2 border-t border-white/10 text-[10px] " + (saveState === "quota" ? "text-rose-400 font-bold" : saveState === "error" ? "text-amber-400" : "text-white/40")}>
          {saveState === "quota"
            ? "保存できません（本日の書き込み上限）。朝9時まで回復しません。編集を続けても消えます — 台本コピーで退避を"
            : saveState === "error"
              ? index.length + "件の案件・未保存（再送中）。この状態でリロードすると消えます"
              : index.length + "件の案件・自動保存"}
        </div>
        {/* 幅を変える取っ手（220〜420px・記憶する）。案件名が長いクライアントで広げられるように */}
        <div
          onPointerDown={(e) => { e.preventDefault(); resizingRef.current = true; document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none"; }}
          onDoubleClick={() => setSidebarW(280)}
          title="ドラッグで幅を変更（ダブルクリックで既定に戻す）"
          className="hidden sm:block absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-white/20 active:bg-white/30" />
      </aside>

      {/* サイドバー開閉オーバーレイ（モバイル・フェード） */}
      <div
        className={"fixed inset-0 z-30 bg-black/40 sm:hidden transition-opacity duration-300 ease-out " + (sidebarOpen ? "opacity-100" : "opacity-0 pointer-events-none")}
        onClick={() => setSidebarOpen(false)} />

      {/* ===== コンテンツ（サイドバー分シフト） ===== */}
      <div className="pb-28" style={{ marginLeft: (() => { try { if (window.self !== window.top) return 0; } catch (e) {} return sidebarOpen && !isNarrow ? sidebarW : 0; })(), transition: "margin-left 0.3s cubic-bezier(0.22, 1, 0.36, 1)" }}>

      {/* ===== ツールバー ===== */}
      <header ref={headerRef} className="sticky top-0 z-20 shadow-lg" style={{ background: theme.main, color: mainText }}>
        <div className="max-w-[1500px] mx-auto px-3 sm:px-4 pt-2.5 pb-1.5 flex items-center gap-2 sm:gap-3 flex-wrap">
          {/* Fボード埋め込み時はハンバーガーとチャンネルチップを出さない（左ツリーが案件切替を担う 2026-07-17 AK指示） */}
          {!IS_EMBED && (
          <button onClick={() => setSidebarOpen((s) => !s)} title="案件リスト"
            className="w-8 h-8 rounded-lg grid place-items-center border border-white/20 hover:bg-white/10 shrink-0">
            <Icon name="menu" className="w-[18px] h-[18px]" />
          </button>
          )}
          {tab === "regulations" ? (
            <div className="font-bold tracking-wide text-[14px] px-1.5 py-1 min-w-0 truncate" style={{ color: mainText, width: "min(46vw, 420px)" }}>レギュレーション一覧</div>
          ) : (
            <input
              value={project.name}
              onChange={(e) => renameProject(project.id, e.target.value)}
              className="bg-transparent font-bold tracking-wide text-[14px] focus:outline-none focus:bg-white/10 rounded px-1.5 py-1 min-w-0"
              /* 200px固定だと長いタイトルが「…」も出ずに頭だけ表示され、リネームが効いてないように見えた（2026-08-08）。
                 幅を広げ、あふれ分は省略記号にする（サイドバーの truncate と同じ見え方に揃える） */
              style={{ color: mainText, width: "min(46vw, 420px)", textOverflow: "ellipsis" }}
              title={project.name || "案件名（クリックで編集）"}
            />
          )}
          {/* カテゴリ（チャンネル）チップはヘッダーから撤去（2026-07-23 AK指示）。変更は左の案件ツリー側で行う */}
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
          <button onClick={() => setTab("regulations")} title="全社・クライアント別のレギュレーション一覧"
            className={"h-8 px-3 rounded-lg inline-flex items-center gap-1.5 text-[11px] font-bold border border-white/20 hover:bg-white/10 " + (tab === "regulations" ? "bg-white/15" : "")} style={{ color: mainText }}>
            <Icon name="book" className="w-4 h-4 shrink-0" /><span>規定一覧</span>
          </button>
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
            <Icon name="book" className="w-4 h-4 shrink-0" /><span className="hidden sm:inline">マニュアル</span>
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
              <div className="mg-pop mg-scroll absolute right-0 top-full mt-1 z-50 w-60 bg-white rounded-xl shadow-2xl border border-stone-200 overflow-hidden text-stone-700 max-h-[80vh] overflow-y-auto">
                {/* ===== 2択だけ（2026-07-17 AK指示：このタブだけ／全体、それだけでいい） ===== */}
                {TAB_SHARE_PANE[tab] && (
                  <button onClick={() => { setShareMenu(false); copyShareUrl(tab); }} className="w-full text-left px-3 py-3 hover:bg-stone-50 text-[13px] font-bold flex items-center gap-2.5">
                    <Icon name="folder" className="w-4 h-4 shrink-0 text-stone-500" />
                    このタブだけ共有<span className="text-[10px] text-stone-400 font-normal ml-auto truncate max-w-[84px]">{TAB_LABEL[tab]}</span>
                  </button>
                )}
                <button onClick={() => { setShareMenu(false); copyShareUrl(); }} className="w-full text-left px-3 py-3 hover:bg-stone-50 text-[13px] font-bold flex items-center gap-2.5">
                  <Icon name="share" className="w-4 h-4 shrink-0 text-stone-500" />
                  全タブ共有<span className="text-[10px] text-stone-400 font-normal ml-auto">閲覧・全タブ</span>
                </button>
                {TAB_LABEL[tab] && (
                  <button onClick={() => { setShareMenu(false); publishShareLive(tab); }} className="w-full text-left px-3 py-3 hover:bg-stone-50 text-[13px] font-bold flex items-center gap-2.5">
                    <Icon name="pencil" className="w-4 h-4 shrink-0 text-stone-500" />
                    このタブだけ編集共有<span className="text-[10px] text-stone-400 font-normal ml-auto truncate max-w-[84px]">{TAB_LABEL[tab]}</span>
                  </button>
                )}
                <button onClick={() => { setShareMenu(false); publishShareLive(); }} className="w-full text-left px-3 py-3 hover:bg-stone-50 text-[13px] font-bold flex items-center gap-2.5">
                  <Icon name="pencil" className="w-4 h-4 shrink-0 text-stone-500" />
                  全タブ編集共有<span className="text-[10px] text-stone-400 font-normal ml-auto">{project.liveId ? "更新・同時編集" : "同時編集"}</span>
                </button>
                {handoffs.find((h) => h.upload || h.id === "upload") && (
                  <button onClick={() => { setShareMenu(false); doHandoff(handoffs.find((h) => h.upload || h.id === "upload")); }} className="w-full text-left px-3 py-3 hover:bg-stone-50 text-[13px] font-bold flex items-center gap-2.5">
                    <Icon name="upload" className="w-4 h-4 shrink-0 text-stone-500" />
                    アップだけ<span className="text-[10px] text-stone-400 font-normal ml-auto">編集者が上げる用</span>
                  </button>
                )}
                <button onClick={() => { setShareMenu(false); copyKouseiText(); }} className="w-full text-left px-3 py-3 hover:bg-stone-50 text-[13px] font-bold flex items-center gap-2.5 border-t border-stone-100">
                  <Icon name="copy" className="w-4 h-4 shrink-0 text-stone-500" />
                  構成をコピー<span className="text-[10px] text-stone-400 font-normal ml-auto">テキスト・貼り付け用</span>
                </button>
                <div className="flex items-stretch border-t border-b border-stone-100">
                  <button onClick={() => { setShareMenu(false); (project.format === "talk" ? exportTalkText : exportScriptCSV)(); }} className="flex-1 text-left px-3 py-3 hover:bg-stone-50 text-[13px] font-bold flex items-center gap-2.5"><Icon name="file" className="w-4 h-4 shrink-0 text-stone-500" />台本コピー<span className="text-[10px] text-stone-400 font-normal ml-auto">CSV</span></button>
                  <button onClick={() => { setShareMenu(false); exportScriptTxt(); }} title="台本をtxtで保存" className="px-3 py-3 hover:bg-stone-50 text-[12px] font-bold text-stone-500 border-l border-stone-100">txt</button>
                </div>
                {/* ===== その他（折りたたみ）：先方/演者・AI・動画確認・カスタマイズ ===== */}
                <button onClick={() => setShareMore((v) => !v)} className="w-full text-left px-3 py-2 hover:bg-stone-50 text-[11px] text-stone-500 flex items-center gap-2">
                  <span className="text-[10px] w-3 inline-block">{shareMore ? "▾" : "▸"}</span> その他のリンク・書き出し
                </button>
                {shareMore && (<>
                  {handoffs.filter((h) => !(h.upload || h.id === "upload")).map((h) => (
                    <button key={h.id} onClick={() => { setShareMenu(false); doHandoff(h); }} className="w-full text-left pl-7 pr-3 py-2.5 hover:bg-stone-50 text-[12px] font-bold flex items-center gap-2">
                      <span className="text-[13px] leading-none">{h.emoji || "📨"}</span>
                      {h.label}<span className="text-[10px] text-stone-400 font-normal ml-auto truncate max-w-[96px]">{(h.tabs || []).map((t) => TAB_LABEL[t]).filter(Boolean).join("・")}</span>
                    </button>
                  ))}
                  <button onClick={() => { setShareMenu(false); setShowHandoffEdit(true); }} className="w-full text-left pl-7 pr-3 py-2 hover:bg-stone-50 text-[11px] text-stone-500 flex items-center gap-2 border-b border-stone-100">
                    <Icon name="gear" className="w-3.5 h-3.5 shrink-0" /> 受け渡しをカスタマイズ
                  </button>
                  <button onClick={() => { setShareMenu(false); copyAiUrl(); }} className="w-full text-left pl-7 pr-3 py-2.5 hover:bg-stone-50 text-[12px] font-bold flex items-center gap-2">
                    <Icon name="robot" className="w-4 h-4 shrink-0 text-stone-500" />
                    AIに読ませる用<span className="text-[10px] text-stone-400 font-normal ml-auto">Claude/GPT</span>
                  </button>
                  <button onClick={() => { setShareMenu(false); setShowMediaModal(true); }} className="w-full text-left pl-7 pr-3 py-2.5 hover:bg-stone-50 text-[12px] font-bold flex items-center gap-2">
                    <Icon name="video" className="w-4 h-4 shrink-0 text-stone-500" /> 動画確認・ファイル転送
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
              <div className="mg-pop absolute right-0 top-full mt-1 z-50 w-60 bg-white rounded-xl shadow-2xl border border-stone-200 overflow-hidden text-stone-700">
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
        {/* タブ：モバイルのみ横スクロールバー（詰め込まずフルラベルで読める。PCは左の縦レールへ移設） */}
        <div className="sm:hidden overflow-x-auto" style={{ WebkitOverflowScrolling: "touch", scrollbarWidth: "none" }}>
          <div className="flex gap-1 px-2 w-max">
            {tabItems.map(([k, ic, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className={"shrink-0 inline-flex items-center gap-1.5 whitespace-nowrap px-3.5 py-2.5 rounded-t-lg text-[12.5px] font-bold tracking-wide transition-colors " + (tab === k ? "" : "opacity-55")}
                style={tab === k ? { background: "#E9E8E3", color: "#1C1C1E" } : { color: mainText }}>
                <Icon name={ic} className="w-4 h-4 shrink-0" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="h-[5px] w-full" style={{ background: stripe }} />

        {showTheme && (
          <div className="mg-pop absolute right-4 top-full mt-2 bg-white text-stone-800 rounded-xl shadow-xl border border-stone-200 p-4 w-64 z-40">
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

      <div className="max-w-[1500px] mx-auto flex">
        {/* 工程タブの縦レールは廃止（2026-07-31）。案件一覧と工程が左右2本に分かれていたのを
            サイドバーのツリー1本に統合した＝視線の横移動が消え、本文の幅がレール分(188px)広がる。
            モバイルは従来どおりヘッダーの横バーで切り替える。 */}
      {!isNarrow && tocItems.length >= 3 && (
        <aside className="hidden sm:block shrink-0 sticky self-start w-10 h-fit z-40" style={{ top: "50%", transform: "translateY(-50%)" }} aria-label="このページの目次">
          <div className="group relative flex flex-col items-center gap-0.5">
            {tocItems.map((it, si) => {
              const active = tocActive === it.id;
              const lineWidth = it.group ? 26 : 10 + ((si * 7) % 15);
              return (
                <button key={it.id} onClick={() => jumpToToc(it.id)} title={it.label}
                  className="relative w-10 h-[11px] shrink-0 flex items-center justify-center rounded focus:outline-none focus-visible:ring-2"
                  aria-label={it.label}>
                  <span className="block rounded-full transition-all hover:scale-x-110"
                    style={{ width: lineWidth, height: it.group ? 3 : 2, backgroundColor: active ? theme.accent : (it.group ? "#8c8880" : "#b9b7b3") }} />
                </button>
              );
            })}
            {/* ホバーで開く一覧（左中央配置・右へ開く。2026-08-23 AK指示）。absolute＝本文の幅を1pxも削らない */}
            <div className="pointer-events-none opacity-0 group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity absolute left-9 top-0 w-56 max-h-[70vh] overflow-y-auto rounded-xl border border-stone-200 bg-white/95 backdrop-blur shadow-xl p-1.5 z-50">
              <div className="text-[9px] font-bold tracking-widest text-stone-300 px-2 pb-1">目次</div>
              {tocItems.map((it) => {
                const active = tocActive === it.id;
                return (
                  <button key={it.id} onClick={() => jumpToToc(it.id)}
                    className={"block w-full text-left text-[11.5px] leading-snug px-2 py-1 rounded-lg hover:bg-stone-100 " + (it.group ? "font-bold mt-1 " : "") + (active ? "font-bold text-stone-900 bg-stone-50" : "text-stone-500")}
                    style={active || it.group ? { color: it.group && !active ? theme.accent : undefined } : {}}>
                    {it.label}
                  </button>
                );
              })}
            </div>
          </div>
        </aside>
      )}
      <main ref={mainRef} className="flex-1 min-w-0 px-3 sm:px-5 pt-5">

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
          <div className={(stacked && project.format !== "talk" ? "max-w-[1400px]" : "max-w-[1500px]") + " mx-auto mb-4 rounded-lg border bg-white px-3 sm:px-4 py-2 flex items-center gap-3 flex-wrap text-[12px]"} style={{ borderColor: "rgba(17,24,39,0.06)" }}>
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

        {/* ================= レギュレーション一覧 ================= */}
        {tab === "regulations" && (
          <div className="max-w-[1100px] mx-auto mb-10 space-y-5">
            <div className="rounded-2xl p-5 sm:p-6 text-white shadow-sm" style={{ background: "linear-gradient(135deg,#1f2937,#111827)" }}>
              <div className="flex items-start gap-3">
                <Icon name="book" className="w-6 h-6 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-bold">レギュレーション一覧</h2>
                  <p className="mt-1 text-[12px] text-stone-300 leading-relaxed">登録の基本単位はクライアント／チャンネルです。全案件共通 → クライアント共通 → 案件固有の例外、の順に自動適用されます。</p>
                </div>
                <button onClick={() => { setManualScope("channel"); setShowManual(true); }} className="shrink-0 rounded-lg bg-white text-stone-900 px-3 py-2 text-[11px] font-bold hover:bg-stone-100">「{curChannel}」の規定を編集</button>
              </div>
            </div>

            <section className={cardCls}>
              {cardHead("全案件共通", <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-50 text-emerald-700">Obsidian承認済み</span>)}
              <div className="p-4 grid sm:grid-cols-2 gap-2.5">
                {APPLIED_PREFLIGHT_RULES.map(([category, rule, scope], i) => (
                  <div key={i} className="rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-3">
                    <div className="flex items-center gap-2 mb-1"><span className="text-[10px] font-bold text-stone-500">{category}</span><span className="ml-auto text-[9px] text-stone-400">{scope}</span></div>
                    <p className="text-[12px] font-bold text-stone-800 leading-relaxed">{rule}</p>
                  </div>
                ))}
                {(globalManuals || []).map((m, i) => (
                  <div key={"g" + i} className="rounded-xl border border-blue-100 bg-blue-50/40 px-3.5 py-3">
                    <div className="text-[10px] font-bold text-blue-600 mb-1">{m.cat || "全社ルール"}</div>
                    <p className="text-[12px] font-bold text-stone-800">{m.title || "名称未設定"}</p>{m.body && <p className="text-[11px] text-stone-600 mt-1 whitespace-pre-wrap">{m.body}</p>}
                  </div>
                ))}
              </div>
            </section>

            <section className={cardCls}>
              {cardHead("クライアント／チャンネル別", <span className="text-[10px] text-stone-400">{channelGroups.length}件</span>)}
              <div className="p-4 space-y-3">
                {channelGroups.map(({ channel, items }) => {
                  const info = channelInfo[channel] || {};
                  const rules = info.manuals || [];
                  return <details key={channel} open={channel === curChannel} className="rounded-xl border border-stone-200 bg-white overflow-hidden">
                    <summary className="cursor-pointer px-4 py-3 flex items-center gap-2 bg-stone-50 select-none">
                      <Icon name="folder" className="w-4 h-4 text-stone-500" /><span className="text-[13px] font-bold text-stone-800">{channel}</span>
                      <span className="text-[10px] text-stone-400 ml-auto">共通ルール {rules.length}件・案件 {items.length}件</span>
                    </summary>
                    <div className="p-3 space-y-2">
                      {rules.length === 0 && <p className="text-[11px] text-stone-400 px-1">チャンネル共通の追加ルールはまだありません。</p>}
                      {rules.map((m, i) => <div key={i} className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2"><span className="text-[10px] font-bold text-amber-700">{m.cat || "チャンネルルール"}</span><div className="text-[12px] font-bold text-stone-800">{m.title || "名称未設定"}</div>{m.body && <div className="text-[11px] text-stone-600 mt-1 whitespace-pre-wrap">{m.body}</div>}</div>)}
                      <div className="pt-1 grid sm:grid-cols-2 gap-2">
                        {items.map((x) => {
                          const d = caseData(x.id);
                          const manuals = (d && d.manuals) || [];
                          return <div key={x.id} className={"rounded-lg border px-3 py-2 " + (x.id === activeId ? "border-rose-200 bg-rose-50/50" : "border-stone-200 bg-white")}>
                            <div className="flex items-center gap-2"><span className="text-[12px] font-bold text-stone-800 truncate">{x.name}</span>{x.id === activeId && <span className="text-[9px] font-bold text-rose-600 shrink-0">開いている案件</span>}<span className="ml-auto text-[10px] text-stone-400 shrink-0">例外 {manuals.length}件</span></div>
                            {manuals.map((m, i) => <div key={i} className="mt-2 pl-2 border-l-2 border-rose-200"><div className="text-[11px] font-bold text-stone-700">{m.title || "名称未設定"}</div>{m.body && <div className="text-[10px] text-stone-500 whitespace-pre-wrap">{m.body}</div>}</div>)}
                            {!d && <div className="text-[9px] text-stone-400 mt-1">案件を開くと固有ルールを表示します</div>}
                          </div>;
                        })}
                      </div>
                    </div>
                  </details>;
                })}
              </div>
            </section>

            <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-[11px] text-blue-800 leading-relaxed">
              <span className="font-bold">現在の案件：</span>{project.name} ／ {curChannel}　
              公開前チェックでは、上の全案件共通ルール・「{curChannel}」の共通ルール・この案件だけの例外を自動でまとめて確認します。
            </div>
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
                {[
                  ["promanUrl", "プロマネのURL"],
                  ["manualUrl", "マニュアルのURL"],
                  ["checklistUrl", "チェックリストのURL"],
                ].map(([key, label]) => (
                  <label key={key} className="block">
                    <span className="text-[11px] font-bold text-stone-500">{label}</span>
                    <input value={curChannelInfo[key]} onChange={(e) => updateChannelInfo({ [key]: e.target.value })}
                      placeholder="https://..."
                      className="mt-1 w-full text-[13px] border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-400" style={{ fontFamily: mono }} />
                  </label>
                ))}
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
                <input value={(project.plans && project.plans[0] && project.plans[0].title) || ""} onChange={(e) => setPlanField(0, "title", e.target.value)}
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
          <div className={scriptView === "mindmap" ? "" : stacked ? "max-w-[1400px] mx-auto" : "max-w-[1500px] mx-auto"}>
            {scriptView !== "mindmap" && (<>
            {/* 「物語の背骨」帯は構成台本タブから撤去（2026-08-23 AK指示）。データ(spine)・マインドマップ側の背骨はそのまま */}

            {/* 番組情報 */}
            <section className={cardCls + " mb-4"}>
              {cardHead("番組情報", (
                <button onClick={openHistory} title="タイトル・サムネ文言・内容・原稿の変更履歴。変更前に戻せる"
                  className="text-[10px] font-bold text-stone-400 hover:text-stone-700 px-2 py-1 rounded-md hover:bg-stone-100 transition-colors">
                  変更履歴
                </button>
              ))}
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
              {/* タイトル（企画・サムネタブと連携）＝ラベル下・改行可。中身の行数ぶん自動で伸びる（切れて見えないようにする） */}
              <div className="border-b border-stone-100 px-3 py-2">
                <div className="text-[11px] font-bold text-stone-400 mb-1">タイトル</div>
                <AutoTextarea value={((project.plans || [])[0] && project.plans[0].title) || ""} placeholder="例）30歳で会社を捨てた男の末路"
                  onChange={(e) => setPlanField(0, "title", e.target.value)} title="企画・サムネタブのタイトルと連携しています"
                  minHeight={44} className="block w-full bg-transparent text-[13px] leading-relaxed focus:outline-none placeholder:text-stone-300" />
              </div>
              {/* サムネ文言 ＝2パターン。ラベル下・改行可。空行込みで全文見えるように自動で伸ばす */}
              <div className="grid sm:grid-cols-2">
                <div className="px-3 py-2 sm:border-r border-stone-100">
                  <div className="text-[11px] font-bold text-stone-400 mb-1">サムネ文言 ①</div>
                  <AutoTextarea value={((project.plans || [])[0] && project.plans[0].thumbText) || ""} placeholder="例）人生、詰んだ。"
                    onChange={(e) => setPlanField(0, "thumbText", e.target.value)} title="企画・サムネタブのサムネ文言と連携しています"
                    minHeight={44} className="block w-full bg-transparent text-[13px] leading-relaxed focus:outline-none placeholder:text-stone-300" />
                </div>
                <div className="px-3 py-2 border-t sm:border-t-0 border-stone-100">
                  <div className="text-[11px] font-bold text-stone-400 mb-1">サムネ文言 ②</div>
                  <AutoTextarea value={((project.plans || [])[0] && project.plans[0].thumbText2) || ""} placeholder="もう1パターン（任意）"
                    onChange={(e) => setPlanField(0, "thumbText2", e.target.value)} title="企画・サムネタブのサムネ文言②と連携しています"
                    minHeight={44} className="block w-full bg-transparent text-[13px] leading-relaxed focus:outline-none placeholder:text-stone-300" />
                </div>
              </div>
            </section>

            {/* ハイライト（独立カード） */}
            <section className={cardCls + " mb-4"}>
              {cardHead("ハイライト（冒頭フック）", (
                <span className="w-6 h-6 shrink-0 grid place-items-center text-stone-400" title={highlightCollapsed ? "開く" : "畳む"}>
                  <span className="text-[10px] transition-transform inline-block" style={{ transform: highlightCollapsed ? "rotate(-90deg)" : "none" }}>▾</span>
                </span>
              ), toggleHighlight)}
              {!highlightCollapsed && (
                <ScriptCell value={m.highlight} onChange={(v) => setMeta("highlight", v)} accent={theme.accent} placeholder="冒頭フックの原稿・テロップ案など（行頭に「・」で ◼︎ 質問行）" />
              )}
            </section>
            </>)}

            {/* 台本編集／マインドマップの表示切替（Phase3） */}
            <div className="flex justify-end items-center gap-2 -mb-1">
              <button onClick={() => setScriptView((v) => v === "mindmap" ? "table" : "mindmap")}
                title={scriptView === "mindmap" ? "台本の編集画面に戻す" : "マインドマップで見る"}
                className={"text-[11px] font-bold px-2.5 py-1 rounded-lg border transition-colors " + (scriptView === "mindmap" ? "text-white border-transparent" : "border-stone-200 text-stone-500 hover:bg-stone-50")}
                style={scriptView === "mindmap" ? { background: theme.main } : {}}>
                {scriptView === "mindmap" ? "◂ 台本に戻る" : "マインドマップで見る"}
              </button>
              {/* 構成テーブル（PC：横並びテーブル）。overflow-clip＝角丸クリップは維持しつつ
                  スクロールコンテナ化しない→theadのstickyが効く（列名がスクロールで消えない） */}
              {/* 見せ方の切替（PCのみ）。スマホは上下積み固定なので出さない */}
              {!isNarrow && scriptView !== "mindmap" && (
                <button onClick={toggleScriptLayout}
                  title={scriptLayout === "stack" ? "横並びの表に戻す" : "原稿を全幅で読む（上下積み）"}
                  className="text-[11px] text-stone-400 hover:text-stone-700 px-2 py-1 rounded-lg hover:bg-stone-100 transition-colors">
                  {scriptLayout === "stack" ? "表示：上下積み（原稿全幅）" : "表示：横並びの表"}
                </button>
              )}
            </div>
            {scriptView === "mindmap" ? (
              <section className="bg-white rounded-2xl shadow-sm border border-stone-200/70 overflow-hidden p-3 sm:p-4">
                {(() => {
                  const mm = buildMindmapSections(project.rows, spineFw, project.rate || 5, project.mindmapNotes);
                  const posPrefix = spineFw + ":";
                  const posMap = {}; Object.keys(project.mindmapPos || {}).forEach((k) => { if (k.startsWith(posPrefix)) posMap[k.slice(posPrefix.length)] = project.mindmapPos[k]; });
                  const widthMap = {}; Object.keys(project.mindmapWidth || {}).forEach((k) => { if (k.startsWith(posPrefix)) widthMap[k.slice(posPrefix.length)] = project.mindmapWidth[k]; });
                  return <MindmapView height="calc(100vh - 190px)" deliverableTitle={project.name} totalEstSec={mm.totalEstSec} totalScenes={mm.totalScenes} sections={mm.sections} onNodeClick={jumpToRow} onNoteChange={setMindmapNote} onAddScene={addSceneFromMindmap} onRenameScene={renameSceneLabel} onAddSceneAfter={addSceneAfter} onEditQuestion={patchQuestion} onEditAnswer={patchAnswer} posMap={posMap} onPosChange={setMindmapPos} onClearPos={clearMindmapPos} widthMap={widthMap} onWidthChange={setMindmapWidth} onUndo={mmUndo} onRedo={mmRedo} onDeleteScene={deleteSceneFromMindmap} onDeleteQuestion={deleteQuestionFromMindmap} onAddQuestion={addQuestionToScene} />;
                })()}
              </section>
            ) : (<>

            {!stacked && (
            <section className="bg-white rounded-2xl shadow-sm border border-stone-200/70 overflow-clip">
             <div className="overflow-x-clip">
              <table className="w-full border-collapse table-fixed" style={{ minWidth: isNarrow ? 600 : undefined }}>
                <colgroup>
                  <col style={{ width: isNarrow ? 64 : 86 }} />
                  <col style={{ width: isNarrow ? 130 : 148 }} />
                  <col style={{ width: isNarrow ? 120 : 148 }} />
                  <col style={{ width: 58 }} />
                  <col style={{ width: 80 }} />
                  <col />
                </colgroup>
                <thead>
                  <tr style={{ background: theme.main, color: mainText }}>
                    {["時間", "内容", "シーン", "秒数", "所要時間", "原稿"].map((h, i) => (
                      <th key={i} className="sticky z-[5] px-3 py-2 text-left text-[10px] font-bold tracking-[0.15em] whitespace-nowrap"
                        style={{ top: headerH, background: theme.main }}>
                        <span style={{ opacity: 0.9 }}>{h}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody style={{ userSelect: painting ? "none" : "auto" }}>
                  {project.rows.map((r, idx) => {
                    if (r.kind === "location") {
                      return (
                        <React.Fragment key={r.id}>
                        {maxDay > 1 && dayStarts[r.id] != null && (
                          <tr>
                            <td colSpan={6} className="pt-4 pb-1 px-1">{dayBannerEl(dayStarts[r.id])}</td>
                          </tr>
                        )}
                        <tr id={"row-" + r.id} data-toc={r.label || "（ロケ名未入力）"} {...dropZoneProps(idx)}
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
                              {dayPickerEl(r, true)}
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
                        </tr>
                        </React.Fragment>
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
                        onContextMenu={(e) => { e.preventDefault(); setRowMenu({ id: r.id, idx, kind: "scene", sceneType: r.type, x: e.clientX, y: e.clientY }); }}
                        className="border-b border-stone-100 transition-colors"
                        style={{
                          ...(sceneDone ? { background: "#F5F5F4", opacity: 0.55 } : { background: t.color + "0e" }), // シーン種別ごとに極薄トーンで色分け（見分けやすく）
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
                  </tr>
                </tfoot>
              </table>
             </div>
            </section>
            )}

            {/* 構成台本（上下積みカード。原稿を全幅で読めるように）。
                スマホは常にこれ。PCも既定でこれ（2026-08-08 AK指示：表だと左半分が空いて原稿が読みづらい）。
                表に戻したい時はヘッダーの表示切替で戻せる。 */}
            {stacked && (() => {
              /* ===== Scene Row レイアウト（2026-08-23 AK仕様「物語が見える」） =====
                 場所＝章（薄い区切り＋📍）、シーン＝1行（タイムライン｜番号｜開始｜タイトル｜種別｜尺｜内容｜⋮）。
                 スクロール＝時間軸。左の1px線と種別色ノードで一本の映像が繋がっていることを示す。
                 ドラッグ（rowDragProps/dropZoneProps）・右クリック（setRowMenu）は表モードと同じ関数を使う＝挙動不変。
                 データ構造・保存は触らない。 */
              const BORDER = "rgba(17,24,39,0.06)";
              const groups = [];
              (project.rows || []).forEach((r, idx) => {
                if (r.kind === "location") groups.push({ loc: r, idx, scenes: [] });
                else { if (!groups.length) groups.push({ loc: null, idx: -1, scenes: [] }); groups[groups.length - 1].scenes.push({ r, idx }); }
              });
              const GRID = "36px 44px 56px minmax(150px,200px) 104px 90px minmax(0,1fr) 52px"; // 列間は gap-x-3 で確保（ピル/尺がめり込まないように） // 台本(内容)列に幅を寄せる（08-23 AK「台本部分の幅を増やして」）
              const pad2 = (n) => String(n).padStart(2, "0");
              const renderScene = ({ r, idx }, i, arr) => {
                const t = sectionOf(r.type);
                const target = targetOf(r);
                const chars = countChars(r.script);
                const dur = chars / project.rate;
                const over = chars > 0 && dur > target * 1.5;
                const sceneDone = !!r.done;
                const first = i === 0, last = i === arr.length - 1;
                const isDragOver = dragOverIndex === idx && dragIds && !dragIds.includes(r.id);
                const openMenu = (e) => { e.preventDefault(); e.stopPropagation(); const b = e.currentTarget.getBoundingClientRect(); setRowMenu({ id: r.id, idx, kind: "scene", sceneType: r.type, x: b.left, y: b.bottom + 4 }); };
                const startTimeEl = clocks[r.id] != null ? (
                  <span className="text-[11.5px] tabular-nums font-medium" style={{ fontFamily: mono, color: "#59616C" }} title="ロケ到着時刻＋尺の積み上げ（実時刻）">{fmtClock(clocks[r.id])}</span>
                ) : (
                  <input
                    key={(r.tc != null ? "m" : "a") + Math.round(tcs[r.id])}
                    defaultValue={fmt(tcs[r.id])}
                    draggable={false}
                    onBlur={(e) => { const v = e.target.value.trim(); updateRow(r.id, { tc: v === "" ? null : parseTC(v) }); }}
                    onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
                    className="w-[52px] text-[11.5px] tabular-nums bg-transparent rounded px-0.5 focus:outline-none focus:bg-stone-50"
                    style={{ fontFamily: mono, color: r.tc != null ? "#171A1F" : "#59616C", fontWeight: r.tc != null ? 700 : 500 }}
                    title="開始時刻を手入力で固定（空欄で自動）" />
                );
                const pillEl = (
                  <span className="relative inline-flex items-center shrink-0 h-[22px] rounded-full border" style={{ background: hexA(t.dot, 0.09), borderColor: hexA(t.dot, 0.22) }}>
                    <span className="w-1.5 h-1.5 rounded-full ml-2.5 shrink-0" style={{ background: t.dot }} />
                    <select value={r.type} onChange={(e) => updateRow(r.id, { type: e.target.value, sec: null })}
                      className="text-[11px] font-semibold bg-transparent pl-1.5 pr-4 h-full cursor-pointer focus:outline-none appearance-none" style={{ color: t.dot }}>
                      {TYPE_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                    <span className="pointer-events-none absolute right-1.5 text-[8px]" style={{ color: t.dot, opacity: 0.7 }}>▾</span>
                  </span>
                );
                /* 尺：クリックで秒入力（枠なし表示→編集時だけ枠）。下に実測（所要/文字数）を弱く */
                const durEl = (
                  <div className="flex flex-col items-start gap-0.5">
                    {secEdit === r.id ? (
                      <input type="number" min="1" autoFocus defaultValue={target}
                        onBlur={(e) => { const v = e.target.value; updateRow(r.id, { sec: v === "" ? null : Number(v) }); setSecEdit(null); }}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") e.target.blur(); }}
                        className="w-14 h-6 text-[12px] text-right rounded-md px-1 tabular-nums bg-white focus:outline-none"
                        style={{ fontFamily: mono, border: "1px solid rgba(74,145,235,0.45)", color: "#171A1F" }} title="秒で入力" />
                    ) : (
                      <button onClick={() => setSecEdit(r.id)} title={"目安 " + target + "秒（クリックで編集）"}
                        className="text-[12.5px] font-semibold tabular-nums rounded px-1 -ml-1 hover:bg-stone-50" style={{ fontFamily: mono, color: "#3F4650" }}>{fmt(target)}</button>
                    )}
                    <span className="text-[10.5px] tabular-nums px-1 -ml-1 rounded whitespace-nowrap" style={{ fontFamily: mono, ...(over ? { color: "#E04C4C", background: "#FFF0F0", fontWeight: 600 } : { color: chars ? "#8C939D" : "#C2C7CD" }) }} title={over ? "目安の1.5倍を超えています" : "実測（文字数÷" + project.rate + "字/秒）"}>
                      {chars ? fmt(dur) : "—"} / {chars}字
                    </span>
                  </div>
                );
                const titleEl = (
                  <BufferedTextarea value={r.label} onChange={(v) => updateRow(r.id, { label: v })} rows={1} placeholder="シーンタイトル"
                    className="block w-full resize-none bg-transparent text-[15px] focus:outline-none placeholder:text-stone-300 placeholder:font-normal"
                    style={{ fontWeight: 650, color: "#171A1F", lineHeight: 1.35, textDecoration: sceneDone ? "line-through" : "none" }} />
                );
                const contentEl = (
                  <div className="max-w-[980px] -ml-3 -mt-2">
                    <ScriptCell value={r.script} onChange={(v) => updateRow(r.id, { script: v })} accent={t.dot} fontSize={14} lineHeight={1.6} qaGutter />
                  </div>
                );
                const actionsEl = (
                  <div className="flex items-center justify-end gap-0.5">
                    <button onClick={() => updateRow(r.id, { done: !r.done })} title={r.done ? "撮影完了を取り消す" : "撮影完了にする"}
                      className={"w-6 h-6 grid place-items-center rounded-md transition-opacity " + (r.done ? "bg-emerald-500 text-white" : "text-stone-300 hover:text-stone-500 hover:bg-stone-100 " + (isNarrow ? "" : "opacity-0 group-hover:opacity-100"))}>
                      <Icon name="check" className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={openMenu} title="メニュー（上へ/下へ/追加/削除）" className="w-6 h-6 grid place-items-center rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-100 text-[15px] leading-none">⋮</button>
                  </div>
                );
                const timelineEl = (
                  <div className="relative self-stretch" aria-hidden>
                    <span className="absolute left-[17px] w-px" style={{ background: hexA(t.dot, 0.45), top: first ? 22 : 0, bottom: last ? "calc(100% - 22px)" : 0 }} />
                    <span className="absolute left-[14px] top-[18.5px] w-[7px] h-[7px] rounded-full" style={{ background: t.dot }} />
                  </div>
                );
                const rowProps = {
                  id: "row-" + r.id,
                  ...dropZoneProps(idx),
                  onContextMenu: (e) => { e.preventDefault(); setRowMenu({ id: r.id, idx, kind: "scene", sceneType: r.type, x: e.clientX, y: e.clientY }); },
                  className: "group relative transition-colors hover:bg-[#FCFCFD] scroll-mt-24" + (last ? "" : " border-b"),
                  style: { borderColor: BORDER, ...(sceneDone ? { opacity: 0.5 } : {}), ...(isDragOver ? { boxShadow: "inset 0 2px 0 0 " + theme.accent } : {}), ...(flashId === r.id ? { boxShadow: "inset 0 0 0 2px " + theme.accent } : {}) },
                };
                if (isNarrow) {
                  return (
                    <div key={r.id} {...rowProps}>
                      <div className="flex items-center gap-2 px-3 pt-3 flex-wrap">
                        <span className="cursor-grab active:cursor-grabbing text-[15px] font-semibold tabular-nums" style={{ fontFamily: mono, color: "#1C2026" }} {...rowDragProps(idx, r.id)} title="ドラッグで移動">{pad2(sceneNos[r.id])}</span>
                        {startTimeEl}{pillEl}
                        <div className="flex-1" />
                        {durEl}{actionsEl}
                      </div>
                      <div className="px-3 pt-2">{titleEl}</div>
                      <div className="px-3 pb-2">{contentEl}</div>
                    </div>
                  );
                }
                return (
                  <div key={r.id} {...rowProps}>
                    <div className="grid items-start py-3 pr-2 gap-x-3" style={{ gridTemplateColumns: GRID }}>
                      {timelineEl}
                      <div className="flex items-center gap-1 pt-[1px] cursor-grab active:cursor-grabbing select-none" {...rowDragProps(idx, r.id)} title="ドラッグで移動">
                        <Icon name="grip" className="w-3 h-3 text-stone-300 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                        <span className="text-[15.5px] tabular-nums" style={{ fontFamily: mono, fontWeight: 650, color: "#1C2026" }}>{pad2(sceneNos[r.id])}</span>
                      </div>
                      <div className="pt-[3px]">{startTimeEl}</div>
                      <div className="min-w-0">{titleEl}</div>
                      <div className="pt-[1px]">{pillEl}</div>
                      <div className="pt-[2px]">{durEl}</div>
                      <div className="min-w-0 pl-2 border-l" style={{ borderColor: BORDER }}>{contentEl}</div>
                      {actionsEl}
                    </div>
                  </div>
                );
              };
              return (
              <section className="flex flex-col">
                {groups.map((g, gi) => {
                  const r = g.loc;
                  const visibleScenes = g.scenes.filter((sc) => !sceneLocDone[sc.r.id]);
                  const lc = r ? locations.find((l) => l.id === r.id) : null;
                  const isDragOver = r && dragOverIndex === g.idx && dragIds && !dragIds.includes(r.id);
                  return (
                    <div key={r ? r.id : "nolocation"} className={gi === 0 ? "" : "mt-6"}>
                      {r && maxDay > 1 && dayStarts[r.id] != null && (
                        <div className="mb-2">{dayBannerEl(dayStarts[r.id])}</div>
                      )}
                      {r && (
                        <div id={"row-" + r.id} data-toc={r.label || "（ロケ名未入力）"} {...dropZoneProps(g.idx)}
                          onContextMenu={(e) => { e.preventDefault(); setRowMenu({ id: r.id, idx: g.idx, kind: "location", x: e.clientX, y: e.clientY }); }}
                          className="group/loc flex items-center gap-2.5 py-2.5 mb-2 border-t scroll-mt-24"
                          style={{ borderColor: BORDER, ...(r.done ? { opacity: 0.6 } : {}), ...(isDragOver ? { boxShadow: "inset 0 2px 0 0 " + theme.accent } : {}), ...(flashId === r.id ? { boxShadow: "inset 0 0 0 2px " + theme.accent } : {}) }}>
                          <span className="w-10 shrink-0 grid place-items-center cursor-grab active:cursor-grabbing" {...rowDragProps(g.idx, r.id)} title="ドラッグで移動（配下のシーンごと）">
                            <Icon name="pin" className="w-4 h-4" style={{ color: "#8C939D" }} />
                          </span>
                          <BufferedInput value={r.label} onChange={(v) => updateRow(r.id, { label: v })} placeholder="場所（例：名古屋｜ご自宅）"
                            className="min-w-0 flex-1 sm:flex-none sm:w-[360px] bg-transparent text-[15.5px] focus:outline-none placeholder:text-stone-300"
                            style={{ fontWeight: 650, color: "#171A1F", textDecoration: r.done ? "line-through" : "none" }} />
                          <span className="text-[11px] shrink-0" style={{ color: "#7D848E" }}>{lc ? lc.scenes.length : 0}シーン</span>
                          <span className="text-[12px] font-semibold tabular-nums shrink-0" style={{ fontFamily: mono, color: "#454B54" }}>{fmt(lc ? lc.secSum : 0)}</span>
                          <div className="flex-1" />
                          <div className={"flex items-center gap-1.5 transition-opacity " + (isNarrow || r.time || r.done || maxDay > 1 ? "" : "opacity-0 group-hover/loc:opacity-100 focus-within:opacity-100")}>
                            {dayPickerEl(r, false)}
                            <input type="time" value={r.time || ""} onChange={(e) => updateRow(r.id, { time: e.target.value })} title="到着・開始予定時刻（香盤表と連動）"
                              className="shrink-0 w-[66px] h-6 bg-transparent text-[11.5px] font-medium tabular-nums text-center rounded focus:outline-none focus:bg-stone-50 appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-datetime-edit]:text-center [&::-webkit-datetime-edit-fields-wrapper]:justify-center"
                              style={{ fontFamily: mono, color: r.time ? "#454B54" : "#B8BDC4" }} />
                            <button onClick={() => updateRow(r.id, { done: !r.done })} title={r.done ? "撮影完了を取り消す" : "このロケを撮影完了にする"}
                              className={"shrink-0 h-6 text-[11px] font-semibold px-2 rounded-md inline-flex items-center gap-1 " + (r.done ? "bg-emerald-50 text-emerald-700" : "text-stone-500 hover:bg-stone-100")}>
                              <Icon name={r.done ? "checkCircle" : "check"} className="w-3 h-3" />{r.done ? "撮影済" : "完了"}
                            </button>
                          </div>
                        </div>
                      )}
                      {visibleScenes.length > 0 && (
                        <div className="rounded-lg border bg-white" style={{ borderColor: BORDER }}>
                          {visibleScenes.map(renderScene)}
                        </div>
                      )}
                      {r && r.done && g.scenes.length > 0 && visibleScenes.length === 0 && (
                        <div className="text-[11px] px-3 py-2" style={{ color: "#8C939D" }}>撮影済み・{g.scenes.length}シーンを畳んでいます</div>
                      )}
                    </div>
                  );
                })}
                {/* 合計 */}
                <div className="flex items-center gap-3 px-3 py-2.5 mt-4 text-[11.5px] tabular-nums border-t" style={{ borderColor: BORDER, color: "#454B54", fontFamily: mono }}>
                  <span className="font-semibold tracking-wider">合計</span>
                  <span className="ml-auto text-[13px] font-semibold" style={{ color: "#171A1F" }}>{fmt(totalEst)}</span>
                  <span style={{ color: "#8C939D" }}>{totalChars.toLocaleString()}字</span>
                </div>
              </section>
              );
            })()}

            {/* 追加：巨大CTAにしない。破線の1段 */}
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg px-3 h-11" style={{ border: "1px dashed rgba(17,24,39,0.12)" }}>
              <span className="text-[12px] inline-flex items-center gap-1" style={{ color: "#626A75" }}><Icon name="plus" className="w-3.5 h-3.5" />シーンを追加</span>
              {TYPE_KEYS.map((k) => (
                <button key={k} onClick={() => setRows((rows) => [...rows, newScene(k)])}
                  className="inline-flex items-center gap-1.5 h-[22px] px-2.5 rounded-full border text-[11px] font-semibold hover:opacity-80"
                  style={{ background: hexA(SECTION_TYPES[k].dot, 0.09), borderColor: hexA(SECTION_TYPES[k].dot, 0.22), color: SECTION_TYPES[k].dot }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: SECTION_TYPES[k].dot }} />{k}
                </button>
              ))}
              <span className="w-px h-4 bg-stone-200 mx-1" />
              <button onClick={() => setRows((rows) => { const lastLoc = [...rows].reverse().find((x) => x.kind === "location"); const d = lastLoc ? dayOf(lastLoc) : 1; return [...rows, { ...newLocation(""), ...(d > 1 ? { day: d } : {}) }]; })}
                className="text-[12px] inline-flex items-center gap-1 hover:text-stone-800" style={{ color: "#626A75" }}>
                <Icon name="pin" className="w-3.5 h-3.5" />場所を追加
              </button>
              <div className="flex-1" />
              <button
                onClick={() => { if (window.confirm("この案件の構成をリセットして一日密着テンプレート（8ロケーション）に戻しますか？")) setProject((p) => ({ ...p, rows: templateRows() })); }}
                className="text-[11px] text-stone-400 underline hover:text-red-400">
                テンプレートに戻す
              </button>
            </div>

            {/* 凡例：5種別の意味（初見でも分かる） */}
            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1.5 px-1 text-[10.5px]" style={{ color: "#656C76" }}>
              {[["インサート", "情景・印象を伝えるカット"], ["VLOG", "日常の動き・行動の記録"], ["ブリッジ", "場や流れをつなぐ"], ["解説系", "インタビュー・説明・対話"], ["訴求", "メッセージ・結論・想い"]].map(([k, d]) => (
                <span key={k} className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full" style={{ background: SECTION_TYPES[k].dot }} />{k}：{d}</span>
              ))}
            </div>

            <p className="mt-3 text-[10.5px] leading-relaxed" style={{ color: "#8C939D" }}>
              原稿：太字 ⌘B／赤文字 ⌘⇧H／行頭に「・」で ◼︎ 質問行（Q.）　／　番号をドラッグで並べ替え（場所は📍をドラッグで配下ごと移動）・右クリックでメニュー　／　尺はクリックで秒編集。実測 ＝ 文字数 ÷ {project.rate}字/秒　／　場所の時刻＝香盤表と連動、各シーンは到着時刻＋尺の積み上げ　／　自動保存
            </p>
            </>)}
          </div>
        )}

        {/* ================= マインドマップタブ（構成台本と同じデータをフルページで） ================= */}
        {tab === "mindmap" && project.format !== "talk" && (
          <div className="max-w-[1700px] mx-auto px-1 sm:px-0 py-1">
            {(() => {
              const mm = buildMindmapSections(project.rows, spineFw, project.rate || 5, project.mindmapNotes);
              const posPrefix = spineFw + ":";
              const posMap = {}; Object.keys(project.mindmapPos || {}).forEach((k) => { if (k.startsWith(posPrefix)) posMap[k.slice(posPrefix.length)] = project.mindmapPos[k]; });
              const widthMap = {}; Object.keys(project.mindmapWidth || {}).forEach((k) => { if (k.startsWith(posPrefix)) widthMap[k.slice(posPrefix.length)] = project.mindmapWidth[k]; });
              return (
                <section className="bg-white rounded-2xl shadow-sm border border-stone-200/70 overflow-hidden p-3 sm:p-4">
                  <p className="text-[11px] text-stone-400 mb-2">構成台本と同じデータを見ています。ここでの編集は台本にもそのまま反映されます。各ステップのカードに、そこで話す内容のラフなセリフ・要点を書き込めます。「＋シーン追加」でそのメモを元に構成台本へシーンを作れます。</p>
                  <MindmapView height="calc(100vh - 200px)" deliverableTitle={project.name} totalEstSec={mm.totalEstSec} totalScenes={mm.totalScenes} sections={mm.sections} onNodeClick={jumpToRow} onNoteChange={setMindmapNote} onAddScene={addSceneFromMindmap} onRenameScene={renameSceneLabel} onAddSceneAfter={addSceneAfter} onEditQuestion={patchQuestion} onEditAnswer={patchAnswer} posMap={posMap} onPosChange={setMindmapPos} onClearPos={clearMindmapPos} widthMap={widthMap} onWidthChange={setMindmapWidth} onUndo={mmUndo} onRedo={mmRedo} onDeleteScene={deleteSceneFromMindmap} onDeleteQuestion={deleteQuestionFromMindmap} onAddQuestion={addQuestionToScene} />
                </section>
              );
            })()}
          </div>
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
                  {m.shootDate || "撮影日未設定"}{maxDay > 1 && <>・{maxDay}日撮影</>}・{locations.length}ロケーション・本編想定 {fmt(totalEst)}・シーン尺 {fmt(totalTarget)}{totalTravel > 0 && <>・交通費 ¥{totalTravel.toLocaleString()}</>}
                </div>
              </div>

              <div className="px-4 sm:px-6 py-5">
                {locations.length === 0 && (
                  <p className="text-sm text-stone-400 text-center py-8">構成台本タブでロケーションを追加すると、ここに1日の流れが表示されます。</p>
                )}

                {locations.map((loc, i) => (
                  <React.Fragment key={loc.id}>
                  {maxDay > 1 && dayStarts[loc.id] != null && (
                    <div className={"mb-3 " + (i > 0 ? "mt-2" : "")}>{dayBannerEl(dayStarts[loc.id])}</div>
                  )}
                  <div className="relative flex gap-2.5 sm:gap-4 group/loc" data-toc={loc.label || "（ロケ名未入力）"}>
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
                        {loc.done ? <Icon name="check" className="w-3 h-3 sm:w-3.5 sm:h-3.5" /> : (loc.noInDay || i + 1)}
                      </div>
                      {i < locations.length - 1 && locations[i + 1].dayNo === loc.dayNo && (
                        <div className="flex-1 w-0.5 my-1 rounded min-h-[20px]" style={{ background: theme.main, opacity: 0.2 }} />
                      )}
                    </div>

                    {/* 右：移動ストリップ＋ロケーションカード（日をまたぐ区間は移動なし） */}
                    <div className="flex-1 min-w-0 mb-3">
                    {i > 0 && dayStarts[loc.id] == null && (() => {
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
                        {dayPickerEl(loc, true)}
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
                  </React.Fragment>
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
                const thumbText2 = p0 ? p0.thumbText2 || "" : "";
                const firstVid = p0 && p0.refs ? (p0.refs.find((r) => r.vid) || {}).vid : "";
                return (
                  <section key={entry.id} data-toc={title || entry.name || ("企画 #" + (pi + 1))} className={"rounded-xl border bg-white overflow-hidden " + (isActive ? "border-stone-400 shadow-sm" : "border-stone-200")}>
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
                        <input value={title} onClick={(e) => e.stopPropagation()} onChange={(e) => updateBoardTitle(entry.id, "title", e.target.value)}
                          placeholder={"タイトル案（例：30歳で会社を捨てた男の末路）"}
                          className="flex-1 min-w-0 text-[13px] font-bold bg-transparent border-0 border-b border-transparent hover:border-stone-200 focus:border-stone-400 focus:outline-none px-0.5 py-1" />
                      ) : brokenIds[entry.id] ? (
                        <span className="flex-1 min-w-0 truncate text-[13px] font-bold text-rose-500">{entry.name}（本体データ無し → 右のゴミ箱で削除）</span>
                      ) : <span className="flex-1 min-w-0 truncate text-[13px] font-bold text-stone-400">{entry.name}（読み込み中…）</span>}
                      {data && (
                        <div className="hidden md:flex flex-col gap-1 w-44 shrink-0 -my-0.5" onClick={(e) => e.stopPropagation()}>
                          <input value={thumbText} onChange={(e) => updateBoardTitle(entry.id, "thumbText", e.target.value)}
                            placeholder="サムネ文言①"
                            className="w-full text-[12px] font-bold text-stone-600 bg-stone-50 rounded-lg border border-transparent hover:border-stone-200 focus:border-stone-400 focus:outline-none px-2 py-1" />
                          <input value={thumbText2} onChange={(e) => updateBoardTitle(entry.id, "thumbText2", e.target.value)}
                            placeholder="サムネ文言②"
                            className="w-full text-[12px] font-bold text-stone-600 bg-stone-50 rounded-lg border border-transparent hover:border-stone-200 focus:border-stone-400 focus:outline-none px-2 py-1" />
                        </div>
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
        {(tab === "hearing" || tab === "wizard") && (
          <div className="max-w-[1120px] mx-auto px-1 sm:px-0 py-1">
            {/* 取材メモ＝ヒアリング＋質問ウィザードを統合（どちらも構成前のメモ）。中で切替 */}
            <div className="inline-flex gap-1 mb-4 p-1 rounded-xl bg-stone-100">
              {[["hearing", "聞き取りシート"], ["wizard", "質問ウィザード"]].map(([k, lab]) => (
                <button key={k} onClick={() => setPrepView(k)}
                  className={"text-[12px] font-bold px-3.5 py-1.5 rounded-lg transition-colors " + (prepView === k ? "bg-white shadow-sm text-stone-800" : "text-stone-500 hover:text-stone-700")}>{lab}</button>
              ))}
            </div>
            {/* マインドマップは独立タブへ移設（2026-08-17）。ここには入口だけ残す */}
            <button onClick={() => setTab("mindmap")}
              className="mb-4 w-full text-left rounded-2xl border border-dashed border-stone-300 hover:border-stone-400 hover:bg-stone-50 transition-colors px-4 py-3 flex items-center gap-2">
              <Icon name="share" className="w-4 h-4 text-stone-400 shrink-0" />
              <span className="text-[12px] font-bold text-stone-600">マインドマップで構造を見る・編集する</span>
              <span className="ml-auto text-[11px] text-stone-400">開く →</span>
            </button>
            {/* 文字起こし→骨組み→Q&A原稿の2段階生成（2026-08-17）。①でロケ・時刻・型だけの骨組みをマインドマップに作り、②で同じ文字起こしからQ&A原稿を書き込む。ここまでで8割、仕上げは構成台本タブで */}
            <div className="mb-4 rounded-2xl border border-stone-200 bg-white px-5 py-4 shadow-sm">
              <div className="flex items-center gap-1.5 mb-1">
                <Icon name="sparkle" className="w-4 h-4 shrink-0" style={{ color: theme.accent }} />
                <span className="text-[13px] font-bold text-stone-800">文字起こしから構成を作る</span>
              </div>
              <p className="text-[11.5px] text-stone-500 mb-2 leading-relaxed">
                ①でロケ・時刻・シーンの型だけの骨組みを作ります（原稿はまだ空）。マインドマップで並び順・スパインを確認・手直ししたら、②で同じ文字起こしからQ&A原稿を書き込みます。ここまでで8割、仕上げは構成台本タブで。
              </p>
              <BufferedTextarea value={project.transcriptRaw || ""} onChange={setTranscriptRaw}
                placeholder="ここに文字起こし・取材メモを貼り付け…" rows={6}
                className="w-full text-[12.5px] leading-relaxed border border-stone-200 rounded-xl p-3 focus:outline-none focus:border-stone-400 resize-y placeholder:text-stone-300" />
              <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                <button onClick={runSkeletonGenerate} disabled={!((project.transcriptRaw || "").trim()) || transcriptBusy}
                  className="text-[12px] font-bold px-3.5 py-2 rounded-lg shadow disabled:opacity-40 inline-flex items-center gap-1.5"
                  style={{ background: theme.accent, color: accentText }}>
                  {transcriptStep === "skeleton" ? "生成中…" : "① 骨組みを作る"}
                </button>
                <button onClick={runFillQa} disabled={!((project.transcriptRaw || "").trim()) || !(project.rows || []).length || transcriptBusy}
                  title={!(project.rows || []).length ? "先に①で骨組みを作ってください" : ""}
                  className="text-[12px] font-bold px-3.5 py-2 rounded-lg border border-stone-300 bg-white text-stone-700 shadow-sm hover:bg-stone-50 disabled:opacity-40 inline-flex items-center gap-1.5">
                  {transcriptStep === "fillqa" ? "書き込み中…" : "② Q&A原稿を書き込む"}
                </button>
                {transcriptBusy && <span className="text-[11px] text-stone-400">少し時間がかかります…</span>}
              </div>
            </div>
            {prepView === "wizard" ? (
              <WizardPane project={project} setProject={setProject} theme={theme} setTab={setTab} />
            ) : (
          <div className="space-y-5">
            {/* 取材メモ リーディング／カード型（2026-08-23）。データ構造・ハンドラは従来のまま、表示だけ
               「質問(Q)＋回答」のカードに分解し、本文幅を760pxに制限・文字を大きく・行間1.7に。
               長文を横幅いっぱいに流さない／全部同じ文字サイズにしない／罫線で区切らない、が方針 */}
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <p className="text-[13px] text-stone-500 leading-relaxed max-w-[760px]">撮影前に演者のことを聞き取るシート。ここを埋めると<span className="font-bold text-stone-700">構成台本のネタ元</span>になります。「🤖 AIに読ませる用リンク」で渡せば、この内容から構成案を作らせられます。</p>
              <button onClick={resetHearing} className="shrink-0 text-[11px] font-bold text-stone-400 hover:text-stone-600 underline">初期テンプレに戻す</button>
            </div>
            <button onClick={() => setHearingImport({ raw: "" })}
              className="w-full rounded-xl border border-dashed p-3.5 text-[13px] font-bold inline-flex items-center justify-center gap-2 transition-colors hover:bg-stone-50"
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
            {/* スマホ用の横型目次（デスクトップは右に固定目次） */}
            <aside className="relative w-full lg:hidden" aria-label="取材メモの目次">
              <nav className="flex flex-wrap items-center gap-1.5 min-h-7 py-0.5">
                <span className="text-[9px] font-bold tracking-widest text-stone-300 mr-1">目次</span>
                  {(project.hearing || []).map((sec, si) => {
                    const active = hearingTocActive === sec.id;
                    const lineWidth = 18 + ((si * 11) % 23);
                    return (
                      <button key={sec.id}
                        onClick={() => { setHearingTocActive(sec.id); jumpToHearing("hearing-sec-" + sec.id); }}
                        className="group relative shrink-0 w-10 h-5 flex items-center justify-center rounded focus:outline-none focus-visible:ring-2"
                        aria-label={(si + 1) + ". " + (sec.title || "無題のセクション")}>
                        <span className="block h-[3px] rounded-full transition-all"
                          style={{ width: lineWidth, backgroundColor: active ? theme.accent : "#c9c9c7" }} />
                        <span role="tooltip"
                          className="pointer-events-none absolute left-1/2 top-full z-30 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-stone-800 px-2 py-1 text-[10px] font-bold text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                          {si + 1}. {sec.title || "無題のセクション"}
                        </span>
                      </button>
                    );
                  })}
              </nav>
            </aside>
            <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_220px] lg:gap-6 lg:items-start">
              {/* 本文：セクション見出し＋項目カード。カード＝左アクセント線＋Q/回答の2段 */}
              <div className="min-w-0 space-y-9">
                {(project.hearing || []).map((sec, si) => {
                  const filled = sec.items.filter((it) => (it.value || "").trim()).length;
                  return (
                    <section key={sec.id} id={"hearing-sec-" + sec.id} data-toc={sec.title || "無題のセクション"} className="group/sec scroll-mt-24 rounded-xl transition-shadow">
                      <div className="flex items-center gap-2.5 mb-3">
                        <span className="shrink-0 w-9 h-9 rounded-xl grid place-items-center bg-stone-100 text-stone-600"><Icon name="note" className="w-[18px] h-[18px]" /></span>
                        <input value={sec.title} onChange={(e) => setHearingTitle(sec.id, e.target.value)} placeholder="セクション名"
                          className="flex-1 min-w-0 text-[19px] font-bold text-stone-800 bg-transparent focus:outline-none leading-tight placeholder:text-stone-300" />
                        <span className="shrink-0 text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-md" style={filled === sec.items.length && sec.items.length ? { background: "#F0FBF4", color: "#2E9E5B" } : { background: "#F4F4F3", color: "#8A8A86" }}>{filled}/{sec.items.length}</span>
                        <button onClick={() => removeHearingSection(sec.id)} title="セクション削除" className="shrink-0 opacity-0 group-hover/sec:opacity-100 text-stone-300 hover:text-rose-500 transition-opacity"><Icon name="trash" className="w-4 h-4" /></button>
                      </div>
                      <div className="space-y-3">
                        {sec.items.map((it) => (
                          <div key={it.id} id={"hearing-item-" + it.id}
                            className="group relative rounded-xl border border-[#E8E8E8] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.07)] transition-shadow scroll-mt-24 overflow-hidden">
                            {/* 質問 */}
                            <div className="flex items-start gap-3 px-4 sm:px-5 pt-4 pb-3 border-l-4" style={{ borderLeftColor: "#EF4055" }}>
                              <span className="shrink-0 w-8 h-8 rounded-lg grid place-items-center text-[15px] font-black leading-none" style={{ background: "#FFF1F3", color: "#EF4055" }}>Q</span>
                              <div className="flex-1 min-w-0 max-w-[760px] pt-1">
                                <input value={it.label} onChange={(e) => setHearingItemLabel(sec.id, it.id, e.target.value)} placeholder="質問・項目名"
                                  className="w-full text-[15.5px] font-bold text-stone-800 bg-transparent focus:outline-none leading-snug placeholder:text-stone-300" />
                                {it.hint && <div className="mt-1 text-[12px] text-stone-400 leading-relaxed whitespace-pre-wrap break-words">{it.hint}</div>}
                              </div>
                              <button onClick={() => removeHearingItem(sec.id, it.id)} title="項目削除" className="shrink-0 mt-1 opacity-0 group-hover:opacity-100 text-stone-300 hover:text-rose-500 transition-opacity"><Icon name="close" className="w-4 h-4" /></button>
                            </div>
                            {/* 回答 */}
                            <div className="flex items-start gap-3 px-4 sm:px-5 pt-3 pb-4 border-l-4" style={{ borderLeftColor: "#4E9CFB", background: "#FAFCFF" }}>
                              <span className="shrink-0 w-8 h-8 rounded-lg grid place-items-center" style={{ background: "#EEF6FF", color: "#4E9CFB" }}><Icon name="chat" className="w-4 h-4" /></span>
                              <div className="flex-1 min-w-0 max-w-[760px] -ml-3 -mt-1.5">
                                <RichCell value={it.value} onChange={(e) => setHearingItem(sec.id, it.id, e.target.value)}
                                  placeholder="ここに聞き取った内容を入力…" minHeight={44} fontSize={14.5} lineHeight={1.7}
                                  className="w-full bg-transparent" />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <button onClick={() => addHearingItem(sec.id)} className="mt-3 text-[12px] font-bold text-stone-400 hover:text-stone-700 inline-flex items-center gap-1 transition-colors"><Icon name="plus" className="w-3.5 h-3.5" />項目を追加</button>
                    </section>
                  );
                })}
                <button onClick={addHearingSection} className="text-[13px] font-bold text-stone-500 hover:text-stone-800 inline-flex items-center gap-1.5 rounded-xl border border-dashed border-stone-300 hover:border-stone-400 px-4 py-3 w-full justify-center transition-colors"><Icon name="plus" className="w-4 h-4" />セクションを追加</button>
              </div>
              {/* デスクトップ右固定の目次（セクション→該当位置へ） */}
              <aside className="hidden lg:block sticky top-24" aria-label="取材メモの目次">
                <div className="rounded-xl border border-stone-200 p-3" style={{ background: "#FAFAFA" }}>
                  <div className="text-[10px] font-bold tracking-widest text-stone-400 mb-1.5 px-1.5">目次</div>
                  <div className="space-y-0.5">
                    {(project.hearing || []).map((sec, si) => {
                      const active = hearingTocActive === sec.id;
                      const filled = sec.items.filter((it) => (it.value || "").trim()).length;
                      return (
                        <button key={sec.id}
                          onClick={() => { setHearingTocActive(sec.id); jumpToHearing("hearing-sec-" + sec.id); }}
                          className={"w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-lg text-[12.5px] leading-snug transition-colors " + (active ? "bg-white shadow-sm text-stone-800 font-bold" : "text-stone-600 hover:bg-white hover:text-stone-800")}>
                          <span className="shrink-0 w-5 h-5 rounded-md grid place-items-center text-[10px] font-bold tabular-nums" style={active ? { background: theme.accent, color: accentText } : { background: "#ECECEA", color: "#6B6B68" }}>{si + 1}</span>
                          <span className="flex-1 min-w-0 truncate">{sec.title || "無題のセクション"}</span>
                          <span className="shrink-0 text-[10px] tabular-nums text-stone-400">{filled}/{sec.items.length}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </aside>
            </div>
          </div>
            )}
          </div>
        )}

        {/* ================= 概要タブ（案件の入口・現在地） ================= */}
        {tab === "overview" && (
          <div className="max-w-[1500px] mx-auto px-1 sm:px-0 py-1 space-y-4">
            {/* 「いまの状態」(ステータス/次にやること/締切)はタスク管理＝Flip Boardに集約のため削除。基本情報カードも未使用のため削除（2026-08-17 AK指示） */}
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
                            const fkey = cat + "|" + fname;
                            const collapsed = !!fname && !!collapsedFolders[fkey];
                            return (
                              <div key={fname || "_loose"}>
                                {fname ? (
                                  <div className="flex items-center gap-1.5 mt-2 mb-0.5 pb-0.5 border-b border-stone-100 cursor-pointer select-none hover:bg-stone-50 rounded-sm"
                                    onClick={() => setCollapsedFolders((m) => ({ ...m, [fkey]: !collapsed }))} title={collapsed ? "開く" : "閉じる"}>
                                    {dlIds.length > 0 && <input type="checkbox" checked={allSel} onClick={(e) => e.stopPropagation()} onChange={(e) => selGroup(arr, e.target.checked)} title="このシーンをまとめて選択" className="w-3.5 h-3.5 accent-stone-600 cursor-pointer" />}
                                    <span className="text-[9px] text-stone-400 w-3 shrink-0 inline-block text-center transition-transform" style={{ transform: collapsed ? "rotate(-90deg)" : "none" }}>▾</span>
                                    <Icon name="folder" className="w-3.5 h-3.5 text-stone-400" />
                                    <span className="text-[11px] font-bold text-stone-500">{fname}</span>
                                    <span className="text-[10px] text-stone-400">{arr.length}</span>
                                  </div>
                                ) : null}
                                {!collapsed && <ul className="divide-y divide-stone-100">{arr.map(renderRow)}</ul>}
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
            </div>
            <ReviewBoard
              versions={evs} trashedVersions={trashedReviewVersions()} comments={comments} main={theme.main} accent={theme.accent} accentText={accentText}
              busy={mediaBusy} prog={mediaProg} userName={(user && user.name) || "ディレクター"}
              shareId={project.shareId} shareToken={project.shareToken} onEnsureShare={ensureShare}
              onUploadVideo={(f) => uploadVersionVideo(f)} onAddYouTube={(u) => addVersionYouTube(u)}
              onRemoveVersion={(id) => removeVersion(id)} onRenameVersion={(id, n) => renameVersion(id, n)} onRestoreVersion={(id) => restoreVersion(id)}
              onPost={(b) => postReviewComment(b)} onUpdate={(cid, p) => updateComment(cid, p)} onReply={(cid, t) => addCommentReply(cid, t)} onDelete={(cid) => deleteComment(cid)} onRefreshStream={() => resumeStreamPolls(true)} />
            <QaEvidencePanel projId={project.id} accent={theme.accent} accentText={accentText} />
          </div>
          );
        })()}

        {/* ================= 納品完了タブ ================= */}
        {tab === "deliver" && (() => {
          const dv = [
            ["deliverTitle", "タイトル", "自動生成で埋まります（手直しOK）。構成台本のタイトルと連動", false, true, "title2"],
            ["deliverThumbImages", "サムネ画像", "", false, false, "image"],
            ["deliverVideoUrl", "納品完了動画", "動画確認の最新版から自動で入ります（Drive/YouTubeのURLに差し替えOK）", false, true],
            ["deliverShorts", "切り抜きショート", "たてがた君のショートから自動で入ります（1行に1本・差し替えOK）", true, true],
            ["deliverDescription", "概要欄", "自動生成で埋まります（手直しOK）", true, true],
            ["deliverHashtags", "ハッシュタグ", "自動生成で埋まります（手直しOK）", false, true],
            ["deliverChapters", "目次", "自動生成で埋まります（手直しOK）", true, true],
          ];
          const isFilled = ([key, , , , , kind]) => kind === "image" ? deliverThumbs().length > 0 : !!(m[key] || "").trim();
          const doneCount = dv.filter(isFilled).length;
          const shortsKey = (() => { const vs = activeReviewVersions().filter((v) => v && v.key && v.type !== "youtube"); return vs.length ? vs[vs.length - 1].key : ""; })();
          return (
          <div className="max-w-3xl mx-auto px-1 sm:px-0 py-2">
            <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-[15px] font-bold text-stone-800">納品完了</h2>
                <p className="text-[12px] text-stone-500 mt-0.5">動画・ショートのURLは動画確認の完成データから自動。タイトル・概要欄・ハッシュタグ・目次は台本から自動生成。編集者も入力OK。</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* 先方確認用URL（2026-08-19 AK要望）: 納品完了ページだけを見せる共有URLを発行してコピー。
                    copyShareUrl は毎回publish＝常に最新の中身が先方に見える */}
                <button onClick={() => copyShareUrl("deliver")}
                  title="先方に見せる確認ページのURLを発行してコピー（タイトル・サムネ・完成動画・概要欄だけが見えます）"
                  className="h-8 px-3 rounded-lg inline-flex items-center gap-1.5 text-[11px] font-bold border border-stone-200 bg-white text-stone-600 hover:border-stone-400 hover:text-stone-800">
                  <Icon name="copy" className="w-3.5 h-3.5" />確認用URLを生成
                </button>
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
                          {/* 2026-08-19 AK「サムネ見づらい・クリックで拡大」: 2列に拡大、候補の減光(opacity-70)を廃止、
                              画像クリック=全画面ライトボックス。差し替えはホバーで出る「差替」ボタンへ分離 */}
                          <div className="grid grid-cols-2 gap-3 max-w-3xl">
                            {(() => { let candRank = 0; return thumbs.map((t, ti) => {
                              const used = deliverThumbUsed(t, ti);
                              if (!used) candRank++;
                              const rankLabel = used ? "使用中" : `候補${candRank}位`;
                              return (
                              <div key={t.key} className="relative aspect-video group">
                                <button type="button" className="block w-full h-full cursor-zoom-in" title="クリックで拡大"
                                  onClick={() => { let r = 0; setThumbLightbox({ idx: ti, items: thumbs.map((x, xi) => { const u = deliverThumbUsed(x, xi); if (!u) r++; return { key: x.key, label: u ? "使用中" : `候補${r}位` }; }) }); }}>
                                  {/* object-contain: 画像の縦横比が16:9でなくても切り取らず全体を見せる（coverだと勝手にクロップされ画角が合わない） */}
                                  <img src={SHARE_API + "/api/file/" + t.key} alt="" className={"w-full h-full object-contain bg-stone-100 rounded-md border-2 " + (used ? "border-emerald-400" : "border-stone-200")} />
                                </button>
                                <label onClick={(e) => e.stopPropagation()} title="画像を差し替え"
                                  className="absolute bottom-1 right-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-white/90 text-stone-500 shadow cursor-pointer opacity-0 group-hover:opacity-100 hover:bg-white">
                                  差替<input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) replaceDeliverThumb(ti, f); e.target.value = ""; }} />
                                </label>
                                <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeDeliverThumb(ti); }} title="削除"
                                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-stone-700 text-white text-[11px] leading-none grid place-items-center opacity-70 hover:opacity-100 hover:bg-rose-500">×</button>
                                <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleDeliverThumbUse(ti); }}
                                  title={used ? "候補に戻す" : "この画像を使用する"}
                                  className={"absolute bottom-1 left-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow " + (used ? "bg-emerald-500 text-white" : "bg-white/90 text-stone-500 hover:bg-white")}>
                                  {rankLabel}
                                </button>
                              </div>
                              );
                            }); })()}
                            {thumbs.length < DELIVER_THUMB_MAX && (
                              <label className="aspect-video rounded-md border border-dashed border-stone-300 grid place-items-center cursor-pointer text-stone-400 hover:text-stone-600 hover:border-stone-400 text-xl leading-none">
                                +
                                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { uploadDeliverThumbs(e.target.files); e.target.value = ""; }} />
                              </label>
                            )}
                          </div>
                          <div className="text-[10px] text-stone-400 mt-1">使用 {thumbs.filter((t, i) => deliverThumbUsed(t, i)).length}/{DELIVER_THUMB_USE_MAX}枚・候補{thumbs.filter((t, i) => !deliverThumbUsed(t, i)).length}枚（全{thumbs.length}/{DELIVER_THUMB_MAX}枚）{thumbUp ? `・アップ中 ${thumbUp.i}/${thumbUp.n}（${thumbUp.pct}%）` : ""}</div>
                          {/* 全画面ライトボックス（背景クリック/Esc/×で閉・←→で前後） */}
                          {thumbLightbox && (
                            <div className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center" onClick={() => setThumbLightbox(null)}>
                              <img src={SHARE_API + "/api/file/" + thumbLightbox.items[thumbLightbox.idx].key} alt=""
                                className="max-w-[96vw] max-h-[90vh] object-contain" onClick={(e) => e.stopPropagation()} />
                              <div className="absolute top-3 left-1/2 -translate-x-1/2 text-white/90 text-xs font-bold px-3 py-1 rounded-full bg-white/10">
                                {thumbLightbox.items[thumbLightbox.idx].label}　{thumbLightbox.idx + 1} / {thumbLightbox.items.length}
                              </div>
                              {thumbLightbox.items.length > 1 && (
                                <>
                                  <button className="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/15 text-white text-2xl leading-none hover:bg-white/30"
                                    onClick={(e) => { e.stopPropagation(); setThumbLightbox((lb) => ({ ...lb, idx: (lb.idx - 1 + lb.items.length) % lb.items.length })); }}>‹</button>
                                  <button className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/15 text-white text-2xl leading-none hover:bg-white/30"
                                    onClick={(e) => { e.stopPropagation(); setThumbLightbox((lb) => ({ ...lb, idx: (lb.idx + 1) % lb.items.length })); }}>›</button>
                                </>
                              )}
                              <button className="absolute top-3 right-3 w-10 h-10 rounded-full bg-white/15 text-white text-xl leading-none hover:bg-white/30"
                                onClick={(e) => { e.stopPropagation(); setThumbLightbox(null); }}>×</button>
                            </div>
                          )}
                        </div>
                      ) : key === "deliverShorts" ? (
                        <ShortsPanel key={project.id} videoKey={shortsKey} shareId={project.shareId} shareToken={project.shareToken} onEnsureShare={ensureShare} onCopyGalleryUrl={copyShortsGalleryUrl} accent={theme.accent}
                          templateId={m.deliverShortsTemplateId || ""} onTemplateChange={(v) => setMeta("deliverShortsTemplateId", v)} />
                      ) : kind === "title2" ? (
                        // タイトル案を2つまで持てるように（2026-08-20 AK要望）。案1は構成台本のタイトルと連動、
                        // 案2は独立入力（自動生成が2案返せば埋まる／無ければ空のまま手入力）。
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="shrink-0 text-[10px] font-bold text-stone-400 w-10">案1</span>
                            <input value={m[key] || ""} onChange={(e) => setMeta(key, e.target.value)} placeholder={placeholder}
                              className="block w-full bg-transparent text-[13px] px-0 py-0.5 focus:outline-none placeholder:text-stone-300" />
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="shrink-0 text-[10px] font-bold text-stone-400 w-10">案2</span>
                            <input value={m[key + "2"] || ""} onChange={(e) => setMeta(key + "2", e.target.value)} placeholder="もう1つのタイトル案（任意）"
                              className="block w-full bg-transparent text-[13px] px-0 py-0.5 focus:outline-none placeholder:text-stone-300" />
                          </div>
                        </div>
                      ) : multiline ? (
                        <AutoTextarea value={m[key] || ""} onChange={(e) => setMeta(key, e.target.value)} placeholder={placeholder}
                          className="block w-full bg-transparent text-[13px] px-0 py-0.5 focus:outline-none placeholder:text-stone-300" minHeight={60} />
                      ) : (
                        <input value={m[key] || ""} onChange={(e) => setMeta(key, e.target.value)} placeholder={placeholder}
                          className="block w-full bg-transparent text-[13px] px-0 py-0.5 focus:outline-none placeholder:text-stone-300" />
                      )}
                      {/* URL欄はワンクリックで飛べるリンクを添える（入力欄のテキストは編集用に据え置き） */}
                      {key === "deliverVideoUrl" && (() => {
                        const urls = (m[key] || "").split("\n").map((s) => s.trim()).filter((s) => /^https?:\/\//.test(s));
                        if (!urls.length) return null;
                        return (
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {urls.map((u, ui) => (
                              <a key={ui} href={u} target="_blank" rel="noreferrer" title={u}
                                className="text-[10px] font-bold px-2 py-1 rounded-lg border border-stone-200 text-stone-500 hover:bg-stone-50 hover:text-stone-700 inline-flex items-center gap-1">
                                ↗ 動画を開く
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
      {/* 目次レール（全タブ）：普段は細い線だけ＝場所を取らない。触るとラベルが本文の上に浮いて出る */}
      </div>{/* /工程タブ縦レール＋本文の flex */}
      </div>{/* /content wrapper */}

      {/* ===== サムネ目立ちテスト モーダル ===== */}
      {thumbTest && (() => {
        const t = thumbTest;
        const tp = (project.plans || []).find((p) => p.id === t.pid) || {};
        const cells = [...t.items];
        cells.splice(Math.min(t.myPos, cells.length), 0, { mine: true });
        return (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3" onClick={() => setThumbTest(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto mg-scroll" onClick={(e) => e.stopPropagation()}>
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
              <div className="flex items-center gap-1.5 p-1.5 mb-3 rounded-xl bg-stone-100 text-[12px] font-bold">
                <button onClick={() => setImportTarget("new")}
                  className={"flex-1 px-4 py-2.5 rounded-lg transition inline-flex items-center justify-center gap-2 " + (importTarget === "new" ? "bg-white shadow-md text-stone-800" : "text-stone-400 hover:text-stone-600 hover:bg-stone-50/50")}>
                  <Icon name="plus" className="w-4 h-4" /> 新規案件として取り込む
                </button>
                <button onClick={() => setImportTarget("current")} disabled={!project}
                  className={"flex-1 px-4 py-2.5 rounded-lg transition disabled:opacity-40 inline-flex items-center justify-center gap-2 " + (importTarget === "current" ? "bg-white shadow-md text-stone-800" : "text-stone-400 hover:text-stone-600 hover:bg-stone-50/50")}>
                  <Icon name="refresh" className="w-4 h-4" /> この案件を更新{project ? "（" + project.name + "）" : ""}
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
              <div
                onDragOver={handleImportDragOver}
                onDrop={handleImportDrop}
                className="relative mb-2 rounded-xl border-2 border-dashed border-stone-300 transition hover:border-stone-400 hover:bg-stone-50/30"
              >
                <textarea
                  value={fullImportText}
                  onChange={(e) => setFullImportText(e.target.value)}
                  placeholder={'ここにファイルをドラッグ＆ドロップするか、JSON/TSV/テキストを貼り付けてください\n\n例）\n{\n  "name": "永田晃聖さん｜オリックス不動産",\n  "channel": "オリックス不動産",\n  "meta": { "highlight": "…" },\n  "rows": [\n    { "kind": "location", "label": "出社", "time": "8:50" },\n    { "kind": "scene", "type": "訴求", "sec": 180, "label": "自己紹介", "script": "◼ …" }\n  ]\n}'}
                  className={"w-full h-72 text-[12px] leading-relaxed border-0 rounded-xl p-3 focus:outline-none resize-y " + (importValidation && importValidation.error ? "bg-red-50" : "bg-stone-50")}
                  style={{ fontFamily: mono }}
                />
                <div className="absolute inset-0 rounded-xl flex items-center justify-center bg-black/5 pointer-events-none opacity-0 hover:opacity-100 transition">
                  <div className="text-center text-stone-500">
                    <Icon name="fileAdd" className="w-8 h-8 mx-auto mb-1" />
                    <div className="text-[12px] font-bold">ファイルをドロップ</div>
                  </div>
                </div>
              </div>
              {/* バリデーション結果の表示 */}
              {fullImportText.trim() && importValidation && (
                <div className={"mt-2 text-[12px] px-3 py-2 rounded-lg flex items-start gap-2 " + (importValidation.error ? "bg-red-50 text-red-800 border border-red-100" : "bg-emerald-50 text-emerald-800 border border-emerald-100")}>
                  <Icon name={importValidation.error ? "warn" : "checkCircle"} className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    {importValidation.error ? (
                      <>
                        <div className="font-bold mb-1">❌ {importValidation.error}</div>
                        <div className="text-[11px] opacity-75">JSON形式で提供する場合は、`{` で始まり `}` で終わる有効なJSONである必要があります。または、プレーンテキスト・TSV形式で貼り付けると自動整形します。</div>
                      </>
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className="font-bold">✓ 準備完了</span>
                        <span className="text-[11px] opacity-75">({importValidation.format === "json" ? "JSON形式" : "テキスト形式"})</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="mt-3 flex justify-end items-center gap-2">
                <button onClick={() => setShowFullImport(false)} className="text-xs font-bold px-4 py-2 rounded-lg border border-stone-200 hover:bg-stone-50 mr-auto">キャンセル</button>
                <button onClick={() => smartImport()} disabled={!fullImportText.trim() || aiParsing || (importValidation && importValidation.error)}
                  title={importValidation && importValidation.error ? "JSON形式を修正してください" : "中身を自動判定して取り込む（生原稿はAI整形・JSON/台本コピーはそのまま）"}
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
              {[["channel", curChannel === DEFAULT_CHANNEL ? "クライアント／チャンネル" : curChannel, (curChannelInfo.manuals || []).length], ["global", "全案件共通", globalManuals.length], ["case", "案件だけの例外", (project.manuals || []).length]].map(([k, label, n]) => (
                <button key={k} onClick={() => setManualScope(k)}
                  className={"text-[12px] font-bold px-3 py-1.5 rounded-lg border " + (manualScope === k ? "text-white border-transparent" : "bg-white border-stone-200 text-stone-500")}
                  style={manualScope === k ? { background: theme.main } : {}}>{label}<span className="opacity-60 ml-1">{n}</span></button>
              ))}
            </div>
            <p className="px-5 pt-2 text-[11px] text-stone-400 shrink-0">{manualScope === "global" ? "全案件に適用する会社共通のルール。" : manualScope === "channel" ? "登録の基本はこちら。このクライアント（チャンネル）の配下にある全案件へ自動適用されます。" : "住所非公開など、この案件だけに必要な例外・追加条件に限定してください。"}共有リンクを発行すると編集者・先方も閲覧できます。</p>
            <div className="p-5 overflow-y-auto mg-scroll">
              {false && manualScope === "global" && <LabChannelRules channel="編集マニュアル" main={theme.main} snapId={project.shareId} token={project.shareToken} upToken={project.shareUpToken} liveId={project.liveId} liveToken={project.liveToken}
                onAdopt={(t) => saveGlobalManuals([...globalManuals, { ...newManual("その他"), body: t }])} />}
              {manualScope === "global" && <ManualPanel entries={globalManuals} onChange={saveGlobalManuals} main={theme.main} accent={theme.accent} />}
              {false && manualScope === "channel" && curChannel !== DEFAULT_CHANNEL && <LabChannelRules channel={curChannel} main={theme.main}
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
            <div className="p-5 overflow-y-auto mg-scroll">
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

      {/* ===== 変更履歴 モーダル =====
          保存が通るたびに差分を積んでいる。「直したのに前の値に戻ってる」を後から追えるようにするのが目的なので、
          変更前の全文をそのまま出す（切らない）。1クリックで戻せる。 */}
      {histOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setHistOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 flex items-center justify-between" style={{ background: theme.main, color: mainText }}>
              <h3 className="text-sm font-bold tracking-wider">変更履歴</h3>
              <button onClick={() => setHistOpen(false)} className="w-7 h-7 rounded-lg grid place-items-center hover:bg-white/15"><Icon name="close" className="w-4 h-4" /></button>
            </div>
            <div className="p-4 overflow-y-auto">
              {!histList.length ? (
                <p className="text-[12px] text-stone-400 py-8 text-center">
                  まだ履歴がない。これ以降の変更（タイトル・サムネ文言・内容・原稿・ロケ名）が保存されるたびにここへ積まれる。
                </p>
              ) : histList.map((h, i) => (
                <div key={i} className="border border-stone-200 rounded-xl mb-2 overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-stone-50 border-b border-stone-100">
                    <span className="text-[10px] tabular-nums text-stone-400 shrink-0" style={{ fontFamily: mono }}>
                      {new Date(h.at).toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className="text-[11px] font-bold text-stone-600 truncate flex-1">{h.label}</span>
                    <button onClick={() => { try { navigator.clipboard.writeText(h.before); showToast("変更前をコピーした"); } catch (e) {} }}
                      className="shrink-0 text-[10px] text-stone-400 hover:text-stone-700 px-2 py-0.5 rounded hover:bg-stone-200">コピー</button>
                    <button onClick={() => restoreHistory(h)}
                      className="shrink-0 text-[10px] font-bold px-2.5 py-0.5 rounded-md text-white" style={{ background: theme.accent, color: accentText }}>これに戻す</button>
                  </div>
                  <div className="px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap break-words text-stone-700 bg-emerald-50/40">{h.before}</div>
                  <div className="px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap break-words text-stone-400 border-t border-stone-100">
                    {h.after ? h.after : <span className="italic">（空になった）</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===== アカウント / ログイン モーダル ===== */}
      {showAccount && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowAccount(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[92vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 flex items-center justify-between" style={{ background: theme.main, color: mainText }}>
              <h3 className="text-sm font-bold tracking-wider inline-flex items-center gap-1.5"><Icon name="user" className="w-4 h-4" />アカウント</h3>
              <button onClick={() => setShowAccount(false)} className="w-7 h-7 rounded-lg grid place-items-center hover:bg-white/15"><Icon name="close" className="w-4 h-4" /></button>
            </div>
            <div className="p-5 overflow-y-auto">
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
                  <div className="mt-3 rounded-xl border border-stone-200 p-3">
                    <div className="flex items-start gap-2">
                      <Icon name="video" className="w-4 h-4 shrink-0 mt-0.5 text-stone-500" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-bold">自分のCloudflare Stream</div>
                        {cfStream.loading ? (
                          <div className="text-[11px] text-stone-400 mt-1">接続状態を確認中…</div>
                        ) : cfStream.connected ? (
                          <>
                            <div className="text-[11px] text-emerald-700 mt-1 truncate">接続済み：{cfStream.accountName}</div>
                            <div className="text-[10px] text-stone-400 mt-1">確認動画はこのアカウントへ直接保存され、料金・容量もこのアカウント側になります。</div>
                          </>
                        ) : (
                          <div className="text-[11px] text-stone-500 mt-1">接続すると、確認動画をあなた自身のStreamへ保存して高速再生できます。</div>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 flex justify-end">
                      {cfStream.connected
                        ? <button onClick={disconnectCloudflare} disabled={cfBusy} className="text-[11px] font-bold px-3 py-1.5 rounded-lg border border-stone-200 hover:bg-stone-50 disabled:opacity-40">接続を解除</button>
                        : <button onClick={connectCloudflare} disabled={cfBusy || cfStream.loading} className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-40">{cfBusy ? "接続中…" : "Cloudflareを接続"}</button>}
                    </div>
                  </div>
                  <div className="mt-3 rounded-xl border border-stone-200 overflow-hidden">
                    <button onClick={() => setConnectionsOpen((v) => !v)} className="w-full px-3 py-2.5 flex items-center gap-2 text-left hover:bg-stone-50">
                      <Icon name="share" className="w-4 h-4 text-stone-500 shrink-0" />
                      <div className="flex-1">
                        <div className="text-[12px] font-bold">ログイン情報の連携先</div>
                        <div className="text-[10px] text-stone-400">保存先・用途・費用負担を確認</div>
                      </div>
                      <span className="text-stone-400 text-xs">{connectionsOpen ? "▲" : "▼"}</span>
                    </button>
                    {connectionsOpen && (
                      <div className="border-t border-stone-100 px-3 py-3">
                        {!connections ? (
                          <div className="text-[11px] text-stone-400 text-center py-3">連携情報を読み込み中…</div>
                        ) : (() => {
                          const rows = [
                            ["本人確認", connections.identity, "user"],
                            ["ログイン状態", connections.session, "checkCircle"],
                            ["案件・台本", connections.projectStorage, "file"],
                            ["確認動画", connections.video, "video"],
                            ["Google Drive", connections.googleDrive, "folder"],
                            ["AI機能", connections.ai, "sparkle"],
                            ["YouTube調査", connections.youtube, "search"],
                            ["共同編集・コメント", connections.collaboration, "user"],
                          ];
                          return (
                            <div className="space-y-2">
                              <div className="rounded-lg bg-stone-50 px-3 py-2 text-[10px] text-stone-500 leading-relaxed">
                                <span className="font-bold text-stone-700">Googleログイン</span>
                                <span className="mx-1.5 text-stone-300">→</span>
                                ものがたりっちの本人確認
                                <span className="mx-1.5 text-stone-300">→</span>
                                各サービスをユーザー単位で識別
                              </div>
                              {rows.map(([label, item, ico]) => {
                                if (!item) return null;
                                const connected = item.connected !== false;
                                const owner = item.owner || (label === "本人確認" ? "自分" : "");
                                const own = owner === "自分";
                                return (
                                  <div key={label} className="rounded-lg border border-stone-100 px-2.5 py-2">
                                    <div className="flex items-center gap-2">
                                      <div className={"w-6 h-6 rounded-md grid place-items-center shrink-0 " + (connected ? "bg-emerald-50 text-emerald-600" : "bg-stone-100 text-stone-400")}>
                                        <Icon name={ico} className="w-3.5 h-3.5" />
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-[11px] font-bold">{label}</span>
                                          <span className={"text-[9px] font-bold px-1.5 py-0.5 rounded-full " + (connected ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-500")}>{connected ? "接続中" : "未接続"}</span>
                                          {owner && <span className={"text-[9px] font-bold px-1.5 py-0.5 rounded-full " + (own ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700")}>{owner}の契約</span>}
                                        </div>
                                        <div className="text-[10px] text-stone-500 truncate">{item.provider}{item.accountName ? " / " + item.accountName : ""}</div>
                                      </div>
                                    </div>
                                    <div className="text-[10px] text-stone-400 leading-relaxed mt-1 pl-8">{item.purpose}</div>
                                    {label === "本人確認" && connections.identity.email && <div className="text-[10px] text-stone-500 mt-1 pl-8 truncate">連携メール：{connections.identity.email}</div>}
                                    {label === "ログイン状態" && item.expiresAt && <div className="text-[10px] text-stone-500 mt-1 pl-8">有効期限：{new Date(item.expiresAt).toLocaleString("ja-JP")}</div>}
                                  </div>
                                );
                              })}
                              <div className="pt-1 text-[9px] text-stone-400 leading-relaxed">
                                APIキー・OAuthトークンそのものは安全のため表示しません。接続先と用途のみ表示しています。
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    )}
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
                  <div className="absolute z-30 left-0 right-0 mt-1 rounded-xl border border-stone-200 bg-white shadow-xl max-h-[60vh] overflow-y-auto mg-scroll">
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
          <div className="mg-pop fixed z-[61] w-48 bg-white rounded-xl shadow-2xl border border-stone-200 overflow-hidden text-stone-700 py-1"
            style={{ left: Math.min(addMenu.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 200), top: addMenu.y }}>
            <div className="px-3 py-1.5 text-[10px] font-bold text-stone-400 truncate">{addMenu.channel} に追加</div>
            <button onClick={() => { const ch = addMenu.channel; setAddMenu(null); createProject(true, ch, "documentary"); }} className="w-full text-left px-3 py-2 hover:bg-stone-50 text-[12px] font-bold flex items-center gap-2"><Icon name="video" className="w-4 h-4 shrink-0 text-stone-500" />一日密着</button>
            <button onClick={() => { const ch = addMenu.channel; setAddMenu(null); createProject(true, ch, "talk"); }} className="w-full text-left px-3 py-2 hover:bg-stone-50 text-[12px] font-bold flex items-center gap-2"><Icon name="mic" className="w-4 h-4 shrink-0 text-stone-500" />トーク系</button>
          </div>
        </>
      )}

      {chShareMenu && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setChShareMenu(null)} />
          <div className="mg-pop fixed z-[61] w-60 bg-white rounded-xl shadow-2xl border border-stone-200 overflow-hidden text-stone-700 py-1"
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
          <div className="mg-pop fixed z-[61] w-52 bg-white rounded-xl shadow-2xl border border-stone-200 overflow-hidden text-stone-700 py-1"
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
          <div className="mg-pop fixed z-[61] w-56 bg-white rounded-xl shadow-2xl border border-stone-200 overflow-hidden text-stone-700 py-1"
            style={{ left: Math.min(chanMenu.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 236), top: chanMenu.y }}>
            <div className="px-3 py-1.5 text-[10px] font-bold text-stone-400">移動先のチャンネルを選ぶ</div>
            <div className="max-h-72 overflow-y-auto mg-scroll">
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
          <div className="mg-pop fixed z-[61] w-48 bg-white rounded-xl shadow-2xl border border-stone-200 overflow-hidden text-stone-700 py-1"
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
          <div className="mg-pop fixed z-[61] w-48 bg-white rounded-xl shadow-2xl border border-stone-200 overflow-hidden text-stone-700 py-1"
            style={{ left: Math.min(rowMenu.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 200), top: Math.min(rowMenu.y, (typeof window !== "undefined" ? window.innerHeight : 9999) - 200) }}>
            <div className="flex border-b border-stone-100">
              <button onClick={() => { moveRow(rowMenu.idx, -1); setRowMenu(null); }} className="flex-1 px-3 py-2 hover:bg-stone-50 text-[12px] inline-flex items-center justify-center gap-1"><Icon name="up" className="w-3.5 h-3.5" />上へ</button>
              <button onClick={() => { moveRow(rowMenu.idx, 1); setRowMenu(null); }} className="flex-1 px-3 py-2 hover:bg-stone-50 text-[12px] inline-flex items-center justify-center gap-1 border-l border-stone-100"><Icon name="down" className="w-3.5 h-3.5" />下へ</button>
            </div>
            <button onClick={() => { const idx = rowMenu.idx, sceneType = rowMenu.sceneType; setRowMenu(null); insertBelow(idx, newScene(rowMenu.kind === "location" ? "解説系" : (sceneType || "解説系"))); }} className="w-full text-left px-3 py-2 hover:bg-stone-50 text-[12px] flex items-center gap-2"><Icon name="plus" className="w-3.5 h-3.5 text-stone-400" />下にシーンを追加</button>
            <button onClick={() => { const idx = rowMenu.idx; setRowMenu(null); insertBelow(idx, newLocation("")); }} className="w-full text-left px-3 py-2 hover:bg-stone-50 text-[12px] flex items-center gap-2"><Icon name="folder" className="w-3.5 h-3.5 text-stone-400" />下にロケ（セクション）を追加</button>
            <button onClick={() => { const id = rowMenu.id; setRowMenu(null); deleteRow(id); }} className="w-full text-left px-3 py-2 mt-1 border-t border-stone-100 hover:bg-red-50 text-[12px] font-bold text-red-500 flex items-center gap-2"><Icon name="trash" className="w-3.5 h-3.5" />削除</button>
          </div>
        </>
      )}

      {/* ===== チャンネルアイコン 選択ポップオーバー ===== */}
      {iconPick && (
        <>
          <div className="fixed inset-0 z-[62]" onClick={() => setIconPick(null)} onContextMenu={(e) => { e.preventDefault(); setIconPick(null); }} />
          <div className="mg-pop fixed z-[63] w-[244px] bg-white rounded-xl shadow-2xl border border-stone-200 p-2.5 text-stone-700"
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

      {/* ===== 動画共有先の選択 ===== */}
      {shareAudience && (
        <div className="fixed inset-0 z-[205] bg-black/45 flex items-center justify-center p-4" onClick={() => setShareAudience(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 flex items-center justify-between border-b border-stone-200" style={{ background: theme.main, color: mainText }}>
              <div><h3 className="text-sm font-bold">誰に共有しますか？</h3><p className="text-[10px] opacity-70 mt-0.5">相手に必要な動画・情報・権限だけを自動で設定します</p></div>
              <button onClick={() => setShareAudience(null)} className="w-8 h-8 rounded-lg grid place-items-center hover:bg-white/15"><Icon name="close" className="w-4 h-4" /></button>
            </div>
            <div className="p-5 grid sm:grid-cols-2 gap-3">
              <button onClick={() => { setShareAudience(null); copyShareUrl("review", false, "client"); }} className="text-left rounded-xl border-2 border-stone-200 p-4 hover:border-stone-400 hover:bg-stone-50 transition-colors">
                <div className="text-[14px] font-bold text-stone-900">先方に共有</div>
                <p className="mt-2 text-[11px] text-stone-500 leading-relaxed">動画の再生とタイムコードコメントだけ。共有前に公開レギュレーションを確認し、社内ルールは表示しません。</p>
              </button>
              <button onClick={() => { const h = handoffs.find((x) => x.id === "editor") || HANDOFF_DEFAULTS[0]; setShareAudience(null); doHandoff({ ...h, tabs: Array.from(new Set(["review", ...(h.tabs || []), "manual"])), start: "review", upload: true }); }} className="text-left rounded-xl border-2 border-stone-200 p-4 hover:border-rose-300 hover:bg-rose-50/40 transition-colors">
                <div className="text-[14px] font-bold text-stone-900">編集者に共有</div>
                <p className="mt-2 text-[11px] text-stone-500 leading-relaxed">動画・制作情報・素材・この案件に適用されるレギュレーションを共有。動画アップとダウンロードもできます。</p>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 納品完了：公開前チェック（MONOGATARI内で完結） ===== */}
      {preflight && (
        <div className="fixed inset-0 z-[210] bg-black/45 flex items-center justify-center p-3 sm:p-5" onClick={() => !preflightBusy && setPreflight(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3.5 flex items-center gap-3 border-b border-stone-200" style={{ background: theme.main, color: mainText }}>
              <div className="flex-1"><h3 className="text-sm font-bold">確認用URLを生成する前のチェック</h3><p className="text-[10px] opacity-70 mt-0.5">{project.name} ・ Obsidianナレッジ {preflight.knowledgeVersion}</p></div>
              <button onClick={() => setPreflight(null)} disabled={preflightBusy} className="w-8 h-8 rounded-lg grid place-items-center hover:bg-white/15 disabled:opacity-40"><Icon name="close" className="w-4 h-4" /></button>
            </div>
            <div className="p-4 sm:p-5 overflow-y-auto space-y-4">
              <section className="rounded-xl border border-stone-200 p-3.5">
                <div className="text-[12px] font-bold text-stone-800 mb-2">あなたが確認すること</div>
                <div className="space-y-2">
                  {HUMAN_PREFLIGHT.map(([key, label]) => (
                    <label key={key} className="flex items-start gap-2.5 cursor-pointer text-[12.5px] text-stone-700">
                      <input type="checkbox" checked={!!preflight.checks[key]} onChange={() => toggleHumanPreflight(key)} className="mt-0.5 w-4 h-4 accent-emerald-600" />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </section>
              <details open className="rounded-xl border border-stone-200 bg-stone-50/50 overflow-hidden">
                <summary className="px-3.5 py-3 cursor-pointer text-[12px] font-bold text-stone-800 select-none">今回確認するレギュレーション <span className="ml-1 text-[10px] font-normal text-stone-400">{regulationChecklist.length}件・{regulationChecklist.filter((r) => preflight.checks[r.key]).length}件確認済み</span></summary>
                <div className="border-t border-stone-200 bg-white px-3.5 py-1">
                  {regulationChecklist.map((r, i) => (
                    <label key={r.key} className={"flex items-start gap-2.5 py-2.5 cursor-pointer " + (i ? "border-t border-stone-100" : "")}>
                      <input type="checkbox" checked={!!preflight.checks[r.key]} onChange={() => toggleHumanPreflight(r.key)} className="mt-0.5 w-4 h-4 accent-emerald-600 shrink-0" />
                      <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">{r.cat}</span>
                      <span className="flex-1 min-w-0 text-[11.5px] leading-relaxed text-stone-700">
                        {r.title}
                        {r.body && <span className="block text-[10.5px] text-stone-500 mt-0.5 whitespace-pre-wrap">{r.body}</span>}
                      </span>
                      <span className="shrink-0 text-[9px] text-stone-400">{r.scope}</span>
                    </label>
                  ))}
                  {regulationChecklist.length === 0 && <p className="text-[11px] text-stone-400 py-3">適用されるレギュレーションはありません。</p>}
                </div>
              </details>
              <section className="rounded-xl border border-stone-200 p-3.5">
                <div className="flex items-center gap-2 mb-2"><span className="text-[12px] font-bold text-stone-800">AIが自動で確認</span>{preflightBusy && <span className="text-[10px] text-indigo-500">確認中…</span>}</div>
                <p className="text-[11px] text-stone-500 leading-relaxed">ブランド、個人情報、センシティブ情報、煽り表現、過去修正、個別承認の懸念をObsidianの承認済みルールと照合します。</p>
                {!preflightBusy && !preflight.error && !(preflight.concerns || []).length && <div className="mt-3 rounded-lg bg-emerald-50 text-emerald-700 px-3 py-2 text-[12px] font-bold">AIが確認を求める懸念はありませんでした</div>}
                {preflight.error && <div className="mt-3 rounded-lg bg-red-50 text-red-700 px-3 py-2 text-[11px]">{preflight.error}。安全のためURL生成を停止します。</div>}
              </section>
              {(preflight.concerns || []).length > 0 && (
                <section className="rounded-xl border border-amber-200 bg-amber-50/40 p-3.5">
                  <div className="text-[12px] font-bold text-amber-900 mb-2">あなたに確認が必要な懸念だけ</div>
                  <div className="space-y-2.5">
                    {preflight.concerns.map((c) => (
                      <label key={c.id} className="block rounded-lg border border-amber-200 bg-white p-3 cursor-pointer">
                        <div className="flex items-start gap-2">{c.severity === "block" ? <span className="mt-0.5 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] grid place-items-center shrink-0">!</span> : <input type="checkbox" className="mt-0.5 w-4 h-4 accent-amber-600" checked={!!preflight.acknowledged[c.id]} onChange={() => setPreflight((p) => ({ ...p, acknowledged: { ...p.acknowledged, [c.id]: !p.acknowledged[c.id] } }))} />}
                          <div className="min-w-0"><div className="text-[12px] font-bold text-stone-800">{c.severity === "block" ? "要修正" : "要確認"}：{c.title}</div><p className="text-[11px] text-stone-600 mt-1">{c.reason}</p>{c.evidence && <p className="text-[10px] text-stone-400 mt-1">根拠：{c.evidence}</p>}<p className="text-[11px] text-amber-800 mt-1">対応：{c.suggestion}</p></div>
                        </div>
                      </label>
                    ))}
                  </div>
                </section>
              )}
            </div>
            <div className="px-5 py-3 border-t border-stone-200 flex items-center justify-between gap-3 bg-stone-50">
              <span className="text-[10px] text-stone-400">案件とクライアントは自動判定済みです</span>
              <button onClick={finishPublishPreflight} disabled={preflightBusy || HUMAN_PREFLIGHT.some(([k]) => !preflight.checks[k]) || regulationChecklist.some((r) => !preflight.checks[r.key]) || !!preflight.error || (preflight.concerns || []).some((c) => c.severity === "block" || !preflight.acknowledged[c.id])}
                className="px-4 py-2 rounded-lg text-[12px] font-bold text-white shadow disabled:opacity-35" style={{ background: theme.accent, color: accentText }}>
                {preflightBusy ? "AI確認中…" : "確認を完了してURL生成"}
              </button>
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
                  ? <>このURLを渡すと、先方が<span className="font-bold">{shareModal.tab ? `「${TAB_LABEL[shareModal.tab] || shareModal.tab}」` : "全タブ"}をその場で編集</span>できます（リアルタイム同時編集・ログイン不要）。あなたもこのリンクを開けば一緒に編集できます。{shareModal.tab && <>他のタブは表示されません。</>}<span className="font-bold text-rose-500">編集できる人全員に渡るので取り扱い注意。</span></>
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
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[88vh] overflow-y-auto mg-scroll" onClick={(e) => e.stopPropagation()}>
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
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[88vh] overflow-y-auto mg-scroll" onClick={(e) => e.stopPropagation()}>
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
            <div className="flex-1 overflow-y-auto mg-scroll p-3 space-y-2" style={{ background: "#F4F3EF" }}>
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
          <button onClick={copySelectedScripts}
            className="text-[11px] font-bold px-3 py-1.5 rounded-full bg-white/20 hover:bg-white/30 inline-flex items-center gap-1">⧉ 原稿をコピー</button>
          <button onClick={downloadSelectedScripts} title="選択した原稿を.txtで保存（Claudeにファイルとしてドラッグ＝空にならない）"
            className="text-[11px] font-bold px-3 py-1.5 rounded-full bg-white/20 hover:bg-white/30 inline-flex items-center gap-1">↓ .txt</button>
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
          <div className="flex-1 overflow-y-auto mg-scroll px-3 py-3 space-y-2.5 bg-stone-50">
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
