// TodayTodo persistence only. No data migration, deletion, or network calls of its own.
import { rollover, TODAY_STORE } from "./today-todo.js";

const record = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const own = (x, key) => Object.hasOwn(x, key);

// The shared cloud wrapper treats malformed responses as "nf". Use a strict
// boundary for TodayTodo: only an explicit null value confirms an absent key.
export function todoCloudStorage(request) {
  return {
    async get(key) {
      const result = await request("/api/kv/get", { key });
      if (!record(result) || !own(result, "value") || (result.value !== null && typeof result.value !== "string")) throw new Error("invalid storage response");
      if (result.value === null) throw new Error("nf");
      return { key, value: result.value };
    },
    async set(key, value) {
      const result = await request("/api/kv/set", { key, value });
      if (!record(result) || result.ok !== true) throw new Error("save not confirmed");
      return { key, value };
    },
  };
}

export async function readTodoState(storage) {
  if (!storage || typeof storage.get !== "function") throw new Error("storage unavailable");
  let result;
  try { result = await storage.get(TODAY_STORE); }
  catch (error) {
    if (error?.message === "nf" && !error.code) return null;
    throw error;
  }
  if (!record(result) || typeof result.value !== "string") throw new Error("invalid todo response");
  const value = JSON.parse(result.value);
  if (!record(value)) throw new Error("invalid todo state");
  if (own(value, "date") && typeof value.date !== "string") throw new Error("invalid todo date");
  if (own(value, "manual") && (!Array.isArray(value.manual) || value.manual.some((m) => !record(m) || typeof m.id !== "string" || typeof m.text !== "string" || (own(m, "done") && typeof m.done !== "boolean")))) throw new Error("invalid manual tasks");
  for (const key of ["doneAuto", "stepAutoCompleted"]) {
    if (own(value, key) && (!record(value[key]) || Object.values(value[key]).some((x) => typeof x !== "boolean"))) throw new Error("invalid todo flags");
  }
  for (const key of ["steps", "stepLegacyResolved", "stepKeys", "stepUnchecked"]) {
    const indexed = key === "steps" || key === "stepLegacyResolved";
    if (own(value, key) && (!record(value[key]) || Object.values(value[key]).some((xs) => !Array.isArray(xs) || xs.some((x) => indexed ? !Number.isInteger(x) || x < 0 : typeof x !== "string")))) throw new Error("invalid todo history");
  }
  return value;
}

// cache is memory-only and scoped by the caller's account. It retains unsaved
// drafts across navigation; a changed remote baseline blocks overwriting it.
export function createTodoPersistence({ storage, current, today, onChange, cache, cacheKey,
  setTimer = setTimeout, clearTimer = clearTimeout }) {
  let active = true, readVersion = 0, timer = null, busy = false, savedRaw = null;
  let view = { draft: null, ready: false, loading: false, saving: false, dirty: false, loadError: "", saveError: "" };
  const valid = () => active && current();
  const emit = (patch) => { view = { ...view, ...patch }; if (active) onChange(view); };
  const remember = () => { if (view.dirty) cache.set(cacheKey, { ...cache.get(cacheKey), savedRaw, draft: view.draft }); };
  const cancel = () => { if (timer !== null) clearTimer(timer); timer = null; };
  const mergeRollover = (value) => ({ ...(value || {}), ...rollover(value, today()) });

  async function load() {
    if (!valid() || busy) return;
    const version = ++readVersion;
    cancel();
    emit({ ready: false, loading: true, loadError: "" });
    try {
      // A previous mount may still have a request in flight. Read only after
      // it settles, so its old write cannot land after this mount's new save.
      while (cache.get(cacheKey)?.inFlight) {
        await cache.get(cacheKey).inFlight.catch(() => {});
        if (!valid() || version !== readVersion) return;
      }
      const value = await readTodoState(storage);
      if (!valid() || version !== readVersion) return;
      const remoteRaw = value === null ? null : JSON.stringify(value);
      const pending = cache.get(cacheKey);
      if (pending && remoteRaw !== pending.savedRaw && remoteRaw !== JSON.stringify(pending.draft)) {
        savedRaw = pending.savedRaw;
        emit({ draft: pending.draft, dirty: true, loading: false, loadError: "保存済みの内容が別の場所で変わっています。下書きと履歴を保護するため、上書きを止めています。" });
        return;
      }
      savedRaw = remoteRaw;
      const dirty = !!pending && remoteRaw !== JSON.stringify(pending.draft);
      if (!dirty) cache.delete(cacheKey);
      emit({ draft: mergeRollover(dirty ? pending.draft : value), ready: true, loading: false, dirty,
        saveError: dirty ? "前回の未保存の内容をこのタブ内に保持しています。確認して再保存してください。再読み込みやタブを閉じると未保存分が失われる場合があります。" : "" });
      remember();
    } catch (_) {
      if (valid() && version === readVersion) emit({ loading: false, ready: false,
        loadError: "保存済みの今日やることを読み込めませんでした。履歴を保護するため、読み込めるまで編集・保存を止めています。" });
    }
  }

  async function save() {
    cancel();
    if (!valid() || !view.ready || !view.dirty || busy) return;
    if (cache.get(cacheKey)?.inFlight) {
      emit({ ready: false, loadError: "前の保存を確認しています。履歴を保護するため、もう一度読み込んでから保存してください。" });
      return;
    }
    busy = true;
    emit({ saving: true, saveError: "" });
    try {
      // Serialize writes. Edits made during a save follow it, never race it.
      while (valid() && view.ready && view.dirty) {
        const draft = view.draft, raw = JSON.stringify(draft);
        if (!valid() || !storage || typeof storage.set !== "function") throw new Error("storage unavailable");
        // This barrier outlives the controller. Reconcile only this operation's
        // cache entry, even if navigation/account change made the UI inactive.
        const operation = Promise.resolve().then(async () => {
          if (!valid()) throw new Error("storage scope changed");
          const result = await storage.set(TODAY_STORE, raw);
          if (!record(result) || result.key !== TODAY_STORE || result.value !== raw) throw new Error("save not confirmed");
        });
        const inFlight = operation.then(() => {
          const pending = cache.get(cacheKey);
          if (pending?.inFlight !== inFlight) return;
          if (JSON.stringify(pending.draft) === raw) cache.delete(cacheKey);
          else cache.set(cacheKey, { ...pending, savedRaw: raw, inFlight: null });
        }, (error) => {
          const pending = cache.get(cacheKey);
          if (pending?.inFlight === inFlight) cache.set(cacheKey, { ...pending, inFlight: null });
          throw error;
        });
        cache.set(cacheKey, { ...cache.get(cacheKey), savedRaw, draft: view.draft, inFlight });
        await inFlight;
        if (!valid()) return;
        savedRaw = raw;
        if (view.draft === draft) { cache.delete(cacheKey); emit({ dirty: false }); }
        else remember();
      }
    } catch (_) {
      if (valid()) {
        remember();
        emit({ saveError: "変更を保存できませんでした。未保存の内容はこのタブ内に保持しています。接続を確認して再保存してください。再読み込みやタブを閉じる前に保存を確認してください。" });
      }
    } finally {
      busy = false;
      if (valid()) emit({ saving: false });
    }
  }

  return {
    load, save,
    update(change) {
      if (!valid() || !view.ready || !view.draft) return false;
      const next = change(mergeRollover(view.draft));
      emit({ draft: { ...view.draft, ...next }, dirty: true });
      remember();
      cancel();
      timer = setTimer(() => { timer = null; void save(); }, 400);
      return true;
    },
    dispose() { cancel(); active = false; readVersion++; },
    snapshot: () => view,
  };
}
