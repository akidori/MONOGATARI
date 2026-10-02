// PR34 の GET /api/snap 回帰テスト。合成スナップ・合成トークン・メモリ内KVだけを使用する。
// Workerはwrite:falseでメモリ内にbundleし、Cloudflare/外部通信は使用しない。runtime sourceは変更しない。
// これはチェックアウトのsource検証。本番Workerのバージョンやデプロイ完了を証明するものではない。
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw new Error("network forbidden in synthetic privacy test"); };

const snapshot = {
  project: {
    name: "Synthetic privacy fixture",
    manualsGlobal: "SYNTHETIC_INTERNAL_MANUAL",
    meta: {
      note: "SYNTHETIC_INTERNAL_NOTE",
      prod: { talents: [{ name: "SYNTHETIC_PRIVATE_NAME", reading: "synthetic", publicName: "synthetic-public" }], editor: "SYNTHETIC_EDITOR" },
      shootDate: "2099-01-01",
    },
    rows: [{ id: "synthetic-row", script: "Synthetic shared script", spine: "SYNTHETIC_INTERNAL_SPINE" }],
  },
  createdAt: "2099-01-01T00:00:00.000Z",
};
const readToken = "synthetic-read";
const editorToken = "synthetic-editor";
const adminToken = "synthetic-admin";
const seenKey = "upseen:synthetic";
const snapKey = "snap:synthetic";
let passed = 0;

function fixture({ legacy = false, missingEditor = false, missingSnap = false, alreadySeen = false, failRead = "", failSeenWrite = false } = {}) {
  const kv = new Map([
    [snapKey, JSON.stringify(snapshot)],
    ["tok:synthetic", adminToken],
    ["uptok:synthetic", editorToken],
    ["uptok:other-synthetic", "synthetic-other-editor"],
  ]);
  if (!legacy) kv.set("rtok:synthetic", readToken);
  if (missingEditor) kv.delete("uptok:synthetic");
  if (missingSnap) kv.delete(snapKey);
  if (alreadySeen) kv.set(seenKey, "2098-12-31T00:00:00.000Z");
  const before = new Map(kv);
  const loadedSnapshots = [], puts = [], forbiddenOperations = [];
  const allowedReads = new Set([snapKey, "tok:synthetic", "uptok:synthetic", "rtok:synthetic", seenKey]);
  const env = {
    // 空の設定だけ。process.env・実credentials・外部service bindingは一切読まない。
    STREAM_ACCOUNT_ID: "", STREAM_API_TOKEN: "",
    SNAPS: {
      async get(key, type) {
        if (!allowedReads.has(key)) { forbiddenOperations.push("get:" + key); throw new Error("unexpected synthetic KV read"); }
        if (key === failRead) throw new Error("synthetic KV read failure");
        if (!kv.has(key)) return null;
        const value = type === "json" ? JSON.parse(kv.get(key)) : kv.get(key);
        if (key === snapKey && type === "json") loadedSnapshots.push(value);
        return value;
      },
      async put(key, value) {
        puts.push(key);
        // upseen の既存仕様だけをメモリ内で許可。snap/credential/その他の更新は検出する。
        if (key !== seenKey) { forbiddenOperations.push("put:" + key); throw new Error("unexpected synthetic KV write"); }
        if (failSeenWrite) throw new Error("synthetic KV write failure");
        kv.set(key, value);
      },
    },
  };
  return {
    env, kv, puts,
    assertUnchanged(label) {
      assert.deepEqual(forbiddenOperations, [], label + ": unexpected KV operation");
      for (const loaded of loadedSnapshots) assert.deepEqual(loaded, snapshot, label + ": redaction mutated loaded snapshot");
      assert.deepEqual([...kv].filter(([k]) => k !== seenKey), [...before].filter(([k]) => k !== seenKey), label + ": snapshot or token storage changed");
      if (before.has(seenKey)) assert.equal(kv.get(seenKey), before.get(seenKey), label + ": existing seen marker changed");
      assert.equal(networkCalls, 0, label + ": external network attempted");
    },
  };
}

try {
  const bundled = await build({
    absWorkingDir: root, entryPoints: ["worker/src/index.js"], bundle: true, write: false,
    format: "esm", platform: "neutral", loader: { ".md": "text" }, logLevel: "silent",
    plugins: [{ name: "synthetic-cloudflare", setup(builder) {
      builder.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: "workers", namespace: "synthetic" }));
      builder.onLoad({ filter: /.*/, namespace: "synthetic" }, () => ({
        contents: 'export class DurableObject { constructor() { throw new Error("DurableObject must not run in snapshot privacy tests"); } }',
      }));
    } }],
  });
  const { default: worker } = await import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64"));

  async function check(label, params, { status = 200, prod = false, admin = false, putCount = 0, state = fixture() } = {}) {
    const query = new URLSearchParams(params).toString();
    const res = await worker.fetch(new Request("https://synthetic.invalid/api/snap/synthetic" + (query ? "?" + query : "")), state.env, {});
    assert.equal(res.status, status, label + ": status");
    const data = await res.json();
    if (status === 200) {
      assert.equal("prod" in data.project.meta, prod, label + ": production info visibility");
      assert.equal("manualsGlobal" in data.project, admin, label + ": internal manual visibility");
      assert.equal("note" in data.project.meta, admin, label + ": internal note visibility");
      assert.equal("spine" in data.project.rows[0], admin, label + ": internal spine visibility");
      if (prod) assert.deepEqual(data.project.meta.prod, snapshot.project.meta.prod, label + ": editor info preserved");
      if (admin) assert.deepEqual(data, snapshot, label + ": admin snapshot preserved");
      assert.equal(data.project.rows[0].script, snapshot.project.rows[0].script, label + ": shared script preserved");
      assert.equal(data.project.meta.shootDate, snapshot.project.meta.shootDate, label + ": shared metadata preserved");
      assert.equal(data.createdAt, snapshot.createdAt, label + ": snapshot metadata preserved");
    } else {
      assert.ok(!data.project, label + ": rejected request exposed project");
      assert.ok(!JSON.stringify(data).includes("SYNTHETIC_PRIVATE_NAME"), label + ": rejected request exposed private data");
    }
    assert.equal(state.puts.length, putCount, label + ": seen marker writes");
    state.assertUnchanged(label);
    passed++;
    return state;
  }

  await check("read token absent", {}, { status: 401 });
  await check("read token wrong", { r: "wrong" }, { status: 401 });
  await check("editor token alone cannot bypass read token", { up: editorToken }, { status: 401 });
  await check("editor token cannot bypass wrong read token", { r: "wrong", up: editorToken }, { status: 401 });
  await check("public read", { r: readToken });
  await check("wrong editor token", { r: readToken, up: "wrong" });
  await check("other snapshot editor token", { r: readToken, up: "synthetic-other-editor" });
  await check("live editToken is not a snapshot editor token", { r: readToken, editToken: editorToken });
  await check("wrong admin token with valid read", { r: readToken, token: "wrong" });
  await check("wrong admin token without read", { token: "wrong" }, { status: 401 });
  const editorState = await check("valid editor token", { r: readToken, up: editorToken }, { prod: true, putCount: 1 });
  await check("repeat editor visit writes marker once", { r: readToken, up: editorToken }, { prod: true, putCount: 1, state: editorState });
  await check("public read after editor remains redacted", { r: readToken }, { putCount: 1, state: editorState });
  await check("existing seen marker does not replace token check", { r: readToken, up: "wrong" }, { state: fixture({ alreadySeen: true }) });
  await check("editor with existing seen marker", { r: readToken, up: editorToken }, { prod: true, state: fixture({ alreadySeen: true }) });
  await check("admin token without read", { token: adminToken }, { prod: true, admin: true });
  await check("admin token with wrong read", { r: "wrong", token: adminToken }, { prod: true, admin: true });
  await check("legacy public grace", {}, { state: fixture({ legacy: true }) });
  await check("legacy wrong editor", { up: "wrong" }, { state: fixture({ legacy: true }) });
  await check("legacy valid editor", { up: editorToken }, { prod: true, putCount: 1, state: fixture({ legacy: true }) });
  await check("legacy admin", { token: adminToken }, { prod: true, admin: true, state: fixture({ legacy: true }) });
  await check("legacy wrong admin", { token: "wrong" }, { state: fixture({ legacy: true }) });
  await check("missing editor credential fails closed", { r: readToken, up: editorToken }, { state: fixture({ missingEditor: true }) });
  await check("editor lookup failure fails closed", { r: readToken, up: editorToken }, { state: fixture({ failRead: "uptok:synthetic" }) });
  await check("seen lookup failure retains verified editor access", { r: readToken, up: editorToken }, { prod: true, state: fixture({ failRead: seenKey }) });
  await check("seen write failure retains verified editor access", { r: readToken, up: editorToken }, { prod: true, putCount: 1, state: fixture({ failSeenWrite: true }) });
  await check("missing snapshot", { r: readToken }, { status: 404, state: fixture({ missingSnap: true }) });

  assert.equal(networkCalls, 0);
  console.log(`share privacy regression tests passed (${passed} synthetic route cases; zero network calls; snapshots/tokens unchanged)`);
} finally {
  globalThis.fetch = originalFetch;
}
