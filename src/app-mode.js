// URLから画面モードを一度だけ決める。
// 将来、共有編集専用ヘッダーなどを追加するときも、この判定を入口にする。
export function getAppMode(search = "", embedded = false) {
  const params = new URLSearchParams(search);
  const liveId = (params.get("live") || "").trim();
  const channelId = (params.get("ch") || "").trim();
  const isLiveEdit = liveId.length > 0;
  const isChannelEdit = channelId.length > 0;
  return {
    isEmbedded: !!embedded,
    isLiveEdit,
    isChannelEdit,
    isGuestEdit: isLiveEdit || isChannelEdit,
    showProjectNavigation: !embedded && !isLiveEdit && !isChannelEdit,
  };
}
