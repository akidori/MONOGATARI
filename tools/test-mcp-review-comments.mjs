// MCP get_review_comments：読みキーで動画確認コメントを返し、鍵なし・別の鍵では読めないこと。
import assert from "node:assert/strict";
import { timingSafeEqual } from "node:crypto";
// Workers 専用の crypto.subtle.timingSafeEqual を Node で補う
if (!crypto.subtle.timingSafeEqual) crypto.subtle.timingSafeEqual = (a, b) => timingSafeEqual(Buffer.from(a), Buffer.from(b));
const { handleMcp } = await import("../worker/src/mcp.js");

const project = { name: "テスト案件", channel: "オリックス", shareId: "shr0001", review: { versions: [{ id: "v1", label: "初稿" }] } };
const kv = {
  "cmt:shr0001": [
    { id: "c1", text: "ここでSE", timecode: 12.5, author: "中村諭律", createdAt: "2026-10-01T00:00:00Z", resolved: false, status: "未対応", category: "音", priority: "中", versionId: "v1", images: [{ key: "secret/key.png" }], replies: [{ author: "編集者", text: "修正しました", createdAt: "2026-10-02T00:00:00Z" }] },
    { id: "c2", text: "テロップ誤字", timecode: null, author: "先方", createdAt: "2026-10-03T00:00:00Z", resolved: true },
  ],
};
const env = {
  MCP_READ_KEY: "read-key", MCP_WRITE_KEY: "write-key",
  DB: { prepare: () => ({ bind: () => ({ first: async () => ({ sub: "s", key: "monogataritch-proj-proj01", value: JSON.stringify(project) }), all: async () => ({ results: [] }) }) }) },
  SNAPS: { get: async (k, t) => (k in kv ? (t === "json" ? kv[k] : JSON.stringify(kv[k])) : null) },
};
const call = (key, args = { id: "proj01" }) => handleMcp(new Request("https://x/mcp", {
  method: "POST", headers: key ? { Authorization: "Bearer " + key } : {},
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_review_comments", arguments: args } }),
}), env, { slim: false });

// 読みキーで読める
let r = await call("read-key");
assert.equal(r.status, 200);
let body = await r.json();
const out = JSON.parse(body.result.content[0].text);
assert.equal(out.count, 2);
assert.equal(out.comments[0].text, "ここでSE");
assert.equal(out.comments[0].timecode, 12.5);
assert.equal(out.comments[0].author, "中村諭律");
assert.equal(out.comments[0].version, "初稿");
assert.equal(out.comments[0].replies[0].text, "修正しました");
assert.equal(out.comments[1].resolved, true);
assert.ok(!("images" in out.comments[0]), "添付画像のキーは返さない");

// 鍵なし・先方用の鍵（MCPの鍵以外）は401
assert.equal((await call(null)).status, 401);
assert.equal((await call("ctok-client-key")).status, 401);

// tools/list に読み取り専用で載っている
r = await handleMcp(new Request("https://x/mcp", { method: "POST", headers: { Authorization: "Bearer read-key" }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) }), env, { slim: false });
const t = (await r.json()).result.tools.find((x) => x.name === "get_review_comments");
assert.ok(t && t.annotations.readOnlyHint === true);

console.log("test-mcp-review-comments: ok");
