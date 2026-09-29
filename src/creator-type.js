// クリエイタータイプ診断（2026-09-29 AK「編集の時間とかを把握するために、クリエイタータイプ診断をものがたりっちに搭載」）
// 回答 → タイプ（4軸）・工程ごとの目安時間・作業の流れの提案 → 納期から逆算した作業予定 → .ics（Googleカレンダーに取り込める）。
// 生年月日・性別は聞かない（作業時間の見積もりに使い道が無く、個人情報を預かるだけになるため。AK了承済み）。
// 軸は MBTI の設問を流用せず、作業の仕方に直結する4つ（時間帯＝朝型/夜型の研究、集中の取り方、着手の早さ、仕上げの粘り）で自前に作った。

export const CREATOR_STEPS = [
  { key: "kousei", label: "構成", mind: "think" },
  { key: "ara", label: "あら編集", mind: "flow" },
  { key: "telop", label: "テロップ入力", mind: "routine" },
  { key: "enshutsu", label: "演出", mind: "think" },
  { key: "final", label: "最終調整", mind: "check" },
];

export const CREATOR_SKILLS = ["インタビュー・密着", "VLOG", "解説・教育", "エンタメ・バラエティ", "広告・PR", "ショート動画", "テロップデザイン", "モーション・アニメ", "カラー・色味", "音・BGM選び", "サムネ"];

// 5段階（-2 そう思わない 〜 +2 そう思う）。pole は +2 の時に寄る側
export const CREATOR_QUESTIONS = [
  { id: "t1", axis: "time", pole: "朝", text: "頭がいちばん冴えるのは午前中だ" },
  { id: "t2", axis: "time", pole: "夜", text: "夜22時を過ぎてからのほうが作業がはかどる" },
  { id: "t3", axis: "time", pole: "朝", text: "休みの日も、わりと早く起きる" },
  { id: "f1", axis: "focus", pole: "まとめて", text: "一度始めたら2〜3時間ぶっ通しで作業したい" },
  { id: "f2", axis: "focus", pole: "細切れ", text: "15〜30分のすき間時間でも作業を進められる" },
  { id: "f3", axis: "focus", pole: "まとめて", text: "作業を途中で止めると、戻るのに時間がかかる" },
  { id: "s1", axis: "start", pole: "前倒し", text: "素材が届いたら、その日のうちに手をつける" },
  { id: "s2", axis: "start", pole: "締切", text: "締切が近いほうが集中できる" },
  { id: "s3", axis: "start", pole: "前倒し", text: "納期の前日には完成させておきたい" },
  { id: "p1", axis: "polish", pole: "こだわり", text: "細部が気になって、同じ所を何度も直してしまう" },
  { id: "p2", axis: "polish", pole: "スピード", text: "7割の出来でまず出して、修正で詰めるほうが好き" },
  { id: "p3", axis: "polish", pole: "こだわり", text: "自分が納得するまで提出したくない" },
];

export const CREATOR_AXES = {
  time: ["朝", "夜"],
  focus: ["まとめて", "細切れ"],
  start: ["前倒し", "締切"],
  polish: ["こだわり", "スピード"],
};

// 軸ごとに、1つ目の極を +、2つ目の極を − とした合計（各軸 -6〜+6）
export function axisScores(answers) {
  const a = answers || {};
  const out = { time: 0, focus: 0, start: 0, polish: 0 };
  for (const q of CREATOR_QUESTIONS) {
    const v = Number(a[q.id]);
    if (!Number.isFinite(v)) continue;
    const sign = q.pole === CREATOR_AXES[q.axis][0] ? 1 : -1;
    out[q.axis] += sign * Math.max(-2, Math.min(2, v));
  }
  return out;
}

// どちらにも寄っていない（|点| が1以下）軸は「中間」
export function axisPoles(scores) {
  const out = {};
  for (const k of Object.keys(CREATOR_AXES)) {
    const s = scores[k] || 0;
    out[k] = s >= 2 ? CREATOR_AXES[k][0] : s <= -2 ? CREATOR_AXES[k][1] : "中間";
  }
  return out;
}

const TYPES = {
  "まとめて/前倒し": { name: "先行ダイブ型", catch: "素材が来たら、まとまった時間で一気に潜る", good: "早めに大きく進むので、納期前に見直す余裕が生まれる", watch: "最初に飛ばしすぎて、後半の最終調整が雑になりやすい" },
  "まとめて/締切": { name: "一撃集中型", catch: "締切前に、まとめて爆発的に仕上げる", good: "短期間の集中力が高く、勢いのある編集になる", watch: "1回詰まると取り返せない。自分締切を本当の納期より前に置くのが命綱" },
  "細切れ/前倒し": { name: "コツコツ積み上げ型", catch: "すき間時間を積み上げて、早めに終わらせる", good: "予定が崩れにくく、急な修正にも対応しやすい", watch: "流れを通しで見る時間が取れず、全体のテンポを見落としやすい" },
  "細切れ/締切": { name: "すき間スプリント型", catch: "細かい時間を締切に向けて一気に回す", good: "本業・副業の合間でも回せる機動力がある", watch: "直前に時間が足りなくなりやすい。工程ごとに小さな締切を置く" },
};

export function creatorType(answers) {
  const scores = axisScores(answers);
  const poles = axisPoles(scores);
  // 中間の軸は、点の符号で寄せる（0 はまとめて・前倒し側＝安全側）
  const focus = poles.focus !== "中間" ? poles.focus : (scores.focus < 0 ? "細切れ" : "まとめて");
  const start = poles.start !== "中間" ? poles.start : (scores.start < 0 ? "締切" : "前倒し");
  const t = TYPES[focus + "/" + start];
  const tags = [];
  if (poles.time !== "中間") tags.push(poles.time + "型");
  if (poles.polish !== "中間") tags.push(poles.polish === "こだわり" ? "仕上げこだわり" : "スピード重視");
  return { ...t, key: focus + "/" + start, focus, start, scores, poles, tags };
}

// 作業の時間帯：朝型→午前、夜型→夜、中間→午後
export function peakSlot(poles) {
  if (poles.time === "朝") return { label: "午前", hour: 9 };
  if (poles.time === "夜") return { label: "夜", hour: 21 };
  return { label: "午後", hour: 14 };
}

// 1回の作業の長さ（時間）。まとめて型は集中が続く長さ（上限3時間）、細切れ型は30分〜1時間
export function blockHours(profile, type) {
  const focusMin = Number(profile && profile.focusMin) || 60;
  if (type.focus === "細切れ") return Math.max(0.5, Math.min(1, focusMin / 60));
  return Math.max(1, Math.min(3, focusMin / 60));
}

// 余裕の上乗せ：締切型 +15%、こだわり +20%（両方なら足す）
export function bufferRate(type) {
  let r = 0;
  if (type.start === "締切") r += 0.15;
  if (type.poles.polish === "こだわり") r += 0.2;
  return r;
}

const round1 = (x) => Math.round(x * 10) / 10;

// 動画1本あたりの工程ごとの時間（回答は「10分の動画で何時間」）
export function estimateHours(profile, minutes, type) {
  const scale = (Number(minutes) || 10) / 10;
  const buf = type ? bufferRate(type) : 0;
  const steps = CREATOR_STEPS.map((s) => {
    const base = Number(profile && profile.steps && profile.steps[s.key] && profile.steps[s.key].hours) || 0;
    const hours = round1(base * scale * (1 + buf));
    return { ...s, base, hours };
  });
  const total = round1(steps.reduce((n, s) => n + s.hours, 0));
  return { steps, total, buffer: buf };
}

// 工程ごとの助言（好き度合い・時間・タイプから）
export function stepAdvice(profile, type) {
  const slot = peakSlot(type.poles);
  const out = [];
  for (const s of CREATOR_STEPS) {
    const st = (profile && profile.steps && profile.steps[s.key]) || {};
    const like = Number(st.like) || 3;
    const tips = [];
    if (s.mind === "think") tips.push(`頭を使う工程なので、いちばん冴える${slot.label}に置く`);
    if (s.mind === "routine") tips.push(type.focus === "細切れ" ? "すき間時間に回しやすい工程。30分ずつ進める" : "単純作業なので、疲れている時間帯や作業の終わりに回す");
    if (s.mind === "flow" && type.focus === "まとめて") tips.push("流れを通しで見たいので、まとまった時間を確保する");
    if (s.mind === "flow" && type.focus === "細切れ") tips.push("区切りのいい場面ごとに進め、最後に一度だけ通しで見る");
    if (s.mind === "check") tips.push(type.poles.polish === "こだわり" ? "直し始めると終わらないので、先に時間の上限を決める" : "一晩寝かせてから見ると、見落としに気づきやすい");
    if (like <= 2) tips.push("苦手な工程。好きな工程の直後に置いて勢いで進めるか、得意な人との分担をAKに相談する");
    if (like >= 4) tips.push("好きな工程。やる気が落ちた日のスタートに使える");
    out.push({ ...s, like, hours: Number(st.hours) || 0, tips });
  }
  return out;
}

const pad = (n) => String(n).padStart(2, "0");
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ""); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };

// その日に使える作業時間
export function hoursOn(profile, date) {
  const av = (profile && profile.avail) || {};
  const dow = date.getDay();
  if ((av.offDays || []).includes(dow)) return 0;
  const weekend = dow === 0 || dow === 6;
  return Number(weekend ? av.weekend : av.weekday) || 0;
}

// 納期から逆算した作業予定。開始日から、使える時間に工程を順番に詰める。
// 自分締切＝納期の前日（締切型は2日前）。最終調整はできれば自分締切までに終える。
export function buildPlan(profile, { minutes, start, due }, type) {
  const est = estimateHours(profile, minutes, type);
  const startD = parseYmd(start);
  const dueD = parseYmd(due);
  if (!startD || !dueD || dueD < startD) return { est, days: [], shortBy: est.total, selfDue: null, ok: false, error: "開始日と納期を正しく入れてください" };
  const selfDue = new Date(dueD);
  selfDue.setDate(selfDue.getDate() - (type.start === "締切" ? 2 : 1));
  const lastDay = selfDue < startD ? dueD : selfDue;
  const block = blockHours(profile, type);
  const slot = peakSlot(type.poles);
  const queue = est.steps.filter((s) => s.hours > 0).map((s) => ({ key: s.key, label: s.label, left: s.hours }));
  const days = [];
  for (let d = new Date(startD); d <= lastDay && queue.length; d.setDate(d.getDate() + 1)) {
    let cap = hoursOn(profile, d);
    const items = [];
    while (cap > 0.001 && queue.length) {
      const q = queue[0];
      // 残りが15分以下なら、細切れを残さずその日に入れ切る（使える時間を少しだけ超える）
      const h = round1(q.left - cap <= 0.25 ? q.left : cap);
      if (h <= 0) break;
      items.push({ key: q.key, label: q.label, hours: h });
      q.left = round1(q.left - h);
      cap = round1(cap - h);
      if (q.left <= 0.001) queue.shift();
    }
    if (items.length) days.push({ date: ymd(d), items, slot: slot.label, hour: slot.hour });
  }
  const shortBy = round1(queue.reduce((n, q) => n + q.left, 0));
  return { est, days, shortBy, selfDue: ymd(lastDay), ok: shortBy <= 0, block };
}

// .ics（Googleカレンダーの「インポート」で取り込める）。時刻は日本時間 → UTC に直して書く
export function planToIcs(plan, title) {
  const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/[,;]/g, (m) => "\\" + m).replace(/\n/g, "\\n");
  const utc = (dateStr, hourFloat) => {
    const d = parseYmd(dateStr);
    const ms = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) + (hourFloat - 9) * 3600000;
    const u = new Date(ms);
    return `${u.getUTCFullYear()}${pad(u.getUTCMonth() + 1)}${pad(u.getUTCDate())}T${pad(u.getUTCHours())}${pad(u.getUTCMinutes())}00Z`;
  };
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//monogataritch//creator-plan//JA", "CALSCALE:GREGORIAN"];
  let n = 0;
  for (const day of plan.days) {
    let h = day.hour;
    for (const it of day.items) {
      n++;
      lines.push("BEGIN:VEVENT", `UID:mg-plan-${day.date}-${n}@monogataritch`, `DTSTAMP:${utc(day.date, 9)}`,
        `DTSTART:${utc(day.date, h)}`, `DTEND:${utc(day.date, h + it.hours)}`,
        `SUMMARY:${esc((title ? title + "｜" : "") + it.label)}`, `DESCRIPTION:${esc("ものがたりっち クリエイタータイプ診断の作業予定（" + it.hours + "時間）")}`, "END:VEVENT");
      h += it.hours;
    }
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

export function profileComplete(p) {
  if (!p) return false;
  const answered = CREATOR_QUESTIONS.every((q) => Number.isFinite(Number((p.answers || {})[q.id])) && (p.answers || {})[q.id] !== "" && (p.answers || {})[q.id] != null);
  const steps = CREATOR_STEPS.every((s) => p.steps && p.steps[s.key] && Number(p.steps[s.key].hours) > 0 && Number(p.steps[s.key].like) >= 1);
  const avail = p.avail && (Number(p.avail.weekday) > 0 || Number(p.avail.weekend) > 0);
  return answered && steps && !!avail;
}

// ===== プロフィール共有・ポートフォリオ（2026-09-29 AK「ポートフォリオとかも回答してもらって、このURLと募集文を渡したらこの人のことがわかるように」）=====
// 共有URLは回答を圧縮して URL の # 以降に入れる（# 以降はサーバーに送られない＝ものがたりっち側に保存しない）。
// Worker の再デプロイ後は短いURL（サーバー保存・AIがそのまま読める形）に切り替える予定。

export const CREATOR_SOFTWARE = ["Premiere Pro", "After Effects", "Final Cut Pro", "DaVinci Resolve", "CapCut", "Photoshop", "Illustrator", "Canva"];
export const CREATOR_YEARS = ["半年未満", "半年〜1年", "1〜3年", "3年以上"];
export const PORTFOLIO_ROLES = ["撮影", "構成", "あら編集", "テロップ", "演出", "最終調整", "サムネ", "全部"];

// http(s) 以外（javascript: 等）は捨てる
export function safeUrl(u) {
  const s = String(u || "").trim();
  if (!s) return "";
  try { const x = new URL(/^https?:\/\//i.test(s) ? s : "https://" + s); return x.protocol === "https:" || x.protocol === "http:" ? x.href : ""; } catch (e) { return ""; }
}

// 共有に載せる項目だけを抜き出す（作業しない曜日などもそのまま。回答12問は結果を再計算するため載せる）
export function publicProfile(p) {
  const clip = (s, n) => String(s || "").slice(0, n);
  return {
    v: 1,
    name: clip(p.name, 40), bio: clip(p.bio, 400), years: clip(p.years, 20), contact: safeUrl(p.contact),
    work: clip(p.work, 20), skills: (p.skills || []).slice(0, 20), software: (p.software || []).slice(0, 12),
    focusMin: Number(p.focusMin) || 60, answers: p.answers || {},
    steps: Object.fromEntries(CREATOR_STEPS.map((s) => { const st = (p.steps || {})[s.key] || {}; return [s.key, { like: Number(st.like) || 0, hours: Number(st.hours) || 0 }]; })),
    avail: { weekday: Number(p.avail && p.avail.weekday) || 0, weekend: Number(p.avail && p.avail.weekend) || 0, offDays: (p.avail && p.avail.offDays) || [] },
    portfolio: (p.portfolio || []).map((w) => ({ url: safeUrl(w.url), title: clip(w.title, 60), roles: (w.roles || []).slice(0, 8), note: clip(w.note, 120) })).filter((w) => w.url).slice(0, 10),
    updatedAt: p.updatedAt || Date.now(),
  };
}

const b64u = {
  enc: (bytes) => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); },
  dec: (str) => { const s = atob(str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4)); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; },
};
async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}
export async function encodeProfile(p) {
  const json = new TextEncoder().encode(JSON.stringify(publicProfile(p)));
  return b64u.enc(await pipe(json, new CompressionStream("deflate-raw")));
}
export async function decodeProfile(code) {
  const bytes = await pipe(b64u.dec(String(code || "")), new DecompressionStream("deflate-raw"));
  return publicProfile(JSON.parse(new TextDecoder().decode(bytes)));
}

// 1か月（4.3週）で作れる本数の目安
export function weeklyHours(p) {
  let n = 0;
  for (let dow = 0; dow < 7; dow++) n += hoursOn(p, new Date(2026, 0, 4 + dow));
  return n;
}
export function monthlyCapacity(p, minutes, type) {
  const per = estimateHours(p, minutes, type).total;
  if (!per) return 0;
  return Math.floor(((weeklyHours(p) * 4.3) / per) * 10) / 10;
}

const SKILL_WORDS = {
  "インタビュー・密着": ["インタビュー", "密着", "ドキュメンタリー", "対談"],
  "VLOG": ["vlog", "ブイログ", "日常"],
  "解説・教育": ["解説", "教育", "ノウハウ", "セミナー", "講座"],
  "エンタメ・バラエティ": ["エンタメ", "バラエティ", "企画"],
  "広告・PR": ["広告", "pr", "cm", "プロモーション", "採用動画", "企業"],
  "ショート動画": ["ショート", "shorts", "リール", "tiktok", "縦型"],
  "テロップデザイン": ["テロップ", "字幕"],
  "モーション・アニメ": ["モーション", "アニメーション", "motion"],
  "カラー・色味": ["カラー", "色調", "グレーディング", "色味"],
  "音・BGM選び": ["bgm", "音響", "効果音", "ミックス", "se"],
  "サムネ": ["サムネ", "サムネイル"],
};

// 募集文との照らし合わせ（キーワードと数字だけの機械的な判定。最終判断は人かAI）
export function matchPosting(p, text) {
  const t = String(text || "");
  const low = t.toLowerCase();
  const type = creatorType(p.answers);
  const lines = [];
  const hit = (words) => words.some((w) => (/^[a-z]+$/.test(w) ? new RegExp("(^|[^a-z])" + w + "([^a-z]|$)").test(low) : low.includes(w.toLowerCase())));
  for (const [skill, words] of Object.entries(SKILL_WORDS)) {
    if (!hit(words)) continue;
    lines.push((p.skills || []).includes(skill) ? { ok: "○", text: `募集に「${skill}」の要素があり、得意分野に入っています` } : { ok: "△", text: `募集に「${skill}」の要素がありますが、得意分野には入っていません` });
  }
  for (const sw of CREATOR_SOFTWARE) {
    if (!low.includes(sw.toLowerCase())) continue;
    lines.push((p.software || []).includes(sw) ? { ok: "○", text: `${sw} を使えます` } : { ok: "×", text: `募集に ${sw} とありますが、使えるソフトに入っていません` });
  }
  const mm = /(\d+(?:\.\d+)?)\s*分/.exec(t);
  const minutes = mm ? Number(mm[1]) : null;
  if (minutes && minutes <= 180) {
    const per = estimateHours(p, minutes, type).total;
    const wk = weeklyHours(p);
    lines.push({ ok: "・", text: `${minutes}分の動画1本で約${per}時間（本人の申告から）。週${wk}時間使えるので、1本におよそ${wk ? Math.ceil((per / wk) * 7) : "—"}日` });
  }
  const mc = /月\s*(\d+)\s*本/.exec(t);
  if (mc) {
    const need = Number(mc[1]);
    const cap = monthlyCapacity(p, minutes || 10, type);
    lines.push(cap >= need ? { ok: "○", text: `月${need}本に対して、目安は月${cap}本（${minutes || 10}分の動画で計算）` } : { ok: "×", text: `月${need}本に対して、目安は月${cap}本で足りない可能性（${minutes || 10}分の動画で計算）` });
  }
  if (/(急ぎ|短納期|即日|翌日納品|スピード)/.test(t)) lines.push(type.start === "締切" || type.poles.polish === "スピード" ? { ok: "○", text: "急ぎ・短納期の募集で、締切で加速する／スピード重視のタイプ" } : { ok: "△", text: "急ぎ・短納期の募集。前倒しで進めるタイプなので、素材が早く届けば対応しやすい" });
  if (/(丁寧|クオリティ|高品質|こだわ)/.test(t)) lines.push(type.poles.polish === "こだわり" ? { ok: "○", text: "品質重視の募集で、仕上げにこだわるタイプ" } : { ok: "・", text: "品質重視の募集。仕上げはスピード寄りのタイプなので、確認の回数を決めておくと安心" });
  if (/(平日|日中|昼間)/.test(t) && Number(p.avail && p.avail.weekday) < 3) lines.push({ ok: "△", text: `募集に平日・日中の記述があります。平日の作業時間は1日${Number(p.avail && p.avail.weekday) || 0}時間` });
  return { lines, minutes, type };
}

// Claude などに貼る文（プロフィール＋募集文）
export function profilePrompt(p, posting) {
  const type = creatorType(p.answers);
  const est = estimateHours(p, 10, type);
  const L = [];
  L.push("次の動画編集者のプロフィールと募集文を読んで、この人が募集に合うか・強み・確認したほうがいい点を、根拠つきで短くまとめてください。プロフィールに無いことは推測で埋めないでください。", "");
  L.push("## プロフィール（ものがたりっち クリエイタータイプ診断）");
  if (p.name) L.push(`- 名前：${p.name}`);
  L.push(`- タイプ：${type.name}（${type.catch}）${type.tags.length ? "／" + type.tags.join("・") : ""}`);
  L.push(`- 強み：${type.good}`, `- 気をつけたいこと：${type.watch}`);
  if (p.work) L.push(`- 動画編集は：${p.work}`);
  if (p.years) L.push(`- 経験：${p.years}`);
  if ((p.skills || []).length) L.push(`- 得意分野：${p.skills.join("、")}`);
  if ((p.software || []).length) L.push(`- 使えるソフト：${p.software.join("、")}`);
  L.push(`- 作業できる時間：平日${Number(p.avail.weekday) || 0}時間／土日${Number(p.avail.weekend) || 0}時間${(p.avail.offDays || []).length ? "（作業しない曜日：" + p.avail.offDays.map((d) => "日月火水木金土"[d]).join("") + "）" : ""}、週${weeklyHours(p)}時間`);
  L.push(`- 10分の動画1本で合計約${est.total}時間：` + est.steps.map((s) => `${s.label}${s.hours}h（好き度${(p.steps[s.key] || {}).like || "-"}/5）`).join("、"));
  if (p.bio) L.push(`- 自己紹介：${p.bio}`);
  if ((p.portfolio || []).length) { L.push("- ポートフォリオ："); for (const w of p.portfolio) L.push(`  - ${w.title || "作品"} ${w.url}${(w.roles || []).length ? "（担当：" + w.roles.join("・") + "）" : ""}${w.note ? "　" + w.note : ""}`); }
  L.push("", "## 募集文", String(posting || "（未入力）").trim());
  return L.join("\n");
}
