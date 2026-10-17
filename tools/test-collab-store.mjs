// 共同編集の保存先 KV→D1（worker/src/collab-store.js・SaaS化 2本目）の回帰テスト
// D1 は node:sqlite、KV は Map で代用する。KV への書き込み回数（無料枠 1日1,000回）が増えないことも見る
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { loadCollab, saveCollab, deleteCollab, collabIdsFor, _resetCollabStoreForTest } from "../worker/src/collab-store.js";

function fakeD1(db) {
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => db.prepare(sql).run(...args),
    _exec: () => db.prepare(sql).run(...args),
  });
  return {
    prepare: (sql) => stmt(sql),
    batch: async (stmts) => {
      db.exec("BEGIN");
      try { for (const s of stmts) s._exec(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; }
    },
  };
}
function fakeKV() {
  const m = new Map(); let puts = 0;
  return {
    m, puts: () => puts,
    get: async (k, t) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)) : m.get(k)) : null),
    put: async (k, v) => { puts++; m.set(k, v); },
    delete: async (k) => { puts++; m.delete(k); },
  };
}
function newEnv({ withTables = true } = {}) {
  _resetCollabStoreForTest();
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE mg_kv (sub TEXT, key TEXT, value TEXT, proj_id TEXT, case_id TEXT, name TEXT, channel TEXT, bytes INTEGER, workspace_id TEXT, updated_at TEXT, PRIMARY KEY (sub, key))`);
  if (withTables) db.exec(readFileSync(new URL("./2026-10-17_collab_d1.sql", import.meta.url), "utf8"));
  return { db, env: { DB: fakeD1(db), SNAPS: fakeKV() } };
}
const row = (db, sub, id) => db.prepare("SELECT * FROM mg_kv WHERE sub=? AND key=?").get(sub, "monogataritch-proj-" + id);

// 1) D1 に保存・読み戻し。KV には一度も書かない
{
  const { db, env } = newEnv();
  const doc = { id: "p1", ownerSub: "100", ownerEmail: "Owner@x.jp", members: ["owner@x.jp"], project: { id: "p1", name: "企画A", rows: [] }, name: "企画A", channel: "ch", updatedAt: "2026-10-17T00:00:00.000Z" };
  await saveCollab(env, doc);
  doc.members.push("ed@x.jp");
  await saveCollab(env, doc, { project: false });
  const got = await loadCollab(env, "p1");
  assert.equal(got.ownerSub, "100");
  assert.equal(got.ownerEmail, "owner@x.jp");
  assert.deepEqual(got.members, ["owner@x.jp", "ed@x.jp"], "オーナーが先頭のまま");
  assert.equal(got.project.name, "企画A");
  assert.equal(got.updatedAt, "2026-10-17T00:00:00.000Z");
  assert.deepEqual(await collabIdsFor(env, "ED@x.jp"), ["p1"]);
  assert.equal(env.SNAPS.puts(), 0, "D1 移行後は KV に書かない");

  // 外したら一覧から消える
  doc.members = ["owner@x.jp"];
  await saveCollab(env, doc, { project: false });
  assert.deepEqual(await collabIdsFor(env, "ed@x.jp"), []);
}

// 2) 案件の中身を書いても mg_kv の case_id / workspace_id が消えない（INSERT OR REPLACE をやめた）
{
  const { db, env } = newEnv();
  db.prepare("INSERT INTO mg_kv (sub,key,value,proj_id,case_id,workspace_id) VALUES ('100','monogataritch-proj-p2','{}','p2','C-9','ws_bf')").run();
  await saveCollab(env, { id: "p2", ownerSub: "100", ownerEmail: "o@x.jp", members: ["o@x.jp"], project: { id: "p2", name: "新" }, name: "新", channel: "" });
  const r = row(db, "100", "p2");
  assert.equal(r.case_id, "C-9");
  assert.equal(r.workspace_id, "ws_bf");
  assert.equal(JSON.parse(r.value).name, "新");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mg_kv").get().n, 1);
}

// 3) KV にしか無い古い共同編集は、読んだ時に D1 へ写る。mg_kv 行があればそちらの中身を正とする
{
  const { db, env } = newEnv();
  const old = { id: "p3", ownerSub: "100", ownerEmail: "o@x.jp", members: ["o@x.jp", "ed@x.jp"], project: { id: "p3", name: "KVの版" }, name: "KVの版", channel: "c", updatedAt: "2026-10-01T00:00:00.000Z" };
  env.SNAPS.m.set("col:p3", JSON.stringify(old));
  env.SNAPS.m.set("colmember:ed@x.jp", JSON.stringify(["p3", "gone"]));
  db.prepare("INSERT INTO mg_kv (sub,key,value,proj_id) VALUES ('100','monogataritch-proj-p3',?, 'p3')").run(JSON.stringify({ id: "p3", name: "D1の版" }));
  assert.deepEqual(await collabIdsFor(env, "ed@x.jp"), ["p3"], "KV索引の消えた案件(gone)は出さない");
  assert.ok(db.prepare("SELECT 1 FROM mg_collab WHERE id='p3'").get(), "D1 に写った");
  const got = await loadCollab(env, "p3");
  assert.equal(got.project.name, "D1の版");
  assert.equal(got.updatedAt, "2026-10-01T00:00:00.000Z", "競合検知の版は引き継ぐ");
  assert.equal(env.SNAPS.puts(), 0);

  // 写した後に外されたら、KV 索引に id が残っていても出さない
  got.members = ["o@x.jp"];
  await saveCollab(env, got, { project: false });
  assert.deepEqual(await collabIdsFor(env, "ed@x.jp"), []);
}

// 4) mg_kv 行が無い古い共同編集（08-25 以前の昇格）は KV の中身を mg_kv に戻す
{
  const { db, env } = newEnv();
  env.SNAPS.m.set("col:p4", JSON.stringify({ id: "p4", ownerSub: "100", ownerEmail: "o@x.jp", members: ["o@x.jp"], project: { id: "p4", name: "古い" }, name: "古い", channel: "", updatedAt: "2026-08-01T00:00:00.000Z" }));
  await loadCollab(env, "p4");
  assert.equal(JSON.parse(row(db, "100", "p4").value).name, "古い");
}

// 5) 削除すると D1 からも KV の控えからも消え、読み直しても復活しない。案件の中身（mg_kv）は残す
{
  const { db, env } = newEnv();
  env.SNAPS.m.set("col:p5", JSON.stringify({ id: "p5", ownerSub: "100", ownerEmail: "o@x.jp", members: ["o@x.jp"], project: { id: "p5" }, updatedAt: "x" }));
  const doc = await loadCollab(env, "p5");
  await deleteCollab(env, doc);
  assert.equal(await loadCollab(env, "p5"), null);
  assert.ok(row(db, "100", "p5"));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mg_collab_members").get().n, 0);
}

// 6) 移行SQLが未実行なら今まで通り KV に書く（デプロイ順を間違えても壊れない）
{
  const { db, env } = newEnv({ withTables: false });
  const doc = { id: "p6", ownerSub: "100", ownerEmail: "o@x.jp", members: ["o@x.jp"], project: { id: "p6", name: "K" }, name: "K", channel: "", updatedAt: "t" };
  await saveCollab(env, doc);
  assert.equal((await loadCollab(env, "p6")).project.name, "K");
  assert.deepEqual(await collabIdsFor(env, "o@x.jp"), ["p6"]);
  assert.equal(JSON.parse(row(db, "100", "p6").value).name, "K", "mg_kv へのミラーも続ける");
  await deleteCollab(env, doc);
  assert.equal(await loadCollab(env, "p6"), null);
  assert.deepEqual(await collabIdsFor(env, "o@x.jp"), []);

  // SQL を流すと、同じ isolate のまま D1 に切り替わる
  db.exec(readFileSync(new URL("./2026-10-17_collab_d1.sql", import.meta.url), "utf8"));
  const before = env.SNAPS.puts();
  await saveCollab(env, { ...doc, id: "p7" });
  assert.equal(env.SNAPS.puts(), before);
  assert.ok(db.prepare("SELECT 1 FROM mg_collab WHERE id='p7'").get());
}

// 7) Worker の共同編集APIが KV に直接書いていない
{
  const src = readFileSync(new URL("../worker/src/index.js", import.meta.url), "utf8");
  assert.ok(!/SNAPS\.put\(\s*["'`]col/.test(src) && !src.includes('"colmember:'), "index.js に col:/colmember: の直書きが残っている");
}

console.log("test-collab-store: ok");
