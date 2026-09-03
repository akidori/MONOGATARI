import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const origin = "https://monogataritch.pages.dev";
const dist = path.resolve(import.meta.dirname, "../dist");
const hash = (data) => createHash("sha256").update(data).digest("hex");
const assertMatch = (file, local, remote) => {
  if (hash(local) !== hash(remote)) throw new Error(`${file} does not match production`);
};

const localIndex = await readFile(path.join(dist, "index.html"));
const remoteIndex = Buffer.from(await (await fetch(`${origin}/index.html?verify=${Date.now()}`)).arrayBuffer());
assertMatch("index.html", localIndex, remoteIndex);

// Fetch the exact versioned URL referenced by production index. Cloudflare may retain
// older query variants, so an unrelated cache-busting query is not authoritative.
const appPath = remoteIndex.toString("utf8").match(/app\.js\?v=[^"']+/)?.[0];
if (!appPath) throw new Error("production index has no versioned app.js URL");
const localApp = await readFile(path.join(dist, "app.js"));
const remoteApp = Buffer.from(await (await fetch(`${origin}/${appPath}`)).arrayBuffer());
assertMatch("app.js", localApp, remoteApp);

const localSw = await readFile(path.join(dist, "sw.js"));
const remoteSw = Buffer.from(await (await fetch(`${origin}/sw.js?verify=${Date.now()}`)).arrayBuffer());
assertMatch("sw.js", localSw, remoteSw);
// share.html（先方・編集者が開く共有ページ）も本番一致を確認する。2026-09-03 監査で追加。
const localShare = await readFile(path.join(dist, "share.html"));
const remoteShare = Buffer.from(await (await fetch(`${origin}/share.html?verify=${Date.now()}`)).arrayBuffer());
assertMatch("share.html", localShare, remoteShare);
console.log("production files match dist");
