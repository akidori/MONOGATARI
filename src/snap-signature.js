// 共有スナップの自動再発行に使う「中身の指紋」。
//
// なぜ切り出したか: 2026-09-08、スタジアム（運命の職業）の共有ページで
// チャンネルコンセプトタブがチャンネル名しか出ない事故が起きた。手元には
// チャンネルURLと競合5件があるのに、スナップ側は空文字と空配列のままだった。
// 原因は、指紋が project だけを見ていて、別ストアにある channelInfo と
// 全体の決め事（globalManuals）の変更で再発行が走らなかったこと。
// publishShare はどちらもスナップに同梱しているので、指紋の範囲と
// 実際にスナップへ載る範囲がずれていた＝黙って古いまま、が構造的に起きていた。

// 指紋から必ず外すフィールド。共有/ライブ系は発行そのものが書き換えるので、
// 入れると再発行が自分を再発火させて無限ループになる。
export const SHARE_FIELDS = [
  "shareId", "shareToken", "shareUpToken", "shareReadToken",
  "live", "liveId", "liveToken", "collab", "collabRole", "members", "ownerEmail",
];

// チャンネル情報のうち、worker の slimCI が実際にスナップへ載せる範囲。
// icon / status / clientNotes / チャンネル共有のトークン類は載らないので入れない
// （入れると、表示に出ない値をいじるたびに無駄な再発行とKV書込が走る）。
export const CHANNEL_SNAP_FIELDS = [
  "name", "url", "concept", "target", "purpose",
  "promanUrl", "manualUrl", "checklistUrl", "competitors", "manuals",
];

export function snapshotSignature(project, channelInfo, globalManuals) {
  const content = {};
  for (const [k, v] of Object.entries(project || {})) {
    if (!SHARE_FIELDS.includes(k)) content[k] = v;
  }
  const ch = CHANNEL_SNAP_FIELDS.map((k) => (channelInfo || {})[k] ?? "");
  return JSON.stringify(content) + "|" + JSON.stringify(ch) + "|" + JSON.stringify(globalManuals || []);
}
