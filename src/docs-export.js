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
