/* ===== 台本チェック（2026-10-04 AK「構成台本の採点もできるわけだ」） =====
   構成台本を「構成のルール（tools/SCRIPT_GEN_PROMPT.md）」と「マニュアル（必ず守るルール・Claudeが1回でやること）」で採点する。
   - 機械で数えられるもの（セクション5種・秒数の目安・1秒5字の文字数・インサートの映像指示・★の数・尺）はここで即時に出す
   - 判断が要るもの（ピクサー7段・2段クライマックス・前提4CHECK・脳の順番など）は Worker の AI が採点する（CRITERIA）
   アプリと Worker の両方から読む（Node でテストできるよう純粋関数だけを置く）。 */

export const SECTION_TYPES = ["インサート", "ブリッジ", "VLOG", "解説系", "訴求"];
/* 構成のルールA の秒数の目安（範囲は目安。外れても「目安から外れている」と知らせるだけ） */
export const SECTION_RANGE = { インサート: [3, 5], ブリッジ: [5, 10], VLOG: [15, 30], 解説系: [30, 60], 訴求: [120, 180] };

/* AIが採点する項目（各0〜2点）。label は画面に出す名前、source は根拠の節 */
export const CRITERIA = [
  { key: "spine", label: "物語の骨組み", source: "マニュアル「ピクサー7段＋スパイン」", ask: "ピクサー7段（日常→喪失→敵対→気づき→戦い→喪失②→統合）の流れがあるか。シーンが「だから」で繋がるか（スパイン）。反転の主体が演者本人か" },
  { key: "climax", label: "2段クライマックス", source: "マニュアル「2段クライマックス（仕事の答え→人生の答え）」", ask: "仕事の答え→人生の答え の2段で山があるか。どのシーンが山か" },
  { key: "premise", label: "前提4CHECK", source: "マニュアル「前提4CHECK」", ask: "撮れるものになっているか／現場でしか分からない問いが残っていないか／クライマックスとCVが整合しているか／入口から最後まで同じ約束を守れているか" },
  { key: "face", label: "0問目の顔", source: "マニュアル「必ず守るルール」", ask: "0問目の顔（第一印象の一言）に合わせて描けているか。人物を実際より暗く描いていないか。前半はインパクト優先で、経歴・過去は後半か移動中に回っているか" },
  { key: "brain", label: "脳の順番", source: "構成のルール「B. 脳の順番で飽きさせない設計」", ask: "冒頭が予測→自分ごと→共感の順か。共感は長く、重い話は短く強くか。2〜3分に1回の驚き（ギャップ・意外な過去・本音）があるか。ラストが達成より安心・余韻か" },
  { key: "sections", label: "セクションの使い分け", source: "構成のルール「A. セクション5種の役割」", ask: "各シーンの type がその役割に合っているか（インサート＝映像のみ・VLOG＝人柄・解説系＝業務説明・訴求＝最も伝えたい内容・ブリッジ＝つなぎ）。動画の核が訴求にあるか" },
  { key: "drawing", label: "引き出し方", source: "構成のルール「C. 引き出し方」", ask: "核心を作業中・移動中に語らせているか。質問が素朴か（事前に知っている前提の質問になっていないか）。演者の口から情報が出るか" },
  { key: "qa", label: "質問と答えのつながり", source: "マニュアル「必ず守るルール」・構成のルール「D. 原稿の書式」", ask: "質問→答えの組がその質問の答えになっているか。次の質問が前の答えから自然に出るか。唐突な話題転換が無いか。素材に無い事実・数字・固有名詞を作っていないか" },
];

// 採点時に本人が明示する型。背骨の表示設定 mg:spineFw とは別。
export const SCRIPT_RUBRIC_VERSION = "story-type-v1";
export const SCRIPT_STORY_TYPES = [
  { value: "pixar", label: "従来基準（ピクサー7段＋スパイン）" },
  { value: "campbell", label: "キャンベル" },
  { value: "cinderella", label: "シンデレラ" },
  { value: "spine", label: "ストーリースパイン" },
];
const TYPE_DEPENDENT = new Set(["spine", "climax"]);
export function scriptRubric(storyType) {
  // 未指定の旧クライアントだけ従来基準へ。未知の明示値は拒否する。
  const value = storyType == null || storyType === "" ? "pixar" : storyType;
  const type = SCRIPT_STORY_TYPES.find((t) => t.value === value);
  if (!type) return null;
  const held = value !== "pixar";
  const criteria = held ? CRITERIA.filter((c) => !TYPE_DEPENDENT.has(c.key)).map((c) => c.key === "qa" ? {
    ...c, ask: c.ask + "。マニュアルの共通ルールとして、シーンが『だから』で繋がるか、反転の主体が演者本人かも確認する（特定の段数・段階・山の数は要求しない）",
  } : c) : CRITERIA;
  return { storyType: value, label: type.label, version: SCRIPT_RUBRIC_VERSION, held, criteria };
}

export function normalizeScriptReview(report, rubric) {
  if (!rubric) throw new Error("不明な採点型です");
  const allowed = new Set(rubric.criteria.map((c) => c.key));
  const criteria = CRITERIA.map((c) => {
    if (!allowed.has(c.key)) return { key: c.key, label: c.label, source: c.source, score: null, withheld: true, comment: "この物語タイプの正式基準が未整備のため採点保留（平均から除外）" };
    const x = (Array.isArray(report.criteria) ? report.criteria : []).find((v) => v && v.key === c.key);
    return { key: c.key, label: c.label, source: c.source, score: x && Number.isInteger(x.score) && x.score >= 0 && x.score <= 2 ? x.score : null, comment: x && typeof x.comment === "string" ? x.comment : "" };
  });
  const seen = new Set();
  const findings = (Array.isArray(report.findings) ? report.findings : []).filter((f) => {
    if (!f || !allowed.has(f.key) || !Number.isInteger(f.scene) || f.scene < 0 || !["high", "mid", "low"].includes(f.severity)) return false;
    const id = f.scene + ":" + f.key;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, 15);
  return { storyType: rubric.storyType, rubricVersion: rubric.version, rubricLabel: rubric.label,
    score: reviewScore(criteria), summary: typeof report.summary === "string" ? report.summary : "", criteria, findings,
    good: (Array.isArray(report.good) ? report.good : []).filter((g) => typeof g === "string").slice(0, 3) };
}

// 旧Workerが選択型を無視した応答は表示・保存しない。
export const matchesScriptRubric = (result, storyType) => {
  const rubric = scriptRubric(storyType);
  return !!rubric && result?.rubricVersion === rubric.version && result?.storyType === rubric.storyType;
};

const stripTags = (s) => String(s || "").replace(/<[^>]+>/g, " ");

/* 読み上げる文字数：映像指示（行全体が（…））・▶︎の狙い行・★取材の行・（笑いながら）等の補足は数えない */
export function spokenChars(script) {
  return stripTags(script).split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !/^[（(].*[）)]$/.test(l) && !/^▶/.test(l) && !/^★取材/.test(l))
    .map((l) => l.replace(/^◼\s*/, "").replace(/[（(][^（()）]*[）)]/g, ""))
    .join("").replace(/\s/g, "").length;
}
/* インサートの映像指示（（…）だけの行）の数 */
export const cutCount = (script) => stripTags(script).split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[（(].*[）)]$/.test(l)).length;
const starCount = (script) => (stripTags(script).match(/★/g) || []).length;

/* 機械で数えるチェック。project は ものがたりっちの案件データ（rows / rate / meta） */
export function mechanicalCheck(project) {
  const p = project || {};
  const rate = Number(p.rate) > 0 ? Number(p.rate) : 5;
  const items = [];
  if (p.format === "talk") return { supported: false, stats: null, items: [] };
  const scenes = (p.rows || []).filter((r) => r && r.kind === "scene");
  let totalSec = 0, stars = 0, n = 0;
  const typeCount = {};
  for (const r of scenes) {
    n++;
    const at = { scene: n, rowId: r.id || null, label: r.label || "" };
    const sec = Number(r.sec) || 0;
    totalSec += sec;
    stars += starCount(r.script);
    const t = r.type || "";
    typeCount[t] = (typeCount[t] || 0) + 1;
    if (!SECTION_TYPES.includes(t)) {
      items.push({ ...at, level: "high", rule: "構成のルール「A. セクション5種」", msg: t ? `「${t}」はセクション5種（インサート／ブリッジ／VLOG／解説系／訴求）にありません` : "セクションの種類（type）が空です" });
      continue;
    }
    const [lo, hi] = SECTION_RANGE[t];
    if (sec && (sec < lo || sec > hi)) items.push({ ...at, level: "info", rule: "構成のルール「A. セクション5種」", msg: `${t}の目安は${lo}〜${hi}秒です（今は${sec}秒）` });
    if (t === "インサート") {
      const spoken = spokenChars(r.script);
      if (spoken > 0) items.push({ ...at, level: "mid", rule: "構成のルール「A. セクション5種」", msg: "インサートは映像のみです。セリフ・ナレーションが入っています" });
      const cuts = cutCount(r.script);
      if (cuts < 3) items.push({ ...at, level: "info", rule: "構成のルール「A. セクション5種」", msg: `インサートの映像指示は3〜4カットが目安です（今は${cuts}カット）` });
      continue;
    }
    if (sec) {
      const chars = spokenChars(r.script);
      const target = sec * rate;
      if (chars < target * 0.8 || chars > target * 1.2) {
        items.push({ ...at, level: "info", rule: "構成のルール「D. 原稿の書式」", msg: `文字数の目安は${Math.round(target)}字（${sec}秒×${rate}字・±2割）です。今は${chars}字${chars < target * 0.8 ? "。足りない時は映像表現で太らせる（セリフを水増ししない）" : ""}` });
      }
    }
  }
  if (scenes.length && !typeCount["訴求"]) items.push({ scene: null, rowId: null, label: "", level: "mid", rule: "構成のルール「A. セクション5種」", msg: "訴求のシーンがありません（動画の核は訴求）" });
  const targetMin = Number(((p.meta || {}).prod || {}).targetMin) || 0;
  if (targetMin && totalSec && Math.abs(totalSec - targetMin * 60) > targetMin * 60 * 0.2) {
    items.push({ scene: null, rowId: null, label: "", level: "info", rule: "制作の情報（目標尺）", msg: `シーンの秒数の合計は${Math.round(totalSec / 60)}分で、目標の${targetMin}分から2割以上離れています` });
  }
  const roles = new Set(scenes.map((r) => r.role).filter(Boolean));
  const missing = [["digest", "ダイジェスト候補"], ["peak", "ピーク"], ["cv", "CV"]].filter(([k]) => !roles.has(k)).map(([, l]) => l);
  if (scenes.length && missing.length) items.push({ scene: null, rowId: null, label: "", level: "info", rule: "台本の役割欄", msg: `役割の印（${missing.join("・")}）が付いていません` });
  return { supported: true, stats: { scenes: scenes.length, totalSec, stars, typeCount }, items };
}

/* AIの採点（各0〜2点）を10点満点に */
export function reviewScore(criteria) {
  // score が null（台本に判断材料が無く採点しなかった項目）は平均から外す
  const xs = (criteria || []).filter((c) => c && Number.isFinite(c.score));
  if (!xs.length) return null;
  const sum = xs.reduce((a, c) => a + Math.max(0, Math.min(2, c.score)), 0);
  return Math.round((sum / (xs.length * 2)) * 100) / 10;
}

/* 機械チェックの結果を、AIに渡す文章にする */
export function mechanicalText(res) {
  if (!res || !res.supported) return "（トーク形式のため機械チェックなし）";
  const s = res.stats;
  const head = `シーン${s.scenes}・秒数の合計${Math.floor(s.totalSec / 60)}分${s.totalSec % 60}秒・★${s.stars}箇所・種類別 ` + Object.entries(s.typeCount).map(([k, v]) => `${k || "（空）"}${v}`).join(" ");
  return head + (res.items.length ? "\n" + res.items.map((i) => `・${i.scene ? "#" + i.scene + " " : ""}${i.msg}`).join("\n") : "\n・機械で数えられる点の指摘は無し");
}
