// Synthetic reproduction and regression: never calls a real provider, inbox, or notifier.
import assert from 'node:assert/strict';
import { invalidFenceResponses, validFenceResponses, ambiguousVerdictResponses } from './fixtures/agent-fences.mjs';
import { readFileSync } from 'node:fs';
import { parseAgentResponse } from '../src/agent-response.js';
import { bumpStat, qaSystemBlock } from '../worker/src/agentqa.js';
const answer = '判定: 回答\n回答: 合成の結論です。\n出典: 合成マニュアル「手順」';
const toAk = '判定: AKへ\nAKへの理由: 構成変更。合成の論点。\n資料にある手順: 合成引用。\nAKに渡す質問文: 合成案件の構成を変えてよいですか？';
const missing = '回答: 本人がOKなら公開して大丈夫です。\n出典: qa.md 2026-10-04';
const quoted = '判定: 回答\n回答: 文字列「判定: AKへ」は引用です。\n出典: 合成資料';
// Main a8cd10d9 reproduces both fail-open and false escalation.
const oldVerdict = (text) => /判定[:：]\s*AKへ/.test(text) ? 'AKへ' : '回答';
assert.equal(oldVerdict(missing), '回答');
assert.equal(oldVerdict('判定: 不明'), '回答');
assert.equal(oldVerdict(quoted), 'AKへ');
const invalid = [...invalidFenceResponses, ...ambiguousVerdictResponses, missing, 'わかりません', '判定: 不明', '判定: 回答\n出典だけ', '', ' ', null,
  '判定: 回答\n回答:\n出典: 合成資料', '判定: 回答\n回答: 合成回答\n出典:',
  answer + '\n判定: AKへ', answer + '\n判定: 回答', answer + '\n出典: 二重',
  '前置き\n' + answer, '```\n' + answer + '\n```', '引用「' + answer + '」',
  '判定: 回答かAKへ\n回答: x\n出典: y', answer + '\nAKへの理由: x',
  '判定: AKへ\nAKへの理由: お金', '判定: AKへ\nAKに渡す質問文: 合成質問',
  toAk + '\n回答: できます', '判定: 回答\n回答: 引用\n```\n合成\n出典: x',
];
const valid = [...validFenceResponses, answer, toAk, quoted, answer.replaceAll(':', '：').replaceAll('\n', '\r\n'),
  '判定: 回答\n回答: 引用例\n```text\n判定: AKへ\n回答: 引用内\n```\n出典: 合成資料',
  '判定: 回答\n回答: 引用例\n> 判定: AKへ\n出典: 合成資料'];
for (const text of ambiguousVerdictResponses) assert.equal(parseAgentResponse(text).error, "DUPLICATE_VERDICT");
for (const sep of ["\r", "\u2028", "\u2029"]) assert.equal(parseAgentResponse(answer.replaceAll("\n", sep)).error, null);
for (const text of invalidFenceResponses) assert.equal(parseAgentResponse(text).error, "UNCLOSED_QUOTE");
for (const text of invalid) { const p = parseAgentResponse(text); assert.equal(p.verdict, null); assert.ok(p.error); assert.deepEqual(p.fields, {}); }
for (const text of valid) assert.equal(parseAgentResponse(text).error, null);
assert.equal(parseAgentResponse(quoted).verdict, '回答');
assert.deepEqual(bumpStat({ 回答: 2, AKへ: 1 }, null), { 回答: 2, AKへ: 1 });
assert.deepEqual(bumpStat(null, 'unknown'), { 回答: 0, AKへ: 0 });

// Execute the actual /api/agent/ask route, with every external interaction replaced.
const source = readFileSync(new URL('../worker/src/index.js', import.meta.url), 'utf8');
const start = source.indexOf('      if (request.method === "POST" && parts[0] === "api" && parts[1] === "agent" && parts[2] === "ask"');
const end = source.indexOf('      // ===== 台本チェック', start);
assert.ok(start >= 0 && end > start);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const route = new AsyncFunction('request', 'env', 'parts', 'requireUser', 'json', 'lc', 'fetch', 'qaSystemBlock', 'AGENT_SYSTEM', 'parseAgentResponse', 'bumpStat', 'console', source.slice(start, end));
async function call(text, options = {}) {
  const writes = [], requests = [], audit = [], kv = new Map();
  const result = await route(new Request('https://fixture.invalid/api/agent/ask', { method: 'POST', body: JSON.stringify({ question: '合成質問', context: '合成の質問13と回答', caseName: '合成案件' }) }), {
    ANTHROPIC_API_KEY: 'synthetic', ADMIN_EMAILS: options.noAdmin ? '' : 'admin@example.invalid', BOT_API_URL: 'https://email.invalid', BOT_API_KEY: 'synthetic',
    SNAPS: { get: async (key, type) => kv.has(key) ? (type === 'json' ? JSON.parse(kv.get(key)) : kv.get(key)) : null,
      put: async (key, value) => { writes.push(key); kv.set(key, value); } },
  }, ['api', 'agent', 'ask'], async () => ({ email: 'fixture@example.invalid' }),
  (data, status = 200) => new Response(JSON.stringify(data), { status }), (s) => s.toLowerCase(), async (url, init) => {
    requests.push(url);
    if (url === 'https://email.invalid/api/email/send') return new Response('{}');
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.ok(JSON.parse(init.body).messages[0].content.includes('合成の質問13と回答'));
    if (options.offline) throw new Error('fixture offline');
    const data = options.nullData ? null : { content: [{ type: 'text', text }], stop_reason: options.stop || 'end_turn' };
    return new Response(JSON.stringify(data), { status: options.providerStatus || 200 });
  }, qaSystemBlock, 'synthetic system', parseAgentResponse, bumpStat, { warn: (...args) => audit.push(args) });
  return { status: result.status, data: await result.json(), writes, requests, audit, kv };
}
for (const text of invalid) {
  const r = await call(text);
  assert.equal(r.status, 502); assert.equal(r.data.verdict, null); assert.equal(r.data.notified, false);
  assert.equal(r.data.code, 'AGENT_RESPONSE_INVALID'); assert.ok(r.data.validationError);
  if (invalidFenceResponses.includes(text)) assert.equal(r.data.validationError, 'UNCLOSED_QUOTE');
  if (ambiguousVerdictResponses.includes(text)) assert.equal(r.data.validationError, 'DUPLICATE_VERDICT');
  assert.equal(r.data.text, undefined); // never return unvalidated free text
  assert.equal(r.requests.length, 1); // no notifier calls
  assert.equal(r.writes.length, 1); assert.ok(r.writes[0].startsWith('agentq:cnt:')); // attempted AI call still costs quota
  assert.deepEqual(r.audit, [['agent_response_validation_failed', r.data.validationError]]);
}
for (const text of valid) {
  const r = await call(text); assert.equal(r.status, 200);
  const isAk = parseAgentResponse(text).verdict === 'AKへ';
  assert.equal(r.data.verdict, isAk ? 'AKへ' : '回答'); assert.equal(r.data.notified, isAk);
  assert.equal(r.requests.length, isAk ? 2 : 1);
  assert.equal(r.writes.includes('agentq:inbox'), isAk);
  assert.equal(r.writes.includes('notif:admin@example.invalid'), isAk);
  assert.equal(r.audit.length, 0);
}
const noAdmin = await call(toAk, { noAdmin: true });
assert.equal(noAdmin.data.notified, false); assert.equal(noAdmin.requests.length, 1);
for (const options of [{ stop: 'max_tokens' }, { nullData: true }]) {
  const r = await call(answer, options); assert.equal(r.status, 502); assert.equal(r.data.verdict, null); assert.equal(r.writes.length, 1);
}
for (const options of [{ offline: true }, { providerStatus: 502 }]) {
  const r = await call(answer, options); assert.equal(r.status, 502); assert.equal(r.writes.length, 1); assert.equal(r.requests.length, 1);
}
assert.equal((await call('', { stop: 'refusal' })).data.verdict, 'AKへ'); // existing explicit refusal behavior
console.log('agent response: fail-open reproduced; parser and Worker regressions passed without external I/O');
