// ホーム「今日やること」（2026-09-29 AK「アドネス的な今日やるTODOチェックみたいなUI」）
// 自動：自分の番の工程で、遅れ・今日締切・あと2日以内のもの（/api/my-work の「あなたの担当」から）
// 手動：自分で足したTODO。チェックしていないものは翌日に持ち越す（Addnessの今日やることと同じ考え方）
// 保存は window.storage の "today-todo-v1"（ログイン中はアカウント別のクラウド保存）
// 手順（2026-09-29 AK「この編集の中で今どのタスクをやるか分解されてないと結局使われなくなる」）：
//   自動のTODOは工程ごとの型で手順に分け、構成台本のロケ（セクション）があれば「00 〇〇の粗カット」のように差し込む。
//   手順のチェックは日をまたいで残す（本編集は数日かかるため）。全部チェックしたら親のTODOも完了

export const TODAY_STORE = "today-todo-v1";
const ORDER = { "遅れ": 0, "今日": 1, "もうすぐ": 2 };

const S = (title, sec) => ({ title, sec });
const num = (i) => String(i).padStart(2, "0");

/* 香盤表（構成台本のロケ行）→ 手順に差し込むセクション（2026-10-02 AK「時間が分かりずらい・香盤表と連動してない」）。
   ロケ名に入っている撮影時刻（13:00〜15:00）は作業時間と見分けにくいので外し、番号は香盤表と同じものを使う */
const CLOCK_RE = /\s*[0-9０-９]{1,2}[:：][0-9０-９]{2}\s*(?:[〜~～\-ー]\s*(?:[0-9０-９]{1,2}[:：][0-9０-９]{2})?)?/g;
export function sectionsFromRows(rows) {
  const out = [];
  for (const r of rows || []) {
    if (!r) continue;
    if (r.kind === "location") {
      const label = String(r.label || "").trim();
      const m = label.match(/^\s*([0-9０-９]+(?:-[A-Za-z0-9]+)?)\s*[｜|.．、)）]?\s*(.*)$/);
      const name = ((m ? m[2] : label).replace(CLOCK_RE, " ").replace(/\s+/g, " ").trim()) || "ロケ";
      out.push({ no: m ? m[1] : num(out.length + 1), name: name.slice(0, 40), scenes: 0 });
    } else if (out.length) out[out.length - 1].scenes += 1;
  }
  return out.slice(0, 12);
}

/* 工程名 → 手順の型。sections は香盤表のロケ（{no,name,scenes}）か、Workerから来たロケ名の文字列 */
export function stepsFor(stepName, sections) {
  const secs = (sections || []).map((x, i) => (typeof x === "string" ? { no: num(i + 1), name: x.trim(), scenes: 0 } : x))
    .filter((x) => x && x.name).slice(0, 12);
  // シーン数が分かるロケは1シーンあたりの目安×シーン数（最低1シーン分）、分からなければ1ロケ分の目安
  const perSection = (verb, perScene, sec) => secs.length
    ? secs.map((x) => S(`${x.no} ${x.name}の${verb}${x.scenes ? `（${x.scenes}シーン）` : ""}`, x.scenes ? perScene * x.scenes : sec))
    : [S(`${verb}（頭から通しで）`, sec * 3)];
  const n = String(stepName || "");
  if (/粗|ラフ|仮編/.test(n)) return [
    S("素材をシーケンスにインポート", 10), S("まず最初のロケのファイルをシーケンスに並べる", 10), S("音声を同期する", 300),
    ...perSection("粗カット", 300, 1800), S("通しで見て尺をメモする", 600),
  ];
  if (/テロップ|字幕/.test(n)) return [
    S("テロップの型（フォント・色・位置）を用意する", 300), ...perSection("テロップ入れ", 200, 1200), S("誤字を読み上げて確認する", 600),
  ];
  if (/修正/.test(n)) return [
    S("指摘を1行ずつ書き出す", 180), S("該当箇所にマーカーを打つ", 300), S("指摘を上から順に直す", 1800),
    S("直した所だけ通しで確認する", 600), S("書き出して納品報告する", 600),
  ];
  if (/書き出|納品|MA|整音|カラー|色/.test(n)) return [
    S("音量をそろえる（-14LUFS目安）", 600), S("色を見直す", 900), S("書き出し設定を確認して書き出す", 900),
    S("書き出したファイルを通しで確認する", 900), S("アップロードして報告する", 300),
  ];
  if (/サムネ/.test(n)) return [S("参考サムネを3つ集める", 600), S("ラフを2案つくる", 1200), S("仕上げて書き出す", 1200)];
  if (/編集|カット/.test(n)) return [
    S("粗カットを通しで見直す", 600), ...perSection("本編集（テンポ・BGM・SE）", 400, 2400),
    S("色を揃える", 900), S("書き出してスマホで確認する", 600),
  ];
  return [S(`${n || "作業"}の段取りを3行で書く`, 300), S(`${n || "作業"}を進める`, 1800), S("見直して次の人へ渡す", 600)];
}

/* 作業にかかる目安。撮影時刻（13:00）と見間違えないよう「約1時間30分」の形で出す */
export const fmtSec = (sec) => {
  const s = Math.max(0, Math.round(sec || 0));
  if (s < 60) return `${s}秒`;
  const m = Math.round(s / 60);
  if (m < 60) return `約${m}分`;
  return `約${Math.floor(m / 60)}時間${m % 60 ? `${m % 60}分` : ""}`;
};

/* 手順の残り時間の合計 */
export const restSec = (steps) => (steps || []).reduce((a, st) => a + (st.done ? 0 : st.sec || 0), 0);

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
      steps: stepsFor(w.mine.name, w.sections),
    });
  }
  return out.sort((a, b) => ORDER[a.pace] - ORDER[b.pace] || (a.deadline || "9").localeCompare(b.deadline || "9")).slice(0, 8);
}

// 日付が変わったら：手動の未完了は持ち越し、完了したものと自動のチェックは消す。手順のチェックは残す（工程が数日かかるため）
export function rollover(state, today) {
  const s = state && typeof state === "object" ? state : {};
  const steps = s.steps || {};
  if (s.date === today) return { date: today, manual: s.manual || [], doneAuto: s.doneAuto || {}, steps };
  return { date: today, manual: (s.manual || []).filter((m) => !m.done).map((m) => ({ ...m, carried: true })), doneAuto: {}, steps };
}

/* 手順のチェック。手順を全部終えたら親のTODOも完了にする（1つでも外したら未完了に戻す） */
export function toggleStep(state, id, index, total) {
  const cur = new Set((state.steps || {})[id] || []);
  if (cur.has(index)) cur.delete(index); else cur.add(index);
  const steps = { ...(state.steps || {}), [id]: [...cur].sort((a, b) => a - b) };
  // 古いTODOの手順が溜まり続けないよう、新しい60件だけ残す
  const keys = Object.keys(steps);
  if (keys.length > 60) keys.slice(0, keys.length - 60).forEach((k) => delete steps[k]);
  const doneAuto = { ...(state.doneAuto || {}) };
  if (total && cur.size >= total) doneAuto[id] = true; else delete doneAuto[id];
  return { ...state, steps, doneAuto };
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
  const auto = autoTodos(cases).map((a) => {
    const checked = new Set((state.steps || {})[a.id] || []);
    const steps = a.steps.map((st, i) => ({ ...st, done: checked.has(i) }));
    const next = steps.find((st) => !st.done) || null;
    return { ...a, steps, next, stepsDone: steps.filter((st) => st.done).length, auto: true, done: !!(state.doneAuto || {})[a.id] };
  });
  const manual = (state.manual || []).map((m) => ({ ...m, auto: false }));
  const all = [...auto, ...manual];
  return { open: all.filter((x) => !x.done), done: all.filter((x) => x.done), total: all.length };
}
