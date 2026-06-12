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
const newScene = (type = "解説系", label = "") => ({ id: uid(), kind: "scene", label, type, sec: null, script: "" });
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

const newProjectData = (name = "新規案件") => ({
  id: uid(),
  name,
  createdAt: Date.now(),
  meta: { shootDate: "", place: "", titles: ["", "", ""], thumbs: ["", "", ""], highlight: "" },
  theme: { ...DEFAULT_THEME },
  rate: 5,
  timeFormat: "tc",
  rows: templateRows(),
});

/* 案件データの欠損補完 */
const migrateProject = (p) => {
  const meta = p.meta || {};
  return {
    id: p.id || uid(),
    name: p.name || "案件",
    createdAt: p.createdAt || Date.now(),
    meta: {
      shootDate: meta.shootDate || "",
      place: meta.place || "",
      titles: meta.titles || ["", "", ""],
      thumbs: meta.thumbs || ["", "", ""],
      highlight: meta.highlight || "",
    },
    theme: { ...DEFAULT_THEME, ...(p.theme || {}) },
    rate: p.rate || 5,
    timeFormat: p.timeFormat || "tc",
    rows: (p.rows || templateRows()).map((r) =>
      r.kind === "scene" ? { sec: null, ...r } : { address: "", time: "", note: "", ...r }
    ),
  };
};

const countChars = (s) => (s || "").replace(/\s/g, "").length;
const fmtJP = (sec) => { const s = Math.round(sec); return Math.floor(s / 60) + "分" + String(s % 60).padStart(2, "0") + "秒"; };
const fmtTC = (sec) => { const s = Math.round(sec); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
const targetOf = (r) => (r.sec != null && r.sec !== "" ? Number(r.sec) : SECTION_TYPES[r.type].target);

const textOn = (hex) => {
  try {
    const h = hex.replace("#", "");
    const f = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const r = parseInt(f.slice(0, 2), 16), g = parseInt(f.slice(2, 4), 16), b = parseInt(f.slice(4, 6), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "#1A1A1A" : "#FFFFFF";
  } catch { return "#FFFFFF"; }
};

/* ---------- 原稿セル：◼︎自動挿入 + 質問行をアクセント色・太字で表示 ---------- */
function ScriptCell({ value, onChange, placeholder, accent = "#E63946" }) {
  const textStyle = {
    fontFamily: "inherit",
    fontSize: 13,
    lineHeight: 1.7,
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    wordBreak: "break-word",
  };

  const handleKeyDown = (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    const ta = e.target;
    const { selectionStart: pos, value: v } = ta;
    const lineStart = v.lastIndexOf("\n", pos - 1) + 1;
    if (v.slice(lineStart, pos).trim() === "") {
      e.preventDefault();
      const insert = "\n◼︎ ";
      onChange(v.slice(0, pos) + insert + v.slice(pos));
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = pos + insert.length; });
    }
  };

  const handleFocus = (e) => {
    if (!value) {
      onChange("◼︎ ");
      const ta = e.target;
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = 3; });
    }
  };

  /* 質問行（◼︎始まり）に色と太字をつけた表示レイヤー */
  const nodes = [];
  (value || "").split("\n").forEach((line, i) => {
    if (i) nodes.push("\n");
    if (/^\s*◼/.test(line)) {
      nodes.push(<span key={i} style={{ color: accent, fontWeight: 700 }}>{line}</span>);
    } else {
      nodes.push(line);
    }
  });

  return (
    <div className="relative">
      <div aria-hidden className="px-3 py-2 text-stone-800" style={{ ...textStyle, minHeight: 38 }}>
        {value ? nodes : <span className="text-stone-300">{placeholder || "クリックして原稿を入力"}</span>}
        {"\u200b"}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        spellCheck={false}
        className="absolute inset-0 w-full h-full resize-none bg-transparent px-3 py-2 focus:outline-none"
        style={{ ...textStyle, color: "transparent", caretColor: "#1C1C1E" }}
      />
    </div>
  );
}

/* ---------- メイン ---------- */
export default function App() {
  const [index, setIndex] = useState([]);       // [{id,name,createdAt}]
  const [activeId, setActiveId] = useState(null);
  const [project, setProject] = useState(null);  // 現在編集中の案件データ
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState("");
  const [hoverId, setHoverId] = useState(null);
  const [showTheme, setShowTheme] = useState(false);
  const [tab, setTab] = useState("script"); // script | kouban
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [renamingId, setRenamingId] = useState(null);
  const saveTimer = useRef(null);

  /* フォント */
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700;900&family=IBM+Plex+Mono:wght@400;600;700&display=swap";
    document.head.appendChild(link);
  }, []);

  /* 初期読み込み：index取得 → なければ旧データ移行 or 新規作成 */
  useEffect(() => {
    (async () => {
      try {
        if (typeof window.storage === "undefined") { setLoaded(true); return; }
        let idx = null;
        try { const r = await window.storage.get(STORE_INDEX); idx = r && r.value ? JSON.parse(r.value) : null; } catch (e) {}

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
          idx = [{ id: first.id, name: first.name, createdAt: first.createdAt }];
          await window.storage.set(STORE_PROJ(first.id), JSON.stringify(first));
          await window.storage.set(STORE_INDEX, JSON.stringify(idx));
          setIndex(idx); setActiveId(first.id); setProject(first);
          setLoaded(true);
          return;
        }

        setIndex(idx);
        const firstId = idx[0].id;
        const r = await window.storage.get(STORE_PROJ(firstId));
        const data = r && r.value ? migrateProject(JSON.parse(r.value)) : newProjectData(idx[0].name);
        setActiveId(firstId); setProject(data);
      } catch (e) { console.error(e); }
      setLoaded(true);
    })();
  }, []);

  /* 案件本体の自動保存 */
  useEffect(() => {
    if (!loaded || !project) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        if (typeof window.storage !== "undefined") {
          await window.storage.set(STORE_PROJ(project.id), JSON.stringify(project));
        }
      } catch (e) { console.error("保存エラー", e); }
    }, 700);
    return () => clearTimeout(saveTimer.current);
  }, [project, loaded]);

  /* indexの保存 */
  const persistIndex = async (idx) => {
    try { if (typeof window.storage !== "undefined") await window.storage.set(STORE_INDEX, JSON.stringify(idx)); }
    catch (e) { console.error(e); }
  };

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(""), 2200); };

  /* ---- 案件操作 ---- */
  const switchProject = async (id) => {
    if (id === activeId) return;
    // 現在のを即保存
    try { if (project) await window.storage.set(STORE_PROJ(project.id), JSON.stringify(project)); } catch (e) {}
    try {
      const r = await window.storage.get(STORE_PROJ(id));
      const data = r && r.value ? migrateProject(JSON.parse(r.value)) : newProjectData("案件");
      setActiveId(id); setProject(data); setTab("script");
    } catch (e) { showToast("案件を開けませんでした"); }
  };

  const createProject = async (template = true) => {
    const n = index.length + 1;
    const data = newProjectData("案件" + n);
    if (!template) data.rows = [];
    const idx = [...index, { id: data.id, name: data.name, createdAt: data.createdAt }];
    try {
      if (project) await window.storage.set(STORE_PROJ(project.id), JSON.stringify(project));
      await window.storage.set(STORE_PROJ(data.id), JSON.stringify(data));
    } catch (e) {}
    setIndex(idx); persistIndex(idx);
    setActiveId(data.id); setProject(data); setTab("script");
    showToast("案件を作成しました");
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
      const srcIdx = index.findIndex((x) => x.id === id);
      const idx = [...index];
      idx.splice(srcIdx + 1, 0, { id: copy.id, name: copy.name, createdAt: copy.createdAt });
      await window.storage.set(STORE_PROJ(copy.id), JSON.stringify(copy));
      setIndex(idx); persistIndex(idx);
      setActiveId(copy.id); setProject(copy); setTab("script");
      showToast("案件を複製しました");
    } catch (e) { showToast("複製に失敗しました"); }
  };

  const deleteProject = async (id) => {
    if (index.length <= 1) { showToast("最後の1案件は削除できません"); return; }
    const name = (index.find((x) => x.id === id) || {}).name || "この案件";
    if (!window.confirm("「" + name + "」を削除します。元に戻せません。よろしいですか？")) return;
    const idx = index.filter((x) => x.id !== id);
    try { if (typeof window.storage !== "undefined") await window.storage.delete(STORE_PROJ(id)); } catch (e) {}
    setIndex(idx); persistIndex(idx);
    if (id === activeId) {
      const next = idx[0];
      const r = await window.storage.get(STORE_PROJ(next.id));
      setActiveId(next.id);
      setProject(r && r.value ? migrateProject(JSON.parse(r.value)) : newProjectData(next.name));
    }
    showToast("案件を削除しました");
  };

  const renameProject = (id, name) => {
    const idx = index.map((x) => (x.id === id ? { ...x, name } : x));
    setIndex(idx); persistIndex(idx);
    if (id === activeId && project) setProject((p) => ({ ...p, name }));
  };

  const fmt = (sec) => (project.timeFormat === "tc" ? fmtTC(sec) : fmtJP(sec));

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

  const { tcs, totalEst, totalTarget, totalChars, locations, sceneNos } = useMemo(() => {
    let acc = 0, tt = 0, tc = 0, no = 0;
    const tcs = {};
    const sceneNos = {};
    const locations = [];
    let cur = null;
    for (const r of project.rows) {
      tcs[r.id] = acc;
      if (r.kind === "location") {
        cur = { ...r, scenes: [], dur: 0, tcIn: acc };
        locations.push(cur);
      } else {
        no += 1;
        sceneNos[r.id] = no;
        const target = targetOf(r);
        const chars = countChars(r.script);
        const d = chars > 0 ? chars / project.rate : target;
        acc += d; tt += target; tc += chars;
        if (cur) { cur.scenes.push(r); cur.dur += d; }
      }
    }
    return { tcs, totalEst: acc, totalTarget: tt, totalChars: tc, locations, sceneNos };
  }, [project.rows, project.rate]);

  /* ---------- TSV書き出し ---------- */
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
        const t = SECTION_TYPES[r.type];
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
      const t = SECTION_TYPES[r.type];
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

      {/* ===== 案件サイドバー ===== */}
      <aside
        className="fixed top-0 left-0 h-full z-40 transition-transform duration-200 flex flex-col"
        style={{
          width: 248,
          background: "#15181D",
          color: "#fff",
          transform: sidebarOpen ? "translateX(0)" : "translateX(-248px)",
        }}>
        <div className="px-4 py-3 flex items-center gap-2 border-b border-white/10">
          <span className="font-black tracking-[0.08em] text-[14px]">ものがたりっち！</span>
        </div>
        <div className="px-3 py-2 flex gap-1.5">
          <button onClick={() => createProject(true)}
            className="flex-1 text-[11px] font-bold py-2 rounded-lg"
            style={{ background: theme.accent, color: accentText }}>
            ＋ 新規案件
          </button>
          <button onClick={() => createProject(false)} title="空の案件"
            className="text-[11px] font-bold py-2 px-2.5 rounded-lg bg-white/10 hover:bg-white/20">
            空
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {index.map((p) => {
            const active = p.id === activeId;
            return (
              <div key={p.id}
                className={"group/p rounded-lg mb-1 px-2.5 py-2 cursor-pointer transition-colors " + (active ? "" : "hover:bg-white/5")}
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
                  ) : (
                    <span className="flex-1 min-w-0 truncate text-[12.5px] font-medium"
                      onDoubleClick={(e) => { e.stopPropagation(); setRenamingId(p.id); }}>
                      {p.name}
                    </span>
                  )}
                  <div className="flex gap-0.5 opacity-0 group-hover/p:opacity-100 transition-opacity shrink-0">
                    <button title="名前変更" onClick={(e) => { e.stopPropagation(); setRenamingId(p.id); }} className="w-5 h-5 grid place-items-center rounded hover:bg-white/20 text-[10px]">✎</button>
                    <button title="複製" onClick={(e) => { e.stopPropagation(); duplicateProject(p.id); }} className="w-5 h-5 grid place-items-center rounded hover:bg-white/20 text-[10px]">⎘</button>
                    <button title="削除" onClick={(e) => { e.stopPropagation(); deleteProject(p.id); }} className="w-5 h-5 grid place-items-center rounded hover:bg-red-500/40 text-[10px]">✕</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="px-3 py-2 border-t border-white/10 text-[10px] text-white/40">
          {index.length}件の案件・自動保存
        </div>
      </aside>

      {/* サイドバー開閉オーバーレイ（モバイル） */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/30 sm:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ===== コンテンツ（サイドバー分シフト） ===== */}
      <div className="pb-28 transition-all duration-200" style={{ marginLeft: sidebarOpen ? 248 : 0 }}>

      {/* ===== ツールバー ===== */}
      <header className="sticky top-0 z-20 shadow-lg" style={{ background: theme.main, color: mainText }}>
        <div className="max-w-[1180px] mx-auto px-4 pt-2.5 pb-1.5 flex items-center gap-3 flex-wrap">
          <button onClick={() => setSidebarOpen((s) => !s)} title="案件リスト"
            className="w-8 h-8 rounded-lg grid place-items-center border border-white/20 hover:bg-white/10 shrink-0">
            <span className="text-base leading-none">☰</span>
          </button>
          <input
            value={project.name}
            onChange={(e) => renameProject(project.id, e.target.value)}
            className="bg-transparent font-bold tracking-wide text-[14px] focus:outline-none focus:bg-white/10 rounded px-1.5 py-1 min-w-0 max-w-[200px]"
            style={{ color: mainText }}
            title="案件名（クリックで編集）"
          />
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background: theme.accent }}></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: theme.accent }}></span>
          </span>
          <div className="flex-1" />
          <button
            onClick={() => setProject((p) => ({ ...p, timeFormat: p.timeFormat === "tc" ? "jp" : "tc" }))}
            title="時間表記を切り替え"
            className="text-[11px] px-2.5 py-1.5 rounded-md border border-white/20 hover:bg-white/10 tabular-nums"
            style={{ fontFamily: mono }}>
            {project.timeFormat === "tc" ? "00:00" : "0分00秒"} ⇄
          </button>
          <div className="flex items-baseline gap-1.5 px-3 py-1 rounded-lg" style={{ background: "rgba(0,0,0,0.25)", fontFamily: mono }}>
            <span className="text-[9px] tracking-widest opacity-60">TOTAL</span>
            <span className="text-xl font-bold tabular-nums leading-none">{fmt(totalEst)}</span>
            <span className="text-[10px] opacity-50">{totalChars.toLocaleString()}字</span>
          </div>
          <label className="flex items-center gap-1.5 text-[11px] opacity-80">
            <input type="number" min="3" max="8" step="0.5" value={project.rate}
              onChange={(e) => setProject((p) => ({ ...p, rate: Number(e.target.value) || 5 }))}
              className="w-12 bg-black/25 border border-white/20 rounded-md px-1.5 py-1 text-center focus:outline-none focus:border-white/60"
              style={{ fontFamily: mono, color: mainText }} />
            字/秒
          </label>
          <button onClick={() => setShowTheme((s) => !s)} title="テーマカラー変更"
            className="w-8 h-8 rounded-lg grid place-items-center border border-white/20 hover:bg-white/10 text-sm">
            🎨
          </button>
          <button onClick={tab === "script" ? exportScriptTSV : exportKoubanTSV}
            className="text-xs font-bold px-4 py-2 rounded-lg hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-white/60 shadow"
            style={{ background: theme.accent, color: accentText }}>
            {tab === "script" ? "スプシ用にコピー" : "香盤表をコピー"}
          </button>
        </div>
        {/* タブ */}
        <div className="max-w-[1180px] mx-auto px-4 flex gap-1">
          {[["script", "構成台本"], ["kouban", "香盤表"]].map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={"px-4 py-1.5 rounded-t-lg text-[12px] font-bold tracking-wider transition-colors " + (tab === k ? "" : "opacity-50 hover:opacity-80")}
              style={tab === k ? { background: "#E9E8E3", color: "#1C1C1E" } : { color: mainText }}>
              {label}
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

      <main className="max-w-[1180px] mx-auto px-3 sm:px-5 pt-5">

        {/* ================= 構成台本タブ ================= */}
        {tab === "script" && (
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
              {/* タイトル案：横一列 */}
              <div className="flex border-b border-stone-100">
                <div className="w-20 shrink-0 px-3 py-2 text-[11px] font-bold text-stone-400">タイトル案</div>
                <div className="flex-1 grid grid-cols-1 md:grid-cols-3">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className={"flex items-center " + (i > 0 ? "md:border-l border-t md:border-t-0 border-stone-100" : "")}>
                      <span className="pl-3 text-[10px] font-bold shrink-0" style={{ color: theme.accent, fontFamily: mono }}>{i + 1}</span>
                      <input className={metaInput} value={(m.titles || [])[i] || ""} placeholder={"案" + (i + 1)} onChange={(e) => setMetaArr("titles", i, e.target.value)} />
                    </div>
                  ))}
                </div>
              </div>
              {/* サムネ案：横一列 */}
              <div className="flex">
                <div className="w-20 shrink-0 px-3 py-2 text-[11px] font-bold text-stone-400">サムネ案</div>
                <div className="flex-1 grid grid-cols-1 md:grid-cols-3">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className={"flex items-center " + (i > 0 ? "md:border-l border-t md:border-t-0 border-stone-100" : "")}>
                      <span className="pl-3 text-[10px] font-bold shrink-0" style={{ color: theme.accent, fontFamily: mono }}>{i + 1}</span>
                      <input className={metaInput} value={(m.thumbs || [])[i] || ""} placeholder={"パターン" + (i + 1)} onChange={(e) => setMetaArr("thumbs", i, e.target.value)} />
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* ハイライト（独立カード） */}
            <section className={cardCls + " mb-4"}>
              {cardHead("ハイライト（冒頭フック）")}
              <ScriptCell value={m.highlight} onChange={(v) => setMeta("highlight", v)} accent={theme.accent} placeholder="冒頭フックの原稿・テロップ案など（空行でEnter → ◼︎ 自動挿入）" />
            </section>

            {/* 構成テーブル */}
            <section className={cardCls}>
              <table className="w-full border-collapse table-fixed">
                <colgroup>
                  <col style={{ width: 60 }} />
                  <col style={{ width: 150 }} />
                  <col style={{ width: 150 }} />
                  <col style={{ width: 60 }} />
                  <col style={{ width: 84 }} />
                  <col />
                  <col style={{ width: 104 }} />
                </colgroup>
                <thead>
                  <tr style={{ background: theme.main, color: mainText }}>
                    {["時間", "内容", "シーン", "秒数", "所要時間", "原稿", ""].map((h, i) => (
                      <th key={i} className="px-3 py-2 text-left text-[10px] font-bold tracking-[0.15em] whitespace-nowrap" style={{ opacity: 0.9 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {project.rows.map((r, idx) => {
                    if (r.kind === "location") {
                      return (
                        <tr key={r.id} onMouseEnter={() => setHoverId(r.id)} onMouseLeave={() => setHoverId(null)}>
                          <td colSpan={6} className="p-0 pt-2">
                            <div className="flex items-stretch overflow-hidden" style={{ background: theme.main }}>
                              <div className="w-5 shrink-0" style={{ background: stripe }} />
                              <input
                                value={r.label}
                                onChange={(e) => updateRow(r.id, { label: e.target.value })}
                                placeholder="ロケーション名（例：ご自宅）"
                                className="flex-1 bg-transparent text-[13px] font-bold tracking-[0.08em] px-3 py-2 focus:outline-none"
                                style={{ color: mainText }}
                              />
                              <span className="self-center pr-3 text-[9px] tracking-[0.2em] opacity-40" style={{ color: mainText, fontFamily: mono }}>LOCATION</span>
                            </div>
                          </td>
                          <td className="pt-2 align-middle">
                            <div className={"flex items-center justify-end gap-0.5 pr-2 transition-opacity " + (hoverId === r.id ? "opacity-100" : "opacity-0")}>
                              <button className={opBtn} title="上へ" onClick={() => moveRow(idx, -1)}>↑</button>
                              <button className={opBtn} title="下へ" onClick={() => moveRow(idx, 1)}>↓</button>
                              <button className={opBtn} title="下にシーンを追加" onClick={() => insertBelow(idx, newScene("解説系"))}>＋</button>
                              <button className={opBtn + " hover:bg-red-100 hover:text-red-500"} title="削除" onClick={() => deleteRow(r.id)}>✕</button>
                            </div>
                          </td>
                        </tr>
                      );
                    }

                    const t = SECTION_TYPES[r.type];
                    const target = targetOf(r);
                    const chars = countChars(r.script);
                    const dur = chars / project.rate;
                    const over = chars > 0 && dur > target * 1.5;
                    return (
                      <tr key={r.id}
                        onMouseEnter={() => setHoverId(r.id)} onMouseLeave={() => setHoverId(null)}
                        className="border-b border-stone-100 hover:bg-stone-50/70 transition-colors">
                        <td className="align-top pt-2.5 text-center" style={{ borderLeft: "3px solid " + t.color }}>
                          <span className="text-[11px] text-stone-400 tabular-nums whitespace-nowrap block" style={{ fontFamily: mono }}>{fmt(tcs[r.id])}</span>
                          <span className="text-[9px] text-stone-300 tabular-nums" style={{ fontFamily: mono }}>#{sceneNos[r.id]}</span>
                        </td>
                        <td className="align-top p-0">
                          <textarea
                            value={r.label}
                            onChange={(e) => updateRow(r.id, { label: e.target.value })}
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
                        <td className="align-top py-1.5 pr-2">
                          <div className={"flex items-center justify-end gap-0.5 transition-opacity " + (hoverId === r.id ? "opacity-100" : "opacity-0")}>
                            <button className={opBtn} title="上へ" onClick={() => moveRow(idx, -1)}>↑</button>
                            <button className={opBtn} title="下へ" onClick={() => moveRow(idx, 1)}>↓</button>
                            <button className={opBtn} title="下に行を追加" onClick={() => insertBelow(idx, newScene(r.type))}>＋</button>
                            <button className={opBtn + " hover:bg-red-100 hover:text-red-500"} title="削除" onClick={() => deleteRow(r.id)}>✕</button>
                          </div>
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
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </section>

            {/* Claude連携 */}
            <section className={cardCls + " mt-4"}>
              {cardHead("Claude連携 — 原稿づくりの流れ")}
              <div className="px-4 py-3 flex flex-wrap items-center gap-3">
                <button onClick={copyClaudePrompt}
                  className="text-xs font-bold px-4 py-2.5 rounded-lg shadow-sm hover:opacity-90"
                  style={{ background: theme.main, color: mainText }}>
                  ① 台本プロンプトをコピー
                </button>
                <span className="text-stone-300">→</span>
                <span className="text-[12px] text-stone-500">Claudeに貼り付け＋ヒアリング資料を追加して送信</span>
                <span className="text-stone-300">→</span>
                <button onClick={() => setShowImport(true)}
                  className="text-xs font-bold px-4 py-2.5 rounded-lg shadow-sm hover:opacity-90"
                  style={{ background: theme.accent, color: accentText }}>
                  ② Claudeの出力を取り込む
                </button>
              </div>
              <p className="px-4 pb-3 text-[11px] text-stone-400 leading-relaxed">
                プロンプトには現在の構成表（シーン番号・種別・目安文字数）と書式ルールが入っています。Claudeが【番号】形式で返した原稿を②で貼り付けると、各シーンに自動で振り分けられます。一部のシーンだけの出力でも、その番号だけ取り込まれます。
              </p>
            </section>

            <div className="mt-4 flex flex-wrap gap-2 items-center">
              <button onClick={() => setRows((rows) => [...rows, newLocation("")])}
                className="text-xs font-bold px-4 py-2 rounded-full shadow-sm hover:opacity-90"
                style={{ background: theme.main, color: mainText }}>
                ＋ ロケーション
              </button>
              {TYPE_KEYS.map((k) => (
                <button key={k} onClick={() => setRows((rows) => [...rows, newScene(k)])}
                  className="text-xs font-bold px-4 py-2 rounded-full shadow-sm hover:opacity-80"
                  style={{ background: SECTION_TYPES[k].bg, color: SECTION_TYPES[k].color }}>
                  ＋ {k}
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
              原稿セルで空行のままEnter →「◼︎ 」自動挿入　／　所要時間 ＝ 文字数 ÷ {project.rate}字/秒　／　秒数セルは行ごとに上書き可　／　自動保存
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
                  {m.shootDate || "撮影日未設定"}・{locations.length}ロケーション・本編想定 {fmt(totalEst)}
                </div>
              </div>

              <div className="px-4 sm:px-6 py-5">
                {locations.length === 0 && (
                  <p className="text-sm text-stone-400 text-center py-8">構成台本タブでロケーションを追加すると、ここに1日の流れが表示されます。</p>
                )}

                {locations.map((loc, i) => (
                  <div key={loc.id} className="relative flex gap-3 sm:gap-4">
                    {/* 縦ルート線＋番号 */}
                    <div className="flex flex-col items-center w-10 shrink-0">
                      <div className="w-9 h-9 rounded-full grid place-items-center font-bold text-[14px] shadow z-10"
                        style={{ background: theme.accent, color: accentText, fontFamily: mono }}>
                        {i + 1}
                      </div>
                      {i < locations.length - 1 && (
                        <div className="flex-1 flex flex-col items-center py-1">
                          <div className="flex-1 w-0.5 rounded" style={{ background: theme.main, opacity: 0.25 }} />
                          <span className="text-[10px] my-0.5" style={{ color: theme.main, opacity: 0.4 }}>▼</span>
                          <div className="flex-1 w-0.5 rounded" style={{ background: theme.main, opacity: 0.25 }} />
                        </div>
                      )}
                    </div>

                    {/* ロケーションカード */}
                    <div className="flex-1 mb-4 rounded-xl border border-stone-200 bg-stone-50/60 overflow-hidden group/loc">
                      <div className="flex items-stretch" style={{ background: theme.main }}>
                        <div className="w-4 shrink-0" style={{ background: stripe }} />
                        <input
                          type="time"
                          value={loc.time}
                          onChange={(e) => updateRow(loc.id, { time: e.target.value })}
                          className="bg-transparent text-[13px] font-bold px-2 py-2 w-[88px] focus:outline-none tabular-nums [color-scheme:dark]"
                          style={{ color: mainText, fontFamily: mono }}
                          title="到着・開始予定時刻"
                        />
                        <input
                          value={loc.label}
                          onChange={(e) => updateRow(loc.id, { label: e.target.value })}
                          placeholder="ロケーション名"
                          className="flex-1 min-w-0 bg-transparent text-[14px] font-bold tracking-wide px-2 py-2 focus:outline-none"
                          style={{ color: mainText }}
                        />
                        <div className="flex items-center gap-0.5 pr-2 opacity-0 group-hover/loc:opacity-100 transition-opacity">
                          <button className="w-6 h-6 grid place-items-center rounded text-[11px] hover:bg-white/15" style={{ color: mainText }} title="ロケーションごと上へ" onClick={() => moveLocationBlock(loc.id, -1)}>↑</button>
                          <button className="w-6 h-6 grid place-items-center rounded text-[11px] hover:bg-white/15" style={{ color: mainText }} title="ロケーションごと下へ" onClick={() => moveLocationBlock(loc.id, 1)}>↓</button>
                        </div>
                      </div>

                      <div className="grid sm:grid-cols-2 border-b border-stone-200/70 bg-white">
                        <div className="flex items-center sm:border-r border-stone-100">
                          <span className="pl-3 pr-1 text-[11px] shrink-0">📍</span>
                          <input
                            value={loc.address}
                            onChange={(e) => updateRow(loc.id, { address: e.target.value })}
                            placeholder="住所・集合場所"
                            className="block w-full bg-transparent text-[12px] px-1 py-2 focus:outline-none placeholder:text-stone-300"
                          />
                        </div>
                        <div className="flex items-center border-t sm:border-t-0 border-stone-100">
                          <span className="pl-3 pr-1 text-[11px] shrink-0">📝</span>
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
                          {loc.scenes.length}シーン / 想定 {fmt(loc.dur)}
                        </span>
                      </div>
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
      </main>
      </div>{/* /content wrapper */}

      {/* ===== Claude出力 取り込みモーダル ===== */}
      {showImport && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowImport(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 flex items-center justify-between" style={{ background: theme.main, color: mainText }}>
              <h3 className="text-sm font-bold tracking-wider">Claudeの出力を取り込む</h3>
              <button onClick={() => setShowImport(false)} className="w-7 h-7 rounded-lg grid place-items-center hover:bg-white/15">✕</button>
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

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 text-sm px-5 py-2.5 rounded-full shadow-xl"
          style={{ background: theme.main, color: mainText }}>
          {toast}
        </div>
      )}
    </div>
  );
}
