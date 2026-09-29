import assert from "node:assert/strict";
import { creatorType, axisScores, estimateHours, buildPlan, planToIcs, profileComplete, stepAdvice, CREATOR_QUESTIONS } from "../src/creator-type.js";

// 夜型・まとめて・締切・こだわり
const answers = { t1: -2, t2: 2, t3: -1, f1: 2, f2: -2, f3: 1, s1: -1, s2: 2, s3: -2, p1: 2, p2: -2, p3: 1 };
const s = axisScores(answers);
assert.deepEqual(s, { time: -5, focus: 5, start: -5, polish: 5 });
const t = creatorType(answers);
assert.equal(t.name, "一撃集中型");
assert.deepEqual(t.tags, ["夜型", "仕上げこだわり"]);

// 全部0なら中間。まとめて・前倒し側に寄せる
const mid = creatorType(Object.fromEntries(CREATOR_QUESTIONS.map((q) => [q.id, 0])));
assert.equal(mid.name, "先行ダイブ型");
assert.deepEqual(mid.tags, []);

const profile = {
  answers,
  focusMin: 120,
  steps: { kousei: { like: 5, hours: 2 }, ara: { like: 3, hours: 4 }, telop: { like: 1, hours: 3 }, enshutsu: { like: 4, hours: 2 }, final: { like: 3, hours: 1 } },
  avail: { weekday: 2, weekend: 6, offDays: [3] },
};
assert.equal(profileComplete(profile), true);
assert.equal(profileComplete({ ...profile, avail: { weekday: 0, weekend: 0 } }), false);

// 20分の動画：素の合計 12h ×2 ＝24h、締切＋こだわりで ×1.35 ＝32.4h 前後
const est = estimateHours(profile, 20, t);
assert.equal(est.buffer, 0.35);
assert.equal(est.steps[0].hours, 5.4);
assert.ok(Math.abs(est.total - 32.4) < 0.11, String(est.total));

// 苦手工程（like 1）には分担相談の助言が付く
const adv = stepAdvice(profile, t);
assert.ok(adv.find((a) => a.key === "telop").tips.some((x) => x.includes("分担")));
assert.ok(adv.find((a) => a.key === "kousei").tips.some((x) => x.includes("夜")));

// 2026-10-01(木)開始・10-12(月)納期。締切型なので自分締切は2日前の10-10(土)。水曜は休み
const plan = buildPlan(profile, { minutes: 20, start: "2026-10-01", due: "2026-10-12" }, t);
assert.equal(plan.selfDue, "2026-10-10");
assert.ok(plan.days.every((d) => d.date <= "2026-10-10"));
assert.ok(!plan.days.some((d) => d.date === "2026-10-07"), "水曜は休み");
// 木2 金2 土6 日6 月2 火2 木2 金2 土6 = 30h < 32.4h → 足りない
assert.equal(plan.ok, false);
assert.ok(plan.shortBy > 2 && plan.shortBy < 3, String(plan.shortBy));
// 工程は順番どおり
const order = plan.days.flatMap((d) => d.items.map((i) => i.key));
const firstIdx = (k) => order.indexOf(k);
assert.ok(firstIdx("kousei") < firstIdx("ara") && firstIdx("ara") < firstIdx("telop") && firstIdx("telop") < firstIdx("enshutsu"));

// 15分以下の細切れは残さない
const p15 = buildPlan(profile, { minutes: 15, start: "2026-10-01", due: "2026-10-20" }, t);
assert.ok(p15.days.every((d) => d.items.every((i) => i.hours > 0.25)), JSON.stringify(p15.days));

// 余裕のある納期なら収まる
const plan2 = buildPlan(profile, { minutes: 10, start: "2026-10-01", due: "2026-10-20" }, t);
assert.equal(plan2.ok, true);
assert.equal(plan2.shortBy, 0);

// 納期が開始より前はエラー
assert.equal(buildPlan(profile, { minutes: 10, start: "2026-10-05", due: "2026-10-01" }, t).ok, false);

// ics：夜型は21時(JST)＝12時(UTC)開始
const ics = planToIcs(plan2, "山岸さん密着");
assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
assert.ok(ics.includes("DTSTART:20261001T120000Z"), ics.slice(0, 400));
assert.ok(ics.includes("SUMMARY:山岸さん密着｜構成"));
assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, plan2.days.reduce((n, d) => n + d.items.length, 0));

console.log("creator type tests passed");
