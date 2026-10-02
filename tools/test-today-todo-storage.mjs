// Synthetic only: memory stores, deterministic timers, extracted actual JSX.
// No real account, browser storage, token, or network access is used.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { transformSync } from "esbuild";
import * as todo from "../src/today-todo.js";
import { createTodoPersistence, readTodoState, todoCloudStorage } from "../src/today-todo-storage.js";

const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw new Error("network forbidden"); };
const copy = (x) => JSON.parse(JSON.stringify(x));
const fixture = () => ({ date: "2026-10-02", manual: [{ id: "original", text: "Preserve original task", done: false }],
  doneAuto: { old: true }, steps: { old: [1, 99] }, stepKeys: { old: ["stable"] }, stepLegacyResolved: { old: [1] },
  stepUnchecked: { old: ["cleared"] }, stepAutoCompleted: { old: true }, customHistory: [{ preserve: true }] });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const drain = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const clock = () => {
  const pending = new Map(); let id = 0;
  return { pending, setTimer(fn) { pending.set(++id, fn); return id; }, clearTimer(id) { pending.delete(id); },
    async run() { for (const [id, fn] of [...pending]) { pending.delete(id); fn(); } await drain(); } };
};
function harness(storage, options = {}) {
  const timers = clock(), cache = options.cache || new Map();
  let view;
  const controller = createTodoPersistence({ storage, current: () => true, today: () => "2026-10-02",
    onChange: (v) => { view = v; }, cache, cacheKey: "account-a", ...timers, ...options });
  return { controller, timers, cache, get view() { return view; } };
}
const result = (value) => ({ key: todo.TODAY_STORE, value: JSON.stringify(value) });
const add = (s) => todo.addManual(s, "Synthetic new task", "new");

// Strict cloud envelopes distinguish real absence from malformed/ambiguous data.
for (const envelope of [null, {}, [], { value: undefined }, { value: 1 }, { error: "failure" }]) {
  await assert.rejects(() => readTodoState(todoCloudStorage(async () => envelope)));
}
assert.equal(await readTodoState(todoCloudStorage(async () => ({ value: null }))), null);
assert.deepEqual(await readTodoState(todoCloudStorage(async () => ({ value: JSON.stringify(fixture()) }))), fixture());
for (const ack of [undefined, null, {}, { ok: false }]) {
  await assert.rejects(() => todoCloudStorage(async () => ack).set(todo.TODAY_STORE, "{}"));
}

// Initial failure cannot create a writable empty state, including malformed history.
const badGets = [
  async () => { throw new Error("transient failure"); },
  async () => { throw Object.assign(new Error("nf"), { code: 401 }); },
  ...[null, {}, { value: null }, { value: "" }, { value: "{" }, { value: "null" }, { value: "[]" },
    ...[{ manual: {} }, { manual: [null] }, { manual: [{ id: "x", text: "x", done: "yes" }] },
      { steps: { x: "bad" } }, { stepKeys: { x: [1] } }, { stepLegacyResolved: { x: [-1] } },
      { stepUnchecked: [] }, { doneAuto: { x: "yes" } }].map((v) => ({ value: JSON.stringify(v) })),
  ].map((value) => async () => value),
];
for (const get of badGets) {
  let writes = 0;
  const h = harness({ get, set: async () => { writes++; } });
  await h.controller.load();
  assert.equal(h.view.ready, false); assert.ok(h.view.loadError);
  assert.equal(h.controller.update(add), false);
  await h.controller.save(); await h.timers.run();
  assert.equal(writes, 0); assert.equal(h.view.draft, null);
  h.controller.dispose();
}
{
  const h = harness(null); await h.controller.load(); assert.equal(h.controller.update(add), false); h.controller.dispose();
}
{
  let saved;
  const h = harness({ get: async () => { throw new Error("nf"); }, set: async (key, value) => { saved = JSON.parse(value); return { key, value }; } });
  await h.controller.load(); assert.equal(h.view.ready, true);
  h.controller.update(add); await h.timers.run();
  assert.equal(saved.manual[0].id, "new"); h.controller.dispose();
}

// Failed asynchronous save retains the complete draft/history, then explicit retry succeeds.
{
  let persisted = fixture(), fail = true;
  const original = copy(persisted);
  const h = harness({ get: async () => result(persisted), set: async (key, value) => {
    if (fail) throw new Error("synthetic rejected save"); persisted = JSON.parse(value); return { key, value };
  } });
  await h.controller.load(); h.controller.update(add); await h.timers.run();
  assert.deepEqual(persisted, original); assert.equal(h.view.draft.manual.length, 2);
  assert.ok(h.view.saveError); assert.equal(h.view.dirty, true); assert.equal(h.view.saving, false);
  for (const field of ["steps", "stepKeys", "stepLegacyResolved", "stepUnchecked", "customHistory"]) assert.deepEqual(h.view.draft[field], original[field]);
  fail = false; await h.controller.save();
  assert.equal(persisted.manual.length, 2); assert.equal(h.view.dirty, false); assert.equal(h.cache.size, 0);
  assert.deepEqual(persisted.customHistory, original.customHistory); h.controller.dispose();
}

// An ambiguous save acknowledgement is not shown as a successful save.
{
  const h = harness({ get: async () => result(fixture()), set: async () => undefined });
  await h.controller.load(); h.controller.update(add); await h.controller.save();
  assert.ok(h.view.saveError); assert.equal(h.view.dirty, true); h.controller.dispose();
}

// Writes are serialized: newer edits cannot be overwritten by an older slow save.
{
  const gate = deferred(), written = []; let active = 0, maximum = 0;
  const h = harness({ get: async () => result(fixture()), set: async (key, value) => {
    maximum = Math.max(maximum, ++active); if (!written.length) await gate.promise;
    written.push(JSON.parse(value)); active--; return { key, value };
  } });
  await h.controller.load(); h.controller.update(add);
  const saving = h.controller.save(); await drain();
  h.controller.update((s) => todo.addManual(s, "Newest edit", "newest"));
  await h.timers.run(); assert.equal(maximum, 1);
  gate.resolve(); await saving;
  assert.equal(written.length, 2); assert.equal(maximum, 1);
  assert.equal(written[1].manual.at(-1).id, "newest"); assert.equal(h.view.dirty, false); h.controller.dispose();
}

// Late reads cannot restore older state after retry or account transition.
{
  const first = deferred(); let reads = 0;
  const newer = { ...fixture(), manual: [{ id: "newer", text: "Newer remote", done: false }] };
  const h = harness({ get: async () => ++reads === 1 ? first.promise : result(newer) });
  const oldLoad = h.controller.load(); await h.controller.load(); first.resolve(result(fixture())); await oldLoad;
  assert.equal(h.view.draft.manual[0].id, "newer"); h.controller.dispose();
}
{
  const pending = deferred(); let current = true, writes = 0;
  const h = harness({ get: async () => pending.promise, set: async () => { writes++; } }, { current: () => current });
  const loading = h.controller.load(); current = false; pending.resolve(result(fixture())); await loading;
  assert.equal(h.view.ready, false); assert.equal(h.controller.update(add), false); assert.equal(writes, 0); h.controller.dispose();
}

// Singleton adapter remains identical while the session changes: old timer cannot write to B.
{
  let account = "a"; const writes = [], stores = { a: fixture(), b: { ...fixture(), manual: [{ id: "b", text: "Account B", done: false }] } };
  const beforeB = copy(stores.b);
  const singleton = { get: async () => result(stores[account]), set: async (key, value) => { writes.push(account); stores[account] = JSON.parse(value); return { key, value }; } };
  const h = harness(singleton, { current: () => account === "a" });
  await h.controller.load(); h.controller.update(add); account = "b";
  await h.timers.run(); assert.deepEqual(writes, []); assert.deepEqual(stores.b, beforeB); h.controller.dispose();
}

// Navigation cancels timers; same-account remount recovers draft only after verified read.
// Already-started requests also remain serialized across controllers/remounts.
{
  let persisted = fixture(), writes = 0, reads = 0;
  const gate = deferred(), cache = new Map();
  const storage = { get: async () => { reads++; return result(persisted); }, set: async (key, value) => {
    writes++; if (writes === 1) await gate.promise;
    persisted = JSON.parse(value); return { key, value };
  } };
  const first = harness(storage, { cache }); await first.controller.load(); first.controller.update(add);
  const oldSave = first.controller.save(); await drain();
  first.controller.update((s) => todo.addManual(s, "Newest across remount", "newest")); first.controller.dispose();
  const second = harness(storage, { cache }); const newLoad = second.controller.load(); await drain();
  assert.equal(reads, 1, "remount must wait before reading the remote baseline");
  assert.equal(second.view.ready, false); await second.controller.save(); assert.equal(writes, 1);
  gate.resolve(); await oldSave; await newLoad;
  assert.equal(reads, 2); assert.equal(second.view.ready, true); assert.equal(second.view.dirty, true);
  assert.equal(second.view.draft.manual.at(-1).id, "newest");
  assert.equal(writes, 1, "recovered draft is not automatically saved");
  await second.controller.save();
  assert.equal(writes, 2); assert.equal(persisted.manual.at(-1).id, "newest"); assert.equal(cache.size, 0); second.controller.dispose();
}
{
  let persisted = fixture(), writes = 0;
  const gate = deferred(), cache = new Map();
  const storage = { get: async () => result(persisted), set: async (key, value) => {
    writes++; if (writes === 1) await gate.promise;
    persisted = JSON.parse(value); return { key, value };
  } };
  const first = harness(storage, { cache }); await first.controller.load(); first.controller.update(add);
  const oldSave = first.controller.save(); await drain(); first.controller.dispose();
  const second = harness(storage, { cache }); const newLoad = second.controller.load();
  gate.reject(new Error("old request failed")); await oldSave; await newLoad;
  assert.equal(second.view.ready, true); assert.equal(second.view.dirty, true);
  assert.equal(second.view.draft.manual.length, 2); assert.equal(writes, 1);
  await second.controller.save(); assert.equal(persisted.manual.length, 2); second.controller.dispose();
}
{
  let persisted = fixture(), writes = 0;
  const storage = { get: async () => result(persisted), set: async (key, value) => { writes++; persisted = JSON.parse(value); return { key, value }; } };
  const cache = new Map(), h = harness(storage, { cache });
  await h.controller.load(); h.controller.update(add); h.controller.dispose();
  assert.equal(h.timers.pending.size, 0); await h.timers.run(); assert.equal(writes, 0);
  const remount = harness(storage, { cache }); await remount.controller.load();
  assert.equal(remount.view.draft.manual.length, 2); assert.ok(remount.view.saveError); assert.equal(remount.timers.pending.size, 0);
  await remount.timers.run(); assert.equal(writes, 0);
  await remount.controller.save(); assert.equal(writes, 1); remount.controller.dispose();
}
{
  let persisted = fixture(), writes = 0;
  const cache = new Map(), storage = { get: async () => result(persisted), set: async () => { writes++; } };
  const first = harness(storage, { cache }); await first.controller.load(); first.controller.update(add); first.controller.dispose();
  persisted.manual.push({ id: "remote-new", text: "Newer remote change", done: false });
  const changedRemote = copy(persisted), remount = harness(storage, { cache }); await remount.controller.load();
  assert.equal(remount.view.ready, false); assert.ok(remount.view.loadError.includes("別の場所"));
  assert.equal(remount.view.draft.manual.at(-1).id, "new"); assert.equal(remount.controller.update(add), false);
  await remount.controller.save(); assert.equal(writes, 0); assert.deepEqual(persisted, changedRemote); assert.equal(cache.size, 1); remount.controller.dispose();
  const other = harness(storage, { cache, cacheKey: "account-b" }); await other.controller.load();
  assert.equal(other.view.draft.manual.at(-1).id, "remote-new"); assert.equal(other.view.dirty, false); other.controller.dispose();
}
{
  let failing = false;
  const h = harness({ get: async () => { if (failing) throw new Error("retry failed"); return result(fixture()); } });
  await h.controller.load(); h.controller.update(add); const draft = copy(h.view.draft);
  failing = true; await h.controller.load();
  assert.deepEqual(h.view.draft, draft); assert.equal(h.view.ready, false); assert.equal(h.cache.size, 1); h.controller.dispose();
}

// Execute the actual TodayTodo component to protect lifecycle and UI wiring.
const source = fs.readFileSync(new URL("../monogataritch.src.jsx", import.meta.url), "utf8");
const code = source.slice(source.indexOf("const todayYmd ="), source.indexOf("export default function App()"));
class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ["2026-10-02T12:00:00Z"])); } }
function mount(storage, options = {}) {
  const slots = [], effects = [], timers = clock(); let cursor = 0, dirty = true, tree, mounted = true;
  const useState = (initial) => { const i = cursor++; slots[i] ||= { value: typeof initial === "function" ? initial() : initial }; return [slots[i].value, (v) => { if (mounted) { slots[i].value = typeof v === "function" ? v(slots[i].value) : v; dirty = true; } }]; };
  const useRef = (initial) => { const i = cursor++; return slots[i] ||= { current: initial }; };
  const changed = (a, b) => !a || b.some((x, i) => !Object.is(x, a[i]));
  const useEffect = (fn, deps) => { const i = cursor++; if (changed(slots[i]?.deps, deps)) { const old = slots[i]; slots[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = fn(); }); } };
  const useMemo = (fn, deps) => { const i = cursor++; if (changed(slots[i]?.deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; };
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter((x) => x !== false && x != null) }) };
  const context = vm.createContext({ React, useState, useRef, useEffect, useMemo, Date: FixedDate, Map, window: { storage },
    MG_SESSION: "synthetic-session-a", cloudStorage: {}, authFetch: () => { throw new Error("unexpected cloud request"); },
    createTodoPersistence: (opts) => createTodoPersistence({ ...opts, ...timers }), todoCloudStorage,
    todayRollover: todo.rollover, todayAdd: todo.addManual, todayToggle: todo.toggle, todayRemove: todo.removeManual,
    todayList: todo.todoList, todayToggleStep: todo.toggleStep, todayFmtSec: todo.fmtSec,
    todayLinkSections: todo.linkCaseSections, todayLoadRows: todo.loadScheduleRows, todayRestSec: todo.restSec, ...options });
  vm.runInContext(transformSync(code + "\nglobalThis.Component = TodayTodo;", { loader: "jsx" }).code, context);
  const props = { ownerKey: "account-a", theme: { accent: "#a00" }, cases: [], onOpenCase() {} };
  const flush = async () => { for (let i = 0; i < 40; i++) { if (dirty) { cursor = 0; dirty = false; tree = context.Component(props); while (effects.length) effects.shift()(); } await Promise.resolve(); } };
  return { flush, context, timers, get tree() { return tree; }, unmount() { mounted = false; for (const slot of slots) slot.cleanup?.(); } };
}
const nodes = (x) => x && typeof x === "object" ? [x, ...x.children.flatMap(nodes)] : [];
const text = (x) => typeof x === "string" ? x : (x?.children || []).map(text).join("");
const button = (app, label) => { const b = nodes(app.tree).find((n) => n.type === "button" && text(n) === label); assert.ok(b, label); return b; };
async function addInUI(app) {
  const input = nodes(app.tree).find((n) => n.type === "input" && n.props.placeholder === "今日やることを追加（Enter）");
  assert.ok(input); input.props.onChange({ target: { value: "UI synthetic edit" } }); await app.flush();
  button(app, "追加").props.onClick(); await app.flush();
}
{
  let fail = true, writes = 0;
  const app = mount({ get: async () => { if (fail) throw new Error("failed load"); return result(fixture()); }, set: async (key, value) => { writes++; return { key, value }; } });
  await app.flush(); assert.ok(text(app.tree).includes("履歴を保護")); assert.equal(nodes(app.tree).some((n) => n.type === "input"), false);
  await app.timers.run(); assert.equal(writes, 0); fail = false; button(app, "もう一度読み込む").props.onClick(); await app.flush();
  await addInUI(app); await app.timers.run(); await app.flush(); assert.equal(writes, 1); app.unmount();
}
{
  let fail = true, persisted = fixture();
  const app = mount({ get: async () => result(persisted), set: async (key, value) => { if (fail) throw new Error("save rejected"); persisted = JSON.parse(value); return { key, value }; } });
  await app.flush(); await addInUI(app); await app.timers.run(); await app.flush();
  assert.ok(text(app.tree).includes("変更を保存できません")); assert.equal(persisted.manual.length, 1);
  fail = false; button(app, "再保存する").props.onClick(); await app.flush();
  assert.equal(persisted.manual.length, 2); app.unmount();
}
{
  let writes = 0;
  const singleton = {}, app = mount(singleton, { cloudStorage: singleton, authFetch: async (path, body) => {
    if (path.endsWith("/get")) return { value: JSON.stringify(fixture()) }; writes++; return { ok: true };
  } });
  await app.flush(); await addInUI(app); assert.equal(app.timers.pending.size, 1);
  app.context.MG_SESSION = "synthetic-session-b"; await app.timers.run(); await app.flush(); assert.equal(writes, 0);
  app.unmount(); assert.equal(app.timers.pending.size, 0);
}
{
  let writes = 0;
  const app = mount({ get: async () => result(fixture()), set: async () => { writes++; } });
  await app.flush(); await addInUI(app); app.unmount(); assert.equal(app.timers.pending.size, 0);
  await app.timers.run(); assert.equal(writes, 0);
}
assert.equal(networkCalls, 0);
globalThis.fetch = originalFetch;
console.log("today todo storage tests passed (synthetic only; zero network calls)");
