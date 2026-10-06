// Optional isolated UI test. Install Playwright outside this repo, then set PLAYWRIGHT_MODULE
// to its index.mjs. Uses the installed Chromium; no app boot, customer data, or external I/O.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { SCRIPT_RUBRIC_VERSION, SCRIPT_STORY_TYPES, CRITERIA, normalizeScriptReview, scriptRubric } from '../src/script-check.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = await readFile(new URL('../monogataritch.src.jsx', import.meta.url), 'utf8');
const start = source.indexOf('const SEV = '), end = source.indexOf('/* 文中の https://', start);
assert.ok(start >= 0 && end > start);
const bundle = await build({ stdin: { contents: `
import React, {useMemo, useState, useEffect, useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {mechanicalCheck, mechanicalText, SCRIPT_RUBRIC_VERSION, SCRIPT_STORY_TYPES, scriptRubric, matchesScriptRubric} from './src/script-check.js';
const SHARE_API = 'https://fixture.invalid', MG_SESSION = 'synthetic';
const Icon = () => <span/>;
${source.slice(start, end)}
function Harness() {
  const [id, setId] = useState('fixture-a');
  window.switchProject = () => setId('fixture-b');
  return <ScriptCheckPanel key={id} theme={{main:'#334155',accent:'#2563eb'}}
    project={{id,name:'合成案件',rows:[{id:'s1',kind:'scene',type:'VLOG',sec:30,script:'合成台本'}]}}
    context="【質問13】合成回答\\n【台本】#1 合成台本" loggedIn={true} onJump={()=>{}} onClose={()=>setId('closed')}/>;
}
createRoot(document.getElementById('root')).render(<Harness/>);`, resolveDir: new URL('..', import.meta.url).pathname, loader: 'jsx' }, bundle: true, write: false, format: 'iife' });
const css = await readFile(new URL('../tailwind.css', import.meta.url), 'utf8');
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/test.js' ? 'application/javascript' : req.url === '/style.css' ? 'text/css' : 'text/html');
  res.end(req.url === '/test.js' ? bundle.outputFiles[0].text : req.url === '/style.css' ? css : '<meta charset="UTF-8"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/test.js"></script>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], posts = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let mode = 'ok', release, entered;
  const fake = (type) => normalizeScriptReview({ summary: '合成結果', criteria: CRITERIA.map((c) => ({ key: c.key, score: 2, comment: '合成理由' })), findings: [] }, scriptRubric(type));
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.url().startsWith(origin)) return route.continue();
    assert.equal(req.url(), 'https://fixture.invalid/api/script/review');
    if (req.method() === 'GET') {
      if (mode === 'offline') return route.abort();
      return route.fulfill({ status: mode === 'old' ? 404 : 200, json: mode === 'old' ? {} : mode === 'malformed' ? { rubricVersion: SCRIPT_RUBRIC_VERSION, storyTypes: {} } : { rubricVersion: SCRIPT_RUBRIC_VERSION, storyTypes: SCRIPT_STORY_TYPES.map((t) => t.value) } });
    }
    assert.equal(req.method(), 'POST');
    const b = req.postDataJSON(); posts.push(b);
    if (mode === 'delay') { entered(); await new Promise((resolve) => { release = resolve; }); }
    await route.fulfill({ json: mode === 'mismatch' ? fake('pixar') : fake(b.storyType) });
  });
  const select = page.getByRole('combobox', { name: '今回の採点に使う物語タイプ' });
  const run = () => page.getByRole('button', { name: /AIで採点する|もう一度採点する/ }).click();
  await page.goto(origin);
  assert.equal(await select.inputValue(), 'pixar');
  for (const t of SCRIPT_STORY_TYPES) {
    await select.selectOption(t.value);
    await run();
    await page.getByText('合成結果', { exact: true }).waitFor();
    await page.waitForFunction((type) => JSON.parse(localStorage.getItem('mg:scriptReview:fixture-a'))?.storyType === type, t.value);
    assert.equal(posts.at(-1).storyType, t.value);
    assert.equal(posts.at(-1).rubricVersion, SCRIPT_RUBRIC_VERSION);
    assert.ok(posts.at(-1).context.includes('合成回答'));
    assert.equal(await page.getByText('型の基準未整備', { exact: true }).count(), t.value === 'pixar' ? 0 : 2);
    assert.ok((await page.getByText(/^表示中の結果：/).innerText()).includes(t.label));
  }
  await page.screenshot({ path: '/tmp/monogatari-story-scoring-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: '/tmp/monogatari-story-scoring-mobile.png', fullPage: true });
  // Reopening defaults to legacy, but the previous result keeps its actual type label.
  await page.reload();
  assert.equal(await select.inputValue(), 'pixar');
  assert.ok((await page.getByText(/^表示中の結果：/).innerText()).includes('現在の選択とは異なる'));
  const old = await page.evaluate(() => localStorage.getItem('mg:scriptReview:fixture-a'));
  for (const failure of ['old', 'offline', 'malformed']) {
    mode = failure; const n = posts.length;
    await select.selectOption('campbell'); await run();
    await page.getByText(/採点基準を確認できませんでした/).waitFor();
    assert.equal(posts.length, n);
    assert.equal(await page.evaluate(() => localStorage.getItem('mg:scriptReview:fixture-a')), old);
  }
  mode = 'mismatch'; await run();
  await page.getByText(/選択した型と採点結果の基準が一致しない/).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('mg:scriptReview:fixture-a')), old);
  // In-flight response for project A must neither appear in nor save into project B.
  mode = 'delay'; const pending = new Promise((resolve) => { entered = resolve; });
  await run(); await pending;
  assert.equal(await select.isDisabled(), true);
  await page.evaluate(() => window.switchProject());
  release();
  await page.waitForResponse((res) => res.request().method() === 'POST');
  await page.waitForTimeout(50);
  assert.equal(await page.getByText('合成結果', { exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('mg:scriptReview:fixture-b')), null);
  assert.equal(await page.evaluate(() => localStorage.getItem('mg:scriptReview:fixture-a')), old);
  // Legacy results remain explicitly marked; unrelated storage is never written.
  await page.evaluate(() => localStorage.setItem('mg:scriptReview:fixture-a', JSON.stringify({ score: 8, summary: '旧結果', criteria: [] })));
  await page.reload();
  await page.getByText(/従来基準（型の記録なし）/).waitFor();
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), ['mg:scriptReview:fixture-a']);
  assert.deepEqual(errors, []);
  console.log('isolated UI passed: 4 types, request/display match, desktop/mobile, legacy, offline/old Worker, mismatch, project-switch race; no external I/O');
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
