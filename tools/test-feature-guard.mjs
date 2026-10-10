// 消えたら困る機能の見張り（2026-10-02 AK「更新のたびによく消えるからそうならないようにして」）。
// 9/29 の merge 9577b23（画面は origin 版を採用）で、9/28 に入れた人物色・修正コメントの画像添付・
// 動画の音量・表示の拡大縮小が丸ごと消え、10/02 の本番デプロイで画面から消えた。
// npm run build の先頭で走るので、ここが落ちたらビルドもデプロイも止まる。
// 機能を本当にやめる時は、AK に確認してからこのリストを直すこと。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "monogataritch.src.jsx"), "utf8");

const MUST = [
  ["人物色の定義", "const PERSON_COLORS"],
  ["人物色の凡例（構成台本の上・名前を編集）", "人物の色</span>"],
  ["人物色を行に付ける操作", "const setPersonFor"],
  ["人物色を台本の行に出す", "personColorOf(personOfRow[r.id])"],
  ["修正コメントの画像添付", "const uploadReviewImage"],
  ["動画の音量スライダー", "const applyVol"],
  ["表示の拡大縮小（＋/−）", "const stepZoom"],
  // 2026-10-02 追加
  ["先方コメントから構成台本の場所へ移動", "jumpToRow(c.sceneId, c.sceneLabel)"],
  ["素材をURL1本で渡す／受け取りURL（/x）", "const createXfer"],
  ["アップの残り時間表示", "const mkEta"],
  ["学習タブ: 音声同期の手順", 'id: "edit-sync", title: "素材を並べて音声を合わせる"'],
  ["学習タブ: テロップを横の中央にそろえる", 'id: "telop-center"'],
  // 2026-10-06 追加
  ["編集者用リンクの前の必須6項目の警告（Issue #38）", "const guardEditorHandoff"],
  ["共有メニュー7区分：先方・演者用（範囲を絞った鍵）（Issue #37）", "const copyClientUrl"],
  ["共有メニュー「その他」：同時編集の共有", "publishShareLive()"],
  ["共有メニュー「その他」：受け渡しのカスタマイズ", "setShowHandoffEdit(true)"],
  ["共有メニュー「その他」：構成をコピー", "copyKouseiText()"],
  ["共有メニュー「その他」：動画確認・ファイル転送", "setShowMediaModal(true)"],
  // 2026-10-10 追加
  ["ホーム「何をしますか？」（構成・動画・素材・質問・新規・やり方）", "const HOME_INTENTS"],
  ["はじめてガイド（#start のURLで開く案内役）", "function StartGuide"],
  ["構成の採点（台本チェック）", "function ScriptCheckPanel"],
  ["AIの確認依頼にAKがアプリで答える", "function AgentAnswerDialog"],
];
// 一度やめたもの（AK指示で撤去済み）。戻ってきたら merge で古い画面に巻き戻った印
const MUST_NOT = [
  ["マインドマップの切替ボタン（2026-09-25 AK指示で撤去・人物色の凡例に置き換え）", '"マインドマップで見る"'],
];

const missing = MUST.filter(([, needle]) => !src.includes(needle));
const back = MUST_NOT.filter(([, needle]) => src.includes(needle));
if (missing.length || back.length) {
  console.error("✗ 消えてはいけない機能が無くなっている／撤去した機能が戻っている（merge で古い画面に巻き戻った可能性）");
  for (const [name] of missing) console.error("  消えた: " + name);
  for (const [name] of back) console.error("  戻った: " + name);
  console.error("  → git log -S で消えたコミットを探して戻す。機能を本当にやめるなら AK に確認してから tools/test-feature-guard.mjs を直す");
  process.exit(1);
}
console.log("✓ feature guard: " + MUST.length + " 機能あり");
