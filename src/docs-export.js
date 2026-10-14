// 構成台本を Googleドキュメント（Word・メールでも可）へ貼れる形にする。
// クリップボードに text/html で載せると、Docs側で見出し・太字・赤字がそのまま残る。
// Docsは class を捨てるので、見た目はすべて inline style で付ける。
import { buildStyledRuns } from "./inline-format.js";

const esc = (s) => (s == null ? "" : String(s)).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const Q_HEAD = /^\s*[◼■][︎️]?\s*/;

/* 行の役割。画面（構成台本の原稿欄）と同じ見分け方：q=質問 / star=★採用候補 / warn=⚠ / dir=演出・ト書き */
export function docsLineFlag(line) {
  const l = line || "";
  if (Q_HEAD.test(l)) return "q";
  if (/^\s*⚠/.test(l)) return "warn";
  if (/^\s*★/.test(l)) return "star";
  if (/^\s*[（(][^）)]*[）)]\s*$/.test(l) || /^\s*▶/.test(l)) return "dir";
  return null;
}

/* 原稿1本 → 行ごとの run 配列。**太字** と !!赤!! は改行をまたいでも効く */
function scriptLines(script) {
  const lines = [[]];
  for (const r of buildStyledRuns(script || "")) {
    if (r.marker) continue;
    r.text.split("\n").forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ text: part, bold: !!r.bold, red: !!r.red });
    });
  }
  return lines;
}

const P = "margin:0 0 4pt 0;font-size:11pt;line-height:1.6;";
const FLAG_STYLE = { q: "font-weight:700;color:#171A1F;", star: "color:#8A5A12;", warn: "color:#B45309;font-weight:700;", dir: "color:#4F6B8A;" };

function scriptHtml(script) {
  const out = [];
  for (const runs of scriptLines(script)) {
    const plain = runs.map((r) => r.text).join("");
    if (!plain.trim()) { out.push('<p style="' + P + '">&nbsp;</p>'); continue; }
    const flag = docsLineFlag(plain);
    let first = true;
    const body = runs.map((r) => {
      let t = r.text;
      if (first && flag === "q") t = t.replace(Q_HEAD, "");
      first = false;
      let h = esc(t);
      if (r.red) h = '<span style="color:#DC2645;">' + h + "</span>";
      if (r.bold) h = "<b>" + h + "</b>";
      return h;
    }).join("");
    out.push('<p style="' + P + (FLAG_STYLE[flag] || "") + '">' + (flag === "q" ? "Q. " : "") + body + "</p>");
  }
  // 末尾の空行は落とす（シーンの間が空きすぎる）
  while (out.length && out[out.length - 1].includes(">&nbsp;<")) out.pop();
  return out.join("");
}

function scriptText(script) {
  return scriptLines(script).map((runs) => {
    const plain = runs.map((r) => r.text).join("");
    return docsLineFlag(plain) === "q" ? "Q. " + plain.replace(Q_HEAD, "") : plain;
  }).join("\n").trim();
}

const H1 = "font-size:20pt;font-weight:700;margin:0 0 8pt 0;";
const H2 = "font-size:15pt;font-weight:700;margin:18pt 0 6pt 0;";
const H3 = "font-size:12pt;font-weight:700;margin:12pt 0 2pt 0;";
const SUB = "margin:0 0 6pt 0;font-size:9pt;color:#6B7280;";

/* h = { fmt, targetOf, dayOf, countChars, maxDay, personOf(row) } … アプリ本体の計算をそのまま使う */
export function buildDocsExport(project, h) {
  const p = project || {};
  const html = [], text = [];
  const title = p.name || "構成台本";
  html.push('<h1 style="' + H1 + '">' + esc(title) + "</h1>");
  text.push(title);

  if (p.format === "talk") {
    const t = p.talk || {};
    const sec = (label, body) => {
      if (!(body || "").trim()) return;
      html.push('<h2 style="' + H2 + '">' + esc(label) + "</h2>" + scriptHtml(body));
      text.push("", "■ " + label, scriptText(body));
    };
    sec("ハイライト", t.highlight);
    sec("冒頭", t.intro);
    const toc = (t.toc || []).filter((x) => x && x.trim());
    if (toc.length) {
      html.push('<h2 style="' + H2 + '">目次</h2><ol>' + toc.map((x) => '<li style="font-size:11pt;">' + esc(x) + "</li>").join("") + "</ol>");
      text.push("", "■ 目次", ...toc.map((x, i) => (i + 1) + ". " + x));
    }
    (t.body || []).forEach((b, i) => {
      const head = b.heading || "本編" + (i + 1);
      html.push('<h2 style="' + H2 + '">' + esc(head) + "</h2>" + scriptHtml(b.script));
      text.push("", "■ " + head, scriptText(b.script));
    });
    sec("CTA", t.cta);
    return { html: html.join(""), text: text.join("\n").trim() };
  }

  const m = p.meta || {};
  const metaRows = [
    ["撮影日", m.shootDate], ["撮影場所", m.place],
    ["タイトル案", (m.titles || []).filter(Boolean).join(" ／ ")],
    ["サムネ案", (m.thumbs || []).filter(Boolean).join(" ／ ")],
  ].filter(([, v]) => (v || "").toString().trim());
  metaRows.forEach(([k, v]) => {
    html.push('<p style="' + P + '"><b>' + esc(k) + "：</b>" + esc(v) + "</p>");
    text.push(k + "：" + v);
  });
  if ((m.highlight || "").trim()) {
    html.push('<h2 style="' + H2 + '">ハイライト</h2>' + scriptHtml(m.highlight));
    text.push("", "■ ハイライト", scriptText(m.highlight));
  }

  let acc = 0, locNo = 0;
  for (const r of p.rows || []) {
    if (r.kind === "location") {
      locNo++;
      const head = [h.maxDay > 1 ? h.dayOf(r) + "日目" : "", String(locNo), r.label || "（ロケ名未入力）", r.time || ""].filter(Boolean).join("　");
      html.push('<h2 style="' + H2 + '">' + esc(head) + "</h2>");
      text.push("", "", "■ " + head);
      continue;
    }
    const target = h.targetOf(r), chars = h.countChars(r.script);
    const who = h.personOf ? h.personOf(r) : "";
    const sub = [h.fmt(acc), r.type || "", target + "秒", who].filter(Boolean).join("　");
    html.push('<h3 style="' + H3 + '">' + esc(r.label || "（無題）") + '</h3><p style="' + SUB + '">' + esc(sub) + "</p>" + scriptHtml(r.script));
    text.push("", "【" + (r.label || "（無題）") + "】" + sub, scriptText(r.script));
    acc += chars > 0 ? chars / (p.rate || 5) : target;
  }
  return { html: html.join(""), text: text.join("\n").trim() };
}

/* ---------- PDF用（印刷ダイアログから「PDFに保存」） ----------
   画面の構成台本に寄せた紙面：ロケ=濃い帯、シーン=種別色の左線＋時間・種別・秒数、原稿は太字・赤字・Q.つき。
   h は buildDocsExport と同じ＋ sectionOf（種別の色）。返すのは1枚で完結するHTML文書 */
const PRINT_FLAG = { q: "q", star: "star", warn: "warn", dir: "dir" };
function scriptPrintHtml(script) {
  const out = [];
  for (const runs of scriptLines(script)) {
    const plain = runs.map((r) => r.text).join("");
    if (!plain.trim()) { out.push('<p class="gap"></p>'); continue; }
    const flag = docsLineFlag(plain);
    let first = true;
    const body = runs.map((r) => {
      let t = r.text;
      if (first && flag === "q") t = t.replace(Q_HEAD, "");
      first = false;
      let x = esc(t);
      if (r.red) x = '<span class="red">' + x + "</span>";
      if (r.bold) x = "<b>" + x + "</b>";
      return x;
    }).join("");
    out.push('<p class="' + (PRINT_FLAG[flag] || "") + '">' + (flag === "q" ? '<span class="ql">Q.</span>' : "") + body + "</p>");
  }
  while (out.length && out[out.length - 1] === '<p class="gap"></p>') out.pop();
  return out.join("");
}

const PRINT_CSS = `
@page { size: A4; margin: 14mm 13mm 15mm; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; padding: 0; }
body { font-family: "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP", Meiryo, sans-serif; color: #171A1F; font-size: 10.5pt; line-height: 1.7; }
h1 { font-size: 18pt; margin: 0 0 2mm; line-height: 1.35; }
.kind { font-size: 8.5pt; color: #6B7280; letter-spacing: .12em; margin: 0 0 1mm; }
.meta { margin: 3mm 0 0; padding: 3mm 4mm; background: #F5F6F8; border-radius: 2mm; font-size: 9.5pt; }
.meta div { display: flex; gap: 3mm; }
.meta b { flex: 0 0 5.5em; color: #4B5563; }
.sec { font-size: 9pt; font-weight: 700; color: #6B7280; letter-spacing: .1em; margin: 6mm 0 1.5mm; }
.loc { display: flex; align-items: center; gap: 4mm; margin: 7mm 0 3mm; padding: 2.5mm 4mm; background: #1D2330; color: #fff; border-radius: 2mm; break-after: avoid; break-inside: avoid; }
.loc .no { font-size: 15pt; font-weight: 800; font-variant-numeric: tabular-nums; }
.loc .name { flex: 1; font-size: 12pt; font-weight: 700; }
.loc .side { font-size: 9pt; font-weight: 700; opacity: .85; white-space: nowrap; }
.scene { margin: 0 0 3.5mm; padding: 0 0 0 4mm; border-left: 1.1mm solid #999; }
.shead { break-after: avoid; break-inside: avoid; }
.sinfo { display: flex; align-items: center; gap: 2.5mm; font-size: 8.5pt; color: #6B7280; font-variant-numeric: tabular-nums; }
.chip { font-weight: 700; padding: 0 2.2mm; border-radius: 3mm; border: .25mm solid; line-height: 1.55; }
.who { font-weight: 700; }
.sname { font-size: 11.5pt; font-weight: 700; margin: .5mm 0 1mm; }
.script p { margin: 0; orphans: 2; widows: 2; }
.script p.gap { height: 1.1em; }
.script p.q { font-weight: 700; margin-top: .6mm; }
.script .ql { color: #347ED6; margin-right: 1.5mm; }
.script p.star { color: #8A5A12; }
.script p.warn { color: #B45309; font-weight: 700; }
.script p.dir { color: #4F6B8A; }
.script .red { color: #DC2645; }
.empty { color: #9CA3AF; font-size: 9pt; }
ol { margin: 0; padding-left: 1.6em; }
`;

export function buildPrintHtml(project, h) {
  const p = project || {};
  const title = p.name || "構成台本";
  const b = [];
  b.push('<p class="kind">' + (p.format === "talk" ? "トーク台本" : "構成台本") + "</p><h1>" + esc(title) + "</h1>");

  if (p.format === "talk") {
    const t = p.talk || {};
    const sec = (label, body) => { if ((body || "").trim()) b.push('<div class="loc"><span class="name">' + esc(label) + '</span></div><div class="script">' + scriptPrintHtml(body) + "</div>"); };
    sec("ハイライト", t.highlight);
    sec("冒頭", t.intro);
    const toc = (t.toc || []).filter((x) => x && x.trim());
    if (toc.length) b.push('<div class="loc"><span class="name">目次</span></div><ol>' + toc.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ol>");
    (t.body || []).forEach((x, i) => b.push('<div class="loc"><span class="no">' + (i + 1) + '</span><span class="name">' + esc(x.heading || "本編" + (i + 1)) + '</span></div><div class="script">' + scriptPrintHtml(x.script) + "</div>"));
    sec("CTA", t.cta);
  } else {
    const m = p.meta || {};
    const metaRows = [
      ["撮影日", m.shootDate], ["撮影場所", m.place],
      ["タイトル案", (m.titles || []).filter(Boolean).join(" ／ ")],
      ["サムネ案", (m.thumbs || []).filter(Boolean).join(" ／ ")],
    ].filter(([, v]) => (v || "").toString().trim());
    if (metaRows.length) b.push('<div class="meta">' + metaRows.map(([k, v]) => "<div><b>" + esc(k) + "</b><span>" + esc(v) + "</span></div>").join("") + "</div>");
    if ((m.highlight || "").trim()) b.push('<p class="sec">ハイライト</p><div class="script">' + scriptPrintHtml(m.highlight) + "</div>");

    let acc = 0, locNo = 0;
    for (const r of p.rows || []) {
      if (r.kind === "location") {
        locNo++;
        const side = [h.maxDay > 1 ? h.dayOf(r) + "日目" : "", r.time || ""].filter(Boolean).join("　");
        b.push('<div class="loc"><span class="no">' + locNo + '</span><span class="name">' + esc(r.label || "（ロケ名未入力）") + "</span>" + (side ? '<span class="side">' + esc(side) + "</span>" : "") + "</div>");
        continue;
      }
      const t = (h.sectionOf && h.sectionOf(r.type)) || {};
      const target = h.targetOf(r), chars = h.countChars(r.script);
      const who = h.personOf ? h.personOf(r) : "";
      const body = scriptPrintHtml(r.script);
      b.push('<div class="scene" style="border-left-color:' + (t.color || "#999") + '"><div class="shead"><div class="sinfo"><span>' + esc(h.fmt(acc)) + "</span>"
        + (r.type ? '<span class="chip" style="color:' + (t.color || "#555") + ";background:" + (t.bg || "#fff") + ";border-color:" + (t.borderColor || "#ddd") + '">' + esc(r.type) + "</span>" : "")
        + "<span>" + target + "秒</span>" + (who ? '<span class="who">' + esc(who) + "</span>" : "") + "</div>"
        + '<div class="sname">' + esc(r.label || "（無題）") + '</div></div><div class="script">' + (body || '<p class="empty">（原稿なし）</p>') + "</div></div>");
      acc += chars > 0 ? chars / (p.rate || 5) : target;
    }
  }
  return '<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>' + esc(title) + "_構成台本</title><style>" + PRINT_CSS + "</style></head><body>" + b.join("") + "</body></html>";
}
