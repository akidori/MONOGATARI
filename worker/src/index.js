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
- meta に shootDate/place/titles[3]/thumbs[3]/highlight、分かる範囲で name(演者名｜案件名)・channel(クライアント名) を埋める`;

const BUILD_TOOL = {
  name: "build_project",
  description: "整形した構成台本データを返す",
  input_schema: {
    type: "object",
    properties: {
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
