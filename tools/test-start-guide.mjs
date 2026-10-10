// はじめてガイド（src/start-guide.js）の回帰テスト
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { START_TOPICS, START_HASH, startUrl, parseStartHash, matchTopics, mediaOf } from "../src/start-guide.js";

// 項目の形：id は重複しない・手順がある・画像は実在する
const ids = new Set();
for (const t of START_TOPICS) {
  assert.ok(/^[a-z0-9-]{1,40}$/.test(t.id), t.id); assert.ok(!ids.has(t.id)); ids.add(t.id);
  assert.ok(t.title && t.summary && t.steps.length >= 2, t.id);
  if (t.image) { assert.equal(mediaOf(t.image).kind, "image"); assert.ok(existsSync(new URL("../" + t.image, import.meta.url)), "画像が無い：" + t.image); }
  if (t.video) assert.ok(mediaOf(t.video), "動画のURLが不正：" + t.id);
}
// ホームの6つのやりたいこと（構成・動画・素材・質問・新規・学習）に対応する項目がある
for (const id of ["script", "video", "assets", "ask", "new"]) assert.ok(ids.has(id), id);

// URL
assert.equal(startUrl("https://monogataritch.pages.dev", "/index.html"), "https://monogataritch.pages.dev/#start");
assert.equal(startUrl("https://x.dev/", "/app/", "video"), "https://x.dev/app/#start=video");
assert.equal(startUrl("https://x.dev", "/", "nope"), "https://x.dev/#start"); // 知らない項目は付けない
assert.deepEqual(parseStartHash("#start"), { open: true, topic: "" });
assert.deepEqual(parseStartHash("#start=ask"), { open: true, topic: "ask" });
assert.deepEqual(parseStartHash("#start=zzz"), { open: true, topic: "" });
assert.deepEqual(parseStartHash("#startup"), { open: false, topic: "" });
assert.deepEqual(parseStartHash("#creator=abc"), { open: false, topic: "" });
assert.deepEqual(parseStartHash(""), { open: false, topic: "" });
assert.equal(START_HASH, "#start");

// 質問に近い項目
assert.equal(matchTopics("動画のアップの仕方が分からない")[0].id, "video");
assert.equal(matchTopics("素材をURLで渡したい")[0].id, "assets");
assert.equal(matchTopics("台本の採点ってどこ？")[0].id, "script");
assert.equal(matchTopics("新しい案件を作りたい")[0].id, "new");
assert.deepEqual(matchTopics("ぜんぜん関係ない話"), []);
assert.deepEqual(matchTopics(""), []);
assert.ok(matchTopics("動画をアップして先方に見せたい", 2).length <= 2);

// メディアのURL：https だけ。YouTube は埋め込みに直す
assert.deepEqual(mediaOf("https://youtu.be/463JLVXupYA"), { kind: "youtube", url: "https://www.youtube-nocookie.com/embed/463JLVXupYA", watch: "https://www.youtube.com/watch?v=463JLVXupYA" });
assert.equal(mediaOf("https://www.youtube.com/watch?v=463JLVXupYA&t=3").kind, "youtube");
assert.equal(mediaOf("https://www.youtube.com/shorts/abcdefghijk").kind, "youtube");
assert.equal(mediaOf("https://www.youtube.com/watch?v=<script>"), null);
assert.equal(mediaOf("https://example.com/a.mp4").kind, "video");
assert.equal(mediaOf("https://example.com/a.png?x=1").kind, "image");
assert.equal(mediaOf("https://example.com/page").kind, "link");
assert.equal(mediaOf("guide/script.jpg").kind, "image");
assert.equal(mediaOf("javascript:alert(1)"), null);
assert.equal(mediaOf("http://example.com/a.png"), null);
assert.equal(mediaOf("guide/../secret.jpg"), null);
assert.equal(mediaOf("//evil.com/a.png"), null);
assert.equal(mediaOf(""), null);

console.log("start guide tests passed");
