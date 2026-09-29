// ホーム「今日やること」（2026-09-29 AK「アドネス的な今日やるTODOチェックみたいなUI」）
// 自動：自分の番の工程で、遅れ・今日締切・あと2日以内のもの（/api/my-work の「あなたの担当」から）
// 手動：自分で足したTODO。チェックしていないものは翌日に持ち越す（Addnessの今日やることと同じ考え方）
// 保存は window.storage の "today-todo-v1"（ログイン中はアカウント別のクラウド保存）

export const TODAY_STORE = "today-todo-v1";
const ORDER = { "遅れ": 0, "今日": 1, "もうすぐ": 2 };

export function autoTodos(cases) {
  const out = [];
  for (const w of cases || []) {
    if (!w || !w.mine || !w.current || !(w.pace in ORDER)) continue;
    if (w.current.name !== w.mine.name) continue; // 前の工程待ち＝今日は手を動かせない
    const days = w.mine.days;
    out.push({
      id: `auto:${w.caseId}:${w.mine.name}:${w.mine.deadline || ""}`,
      caseId: w.caseId,
      text: `${w.title || "案件"}：${w.mine.name}を進める`,
      pace: w.pace,
      badge: w.pace === "遅れ" ? `遅れ・${Math.abs(days)}日` : w.pace === "今日" ? "今日締切" : `あと${days}日`,
      deadline: w.mine.deadline || "",
    });
  }
  return out.sort((a, b) => ORDER[a.pace] - ORDER[b.pace] || (a.deadline || "9").localeCompare(b.deadline || "9")).slice(0, 8);
}

// 日付が変わったら：手動の未完了は持ち越し、完了したものと自動のチェックは消す
export function rollover(state, today) {
  const s = state && typeof state === "object" ? state : {};
  if (s.date === today) return { date: today, manual: s.manual || [], doneAuto: s.doneAuto || {} };
  return { date: today, manual: (s.manual || []).filter((m) => !m.done).map((m) => ({ ...m, carried: true })), doneAuto: {} };
}

export function addManual(state, text, id) {
  const t = String(text || "").trim().slice(0, 200);
  if (!t) return state;
  return { ...state, manual: [...(state.manual || []), { id: id || "m" + Date.now().toString(36), text: t, done: false }] };
}

export function toggle(state, id) {
  if (String(id).startsWith("auto:")) {
    const doneAuto = { ...(state.doneAuto || {}) };
    if (doneAuto[id]) delete doneAuto[id]; else doneAuto[id] = true;
    return { ...state, doneAuto };
  }
  return { ...state, manual: (state.manual || []).map((m) => (m.id === id ? { ...m, done: !m.done } : m)) };
}

export function removeManual(state, id) {
  return { ...state, manual: (state.manual || []).filter((m) => m.id !== id) };
}

// 表示用：自動→手動の順。完了は下にまとめる
export function todoList(state, cases) {
  const auto = autoTodos(cases).map((a) => ({ ...a, auto: true, done: !!(state.doneAuto || {})[a.id] }));
  const manual = (state.manual || []).map((m) => ({ ...m, auto: false }));
  const all = [...auto, ...manual];
  return { open: all.filter((x) => !x.done), done: all.filter((x) => x.done), total: all.length };
}
