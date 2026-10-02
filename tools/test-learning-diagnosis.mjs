// Synthetic regression tests: no network, real accounts, or persistent stores.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import * as creator from '../src/creator-type.js';
import * as reliability from '../src/learning-diagnosis.js';

const source = fs.readFileSync(new URL('../monogataritch.src.jsx', import.meta.url), 'utf8');
const theme = { main: '#333333', accent: '#bb6611' };
const profile = {
  v: 1, name: 'Synthetic profile', updatedAt: 123, showContact: false,
  email: 'synthetic@example.test', line: 'test-only', customHistory: [{ value: 'keep' }],
  answers: Object.fromEntries(creator.CREATOR_QUESTIONS.map((q) => [q.id, 0])),
  steps: Object.fromEntries(creator.CREATOR_STEPS.map((s) => [s.key, { like: 3, hours: 1, extra: 'keep' }])),
  avail: { weekday: 8, weekend: 0, offDays: [], extra: 'keep' },
};
const copy = (x) => JSON.parse(JSON.stringify(x));
const type = creator.creatorType(profile.answers);

for (const storage of [null, {}, { get: async () => { throw new Error('network'); } }, { get: async () => { throw Object.assign(new Error('nf'), { code: 401 }); } }, { get: async () => ({ value: '{' }) }, { get: async () => ({ value: 'null' }) }, { get: async () => ({ value: '{"answers":[]}' }) }]) {
  await assert.rejects(() => reliability.readCreatorProfile(storage, 'creator-profile-v1'));
}
assert.equal(await reliability.readCreatorProfile({ get: async () => { throw new Error('nf'); } }, 'key'), null);
assert.deepEqual(await reliability.readCreatorProfile({ get: async () => ({ value: JSON.stringify(profile) }) }, 'key'), profile);
await assert.rejects(() => reliability.writeCreatorProfile(null, 'key', profile));
await assert.rejects(() => reliability.writeCreatorProfile({ set: async () => { throw new Error('offline'); } }, 'key', profile));
let written;
await reliability.writeCreatorProfile({ set: async (key, value) => { written = { key, value }; } }, 'creator-profile-v1', profile);
assert.deepEqual(JSON.parse(written.value), profile);
assert.equal(written.key, 'creator-profile-v1');

for (const missing of ['', null, undefined, 0, -1, 'NaN', NaN, Infinity]) {
  const partial = copy(profile);
  partial.steps.final.hours = missing;
  const estimate = creator.estimateHours(partial, 10, type);
  assert.equal(estimate.complete, false, String(missing));
  assert.equal(creator.monthlyCapacity(partial, 10, type), null);
  assert.ok(!creator.matchPosting(partial, '10分、月4本').lines.some((line) => /動画1本|本に対して/.test(line.text)));
  assert.ok(!creator.profilePrompt(creator.publicProfile(partial), '募集').includes('動画1本で合計'));
}
const partial = copy(profile);
for (const key of ['ara', 'telop', 'enshutsu', 'final']) partial.steps[key].hours = '';
assert.equal(creator.estimateHours(partial, 10, type).enteredCount, 1);
assert.equal(creator.monthlyCapacity(partial, 10, type), null);
const partialBack = await creator.decodeProfile(await creator.encodeProfile(partial));
assert.equal(partialBack.steps.final.hours, 0); // Preserve public numeric values.
assert.equal(partialBack.steps.final.hoursEntered, false);
assert.equal(creator.estimateHours(partialBack, 10, type).complete, false);
assert.equal(partialBack.email, '');
assert.equal(partialBack.line, '');
assert.equal(partialBack.showContact, false);
const explicitZero = copy(profile);
explicitZero.steps.final = { ...explicitZero.steps.final, hours: 0, hoursEntered: true };
assert.equal(creator.estimateHours(explicitZero, 10, type).complete, true);
assert.equal(creator.estimateHours(await creator.decodeProfile(await creator.encodeProfile(explicitZero)), 10, type).complete, true);
// Old version-one URLs have no hoursEntered field. Encode that exact legacy shape.
const old = creator.publicProfile(partial);
for (const step of Object.values(old.steps)) delete step.hoursEntered;
const compressed = new Uint8Array(await new Response(new Blob([JSON.stringify(old)]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
const legacyCode = Buffer.from(compressed).toString('base64url');
const legacyBack = await creator.decodeProfile(legacyCode);
assert.equal(legacyBack.steps.final.hours, 0);
assert.equal(creator.monthlyCapacity(legacyBack, 10, type), null);
assert.equal(creator.estimateHours(profile, 10, type).total, 5);
assert.equal(creator.monthlyCapacity(profile, 10, type), 34.4);
assert.deepEqual(creator.creatorType(profile.answers), type);

const learning = { version: 'synthetic-v1', phases: [{ id: 'rough', title: '粗編', goal: 'synthetic goal', steps: [{ id: 'read', do: 'Read the script', tip: 'Synthetic tip', help: [{ q: 'Where is the script?', a: ['AK に自動で知らせました', 'Keep this line'], src: 'synthetic source' }] }] }] };
const original = copy(learning);
const groups = reliability.stepsToLearnGroups(learning);
assert.ok(groups[0].items[0].qa[0].a[0].includes('自動通知は送られません'));
assert.equal(groups[0].items[0].qa[0].a[1], 'Keep this line');
assert.deepEqual(learning, original);
assert.deepEqual(reliability.stepsToLearnGroups({ phases: [] }), []);
assert.deepEqual(reliability.stepsToLearnGroups({ phases: [{ steps: [] }] }), []);
for (const response of [{ ok: false }, { ok: true, json: async () => { throw new Error('invalid JSON'); } }, { ok: true, json: async () => ({ connected: false }) }, { ok: true, json: async () => ({ connected: true, data: { phases: [{}] } }) }]) {
  await assert.rejects(() => reliability.fetchLearnSteps(async () => response, '/synthetic'));
}
assert.equal((await reliability.fetchLearnSteps(async () => ({ ok: true, json: async () => ({ connected: true, data: learning, sha: 'sha-example' }) }), '/synthetic')).version, 'synthetic-v1');
assert.equal((await reliability.fetchLearnSteps(async () => ({ ok: true, json: async () => ({ connected: true, data: { phases: [] }, sha: 'sha-example' }) }), '/synthetic')).version, 'sha-example');

// Execute the actual JSX functions with deterministic hooks, including effects
// and event handlers. This exercises state transitions rather than string guards.
function mount(name, globals = {}, props = {}) {
  const slots = [], effects = [];
  let cursor = 0, dirty = true, tree, mounted = true;
  const useState = (initial) => {
    const i = cursor++;
    if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
    return [slots[i].value, (value) => { if (!mounted) return; slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; dirty = true; }];
  };
  const useRef = (initial) => { const i = cursor++; return (slots[i] ||= { current: initial }); };
  const useEffect = (fn, deps) => {
    const i = cursor++;
    if (!slots[i] || deps.some((d, j) => !Object.is(d, slots[i].deps[j]))) {
      const old = slots[i]; slots[i] = { deps, cleanup: old && old.cleanup };
      effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = fn(); });
    }
  };
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter((x) => x !== false && x != null) }), Fragment: 'fragment' };
  const start = source.indexOf('const STORE_CREATOR =');
  const constants = source.slice(start, source.indexOf('// 共有URL', start));
  const extract = (name, end) => source.slice(source.indexOf('function ' + name), source.indexOf(end, source.indexOf('function ' + name)));
  const code = constants + extract('CreatorProfileCard', 'function CreatorDiagnosis') + extract('CreatorDiagnosis', '/* ===== 今日やること') + extract('LearnPage', '/* ===== クリエイタータイプ診断');
  const context = vm.createContext({ ...creator, ...reliability, React, useState, useEffect, useRef, Icon: 'icon', window: { storage: globals.storage, scrollTo() {} }, navigator: { clipboard: { writeText: async () => {} } }, alert() {}, setTimeout: () => 1, clearTimeout() {}, AbortController, SHARE_API: 'https://synthetic.invalid', LEARN_GROUPS: [{ title: 'Basic', items: [{ id: 'basic-first', title: 'Basic manual', steps: ['Basic instructions'] }] }], learnReady: () => true, hexA: () => '#eee', ...globals });
  vm.runInContext(transformSync(code + `\nglobalThis.Component = ${name};`, { loader: 'jsx' }).code, context);
  const render = () => { cursor = 0; dirty = false; tree = context.Component({ theme, userEmail: '', ...props }); while (effects.length) effects.shift()(); };
  const flush = async () => { for (let i = 0; i < 20; i++) { if (dirty) render(); await Promise.resolve(); } return tree; };
  return { flush, get tree() { return tree; }, context, update(next) { props = { ...props, ...next }; dirty = true; }, unmount() { mounted = false; for (const slot of slots) slot.cleanup?.(); } };
}
const textOf = (tree) => typeof tree === 'string' || typeof tree === 'number' ? String(tree) : (tree?.children || []).map(textOf).join('');
const nodes = (tree) => tree && typeof tree === 'object' ? [tree, ...tree.children.flatMap(nodes)] : [];
const button = (app, label) => { const found = nodes(app.tree).find((node) => node.type === 'button' && textOf(node) === label); assert.ok(found, label); return found; };
const click = async (app, label) => { button(app, label).props.onClick(); await app.flush(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

let readsFail = true, saves = 0;
const loadApp = mount('CreatorDiagnosis', { storage: { get: async () => { if (readsFail) throw new Error('offline'); return { value: JSON.stringify(profile) }; }, set: async () => { saves++; } } });
await loadApp.flush();
assert.ok(textOf(loadApp.tree).includes('編集・保存を止めています'));
assert.ok(!textOf(loadApp.tree).includes('診断する'));
assert.equal(saves, 0);
readsFail = false;
await click(loadApp, '回答を再読み込み');
assert.ok(textOf(loadApp.tree).includes('あなたのクリエイタータイプ'));

let failSave = true, stored = copy(profile), pendingSave;
const saveApp = mount('CreatorDiagnosis', { storage: { get: async () => ({ value: JSON.stringify(stored) }), set: async (key, value) => { saves++; if (pendingSave) await pendingSave.promise; if (failSave) throw new Error('offline'); stored = JSON.parse(value); } } });
await saveApp.flush();
await click(saveApp, '回答を見直す');
const nameInput = () => nodes(saveApp.tree).find((node) => node.type === 'input' && node.props.placeholder === '例）中村（Xの名前など）');
nameInput().props.onChange({ target: { value: 'Unsaved synthetic edit' } });
await saveApp.flush();
await click(saveApp, '診断する');
assert.ok(textOf(saveApp.tree).includes('入力した回答はこの画面に残っています'));
assert.equal(nameInput().props.value, 'Unsaved synthetic edit');
assert.deepEqual(stored, profile);
assert.ok(!textOf(saveApp.tree).includes('共有URLをコピー'));
failSave = false; pendingSave = deferred();
const saveButton = button(saveApp, 'もう一度保存して診断する');
const countBefore = saves;
saveButton.props.onClick(); saveButton.props.onClick();
await saveApp.flush();
assert.equal(saves, countBefore + 1);
assert.equal(saveApp.tree.type, 'fieldset');
assert.equal(saveApp.tree.props.disabled, true);
pendingSave.resolve(); await saveApp.flush();
assert.ok(textOf(saveApp.tree).includes('あなたのクリエイタータイプ'));
assert.equal(stored.name, 'Unsaved synthetic edit');
assert.deepEqual(stored.customHistory, profile.customHistory);
assert.equal(stored.steps.final.extra, 'keep');
assert.equal(stored.avail.extra, 'keep');
assert.equal(stored.showContact, false);
assert.equal(stored.email, profile.email);

const firstUse = mount('CreatorDiagnosis', { storage: { get: async () => { throw new Error('nf'); }, set: async () => { throw new Error('must not write'); } } });
await firstUse.flush();
assert.ok(textOf(firstUse.tree).includes('1. あなたについて'));
assert.equal(button(firstUse, '診断する').props.disabled, true);
const card = mount('CreatorProfileCard', {}, { profile: partialBack }); await card.flush();
assert.ok(textOf(card.tree).includes('1/5工程のみ入力'));
assert.ok(!textOf(card.tree).includes('10分の動画1本（目安）'));
assert.ok(!textOf(card.tree).includes('月の目安（10分）'));

let response = deferred(), fetches = 0;
const learnApp = mount('LearnPage', { fetch: async () => { fetches++; return response.promise; } });
await learnApp.flush();
assert.ok(textOf(learnApp.tree).includes('読み込み中'));
await click(learnApp, 'Basic manual');
response.resolve({ ok: true, json: async () => ({ connected: true, data: learning }) });
await learnApp.flush();
assert.ok(textOf(learnApp.tree).includes('作業ステップ 1件'));
assert.ok(textOf(learnApp.tree).includes('synthetic-v1'));
assert.ok(textOf(learnApp.tree).includes('Basic instructions')); // late fetch preserves selection
response = deferred(); await click(learnApp, '再読み込み');
response.reject(new Error('offline')); await learnApp.flush();
assert.ok(textOf(learnApp.tree).includes('前回読み込んだ内容'));
assert.ok(textOf(learnApp.tree).includes('1. Read the script'));
response = deferred(); await click(learnApp, '再読み込み');
response.resolve({ ok: true, json: async () => ({ connected: true, data: { version: 'empty-v2', phases: [] } }) });
await learnApp.flush();
assert.ok(textOf(learnApp.tree).includes('0件'));
assert.ok(textOf(learnApp.tree).includes('Basic instructions'));
response = deferred(); await click(learnApp, '再読み込み');
response.resolve({ ok: true, json: async () => ({ connected: true, data: learning }) });
await learnApp.flush(); await click(learnApp, '1. Read the script');
assert.ok(textOf(learnApp.tree).includes('自動通知は送られません'));
assert.ok(!textOf(learnApp.tree).includes('AK に自動で知らせました'));
assert.equal(fetches, 4);

// Timeout must exit the loading state and preserve the fixed manuals.
let timeoutCallback, timeoutMs;
const timeoutApp = mount('LearnPage', {
  setTimeout: (fn, ms) => { timeoutCallback = fn; timeoutMs = ms; return 1; },
  fetch: async (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))),
});
await timeoutApp.flush();
assert.equal(timeoutMs, 15000);
timeoutCallback(); await timeoutApp.flush();
assert.ok(textOf(timeoutApp.tree).includes('基本マニュアルは引き続き読めます'));
assert.ok(textOf(timeoutApp.tree).includes('Basic instructions'));

// A refresh that removes the selected remote step highlights the actual fallback.
response = deferred(); await click(learnApp, '再読み込み');
response.resolve({ ok: true, json: async () => ({ connected: true, data: { phases: [] } }) });
await learnApp.flush();
assert.ok(button(learnApp, 'Basic manual').props.className.includes('shadow-sm'));

// A late load for a previous account must never replace the newer account.
const oldLoad = deferred(); let loadCount = 0;
const accountApp = mount('CreatorDiagnosis', { storage: { get: async () => ++loadCount === 1 ? oldLoad.promise : { value: JSON.stringify({ ...profile, name: 'New synthetic account' }) } } });
await accountApp.flush(); accountApp.update({ userEmail: 'other@example.test' }); await accountApp.flush();
oldLoad.resolve({ value: JSON.stringify(profile) }); await accountApp.flush();
await click(accountApp, '回答を見直す');
assert.equal(nodes(accountApp.tree).find((node) => node.props.placeholder === '例）中村（Xの名前など）').props.value, 'New synthetic account');
let unexpectedWrites = 0;
accountApp.context.window.storage = { set: async () => { unexpectedWrites++; } };
await click(accountApp, '診断する');
assert.ok(textOf(accountApp.tree).includes('保存先が変わりました'));
assert.equal(unexpectedWrites, 0);
learnApp.unmount(); saveApp.unmount(); loadApp.unmount(); firstUse.unmount(); card.unmount(); timeoutApp.unmount(); accountApp.unmount();

console.log('learning/diagnosis synthetic reliability regression tests passed');
