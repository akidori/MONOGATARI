// Render the actual chat log JSX and execute sendAsk with synthetic state/fetch only.
import assert from 'node:assert/strict';
import { invalidFenceResponses, ambiguousVerdictResponses } from './fixtures/agent-fences.mjs';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transform } from 'esbuild';
import { parseAgentResponse } from '../src/agent-response.js';
const source = readFileSync(new URL('../monogataritch.src.jsx', import.meta.url), 'utf8');
const a = source.indexOf('{askLog.map((e, i) => {'), b = source.indexOf('{askBusy &&', a);
assert.ok(a > 0 && b > a);
const expression = source.slice(a + 1, b).trim().slice(0, -1);
const { code } = await transform('const markup = (' + expression + ');', { loader: 'jsx' });
const render = new Function('React', 'askLog', 'parseAgentResponse', 'theme', 'LinkText', code + ';return markup;');
const show = (entry) => renderToStaticMarkup(React.createElement(React.Fragment, null, render(React, [entry], parseAgentResponse, { accent: '#333' }, ({ text }) => React.createElement('span', null, text))));
const answer = '判定: 回答\n回答: 合成の正常回答\n出典: 合成資料';
const ak = '判定: AKへ\nAKへの理由: 合成の理由\nAKに渡す質問文: 合成の質問';
for (const entry of [
  ...[...invalidFenceResponses, ...ambiguousVerdictResponses].map((text) => ({ verdict: "AKへ", text, notified: true })),
  { verdict: '回答', text: '回答: UNSAFE_RAW\n出典: 合成資料' },
  { verdict: null, text: 'UNSAFE_RAW' }, { verdict: '回答', text: '判定: 不明\n回答: UNSAFE_RAW' },
  { verdict: 'AKへ', text: 'UNSAFE_RAW', notified: true },
]) {
  const html = show(entry); assert.ok(html.includes('保留')); assert.ok(!html.includes('UNSAFE_RAW')); assert.ok(!html.includes('通知を保存しました'));
}
assert.ok(show({ verdict: '回答', text: answer }).includes('合成の正常回答'));
assert.ok(show({ verdict: 'AKへ', text: ak }).includes('通知状況は未確認'));
assert.ok(show({ verdict: 'AKへ', text: ak, notified: true }).includes('アプリ内通知を保存しました'));
const start = source.indexOf('  const sendAsk = async () => {');
const end = source.indexOf('\n  };', start);
const body = source.slice(source.indexOf('{', start) + 1, end);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const send = new AsyncFunction('fetch', 'parseAgentResponse', 'setAskLog', 'setAskInput', 'showToast', 'setAskBusy', 'localStorage', `
const askInput='合成質問', askBusy=false, user={}, MG_SESSION='fixture', view='home', project=null, SHARE_API='https://fixture.invalid';
${body}`);
for (const [status, data, success] of [
  ...[...invalidFenceResponses, ...ambiguousVerdictResponses].map((text) => [200, { verdict: "AKへ", text, notified: true }, false]),
  [502, { code: 'AGENT_RESPONSE_INVALID', verdict: null, error: '形式検証エラー。通知は送っていません。' }, false],
  [200, { verdict: '回答', text: '回答: UNSAFE_RAW\n出典: 合成資料' }, false],
  [200, { verdict: 'AKへ', text: answer }, false],
  [200, { verdict: '回答', text: answer, notified: false }, true],
  [200, { verdict: 'AKへ', text: ak, notified: true }, true],
]) {
  let log=[], input='合成質問', writes=0; const notices=[], busy=[];
  await send(async () => new Response(JSON.stringify(data), { status }), parseAgentResponse,
    (fn) => { log=fn(log); }, (v) => { input=v; }, (v) => notices.push(v), (v) => busy.push(v), { setItem: () => writes++ });
  assert.equal(log.length, success ? 1 : 0); assert.equal(writes, success ? 1 : 0);
  assert.equal(input, success ? '' : '合成質問'); assert.equal(notices.length, success ? 0 : 1);
  assert.ok(notices.every((t) => !t.includes('UNSAFE_RAW'))); assert.deepEqual(busy, [true, false]);
  if (success) assert.equal(log[0].notified, data.notified);
}
console.log('agent response UI: actual log JSX and sendAsk passed; invalid raw text hidden, history untouched, notification claims verified');
