import assert from "node:assert/strict";
import { buildDocsExport, buildPrintHtml, docsLineFlag } from "../src/docs-export.js";

const h = {
  fmt: (s) => String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(Math.round(s) % 60).padStart(2, "0"),
  targetOf: (r) => (r.sec != null ? Number(r.sec) : 30),
  dayOf: (r) => r.day || 1,
  countChars: (s) => (s || "").replace(/\s/g, "").length,
  maxDay: 2,
  personOf: (r) => (r.person ? "専務" : ""),
};

assert.equal(docsLineFlag("◼︎ これは毎朝？"), "q");
assert.equal(docsLineFlag("★取材：（回答）"), "star");
assert.equal(docsLineFlag("（朝礼の様子）"), "dir");
assert.equal(docsLineFlag("ふつうの文"), null);

const doc = buildDocsExport({
  name: "オヤマ様 <小山専務>",
  rate: 5,
  meta: { shootDate: "10/20", place: "", titles: ["案A", "", "案B"], thumbs: [], highlight: "" },
  rows: [
    { kind: "location", id: "l1", label: "本社（朝）", day: 2, time: "10:00" },
    { kind: "scene", id: "s1", label: "朝礼・会議", type: "VLOG", sec: 30, person: "p1",
      script: "（朝礼の様子）\n\n◼︎ これは、**毎朝\nやって**るんですか？\n★取材：!!（回答）!!\n\n" },
    { kind: "scene", id: "s2", label: "移動", type: "ブリッジ", sec: 20, script: "" },
  ],
}, h);

// 見出し：案件名=h1、ロケ=h2（日・番号・時刻つき）、シーン=h3
assert.match(doc.html, /<h1[^>]*>オヤマ様 &lt;小山専務&gt;<\/h1>/);
assert.match(doc.html, /<h2[^>]*>2日目　1　本社（朝）　10:00<\/h2>/);
assert.match(doc.html, /<h3[^>]*>朝礼・会議<\/h3>/);
assert.ok(doc.html.includes("00:00　VLOG　30秒　専務"));
// 時間は原稿の文字数から進む（画面の時間と同じ計算）
assert.match(doc.html, /00:0[1-9]　ブリッジ　20秒/);
// 空の項目は出さない
assert.ok(!doc.html.includes("撮影場所"));
assert.ok(doc.html.includes("案A ／ 案B"));
// 質問は ◼ を Q. に、太字は改行をまたいでも効く、赤字は色つき、記号は残さない
assert.ok(doc.html.includes("Q. これは、<b>毎朝</b>"));
assert.ok(doc.html.includes("<b>やって</b>るんですか？"));
assert.ok(doc.html.includes('<span style="color:#DC2645;">（回答）</span>'));
assert.ok(!/\*\*|!!|◼/.test(doc.html));
assert.ok(!/\*\*|!!|◼/.test(doc.text));
// 原稿の末尾の空行は落とす
assert.ok(!doc.html.includes("&nbsp;</p><h3"));
assert.ok(doc.text.includes("Q. これは、毎朝\nやってるんですか？"));

const talk0 = { name: "トーク", format: "talk", talk: { highlight: "", intro: "こんにちは", toc: ["一つ目", ""], body: [{ heading: "", script: "本文" }], cta: "" } };
const talk = buildDocsExport(talk0, h);
assert.ok(talk.html.includes(">冒頭</h2>"));
assert.ok(talk.html.includes("<li") && talk.html.includes("一つ目"));
assert.ok(talk.html.includes(">本編1</h2>"));
assert.ok(!talk.html.includes("ハイライト") && !talk.html.includes("CTA"));

// PDF用の紙面：1枚で完結するHTML。ロケの帯・種別の色・Q.・赤字が入り、記号は残さない
const proj = { name: "オヤマ様", rate: 5, meta: { shootDate: "10/20", titles: [], thumbs: [] }, rows: [
  { kind: "location", id: "l1", label: "本社（朝）", day: 2, time: "10:00" },
  { kind: "scene", id: "s1", label: "朝礼", type: "VLOG", sec: 30, person: "p1", script: "◼︎ 毎朝ですか？\n★取材：!!（回答）!!" },
  { kind: "scene", id: "s2", label: "移動", type: "ブリッジ", sec: 20, script: "" },
] };
const pdf = buildPrintHtml(proj, { ...h, sectionOf: () => ({ color: "#D8762B", bg: "#FFF2E5", borderColor: "#F7D6B6" }) });
assert.ok(pdf.startsWith("<!doctype html>"));
assert.ok(pdf.includes("<title>オヤマ様_構成台本</title>"));
assert.ok(pdf.includes('<span class="no">1</span><span class="name">本社（朝）</span><span class="side">2日目　10:00</span>'));
assert.ok(pdf.includes("border-left-color:#D8762B"));
assert.ok(pdf.includes('<span class="ql">Q.</span>毎朝ですか？'));
assert.ok(pdf.includes('<span class="red">（回答）</span>'));
assert.ok(pdf.includes("（原稿なし）"));
assert.ok(!/\*\*|!!|◼/.test(pdf.split("</style>")[1]));
assert.ok(buildPrintHtml(talk0, h).includes("トーク台本"));

console.log("docs export tests passed");
