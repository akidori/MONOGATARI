/* ============================================================
   ものがたりっち！ 共有＋コメント Worker
   - 構成台本スナップショットの publish / 取得
   - 先方コメントの投稿 / 取得 / 解決(対応済)
   保存は Workers KV（SNAPS）。
   キー設計:
     snap:{id}  -> { project, createdAt, updatedAt }
     cmt:{id}   -> [ {id, sceneId, sceneLabel, author, text, createdAt, resolved} ]
     tok:{id}   -> 管理トークン（AKのみ保持。コメント解決/削除に必要）
   ============================================================ */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS } });

const rid = (n = 8) => {
  const a = "abcdefghijkmnpqrstuvwxyz23456789"; // 紛らわしい文字を除外
  const buf = crypto.getRandomValues(new Uint8Array(n));
  let s = "";
  for (let i = 0; i < n; i++) s += a[buf[i] % a.length];
  return s;
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean); // ["api","snap","{id}",...]

    try {
      // POST /api/publish  { project, prevId?, token? }
      if (request.method === "POST" && parts[0] === "api" && parts[1] === "publish") {
        const body = await request.json();
        const project = body && body.project;
        if (!project || !Array.isArray(project.rows)) return json({ error: "invalid project" }, 400);

        let id = (body.prevId || "").toString().slice(0, 16);
        let token;
        const now = new Date().toISOString();
        let createdAt = now;

        if (id) {
          const existingTok = await env.SNAPS.get("tok:" + id);
          // 既存の更新はトークン一致が必要
          if (!existingTok || existingTok !== (body.token || "")) { id = ""; }
          else {
            token = existingTok;
            const prev = await env.SNAPS.get("snap:" + id, "json");
            if (prev && prev.createdAt) createdAt = prev.createdAt;
          }
        }
        if (!id) { id = rid(8); token = rid(20); }

        await env.SNAPS.put("snap:" + id, JSON.stringify({ project: slim(project), createdAt, updatedAt: now }));
        await env.SNAPS.put("tok:" + id, token);
        return json({ id, token });
      }

      // GET /api/snap/{id}
      if (request.method === "GET" && parts[0] === "api" && parts[1] === "snap" && parts[2] && !parts[3]) {
        const snap = await env.SNAPS.get("snap:" + parts[2], "json");
        if (!snap) return json({ error: "not found" }, 404);
        return json(snap);
      }

      // GET /api/snap/{id}/comments
      if (request.method === "GET" && parts[1] === "snap" && parts[3] === "comments" && !parts[4]) {
        const list = (await env.SNAPS.get("cmt:" + parts[2], "json")) || [];
        return json({ comments: list });
      }

      // POST /api/snap/{id}/comments  { sceneId, sceneLabel, author, text }
      if (request.method === "POST" && parts[1] === "snap" && parts[3] === "comments" && !parts[4]) {
        const id = parts[2];
        const snap = await env.SNAPS.get("snap:" + id);
        if (!snap) return json({ error: "not found" }, 404);
        const b = await request.json();
        const text = (b.text || "").toString().trim().slice(0, 4000);
        if (!text) return json({ error: "empty" }, 400);
        const list = (await env.SNAPS.get("cmt:" + id, "json")) || [];
        const c = {
          id: rid(10),
          sceneId: (b.sceneId || "").toString().slice(0, 40),
          sceneLabel: (b.sceneLabel || "").toString().slice(0, 200),
          author: (b.author || "ゲスト").toString().slice(0, 60),
          text,
          createdAt: new Date().toISOString(),
          resolved: false,
        };
        list.push(c);
        await env.SNAPS.put("cmt:" + id, JSON.stringify(list));
        return json({ comment: c });
      }

      // POST /api/snap/{id}/comments/{cid}  { resolved?, token }  （AK側・要トークン）
      if (request.method === "POST" && parts[1] === "snap" && parts[3] === "comments" && parts[4]) {
        const id = parts[2], cid = parts[4];
        const b = await request.json();
        const tok = await env.SNAPS.get("tok:" + id);
        if (!tok || tok !== (b.token || "")) return json({ error: "forbidden" }, 403);
        const list = (await env.SNAPS.get("cmt:" + id, "json")) || [];
        const c = list.find((x) => x.id === cid);
        if (!c) return json({ error: "not found" }, 404);
        if (typeof b.resolved === "boolean") c.resolved = b.resolved;
        await env.SNAPS.put("cmt:" + id, JSON.stringify(list));
        return json({ comment: c });
      }

      // DELETE /api/snap/{id}/comments/{cid}?token=...  （AK側・要トークン）
      if (request.method === "DELETE" && parts[1] === "snap" && parts[3] === "comments" && parts[4]) {
        const id = parts[2], cid = parts[4];
        const tok = await env.SNAPS.get("tok:" + id);
        if (!tok || tok !== (url.searchParams.get("token") || "")) return json({ error: "forbidden" }, 403);
        let list = (await env.SNAPS.get("cmt:" + id, "json")) || [];
        list = list.filter((x) => x.id !== cid);
        await env.SNAPS.put("cmt:" + id, JSON.stringify(list));
        return json({ ok: true });
      }

      return json({ error: "no route" }, 404);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  },
};

/* 共有スナップショットは必要な項目だけに絞る（テーマ/原稿は残す、巨大化を防ぐ） */
function slim(p) {
  return {
    name: p.name || "構成台本",
    channel: p.channel || "",
    meta: p.meta || {},
    theme: p.theme || { main: "#1F2430", accent: "#E63946" },
    rate: p.rate || 5,
    timeFormat: p.timeFormat || "tc",
    rows: (p.rows || []).map((r) =>
      r.kind === "location"
        ? { id: r.id, kind: "location", label: r.label || "", address: r.address || "", time: r.time || "", note: r.note || "" }
        : { id: r.id, kind: "scene", label: r.label || "", type: r.type, sec: r.sec ?? null, script: r.script || "" }
    ),
  };
}
