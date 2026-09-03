// 回帰テスト：share.html の完成動画アップ枠は、動画ゼロ（vc-player 不在）でも配線されること。
// 2026-09-03 スタジアム#10_森川さん：mountVideo が vc-player 不在で早期returnし wireVideoUpload に到達せず、
// 編集者が「ファイルを選択」しても無反応だった。配線は必ず早期returnより前に置く。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const html = await readFile(path.resolve(import.meta.dirname, "../share.html"), "utf8");
const start = html.indexOf("function mountVideo(");
assert.ok(start > 0, "mountVideo が見つからない");
const end = html.indexOf("\nfunction ", start + 10);
const body = html.slice(start, end > 0 ? end : undefined);

const wire = body.indexOf("wireVideoUpload(p, accent, main)");
const ret = body.indexOf('if(!stage) return;');
assert.ok(wire > 0, "mountVideo 内で wireVideoUpload が呼ばれていない");
assert.ok(ret > 0, "mountVideo の早期return(if(!stage) return;)が見つからない");
assert.ok(wire < ret, "wireVideoUpload が早期returnより後にある＝動画ゼロの編集者リンクでアップ枠が無反応になる");
assert.equal(body.split("wireVideoUpload(p, accent, main)").length - 1, 1, "wireVideoUpload の呼び出しが複数＝二重アップの恐れ");

// 動画ゼロ時に paneVideo がアップ枠を返すこと（枠が無ければ配線しても意味がない）
const pane = html.slice(html.indexOf("function paneVideo("), html.indexOf("\nfunction ", html.indexOf("function paneVideo(") + 10));
assert.ok(/if\(!opts\.length\)[\s\S]*videoUploadBox\(accent, main, false\)/.test(pane), "paneVideo の動画ゼロ分岐にアップ枠が無い");

// 先祖返り警告はゴミ箱入りの版を基準にしない
assert.ok(/if\(v && !v\.trashedAt\) push\(v\.createdAt\)/.test(html), "latestBoardTs がゴミ箱入りの版を基準に含めている");

console.log("share upload wiring regression tests passed");
