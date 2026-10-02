// ホーム「今日やること」（2026-09-29 AK「アドネス的な今日やるTODOチェックみたいなUI」）
// 自動：自分の番の工程で、遅れ・今日締切・あと2日以内のもの（/api/my-work の「あなたの担当」から）
// 手動：自分で足したTODO。チェックしていないものは翌日に持ち越す（Addnessの今日やることと同じ考え方）
// 保存は window.storage の "today-todo-v1"（ログイン中はアカウント別のクラウド保存）
// 手順（2026-09-29 AK「この編集の中で今どのタスクをやるか分解されてないと結局使われなくなる」）：
//   自動のTODOは工程ごとの型で手順に分け、構成台本のロケ（セクション）があれば「00 〇〇の粗カット」のように差し込む。
//   手順のチェックは日をまたいで残す（本編集は数日かかるため）。全部チェックしたら親のTODOも完了

export const TODAY_STORE = "today-todo-v1";
const ORDER = { "遅れ": 0, "今日": 1, "もうすぐ": 2 };

const S = (title, sec, key = title, legacyKey = key) => ({ title, sec, key, legacyKey });
const num = (i) => String(i).padStart(2, "0");

/* 香盤表（構成台本のロケ行）→ 手順に差し込むセクション（2026-10-02 AK「時間が分かりずらい・香盤表と連動してない」）。
   ロケ名に入っている撮影時刻（13:00〜15:00）は作業時間と見分けにくいので外し、番号は香盤表と同じものを使う */
const CLOCK_RE = /\s*[0-9０-９]{1,2}[:：][0-9０-９]{2}\s*(?:[〜~～\-ー]\s*(?:[0-9０-９]{1,2}[:：][0-9０-９]{2})?)?/g;
const LOCATION_NUMBER_RE = /^([0-9０-９]+(?:-[A-Za-z0-9]+)?)(?:\s*[｜|.．、)）]\s*|\s+)(.*)$/;
const locationName = (label, index) => {
  const clean = String(label || "").replace(CLOCK_RE, " ").replace(/\s+/g, " ").trim();
  const m = clean.match(LOCATION_NUMBER_RE);
  return { no: m ? m[1] : num(index + 1), name: ((m ? m[2] : clean).trim() || "ロケ").slice(0, 40), scenes: 0 };
};
export function sectionsFromRows(rows) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r) continue;
    if (r.kind === "location") {
      out.push({ ...(r.id ? { id: r.id } : {}), ...locationName(r.label, out.length) });
    } else if (r.kind === "scene" && out.length) out[out.length - 1].scenes += 1;
  }
  return out.slice(0, 12);
}

// 読めた空の香盤表も最新データ。古いWorkerのロケを復活させない。
// 読み取り失敗・未読込の場合だけWorkerの情報を使う。
export function linkCaseSections(cases, rowsById) {
  return (Array.isArray(cases) ? cases : []).map((c) => c && Array.isArray(rowsById?.[c.caseId])
    ? { ...c, legacySections: c.sections, sections: sectionsFromRows(rowsById[c.caseId]) } : c);
}

// effectの後片付けでキャンセルする。古い読込の返答が新しい香盤表を上書きしない。
export function loadScheduleRows(ids, loadRows, onRows) {
  let alive = true;
  if (typeof loadRows === "function") for (const id of new Set(ids || [])) {
    Promise.resolve().then(() => loadRows(id)).then((rows) => {
      if (alive && Array.isArray(rows)) onRows(id, rows);
    }).catch(() => {}); // 取得失敗は未読込のまま。空配列として扱わない。
  }
  return () => { alive = false; };
}

/* 工程名 → 手順の型。sections は香盤表のロケ（{no,name,scenes}）か、Workerから来たロケ名の文字列 */
export function stepsFor(stepName, sections) {
  const secs = (Array.isArray(sections) ? sections : []).map((x, i) => {
    if (typeof x !== "string") return x;
    return locationName(x, i);
  })
    .filter((x) => x && x.name).slice(0, 12);
  // シーン数が分かるロケは1シーンあたりの目安×シーン数（最低1シーン分）、分からなければ1ロケ分の目安
  const perSection = (verb, perScene, sec) => secs.length
    ? secs.map((x) => S(`${x.no} ${x.name}の${verb}${x.scenes ? `（${x.scenes}シーン）` : ""}`, x.scenes ? perScene * x.scenes : sec,
      `section:${x.id || `${x.no}:${x.name}`}:${verb}`, `section:${x.no}:${x.name}:${verb}`))
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
      legacySteps: Object.hasOwn(w, "legacySections") ? stepsFor(w.mine.name, w.legacySections) : null,
    });
  }
  return out.sort((a, b) => ORDER[a.pace] - ORDER[b.pace] || (a.deadline || "9").localeCompare(b.deadline || "9")).slice(0, 8);
}

// 日付が変わったら：手動の未完了は持ち越し、完了したものと自動のチェックは消す。手順のチェックは残す（工程が数日かかるため）
export function rollover(state, today) {
  const s = state && typeof state === "object" ? state : {};
  const steps = s.steps || {};
  const keyed = { stepKeys: s.stepKeys || {}, stepAutoCompleted: s.stepAutoCompleted || {},
    stepLegacyResolved: s.stepLegacyResolved || {}, stepUnchecked: s.stepUnchecked || {} };
  if (s.date === today) return { date: today, manual: s.manual || [], doneAuto: s.doneAuto || {}, steps, ...keyed };
  return { date: today, manual: (s.manual || []).filter((m) => !m.done).map((m) => ({ ...m, carried: true })), doneAuto: {}, steps, ...keyed };
}

/* 手順のチェック。手順を全部終えたら親のTODOも完了にする（1つでも外したら未完了に戻す） */
export function toggleStep(state, id, index, total, items = null) {
  // 香盤表の非同期読込やロケの追加・並べ替えで、別の手順にチェックが移らないようキーで保存する。
  // 旧データ（番号）は消さず、照合できた分だけキーへ移す。未照合は後の読込で再照合する。
  if (Array.isArray(items)) {
    if (!items[index]) return state;
    const previous = state.stepKeys?.[id];
    const legacyIndexes = (state.steps || {})[id] || [];
    const resolvedBefore = state.stepLegacyResolved?.[id];
    // 旧キー保存に照合記録が無い時は、意図的な未チェックか未照合か判別できない。
    // 元の番号は保持しつつ、自動復活はさせない（この版の新規保存は空の照合記録も必ず残す）。
    const resolved = new Set(Array.isArray(resolvedBefore) ? resolvedBefore : Array.isArray(previous) ? legacyIndexes : []);
    const cur = new Set(Array.isArray(previous) ? previous : []);
    if (items.some((st) => Object.hasOwn(st, "done"))) {
      for (const st of items) if (st.done) {
        cur.add(st.key);
        for (const i of st.legacyIndexes || []) resolved.add(i);
      }
    } else {
      for (const i of legacyIndexes) if (items[i]) { cur.add(items[i].key); resolved.add(i); }
    }
    const key = items[index].key;
    const unchecked = new Set(state.stepUnchecked?.[id] || []);
    const aliases = [key, items[index].legacyKey].filter(Boolean);
    const wasDone = typeof items[index].done === "boolean" ? items[index].done : cur.has(key);
    if (wasDone) { cur.delete(key); for (const k of aliases) unchecked.add(k); }
    else { cur.add(key); for (const k of aliases) unchecked.delete(k); }
    const stepKeys = { ...(state.stepKeys || {}), [id]: [...cur] };
    const stepLegacyResolved = { ...(state.stepLegacyResolved || {}), [id]: [...resolved] };
    const stepUnchecked = { ...(state.stepUnchecked || {}), [id]: [...unchecked] };
    const stepAutoCompleted = { ...(state.stepAutoCompleted || {}), [id]: true };
    const doneAuto = { ...(state.doneAuto || {}) };
    if (items.length && items.every((st) => cur.has(st.key) && !unchecked.has(st.key))) doneAuto[id] = true; else delete doneAuto[id];
    // 件数で古いキーを削除しない。現在の画面から外れたロケ・工程の履歴も保存する。
    return { ...state, stepKeys, stepLegacyResolved, stepUnchecked, stepAutoCompleted, doneAuto };
  }
  const cur = new Set((state.steps || {})[id] || []);
  if (cur.has(index)) cur.delete(index); else cur.add(index);
  const steps = { ...(state.steps || {}), [id]: [...cur].sort((a, b) => a - b) };
  // 旧形式からの保存でも、別の工程の履歴を件数だけで消さない。
  const doneAuto = { ...(state.doneAuto || {}) };
  if (total && cur.size >= total) doneAuto[id] = true; else delete doneAuto[id];
  return { ...state, steps, doneAuto };
}

export function addManual(state, text, id) {
  const t = String(text || "").trim().slice(0, 200);
  if (!t) return state;
  return { ...state, manual: [...(state.manual || []), { id: id || "m" + Date.now().toString(36), text: t, done: false }] };
}

export function toggle(state, id, currentDone = null) {
  if (String(id).startsWith("auto:")) {
    const doneAuto = { ...(state.doneAuto || {}) };
    if (typeof currentDone === "boolean" ? currentDone : doneAuto[id]) delete doneAuto[id]; else doneAuto[id] = true;
    const stepAutoCompleted = { ...(state.stepAutoCompleted || {}) };
    delete stepAutoCompleted[id]; // 親のチェックは利用者の明示操作として優先
    return { ...state, doneAuto, stepAutoCompleted };
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
    const keys = state.stepKeys?.[a.id];
    const keyed = Array.isArray(keys) ? new Set(keys) : null;
    const resolvedBefore = state.stepLegacyResolved?.[a.id];
    const resolved = new Set(Array.isArray(resolvedBefore) ? resolvedBefore : keyed ? checked : []);
    const unchecked = new Set(state.stepUnchecked?.[a.id] || []);
    const legacySteps = a.legacySteps || a.steps;
    const steps = a.steps.map((st) => {
      // 同名の旧手順や同名ロケが複数ある時は推測してチェックを移さない。元の番号は未照合のまま残す。
      const unique = legacySteps.filter((x) => x.legacyKey === st.legacyKey).length === 1
        && a.steps.filter((x) => x.legacyKey === st.legacyKey).length === 1;
      const legacyIndexes = unique ? [...checked].filter((i) => !resolved.has(i) && legacySteps[i]?.legacyKey === st.legacyKey) : [];
      // ID付きの明示チェックは、別の同名ロケの解除より優先。名前だけの旧チェックは解除記録で抑制する。
      const legacyDone = !unchecked.has(st.legacyKey) && ((unique && !!keyed?.has(st.legacyKey)) || legacyIndexes.length > 0);
      return { ...st, legacyIndexes, done: !unchecked.has(st.key) && (!!keyed?.has(st.key) || legacyDone) };
    });
    const next = steps.find((st) => !st.done) || null;
    const done = state.stepAutoCompleted?.[a.id] ? steps.length > 0 && steps.every((st) => st.done) : !!(state.doneAuto || {})[a.id];
    return { ...a, steps, next, stepsDone: steps.filter((st) => st.done).length, auto: true, done };
  });
  const manual = (state.manual || []).map((m) => ({ ...m, auto: false }));
  const all = [...auto, ...manual];
  return { open: all.filter((x) => !x.done), done: all.filter((x) => x.done), total: all.length };
}
