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
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Max-Age": "86400",
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS } });

const lc = (s) => (s || "").toString().trim().toLowerCase();
const now = () => new Date().toISOString();
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
      // POST /api/parse  { raw }  → 生原稿をClaudeで構成台本(project JSON)に整形して返す
      if (request.method === "POST" && parts[0] === "api" && parts[1] === "parse") {
        if (!env.ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY 未設定（wrangler secret put が必要）" }, 500);
        const b = await request.json();
        const raw = (b && b.raw ? b.raw : "").toString();
        if (!raw.trim()) return json({ error: "本文が空です" }, 400);
        if (raw.length > 60000) return json({ error: "本文が長すぎます（6万字まで）" }, 413);
        const project = await parseWithClaude(raw, env);
        if (!project || !Array.isArray(project.rows) || !project.rows.length) {
          return json({ error: "整形に失敗しました（構成を読み取れませんでした）" }, 422);
        }
        return json({ project });
      }

      // POST /api/assist  { project, message }  → 現案件に生メッセージを反映して更新案件を返す
      if (request.method === "POST" && parts[0] === "api" && parts[1] === "assist") {
        if (!env.ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY 未設定（wrangler secret put が必要）" }, 500);
        const b = await request.json();
        const message = (b && b.message ? b.message : "").toString();
        const project = b && b.project;
        if (!message.trim()) return json({ error: "メッセージが空です" }, 400);
        if (message.length > 40000) return json({ error: "メッセージが長すぎます（4万字まで）" }, 413);
        if (!project || !Array.isArray(project.rows)) return json({ error: "現在の案件が必要です" }, 400);
        const out = await assistWithClaude(project, message, env);
        if (!out || !Array.isArray(out.rows) || !out.rows.length) return json({ error: "反映に失敗しました" }, 422);
        return json({ project: out, summary: (out.summary || "").toString() });
      }

      // POST /api/review  { project }  → 構成台本を校正チェックして指摘リストを返す
      if (request.method === "POST" && parts[0] === "api" && parts[1] === "review") {
        if (!env.ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY 未設定（wrangler secret put が必要）" }, 500);
        const b = await request.json();
        const project = b && b.project;
        if (!project || !Array.isArray(project.rows)) return json({ error: "現在の案件が必要です" }, 400);
        const out = await reviewWithClaude(project, env);
        return json({ issues: Array.isArray(out.issues) ? out.issues : [], summary: (out.summary || "").toString() });
      }

      // GET /api/yt?v=<videoId>  → YouTube動画＋チャンネル統計を返す（APIキーはサーバ側に秘匿）
      if (request.method === "GET" && parts[0] === "api" && parts[1] === "yt") {
        if (!env.YT_API_KEY) return json({ error: "YT_API_KEY 未設定", needKey: true }, 200);
        const vid = (url.searchParams.get("v") || "").trim();
        if (!/^[a-zA-Z0-9_-]{11}$/.test(vid)) return json({ error: "動画IDが不正です" }, 400);
        const vRes = await fetch("https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=" + vid + "&key=" + env.YT_API_KEY);
        const vData = await vRes.json();
        if (!vData.items || !vData.items.length) return json({ error: "動画が見つかりませんでした" }, 404);
        const it = vData.items[0];
        let subs = 0;
        try {
          const cRes = await fetch("https://www.googleapis.com/youtube/v3/channels?part=statistics&id=" + it.snippet.channelId + "&key=" + env.YT_API_KEY);
          const cData = await cRes.json();
          subs = parseInt((cData.items && cData.items[0] && cData.items[0].statistics && cData.items[0].statistics.subscriberCount) || 0);
        } catch (e) {}
        return json({
          vid,
          title: it.snippet.title || "",
          channel: it.snippet.channelTitle || "",
          views: parseInt((it.statistics && it.statistics.viewCount) || 0),
          likes: parseInt((it.statistics && it.statistics.likeCount) || 0),
          subs,
          uploadDate: (it.snippet.publishedAt || "").slice(0, 10),
          duration: it.contentDetails && it.contentDetails.duration || "PT0S",
        });
      }

      // GET /api/ytchannel?u=<channelUrlOrHandle>  → YouTubeチャンネル統計（競合リサーチ用）
      if (request.method === "GET" && parts[0] === "api" && parts[1] === "ytchannel") {
        if (!env.YT_API_KEY) return json({ error: "YT_API_KEY 未設定", needKey: true }, 200);
        const raw = (url.searchParams.get("u") || "").trim();
        if (!raw) return json({ error: "チャンネルURLを入力してください" }, 400);
        const base = "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&key=" + env.YT_API_KEY;
        let api = null;
        let m;
        if ((m = raw.match(/\/channel\/(UC[a-zA-Z0-9_-]{20,})/))) api = base + "&id=" + m[1];
        else if ((m = raw.match(/@([a-zA-Z0-9_.\-]+)/))) api = base + "&forHandle=@" + m[1];
        else if ((m = raw.match(/\/user\/([a-zA-Z0-9_.\-]+)/))) api = base + "&forUsername=" + m[1];
        if (!api) {
          // /c/カスタム名 や 生のチャンネル名 → 検索で解決
          const q = (raw.match(/\/c\/([^/?#]+)/) || [])[1] || raw;
          const sRes = await fetch("https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&maxResults=1&q=" + encodeURIComponent(decodeURIComponent(q)) + "&key=" + env.YT_API_KEY);
          const sData = await sRes.json();
          const cid = sData.items && sData.items[0] && sData.items[0].snippet && sData.items[0].snippet.channelId;
          if (!cid) return json({ error: "チャンネルが見つかりませんでした" }, 404);
          api = base + "&id=" + cid;
        }
        const cRes = await fetch(api);
        const cData = await cRes.json();
        const it = cData.items && cData.items[0];
        if (!it) return json({ error: "チャンネルが見つかりませんでした" }, 404);
        const st = it.statistics || {};
        return json({
          channelId: it.id,
          name: it.snippet && it.snippet.title || "",
          thumb: it.snippet && it.snippet.thumbnails && it.snippet.thumbnails.default && it.snippet.thumbnails.default.url || "",
          subs: parseInt(st.subscriberCount || 0),
          videos: parseInt(st.videoCount || 0),
          views: parseInt(st.viewCount || 0),
        });
      }

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

      // POST /api/publish-channel { name, channelInfo, projects:[...], prevId?, token? } → チャンネル丸ごと公開
      if (request.method === "POST" && parts[0] === "api" && parts[1] === "publish-channel") {
        const b = await request.json();
        if (!b || !b.name) return json({ error: "channel name required" }, 400);
        const projects = Array.isArray(b.projects) ? b.projects : [];
        let id = (b.prevId || "").toString().slice(0, 16);
        let token; const nowt = now(); let createdAt = nowt;
        if (id) {
          const et = await env.SNAPS.get("chtok:" + id);
          if (!et || et !== (b.token || "")) { id = ""; }
          else { token = et; const prev = await env.SNAPS.get("chan:" + id, "json"); if (prev && prev.createdAt) createdAt = prev.createdAt; }
        }
        if (!id) { id = rid(8); token = rid(20); }
        const doc = { name: b.name, channelInfo: slimCI(b.channelInfo), cases: projects.map(slim), createdAt, updatedAt: nowt };
        await env.SNAPS.put("chan:" + id, JSON.stringify(doc));
        await env.SNAPS.put("chtok:" + id, token);
        return json({ id, token });
      }

      // GET /api/chan/{id}
      if (request.method === "GET" && parts[0] === "api" && parts[1] === "chan" && parts[2] && !parts[3]) {
        const doc = await env.SNAPS.get("chan:" + parts[2], "json");
        if (!doc) return json({ error: "not found" }, 404);
        return json(doc);
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

      // ===== ログイン（Google）→ 自前セッショントークン発行 =====
      // POST /api/auth/google { credential }
      if (request.method === "POST" && parts[1] === "auth" && parts[2] === "google") {
        const b = await request.json();
        const cred = (b && b.credential ? b.credential : "").toString();
        if (!cred) return json({ error: "credential がありません" }, 400);
        const ti = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(cred));
        if (!ti.ok) return json({ error: "Google の検証に失敗しました" }, 401);
        const g = await ti.json();
        if (env.GOOGLE_CLIENT_ID && g.aud !== env.GOOGLE_CLIENT_ID) return json({ error: "client_id が一致しません" }, 401);
        if (!g.sub) return json({ error: "ユーザー情報を取得できませんでした" }, 401);
        const user = { sub: g.sub, email: g.email || "", name: g.name || g.email || "ユーザー", picture: g.picture || "" };
        const now = Math.floor(Date.now() / 1000);
        const token = await mintSession({ ...user, iat: now, exp: now + 60 * 60 * 24 * 30 }, sessionSecret(env));
        return json({ token, user });
      }

      // ===== ユーザー別ストレージ（要ログイン）。KVは SNAPS を u:<sub>: で間借り =====
      // POST /api/kv/{get|set|delete|list}
      if (request.method === "POST" && parts[1] === "kv") {
        const u = await requireUser(request, env);
        if (!u) return json({ error: "unauthorized" }, 401);
        const pre = "u:" + u.sub + ":";
        const b = await request.json();
        const op = parts[2];
        if (op === "get") {
          const v = await env.SNAPS.get(pre + (b.key || ""));
          return json({ value: v });
        }
        if (op === "set") {
          if (!b.key) return json({ error: "key がありません" }, 400);
          await env.SNAPS.put(pre + b.key, (b.value == null ? "" : b.value).toString());
          return json({ ok: true });
        }
        if (op === "delete") {
          await env.SNAPS.delete(pre + (b.key || ""));
          return json({ ok: true });
        }
        if (op === "list") {
          const out = await env.SNAPS.list({ prefix: pre + (b.prefix || ""), limit: 1000 });
          return json({ keys: out.keys.map((k) => k.name.slice(pre.length)) });
        }
        return json({ error: "unknown kv op" }, 400);
      }

      // ===== 案件ごとの共同編集（招待・権限） =====
      // POST /api/collab/{upsert|invite|uninvite|leave|list|get|delete}
      if (request.method === "POST" && parts[1] === "collab") {
        const u = await requireUser(request, env);
        if (!u) return json({ error: "unauthorized" }, 401);
        const myEmail = lc(u.email);
        const op = parts[2];
        const b = await request.json();
        const docKey = (id) => "col:" + id;
        const loadDoc = async (id) => (id ? await env.SNAPS.get(docKey(id), "json") : null);
        const canEdit = (doc) => doc && (doc.ownerSub === u.sub || (doc.members || []).includes(myEmail));
        const addIdx = async (email, id) => { const k = "colmember:" + lc(email); const a = (await env.SNAPS.get(k, "json")) || []; if (!a.includes(id)) { a.push(id); await env.SNAPS.put(k, JSON.stringify(a)); } };
        const delIdx = async (email, id) => { const k = "colmember:" + lc(email); const a = (await env.SNAPS.get(k, "json")) || []; const n = a.filter((x) => x !== id); await env.SNAPS.put(k, JSON.stringify(n)); };

        if (op === "upsert") {
          const project = b.project; const id = (b.id || (project && project.id) || "").toString();
          if (!id || !project) return json({ error: "id/project が必要です" }, 400);
          let doc = await loadDoc(id);
          if (!doc) {
            doc = { id, ownerSub: u.sub, ownerEmail: u.email, members: [myEmail], project, name: project.name || "", channel: project.channel || "", updatedAt: now() };
            await addIdx(myEmail, id);
          } else {
            if (!canEdit(doc)) return json({ error: "forbidden" }, 403);
            doc.project = project; doc.name = project.name || doc.name; doc.channel = project.channel || doc.channel; doc.updatedAt = now();
          }
          await env.SNAPS.put(docKey(id), JSON.stringify(doc));
          return json({ id, ownerEmail: doc.ownerEmail, members: doc.members, role: doc.ownerSub === u.sub ? "owner" : "member" });
        }
        if (op === "invite") {
          const doc = await loadDoc(b.id); if (!doc) return json({ error: "not found" }, 404);
          if (doc.ownerSub !== u.sub) return json({ error: "オーナーのみ招待できます" }, 403);
          const em = lc(b.email); if (!em || !em.includes("@")) return json({ error: "メールアドレスが不正です" }, 400);
          if (!doc.members.includes(em)) doc.members.push(em);
          await env.SNAPS.put(docKey(doc.id), JSON.stringify(doc));
          await addIdx(em, doc.id);
          return json({ members: doc.members });
        }
        if (op === "uninvite") {
          const doc = await loadDoc(b.id); if (!doc) return json({ error: "not found" }, 404);
          if (doc.ownerSub !== u.sub) return json({ error: "オーナーのみ操作できます" }, 403);
          const em = lc(b.email);
          doc.members = doc.members.filter((x) => x !== em || x === lc(doc.ownerEmail));
          await env.SNAPS.put(docKey(doc.id), JSON.stringify(doc));
          await delIdx(em, doc.id);
          return json({ members: doc.members });
        }
        if (op === "leave") {
          const doc = await loadDoc(b.id); if (!doc) return json({ error: "not found" }, 404);
          if (doc.ownerSub === u.sub) return json({ error: "オーナーは退出できません（削除してください）" }, 400);
          doc.members = doc.members.filter((x) => x !== myEmail);
          await env.SNAPS.put(docKey(doc.id), JSON.stringify(doc));
          await delIdx(myEmail, doc.id);
          return json({ ok: true });
        }
        if (op === "delete") {
          const doc = await loadDoc(b.id); if (!doc) return json({ error: "not found" }, 404);
          if (doc.ownerSub !== u.sub) return json({ error: "オーナーのみ削除できます" }, 403);
          for (const em of doc.members) await delIdx(em, doc.id);
          await env.SNAPS.delete(docKey(doc.id));
          return json({ ok: true });
        }
        if (op === "list") {
          const ids = (await env.SNAPS.get("colmember:" + myEmail, "json")) || [];
          const out = [];
          for (const id of ids) {
            const doc = await loadDoc(id);
            if (!doc || !canEdit(doc)) continue;
            out.push({ id, name: doc.name || "", channel: doc.channel || "", ownerEmail: doc.ownerEmail, role: doc.ownerSub === u.sub ? "owner" : "member", members: doc.members, updatedAt: doc.updatedAt });
          }
          return json({ projects: out });
        }
        if (op === "get") {
          const doc = await loadDoc(b.id); if (!doc) return json({ error: "not found" }, 404);
          if (!canEdit(doc)) return json({ error: "forbidden" }, 403);
          return json({ project: doc.project, ownerEmail: doc.ownerEmail, members: doc.members, role: doc.ownerSub === u.sub ? "owner" : "member" });
        }
        return json({ error: "unknown collab op" }, 400);
      }

      return json({ error: "no route" }, 404);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  },
};

/* ===== セッショントークン（HS256 JWT）。Google検証後に発行し、以降のKVアクセスに使う ===== */
function sessionSecret(env) { return env.SESSION_SECRET || "dev-secret-change-me-please"; }
function b64urlBytes(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = ""; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const b64urlStr = (str) => b64urlBytes(new TextEncoder().encode(str));
function b64urlToStr(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? 4 - (s.length % 4) : 0;
  return atob(s + "=".repeat(pad));
}
async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function mintSession(payload, secret) {
  const data = b64urlStr(JSON.stringify({ alg: "HS256", typ: "JWT" })) + "." + b64urlStr(JSON.stringify(payload));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(data));
  return data + "." + b64urlBytes(new Uint8Array(sig));
}
async function verifySession(token, secret) {
  if (!token) return null;
  const p = token.split("."); if (p.length !== 3) return null;
  const data = p[0] + "." + p[1];
  const sig = Uint8Array.from(b64urlToStr(p[2]), (c) => c.charCodeAt(0));
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), sig, new TextEncoder().encode(data));
  if (!ok) return null;
  let payload; try { payload = JSON.parse(b64urlToStr(p[1])); } catch (e) { return null; }
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
  return payload;
}
async function requireUser(request, env) {
  const m = (request.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  return verifySession(m[1], sessionSecret(env));
}

/* 共有スナップショットは必要な項目だけに絞る（テーマ/原稿は残す、巨大化を防ぐ） */
function slim(p) {
  return {
    name: p.name || "構成台本",
    channel: p.channel || "",
    format: p.format === "talk" ? "talk" : "documentary",
    talk: p.talk ? {
      highlight: p.talk.highlight || "", intro: p.talk.intro || "", cta: p.talk.cta || "",
      toc: Array.isArray(p.talk.toc) ? p.talk.toc : [],
      body: (p.talk.body || []).map((b) => ({ id: b.id, heading: b.heading || "", script: b.script || "" })),
    } : null,
    meta: p.meta || {},
    theme: p.theme || { main: "#1F2430", accent: "#E63946" },
    rate: p.rate || 5,
    timeFormat: p.timeFormat || "tc",
    rows: (p.rows || []).map((r) =>
      r.kind === "location"
        ? { id: r.id, kind: "location", label: r.label || "", address: r.address || "", time: r.time || "", note: r.note || "" }
        : { id: r.id, kind: "scene", label: r.label || "", type: r.type, sec: r.sec ?? null, script: r.script || "" }
    ),
    plans: (p.plans || []).map((pl) => ({
      id: pl.id, title: pl.title || "", thumbText: pl.thumbText || "", note: pl.note || "",
      refs: (pl.refs || []).map((rf) => ({ vid: rf.vid || "", title: rf.title || "", channel: rf.channel || "", views: rf.views || 0, subs: rf.subs || 0, uploadDate: rf.uploadDate || "", duration: rf.duration || "" })),
    })),
    channelInfo: slimCI(p.channelInfo),
  };
}

function slimCI(ci) {
  if (!ci) return null;
  return {
    name: ci.name || "", url: ci.url || "", concept: ci.concept || "",
    target: ci.target || "", purpose: ci.purpose || "",
    competitors: (ci.competitors || []).map((c) => ({ name: c.name || "", url: c.url || "", subs: c.subs || 0, videos: c.videos || 0, note: c.note || "", thumb: c.thumb || "" })),
  };
}

/* ===== 生原稿 → 構成台本(project JSON) を Claude で整形 ===== */
const PARSE_SYSTEM = `あなたは一日密着ドキュメンタリーの構成作家です。渡された素材（他AIが書いた原稿・取材メモ・文字起こし等、形式は不問）を読み取り、構成台本ツール「ものがたりっち！」のデータに整形して build_project ツールで返してください。

# セクション5種（rowsのtype）
- インサート（3〜5秒）＝映像のみ。場面説明。原稿の代わりに映像指示を3〜4カット（例「（オフィス外観）\\n（出社風景）」）
- VLOG（15〜30秒）＝原稿にない他愛もない会話。人柄
- 解説系（30秒〜1分）＝今から何をするか／今やっている業務の説明
- 訴求（2〜3分）＝最も伝えたい内容・想い・原点・商品紹介。動画の核
- ブリッジ（5〜10秒）＝次の場面へのつなぎ

# ルール
- 場所の見出しは {kind:"location", label, time?}。その配下に scene を順に並べる
- 各 scene は {kind:"scene", type, sec, label(短い見出し), script(原稿全文)}
- type は インサート/ブリッジ/VLOG/解説系/訴求 のいずれか。「インサート（3~5秒）」等は種別名だけに正規化
- sec は目標秒数（インサート5・ブリッジ10・VLOG30・解説系60・訴求180 が目安）
- script: 質問は行頭「◼ 」、回答は話し言葉。改行は維持。素材に無い事実・数字・固有名詞は作らず、本人の生声が要る所は「★取材：（何を聞くか）」と書いて空ける
- 既に構成された原稿なら、その意図・順番・原稿をできる限りそのまま写す（要約・改変しない）。素材がメモだけなら脳科学的に飽きさせない流れ（共感は長く、重い話は短く強く、2〜3分に1回の驚き、ラストは余韻）で構成する
- meta に shootDate/place/titles[3]/thumbs[3]/highlight、分かる範囲で name(演者名｜案件名)・channel(クライアント名) を埋める

# スプレッドシートからの貼り付け（タブ区切りの表）への対応 ★最重要
ものがたりっちの構成スプシをそのままコピペした表が来る。列順はおおむね:
  時間 ｜ シーン(ロケ名/イベント名) ｜ 内容(シーンの短い見出し) ｜ シーン(種別) ｜ 秒数 ｜ 所要時間 ｜ 文字数 ｜ 原稿 ｜ (メモ) ｜ (コメント)
- 「秒数/所要時間/文字数」はスプシ側の自動計算列。所要時間・文字数は完全に無視。sec は「秒数」列の数値を使う（空なら種別の既定）
- 行に種別セル（インサート/ブリッジ/VLOG/解説系/訴求。「インサート（3~5秒）」のような注記付きでも種別名だけに正規化）が有る行 = scene。「内容」列を label、「原稿」列を script に入れる
- 種別が無く、時間やロケ名/イベント名だけの行 = location 見出し（例「8:50␉出社」→ {kind:"location", label:"出社", time:"8:50"}）。配下の scene をその下に並べる
- 原稿の「▶︎「…」（狙い）」はそのシーンの狙い書き＝残してよい。「◼ 」始まりは質問
- 表より前にある「ルール説明」「◼︎セクションの意図」「注意」など“作り方の説明”ブロックは取り込まない（rowsに入れない）
- 「撮影日」「撮影場所」「タイトル案」「サムネ案」「ハイライト」「動画の流れ」の行は meta へ振り分ける（タイトル案/サムネ案は横並びの複数セルを titles[]/thumbs[] に。動画の流れは highlight 末尾に添えるか無視）
- 空セルだけの行、「合計」行、緑の自動生成セルは無視。原稿は改変せずそのまま写す`;

const BUILD_TOOL = {
  name: "build_project",
  description: "整形した構成台本データを返す",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "（アシスタント更新時のみ）今回の変更点を日本語で1〜3行" },
      name: { type: "string", description: "演者名｜案件名" },
      channel: { type: "string", description: "クライアント名" },
      meta: {
        type: "object",
        properties: {
          shootDate: { type: "string" },
          place: { type: "string" },
          titles: { type: "array", items: { type: "string" } },
          thumbs: { type: "array", items: { type: "string" } },
          highlight: { type: "string" },
        },
      },
      rate: { type: "number", description: "字/秒。既定5" },
      rows: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["location", "scene"] },
            label: { type: "string" },
            time: { type: "string", description: "ロケーションの予定時刻（例 8:50）" },
            type: { type: "string", enum: ["インサート", "ブリッジ", "VLOG", "解説系", "訴求"] },
            sec: { type: "number" },
            script: { type: "string" },
          },
          required: ["kind"],
        },
      },
    },
    required: ["rows"],
  },
};

async function parseWithClaude(raw, env) {
  const model = env.PARSE_MODEL || "claude-sonnet-4-6";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      system: PARSE_SYSTEM,
      tools: [BUILD_TOOL],
      tool_choice: { type: "tool", name: "build_project" },
      messages: [{ role: "user", content: "以下の素材を構成台本に整形して build_project で返してください。\n\n----- 素材ここから -----\n" + raw + "\n----- 素材ここまで -----" }],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error("Claude API " + res.status + ": " + t.slice(0, 300));
  }
  const data = await res.json();
  const block = (data.content || []).find((b) => b.type === "tool_use" && b.name === "build_project");
  if (!block || !block.input) throw new Error("tool_use が返りませんでした");
  return block.input;
}

/* ===== AIアシスタント：現案件＋現場からの生メッセージ → 反映して更新案件を返す ===== */
const ASSIST_SYSTEM = `あなたは一日密着ドキュメンタリーの構成作家アシスタントです。「現在の構成台本(JSON)」と、現場・先方・演者から届いた「生のメッセージ（LINE文面・取材メモ・指示など、形式は不問）」が渡されます。メッセージの内容を構成台本に反映し、更新後の【完全な】構成台本を build_project ツールで返してください。

# やること
- メッセージから読み取れる情報を、該当する箇所に埋める／追記する：
  - 集合場所・住所・施設名 → 近いロケーションの label、必要なら住所はメモ(note)や該当locationに反映
  - 撮影日 → meta.shootDate、時間 → 該当ロケの time
  - 駐車場・許可・持ち物・注意 → 該当ロケの note
  - 人物像・エピソード・経歴・想い・商品の話 → 適切な type の scene を追加、または既存 scene の script/label を充実
  - 「冒頭の引きを強く」等の“指示”なら、その箇所を実際に書き換える
- それ以外の既存内容は極力そのまま残す（メッセージが触れていない所は変えない）

# ルール
- 事実・数字・固有名詞を勝手に創作しない。本人の生声が要る所は script に「★取材：（何を聞くか）」と書いて空ける
- type は インサート/ブリッジ/VLOG/解説系/訴求 のいずれか。sec は目安（インサート5・ブリッジ10・VLOG30・解説系60・訴求180）
- script の質問は行頭「◼ 」、回答は話し言葉。改行は維持
- rows は省略せず【全行】返す（変更が無い行もそのまま含める）
- summary に「何をどう変えたか」を日本語で1〜3行。反映できる情報が無ければ無理に変えず、summary でその旨を伝える`;

async function assistWithClaude(project, message, env) {
  const model = env.PARSE_MODEL || "claude-sonnet-4-6";
  const ctx = "----- 現在の構成台本(JSON) -----\n" + JSON.stringify(slim(project)) +
    "\n----- 現場から届いたメッセージ -----\n" + message +
    "\n----- ここまで -----\n\n上のメッセージを構成台本に反映して、更新後の完全な構成台本を build_project で返してください。";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      system: ASSIST_SYSTEM,
      tools: [BUILD_TOOL],
      tool_choice: { type: "tool", name: "build_project" },
      messages: [{ role: "user", content: ctx }],
    }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error("Claude API " + res.status + ": " + t.slice(0, 300)); }
  const data = await res.json();
  const block = (data.content || []).find((b) => b.type === "tool_use" && b.name === "build_project");
  if (!block || !block.input) throw new Error("tool_use が返りませんでした");
  return block.input;
}

/* ===== 構成台本の校正チェック（誤字脱字・質問と回答の逆転・未記入）===== */
const REVIEW_SYSTEM = `あなたは一日密着ドキュメンタリー構成台本の校正者です。渡された「構成台本(JSON)」を読み、下記の3観点だけを厳密にチェックして report_review ツールで指摘リストを返してください。

# チェック観点（この3つだけ）
1. 誤字脱字（category="誤字脱字"）
   - 変換ミス・タイプミス・送り仮名・てにをは・明らかな衍字/脱字。該当語句を必ず引用する
2. 質問と回答の逆転（category="質問と回答の逆転"）
   - script内で、質問は行頭「◼ 」、回答は話し言葉という形式。これが崩れている所を指摘する：
     - 質問なのに「◼ 」が付いておらず回答文に紛れている／回答なのに「◼ 」が付いて質問扱いになっている
     - インタビュアーの問いと演者の答えが入れ替わっている、噛み合っていない（問いに対し答えが別物）
     - 回答が先に来て質問が後になっている等、順序が逆
3. 未記入・空欄（category="未記入"）
   - scriptが空、または「★取材：」のプレースホルダのまま埋まっていない
   - sceneのlabel（見出し）が空
   - locationの見出しだけで配下にsceneが1つも無い

# 厳守
- 上記3観点に当てはまる「実際の問題」だけを挙げる。推測で粗探しをしない。問題が無ければ issues は空配列で返す
- 各 issue には、対象シーンの id（JSONのrows[].id）を rowId に、見出しを sceneLabel に入れて人が探せるようにする
- detail には「何がどう問題か」を、該当箇所の語句を「」で引用しながら具体的に書く。suggestion に直し方（任意）
- 創作・改変はしない。あくまで指摘のみ
- summary に全体の所感を1〜2行。問題が無ければ「大きな問題は見つかりませんでした。」`;

const REVIEW_TOOL = {
  name: "report_review",
  description: "構成台本の校正チェック結果（指摘リスト）を返す",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "全体所感を1〜2行" },
      issues: {
        type: "array",
        items: {
          type: "object",
          properties: {
            rowId: { type: "string", description: "対象シーンのid（rows[].id）。全体に関わる場合は空でよい" },
            sceneLabel: { type: "string", description: "対象シーンの見出し（人が探せるように）" },
            category: { type: "string", enum: ["誤字脱字", "質問と回答の逆転", "未記入", "その他"] },
            severity: { type: "string", enum: ["high", "medium", "low"] },
            detail: { type: "string", description: "何がどう問題か。該当語句を「」で引用" },
            suggestion: { type: "string", description: "修正案（任意）" },
          },
          required: ["category", "detail"],
        },
      },
    },
    required: ["issues"],
  },
};

const TALK_REVIEW_SYSTEM = `あなたはトーク系YouTube台本（一人語り・対談）の校正者です。渡された台本(JSON: title/highlight=ハイライト/intro=冒頭/toc=目次/body[]=本編(heading+script)/cta=CTA)を読み、下記の観点で report_review ツールに指摘を返してください。

# チェック観点
1. 誤字脱字（category="誤字脱字"）：変換ミス・タイプミス・てにをは。該当語句を「」で引用
2. 未記入（category="未記入"）：タイトル/ハイライト/冒頭/本編script/CTA等が空、または本編の見出しだけで中身が無い
3. その他（category="その他"）：構成上の明らかな弱点だけ簡潔に（冒頭に動画の結論/メリットが無い、CTAが無い/弱い、目次と本編が食い違う、同じ話の重複など）。粗探しはしない

# 厳守
- 実際の問題だけ。無ければ issues は空配列。創作・改変はしない
- 本編の指摘は rowId に該当 body の id、sceneLabel にその見出しを入れる。全体の指摘は rowId 空でよい
- detail は該当箇所を引用しつつ具体的に。suggestion に直し方（任意）
- summary に全体所感を1〜2行`;

async function reviewWithClaude(project, env) {
  const model = env.PARSE_MODEL || "claude-sonnet-4-6";
  const isTalk = project && project.format === "talk";
  const ctx = "----- 台本(JSON) -----\n" + JSON.stringify(slim(project)) +
    "\n----- ここまで -----\n\n上の台本を校正チェックして report_review で返してください。";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      system: isTalk ? TALK_REVIEW_SYSTEM : REVIEW_SYSTEM,
      tools: [REVIEW_TOOL],
      tool_choice: { type: "tool", name: "report_review" },
      messages: [{ role: "user", content: ctx }],
    }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error("Claude API " + res.status + ": " + t.slice(0, 300)); }
  const data = await res.json();
  const block = (data.content || []).find((b) => b.type === "tool_use" && b.name === "report_review");
  if (!block || !block.input) throw new Error("tool_use が返りませんでした");
  return block.input;
}
