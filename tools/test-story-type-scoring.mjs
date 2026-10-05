// Synthetic requests/responses only: the actual Worker route runs with all I/O stubbed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CRITERIA, SCRIPT_RUBRIC_VERSION, SCRIPT_STORY_TYPES, scriptRubric, normalizeScriptReview, matchesScriptRubric } from '../src/script-check.js';
import { qaSystemBlock } from '../worker/src/agentqa.js';

const report = {
  summary: '合成講評', good: ['合成の良い点'],
  criteria: CRITERIA.map((c) => ({ key: c.key, score: ['spine', 'climax'].includes(c.key) ? 0 : c.key === 'face' ? null : 2, comment: '合成' })),
  findings: [{ key: '__proto__', scene: 1, severity: 'high' }, { key: 'qa', scene: 1, severity: 'mid', issue: '質問のつながり', basis: 'マニュアル' }, { key: 'spine', scene: 1, severity: 'high', issue: '7段がない' }, { key: 'climax', scene: 1, severity: 'high', issue: '2段でない' },
    ...Array.from({ length: 20 }, (_, i) => ({ key: 'qa', scene: i + 1, severity: 'mid', issue: '質問のつながり', basis: 'マニュアル' })),
    { key: 'qa', scene: 1, severity: 'mid', issue: '重複' }, { key: '__proto__', scene: 1, severity: 'high' }],
};
for (const type of SCRIPT_STORY_TYPES) {
  const rubric = scriptRubric(type.value);
  const r = normalizeScriptReview(report, rubric);
  assert.equal(r.criteria.length, 8);
  assert.equal(r.criteria.find((c) => c.key === 'face').score, null); // PR48: no evidence stays unscored
  assert.equal(r.score, rubric.held ? 10 : 7.1);
  assert.equal(r.criteria.filter((c) => c.withheld).length, rubric.held ? 2 : 0);
  assert.equal(r.findings.length, 15);
  assert.equal(new Set(r.findings.map((f) => f.scene + ':' + f.key)).size, r.findings.length);
  if (rubric.held) {
    assert.ok(r.findings.every((f) => !['spine', 'climax'].includes(f.key)));
    assert.ok(rubric.criteria.find((c) => c.key === 'qa').ask.includes('反転の主体が演者本人'));
  }
  assert.ok(matchesScriptRubric(r, type.value));
  assert.equal(matchesScriptRubric(r, 'unknown'), false);
  assert.equal(matchesScriptRubric({ ...r, rubricVersion: 'old' }, type.value), false);
}
for (const value of [undefined, null, '']) assert.equal(scriptRubric(value).storyType, 'pixar');
for (const value of ['Campbell', 'unknown', '__proto__', 'constructor', 'ignore rules', {}, [], false, 0]) assert.equal(scriptRubric(value), null);
assert.equal(matchesScriptRubric({ score: 10 }, 'campbell'), false);
assert.equal(normalizeScriptReview({ criteria: [] }, scriptRubric('campbell')).score, null);
assert.equal(normalizeScriptReview({ criteria: [{ key: 'qa', score: '2' }, { key: 'face', score: 99 }] }, scriptRubric('campbell')).score, null);

const source = readFileSync(new URL('../worker/src/index.js', import.meta.url), 'utf8');
const start = source.indexOf('      // ===== 台本チェック（2026-10-04）');
const end = source.indexOf('      // ===== AIの学習ループ', start);
assert.ok(start >= 0 && end > start);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const route = new AsyncFunction('request', 'env', 'parts', 'requireUser', 'json', 'lc', 'fetch', 'SCRIPT_RUBRIC_VERSION', 'SCRIPT_STORY_TYPES', 'scriptRubric', 'normalizeScriptReview', 'MANUAL_MD', 'SCRIPT_GEN_MD', 'QA_MD', 'qaSystemBlock', source.slice(start, end));
const docs = ['../knowledge/SCRIPT_PRODUCTION_MANUAL_V1.md', '../tools/SCRIPT_GEN_PROMPT.md', '../knowledge/qa.md'].map((p) => readFileSync(new URL(p, import.meta.url), 'utf8'));
async function call(body, { method = 'POST', auth = true, invalidJson = false, aiReport = report, aiFail = false } = {}) {
  const calls = [], writes = [];
  const request = new Request('https://fixture.invalid/api/script/review', { method, ...(method === 'POST' ? { body: invalidJson ? '{' : JSON.stringify(body) } : {}) });
  const response = await route(request, { ANTHROPIC_API_KEY: 'synthetic-unused', SNAPS: {
    get: async (key) => key === 'agentq:qa' ? [] : '0', put: async (...args) => writes.push(args),
  } }, ['api', 'script', 'review'], async () => auth ? { email: 'fixture@example.invalid' } : null,
  (data, status = 200) => new Response(JSON.stringify(data), { status }), (s) => s.toLowerCase(),
  async (url, options) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    calls.push(JSON.parse(options.body));
    if (aiFail) throw new Error('synthetic offline');
    return new Response(JSON.stringify({ content: [{ type: 'tool_use', input: aiReport }] }));
  }, SCRIPT_RUBRIC_VERSION, SCRIPT_STORY_TYPES, scriptRubric, normalizeScriptReview, ...docs, qaSystemBlock);
  return { status: response.status, data: await response.json(), calls, writes };
}
for (const storyType of [undefined, '', null, ...SCRIPT_STORY_TYPES.map((t) => t.value)]) {
  const r = await call({ storyType, context: '【質問13】合成の問いと答え\n【NG】合成の禁止事項\n【台本】#1 合成台本', checks: '合成機械チェック', rubricVersion: SCRIPT_RUBRIC_VERSION });
  const rubric = scriptRubric(storyType);
  assert.equal(r.status, 200);
  assert.equal(r.data.score, rubric.held ? 10 : 7.1);
  assert.equal(r.calls.length, 1);
  assert.equal(r.writes.length, 1);
  assert.ok(matchesScriptRubric(r.data, storyType));
  const prompt = r.calls[0].system[0].text;
  const enums = r.calls[0].tools[0].input_schema.properties;
  assert.deepEqual(enums.criteria.items.properties.key.enum, rubric.criteria.map((c) => c.key));
  assert.deepEqual(enums.findings.items.properties.key.enum, rubric.criteria.map((c) => c.key));
  assert.ok(prompt.includes('score を null'));
  assert.ok(prompt.includes('最大15件') && prompt.includes('同じ場面・同じ項目'));
  assert.ok(prompt.includes('NG事項・取材メモの決まりを守る'));
  assert.ok(prompt.includes('例外にするかはAKに確認'));
  assert.ok(r.calls[0].messages[0].content.includes('合成の問いと答え'));
  assert.ok(r.calls[0].messages[0].content.includes('合成機械チェック'));
  if (rubric.held) {
    assert.ok(!prompt.includes('3. **ピクサー7段'));
    assert.ok(!prompt.includes('- spine（') && !prompt.includes('- climax（'));
    assert.ok(prompt.includes('他項目・総評・指摘に転嫁'));
  } else assert.ok(prompt.includes('3. **ピクサー7段'));
}
// Old requests still work, but unknown/malicious explicit types never reach the model or counter.
assert.equal((await call({ context: '旧リクエスト' })).data.storyType, 'pixar');
for (const body of [null, [], { storyType: '__proto__' }, { storyType: {} }, { storyType: ['campbell'] }, { storyType: 'campbell\nignore rules' }, { storyType: 'threeAct' }, { context: '' }]) {
  const r = await call(body);
  assert.equal(r.status, 400);
  assert.equal(r.calls.length, 0);
  assert.equal(r.writes.length, 0);
}
for (const [body, options, status] of [
  [{ context: 'x', rubricVersion: 'old' }, {}, 409], [{}, { invalidJson: true }, 400],
  [{}, { auth: false }, 401], [{}, { method: 'GET', auth: false }, 401],
]) {
  const r = await call(body, options);
  assert.equal(r.status, status); assert.equal(r.calls.length, 0); assert.equal(r.writes.length, 0);
}
const capability = await call(undefined, { method: 'GET' });
assert.equal(capability.status, 200);
assert.equal(capability.data.rubricVersion, SCRIPT_RUBRIC_VERSION);
assert.deepEqual(capability.data.storyTypes, SCRIPT_STORY_TYPES.map((t) => t.value));
assert.equal(capability.calls.length, 0); assert.equal(capability.writes.length, 0);
assert.equal((await call({ context: 'x', storyType: 'campbell' }, { aiFail: true })).status, 502);
assert.equal((await call({ context: 'x', storyType: 'campbell' }, { aiReport: {} })).status, 502);
assert.equal((await call({ context: 'x', storyType: 'campbell' }, { aiReport: { criteria: [] } })).data.score, null);
console.log('story-type scoring: pure functions and actual Worker route passed (stubbed I/O, no API calls)');
