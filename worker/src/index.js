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

import { DurableObject } from "cloudflare:workers";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Max-Age": "86400",
  // 全応答に付与するセキュリティ土台（MIMEスニッフ抑止＝アップロード物のストアドXSS面を潰す最重要項目）
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

// /api/file でインライン表示(=ブラウザ実行)を許してよいMIMEだけの許可リスト。
// これ以外（text/html, image/svg+xml, application/xml 等）は attachment 強制でスクリプト実行を封じる。
const INLINE_OK = /^(video\/|audio\/|image\/(?!svg)|application\/pdf$)/i;

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

// 編集者が共有リンクから上げた完成動画を、AKがアプリを開かなくても「確認用バージョン」に自動昇格する。
// R2直再生で即見え、Stream変換をキックして完了後にHLS昇格（配信時の自己治癒で ready 反映）。
// 版は key を持たせるので、後でAKのアプリが取り込んでも key/uid 一致で重複しない（importGuestUploads / reconcile と整合）。
async function autoRegisterReviewVersion(env, origin, snapId, meta) {
  const snap = await env.SNAPS.get("snap:" + snapId, "json");
  if (!snap || !snap.project) return;
  const review = snap.project.review || (snap.project.review = {});
  const vers = Array.isArray(review.versions) ? review.versions : (review.versions = []);
  if (vers.some((v) => v && (v.key === meta.key))) return; // 二重completeガード
  const nextN = vers.filter((v) => v && !v.trashedAt).length + 1;
  const ver = { id: rid(8), label: "v" + nextN, name: meta.name || ("v" + nextN),
    type: "stream", key: meta.key, url: "", uid: "", hls: "", ready: false,
    createdAt: Date.now(), createdBy: meta.by === "owner" ? "AK" : "編集者" };
  if (env.STREAM_ACCOUNT_ID && env.STREAM_API_TOKEN) {
    try {
      const r = await fetch("https://api.cloudflare.com/client/v4/accounts/" + env.STREAM_ACCOUNT_ID + "/stream/copy", {
        method: "POST",
        headers: { Authorization: "Bearer " + env.STREAM_API_TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify({ url: origin + "/api/file/" + meta.key, meta: { name: (meta.name || "確認用動画").toString().slice(0, 120) }, requireSignedURLs: false }),
      });
      const d = await r.json().catch(() => null);
      if (d && d.success && d.result && d.result.uid) ver.uid = d.result.uid;
    } catch (e) {}
  }
  vers.push(ver);
  await env.SNAPS.put("snap:" + snapId, JSON.stringify(snap));
}

// IPベースの簡易レート制限（KVカウンタ）。無認証で叩けるAI系のコスト焼却DoSを抑止。
// KVは結果整合なのでバースト時に多少すり抜けるが、持続的な濫用は確実に頭打ちにできる。
async function rateLimit(env, ip, bucket, limit, windowSec) {
  try {
    const win = Math.floor(Date.now() / 1000 / windowSec);
    const key = `rl:${bucket}:${ip}:${win}`;
    const cur = parseInt((await env.SNAPS.get(key)) || "0", 10);
    if (cur >= limit) return false;
    await env.SNAPS.put(key, String(cur + 1), { expirationTtl: windowSec * 2 });
    return true;
  } catch { return true; } // KV障害時はブロックしない（可用性優先／DoS抑止はベストエフォート）
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean); // ["api","snap","{id}",...]

    // WebSocket 接続は Durable Object(LiveDoc) へ委譲（リアルタイム共同編集）
    if (parts[0] === "api" && parts[1] === "live" && parts[2] && parts[2] !== "create" && request.headers.get("Upgrade") === "websocket") {
      const stub = env.LIVEDOC.get(env.LIVEDOC.idFromName(parts[2]));
      return stub.fetch(request);
    }

    try {
      // AI系エンドポイントのIPレート制限（無認証で叩けるためANTHROPIC/YT予算の焼却DoSを防ぐ）
      if (parts[0] === "api" && ["parse", "assist", "review", "deliver", "hearing", "chat", "help", "yt", "ytsearch"].includes(parts[1])) {
        const ip = request.headers.get("cf-connecting-ip") || "0.0.0.0";
        if (!(await rateLimit(env, ip, "ai", 40, 60))) return json({ error: "リクエストが多すぎます。1分ほど待って再度お試しください。" }, 429);
      }
      // GET /api/lab-manual?channel=オリックス → Flip-LABの保存済み編集ルールを中継して返す。
      // 編集者がものがたりっちで作業中に、そのチャンネルの蒸留済みルールを見れる。
      // トークン(FLIP_LAB_TOKEN)はサーバ側に秘匿。LABへはservice binding(env.LAB)で直結＝1042回避。
      // 認証：NGワード等クライアント固有の機密が乗るため無認証公開はNG。新規の認証方式は作らず既存の
      // 共有トークンに相乗り＝ ①ログインセッション(Authorization) ②snap所有者/編集者トークン(id+token|up)
      // ③ライブ編集トークン(live+k、LiveDoc DOへ委譲して照合)。いずれも無ければ401。
      if (request.method === "GET" && parts[0] === "api" && parts[1] === "lab-manual") {
        const channel = url.searchParams.get("channel") || "";
        const projectId = (url.searchParams.get("id") || "").slice(0, 16);
        if (!channel) return json({ ok: false, error: "channel必須", manual: "" }, 400);
        let authed = !!(await requireUser(request, env));
        if (!authed) {
          const snapId = projectId;
          const tokenParam = url.searchParams.get("token") || "";
          const upParam = url.searchParams.get("up") || "";
          if (snapId && tokenParam) { const tok = await env.SNAPS.get("tok:" + snapId); authed = !!tok && tok === tokenParam; }
          if (!authed && snapId && upParam) { const uptok = await env.SNAPS.get("uptok:" + snapId); authed = !!uptok && uptok === upParam; }
        }
        if (!authed) {
          const liveId = (url.searchParams.get("live") || "").slice(0, 16);
          const kParam = url.searchParams.get("k") || "";
          if (liveId && kParam && env.LIVEDOC) {
            try {
              const stub = env.LIVEDOC.get(env.LIVEDOC.idFromName(liveId));
              const r = await stub.fetch("https://do/snapshot?k=" + encodeURIComponent(kParam));
              authed = r.ok;
            } catch (e) {}
          }
        }
        if (!authed) return json({ ok: false, error: "unauthorized", manual: "" }, 401);
        if (!env.FLIP_LAB_TOKEN) return json({ ok: false, error: "LAB未接続", manual: "" });
        // idを渡すとFlip-LAB側でFlip Board台帳のクライアント名解決を使う（書き込み側=refreshChannelsと同じロジック）。
        // これが無いと、Flip Boardでチャンネル名が変わった案件だけ表示が古い名前のまま固まる。
        const qs = "channel=" + encodeURIComponent(channel) + (projectId ? "&id=" + encodeURIComponent(projectId) : "");
        const labReq = new Request(
          "https://flip-lens/api/channel_manual?" + qs,
          { headers: { "Authorization": "Bearer " + env.FLIP_LAB_TOKEN } }
        );
        try {
          const r = env.LAB ? await env.LAB.fetch(labReq)
            : await fetch("https://flip-lens.aki-surf89315.workers.dev/api/channel_manual?" + qs,
                { headers: { "Authorization": "Bearer " + env.FLIP_LAB_TOKEN } });
          const d = await r.json();
          // fixed(確定ルール逐語)/distilled(学習した傾向)/settings(案件設定=テロップカラー等)も転送。
          return json({ ok: true, channel: d.channel, manual: d.manual || "", fixed: d.fixed || "", distilled: d.distilled || "", settings: d.settings || {}, updated: d.updated || null });
        } catch (e) {
          return json({ ok: false, error: "LAB取得失敗: " + e.message, manual: "" });
        }
      }

      // POST /api/lab-rules { snap, token, channel, text } → 決め事(確定ルール)をFlip-LABへ保存（snap所有者のみ）
      if (request.method === "POST" && parts[0] === "api" && parts[1] === "lab-rules") {
        const b = await request.json().catch(() => ({}));
        const snap = (b.snap || "").toString().slice(0, 16);
        const tok = snap ? await env.SNAPS.get("tok:" + snap) : null;
        if (!tok || tok !== (b.token || "")) return json({ error: "forbidden" }, 403);
        if (!b.channel) return json({ error: "channel必須" }, 400);
        if (!env.FLIP_LAB_TOKEN) return json({ error: "LAB未接続" }, 502);
        // idを渡すとFlip-LAB側でFlip Board台帳のクライアント名解決を使う。読み取り側(lab-manual)と揃えないと
        // 「採用」で確定ルールが読んでいたのと別のチャンネル箱に保存されるズレが起きる。
        const body = JSON.stringify({ channel: b.channel, text: b.text || "", id: snap });
        const labReq = new Request("https://flip-lens/api/fixed-rules", { method: "POST", headers: { "content-type": "application/json", "Authorization": "Bearer " + env.FLIP_LAB_TOKEN }, body });
        try {
          const r = env.LAB ? await env.LAB.fetch(labReq)
            : await fetch("https://flip-lens.aki-surf89315.workers.dev/api/fixed-rules", { method: "POST", headers: { "content-type": "application/json", "Authorization": "Bearer " + env.FLIP_LAB_TOKEN }, body });
          const d = await r.json().catch(() => ({}));
          return json(d, r.ok ? 200 : 502);
        } catch (e) {
          return json({ error: "LAB送信失敗: " + e.message }, 502);
        }
      }

      // GET /api/schedule?id=<snapId> → Flip Board(D1正本)から担当案件の日程スライスを中継。
      // 編集者がものがたりっちの中だけで「撮影日・次の締切・次の一手」を見れる（窓表示・読み取り専用）。
      // MG_LIST_KEY はサーバ側に秘匿し、cron(birdflip-cron)へService Binding(env.CRON)で直結＝1042回避。
      // ログイン不要（共有台本と同等の見せ方＝チャンネル編集ライブモードでも見える）。
      if (request.method === "GET" && parts[0] === "api" && parts[1] === "schedule") {
        const id = (url.searchParams.get("id") || "").trim();
        if (!/^[A-Za-z0-9]{3,32}$/.test(id)) return json({ found: false, error: "id不正" }, 400);
        if (!env.MG_LIST_KEY) return json({ found: false, error: "未接続" });
        // ログイン中なら email を添えて「あがり報告ボタンを出してよいか(canReportUp)」をserver判定させる。未ログインでもOK（窓表示）。
        const su = await requireUser(request, env);
        const semail = su && su.email ? "&email=" + encodeURIComponent(su.email) : "";
        const cronPath = "/api/case-schedule?id=" + encodeURIComponent(id) + "&key=" + encodeURIComponent(env.MG_LIST_KEY) + semail;
        try {
          const r = env.CRON ? await env.CRON.fetch(new Request("https://birdflip-cron" + cronPath))
            : await fetch("https://birdflip-cron.aki-surf89315.workers.dev" + cronPath);
          return json(await r.json());
        } catch (e) {
          return json({ found: false, error: "日程取得失敗: " + e.message });
        }
      }

      // POST /api/report-up { id } → 担当編集者のあがり報告。要ログイン。cronで members 照合し ball→ak に書き戻し＋AK通知。
      if (request.method === "POST" && parts[0] === "api" && parts[1] === "report-up") {
        const ru = await requireUser(request, env);
        if (!ru || !ru.email) return json({ ok: false, error: "ログインが必要です" }, 401);
        if (!env.MG_LIST_KEY) return json({ ok: false, error: "未接続" });
        const b = await request.json().catch(() => ({}));
        const id = (b && b.id ? String(b.id) : "").trim();
        if (!/^[A-Za-z0-9]{3,32}$/.test(id)) return json({ ok: false, error: "id不正" }, 400);
        const cronPath = "/api/report-up?id=" + encodeURIComponent(id) + "&email=" + encodeURIComponent(ru.email) + "&key=" + encodeURIComponent(env.MG_LIST_KEY);
        try {
          const r = env.CRON ? await env.CRON.fetch(new Request("https://birdflip-cron" + cronPath, { method: "POST" }))
            : await fetch("https://birdflip-cron.aki-surf89315.workers.dev" + cronPath, { method: "POST" });
          return json(await r.json());
        } catch (e) {
          return json({ ok: false, error: "報告失敗: " + e.message });
        }
      }

      // POST /api/report-delivered { id, videoUrl } → 納品セット完了の報告。要ログイン。cronで members 照合し ball→ak＋納品URL書き添え＋AK通知。
      if (request.method === "POST" && parts[0] === "api" && parts[1] === "report-delivered") {
        const ru = await requireUser(request, env);
        if (!ru || !ru.email) return json({ ok: false, error: "ログインが必要です" }, 401);
        if (!env.MG_LIST_KEY) return json({ ok: false, error: "未接続" });
        const b = await request.json().catch(() => ({}));
        const id = (b && b.id ? String(b.id) : "").trim();
        if (!/^[A-Za-z0-9]{3,32}$/.test(id)) return json({ ok: false, error: "id不正" }, 400);
        const vu = (b && b.videoUrl ? String(b.videoUrl) : "").trim().slice(0, 500);
        const cronPath = "/api/report-delivered?id=" + encodeURIComponent(id) + "&email=" + encodeURIComponent(ru.email) + "&key=" + encodeURIComponent(env.MG_LIST_KEY) + (vu ? "&videoUrl=" + encodeURIComponent(vu) : "");
        try {
          const r = env.CRON ? await env.CRON.fetch(new Request("https://birdflip-cron" + cronPath, { method: "POST" }))
            : await fetch("https://birdflip-cron.aki-surf89315.workers.dev" + cronPath, { method: "POST" });
          return json(await r.json());
        } catch (e) {
          return json({ ok: false, error: "報告失敗: " + e.message });
        }
      }

      // GET /api/board → Flip Board(D1正本)の全案件を担当・工程・次の締切で一望（進行ボード・読み取り）。
      if (request.method === "GET" && parts[0] === "api" && parts[1] === "board") {
        if (!env.MG_LIST_KEY) return json({ count: 0, rows: [], error: "未接続" });
        const cronPath = "/api/board?key=" + encodeURIComponent(env.MG_LIST_KEY);
        try {
          const r = env.CRON ? await env.CRON.fetch(new Request("https://birdflip-cron" + cronPath))
            : await fetch("https://birdflip-cron.aki-surf89315.workers.dev" + cronPath);
          return json(await r.json());
        } catch (e) {
          return json({ count: 0, rows: [], error: "ボード取得失敗: " + e.message });
        }
      }

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

      // POST /api/deliver  { project, transcript? }  → 台本からYouTube投稿用（タイトル・概要欄・ハッシュタグ）を生成。
      // transcript（切り抜き生成時のWhisper文字起こし）があれば実尺TCベースの目次(chapters)も作る
      if (request.method === "POST" && parts[0] === "api" && parts[1] === "deliver") {
        if (!env.ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY 未設定（wrangler secret put が必要）" }, 500);
        const b = await request.json();
        const project = b && b.project;
        if (!project || !Array.isArray(project.rows)) return json({ error: "現在の案件が必要です" }, 400);
        const transcript = Array.isArray(b.transcript) ? b.transcript.slice(0, 4000) : null;
        const out = await deliverWithClaude(project, env, transcript);
        return json(out);
      }

      // POST /api/hearing  { raw, hearing }  → 文字起こしからヒアリング項目を埋める
      if (request.method === "POST" && parts[0] === "api" && parts[1] === "hearing") {
        if (!env.ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY 未設定（wrangler secret put が必要）" }, 500);
        const b = await request.json();
        const raw = (b && b.raw ? b.raw : "").toString();
        const hearing = b && Array.isArray(b.hearing) ? b.hearing : [];
        if (!raw.trim()) return json({ error: "文字起こしが空です" }, 400);
        if (raw.length > 120000) return json({ error: "文字起こしが長すぎます（12万字まで）" }, 413);
        if (!hearing.length) return json({ error: "ヒアリング項目がありません" }, 400);
        const out = await fillHearingWithClaude(hearing, raw, env);
        return json({ items: Array.isArray(out.items) ? out.items : [], summary: (out.summary || "").toString() });
      }

      // POST /api/chat  { project, history?, message }  → 会話しながら台本を提案（提案→承認フロー）
      if (request.method === "POST" && parts[0] === "api" && parts[1] === "chat") {
        if (!env.ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY 未設定（wrangler secret put が必要）" }, 500);
        const b = await request.json();
        const message = (b && b.message ? b.message : "").toString();
        const project = b && b.project;
        const history = Array.isArray(b && b.history) ? b.history : [];
        if (!message.trim()) return json({ error: "メッセージが空です" }, 400);
        if (message.length > 40000) return json({ error: "メッセージが長すぎます（4万字まで）" }, 413);
        if (!project || typeof project !== "object") return json({ error: "現在の案件が必要です" }, 400);
        const out = await chatWithClaude(project, history, message, env);
        return json(out);
      }

      // POST /api/help { message, history?, channel?, caseName? } → 編集者向け使い方サポート＋要望検知でDiscord/KVへ
      if (request.method === "POST" && parts[0] === "api" && parts[1] === "help") {
        if (!env.ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY 未設定（wrangler secret put が必要）" }, 500);
        const b = await request.json();
        const message = (b && b.message ? b.message : "").toString();
        const history = Array.isArray(b && b.history) ? b.history : [];
        if (!message.trim()) return json({ error: "メッセージが空です" }, 400);
        if (message.length > 8000) return json({ error: "メッセージが長すぎます（8千字まで）" }, 413);
        const out = await helpWithClaude(history, message, env, {
          channel: (b.channel || "").toString().slice(0, 60),
          caseName: (b.caseName || "").toString().slice(0, 80),
        });
        return json(out);
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

      // GET /api/ytsearch?q=<keyword>&max=8  → キーワードに関連する動画を返す（競合サムネ比較用）
      if (request.method === "GET" && parts[0] === "api" && parts[1] === "ytsearch") {
        if (!env.YT_API_KEY) return json({ error: "YT_API_KEY 未設定", needKey: true }, 200);
        const q = (url.searchParams.get("q") || "").trim();
        if (!q) return json({ error: "キーワードを入力してください" }, 400);
        const max = Math.min(20, Math.max(1, parseInt(url.searchParams.get("max") || "12") || 12));
        const sRes = await fetch("https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=" + max + "&relevanceLanguage=ja&regionCode=JP&q=" + encodeURIComponent(q) + "&key=" + env.YT_API_KEY);
        const sData = await sRes.json();
        if (sData.error) return json({ error: (sData.error.message || "検索失敗") }, 502);
        let items = (sData.items || [])
          .filter((it) => it.id && it.id.videoId)
          .map((it) => ({
            vid: it.id.videoId,
            title: (it.snippet && it.snippet.title) || "",
            channel: (it.snippet && it.snippet.channelTitle) || "",
            channelId: (it.snippet && it.snippet.channelId) || "",
            publishedAt: (it.snippet && it.snippet.publishedAt) || "",
            views: 0,
            duration: "PT0S",
            avatar: "",
          }));
        // 視聴回数・尺をまとめて取得（1回のvideos.list）
        try {
          const vids = items.map((x) => x.vid).join(",");
          if (vids) {
            const vRes = await fetch("https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails&id=" + vids + "&key=" + env.YT_API_KEY);
            const vData = await vRes.json();
            const vm = {};
            (vData.items || []).forEach((v) => { vm[v.id] = v; });
            items.forEach((x) => {
              const v = vm[x.vid];
              if (v) {
                x.views = parseInt((v.statistics && v.statistics.viewCount) || 0);
                x.duration = (v.contentDetails && v.contentDetails.duration) || "PT0S";
              }
            });
          }
        } catch (e) {}
        // チャンネルアバターをまとめて取得（1回のchannels.list）
        try {
          const chIds = Array.from(new Set(items.map((x) => x.channelId).filter(Boolean))).join(",");
          if (chIds) {
            const cRes = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&id=" + chIds + "&key=" + env.YT_API_KEY);
            const cData = await cRes.json();
            const cm = {};
            (cData.items || []).forEach((c) => { cm[c.id] = (c.snippet && c.snippet.thumbnails && (c.snippet.thumbnails.default || c.snippet.thumbnails.medium) || {}).url || ""; });
            items.forEach((x) => { x.avatar = cm[x.channelId] || ""; });
          }
        } catch (e) {}
        return json({ items });
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
        let token, isNew = false;
        const now = new Date().toISOString();
        let createdAt = now;

        let prevSnap = null;
        if (id) {
          const existingTok = await env.SNAPS.get("tok:" + id);
          // 既存の更新はトークン一致が必要
          if (!existingTok || existingTok !== (body.token || "")) { id = ""; }
          else {
            token = existingTok;
            prevSnap = await env.SNAPS.get("snap:" + id, "json");
            if (prevSnap && prevSnap.createdAt) createdAt = prevSnap.createdAt;
          }
        }
        if (!id) { id = rid(8); token = rid(20); isNew = true; }

        const slimmed = slim(project);
        // マージガード：同じ共有IDへ複数の端末/コピーが発行しても、発行側が知らない既存の動画版を黙って消さない
        // （2026-07-05 喜多さん事故：編集者が上げた版を、古い状態の別コピーの再発行が上書きで消した）。
        // 発行側でゴミ箱入り(trashedAt)の版は引き継がない＝意図した削除は尊重。
        if (prevSnap && prevSnap.project && prevSnap.project.review && Array.isArray(prevSnap.project.review.versions)) {
          const ids = (v) => ["key", "uid", "url", "id"].map((f) => v && v[f]).filter(Boolean);
          const incoming = new Set(((project.review && project.review.versions) || []).flatMap(ids));
          const keep = prevSnap.project.review.versions.filter((v) => v && !v.trashedAt && ids(v).length && !ids(v).some((x) => incoming.has(x)));
          if (keep.length) {
            slimmed.review.versions = slimmed.review.versions.concat(keep)
              .sort((a, b) => (+a.createdAt || 0) - (+b.createdAt || 0)).slice(-50);
          }
        }
        await env.SNAPS.put("snap:" + id, JSON.stringify({ project: slimmed, createdAt, updatedAt: now }));
        await env.SNAPS.put("tok:" + id, token);
        // 編集者用アップロードトークン：大容量アップだけ許可（コメント削除等の管理権限は持たせない）。無ければ発行。
        let uptok = await env.SNAPS.get("uptok:" + id);
        if (!uptok) { uptok = rid(20); await env.SNAPS.put("uptok:" + id, uptok); }
        // 読取トークン(共有URLの ?r=)。新規snapは発行し閲覧に必須化。既存の旧snap(rtok無し)はgraceで従来通り読める＝配布済みリンク不破壊。
        let rtok = await env.SNAPS.get("rtok:" + id);
        if (!rtok && isNew) { rtok = rid(20); await env.SNAPS.put("rtok:" + id, rtok); }
        return json({ id, token, uptok, rtok: rtok || null });
      }

      // POST /api/publish-channel { name, channelInfo, projects:[...], prevId?, token? } → チャンネル丸ごと公開
      if (request.method === "POST" && parts[0] === "api" && parts[1] === "publish-channel") {
        const b = await request.json();
        if (!b || !b.name) return json({ error: "channel name required" }, 400);
        const projects = Array.isArray(b.projects) ? b.projects : [];
        let id = (b.prevId || "").toString().slice(0, 16);
        let token, isNew = false; const nowt = now(); let createdAt = nowt;
        if (id) {
          const et = await env.SNAPS.get("chtok:" + id);
          if (!et || et !== (b.token || "")) { id = ""; }
          else { token = et; const prev = await env.SNAPS.get("chan:" + id, "json"); if (prev && prev.createdAt) createdAt = prev.createdAt; }
        }
        if (!id) { id = rid(8); token = rid(20); isNew = true; }
        // edit:true のときは案件ごとに live 編集リンク（liveId/editToken）を埋めて「URLで全部編集」を可能にする
        const cases = projects.map((p) => {
          const c = slim(p);
          c.id = (p && p.id ? p.id : "").toString().slice(0, 40);
          if (b.edit && p && p.liveId && p.liveToken) {
            c.edit = { liveId: ("" + p.liveId).slice(0, 16), editToken: ("" + p.liveToken).slice(0, 40) };
          }
          return c;
        });
        const doc = { name: b.name, channelInfo: slimCI(b.channelInfo), cases, editable: !!b.edit, createdAt, updatedAt: nowt };
        await env.SNAPS.put("chan:" + id, JSON.stringify(doc));
        await env.SNAPS.put("chtok:" + id, token);
        return json({ id, token });
      }

      // GET /api/chan/{id}  ※チャンネルgatingはPhase2（編集可チャンネルの編集フローと両立確認後）
      if (request.method === "GET" && parts[0] === "api" && parts[1] === "chan" && parts[2] && !parts[3]) {
        const doc = await env.SNAPS.get("chan:" + parts[2], "json");
        if (!doc) return json({ error: "not found" }, 404);
        return json(doc);
      }

      // GET /api/snaps?key=<MG_LIST_KEY> → 公開スナップ一覧 [{id,name,channel}]
      // Flip Board の自動リンク(cron)用。token保護。案件名だけ返す（低機密）。
      if (request.method === "GET" && parts[0] === "api" && parts[1] === "snaps" && !parts[2]) {
        if (!env.MG_LIST_KEY || url.searchParams.get("key") !== env.MG_LIST_KEY) return json({ error: "forbidden" }, 403);
        const listed = await env.SNAPS.list({ prefix: "snap:", limit: 1000 });
        const snaps = [];
        for (const k of listed.keys) {
          const s = await env.SNAPS.get(k.name, "json");
          if (s && s.project) snaps.push({ id: k.name.slice(5), name: s.project.name || "", channel: s.project.channel || "", updatedAt: s.updatedAt || "" });
        }
        return json({ snaps });
      }

      // GET /api/snap/{id}?r=<rtok>
      if (request.method === "GET" && parts[0] === "api" && parts[1] === "snap" && parts[2] && !parts[3]) {
        const rtok = await env.SNAPS.get("rtok:" + parts[2]);
        if (rtok) { // rtok有り=新方式snap→ ?r= 必須（管理token所持のAK本人も可）。rtok無し=旧snapはgraceで従来通り読める。
          const r = url.searchParams.get("r") || "", t = url.searchParams.get("token") || "";
          const admin = t ? await env.SNAPS.get("tok:" + parts[2]) : null;
          if (r !== rtok && !(admin && t === admin)) return json({ error: "unauthorized", auth_required: true }, 401);
        }
        const snap = await env.SNAPS.get("snap:" + parts[2], "json");
        if (!snap) return json({ error: "not found" }, 404);
        // 自己治癒：発行時点で「Stream変換中」のまま凍結した版が snap に残ると、先方ページが
        // 生mp4フォールバック＝激重になる。配信時にStreamの現状を確認し ready/hls を書き戻す。
        try {
          const rv = snap.project && snap.project.review && snap.project.review.versions;
          if (Array.isArray(rv) && env.STREAM_ACCOUNT_ID && env.STREAM_API_TOKEN) {
            const stale = rv.filter((v) => v && v.type === "stream" && v.uid && (!v.ready || !v.hls) && !v.trashedAt).slice(0, 6);
            let changed = false;
            for (const v of stale) {
              const r = await fetch("https://api.cloudflare.com/client/v4/accounts/" + env.STREAM_ACCOUNT_ID + "/stream/" + v.uid,
                { headers: { Authorization: "Bearer " + env.STREAM_API_TOKEN } });
              const d = await r.json().catch(() => null);
              const st = d && d.result && d.result.status && d.result.status.state;
              if (st === "ready") {
                v.ready = true;
                v.hls = (d.result.playback && d.result.playback.hls) || v.hls || "";
                changed = true;
              }
            }
            if (changed) await env.SNAPS.put("snap:" + parts[2], JSON.stringify(snap));
          }
        } catch (e) {}
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
        // 無認証エンドポイントのためスパム/KV肥大化を防ぐ件数上限
        if (list.length >= 1000) return json({ error: "コメント数が上限に達しています" }, 429);
        const c = {
          id: rid(10),
          sceneId: (b.sceneId || "").toString().slice(0, 40),
          sceneLabel: (b.sceneLabel || "").toString().slice(0, 200),
          author: (b.author || "ゲスト").toString().slice(0, 60),
          text,
          timecode: (typeof b.timecode === "number" && isFinite(b.timecode)) ? Math.max(0, b.timecode) : null,
          videoKey: (b.videoKey || "").toString().slice(0, 80) || null,
          // ===== 修正管理（Frame.io型）=====
          category: (b.category || "その他").toString().slice(0, 20),
          priority: (b.priority || "中").toString().slice(0, 4),
          status: (b.status || "未対応").toString().slice(0, 8),
          assignee: (b.assignee || "").toString().slice(0, 60),
          versionId: (b.versionId || "").toString().slice(0, 40),
          replies: [],
          createdAt: new Date().toISOString(),
          resolved: false,
        };
        list.push(c);
        await env.SNAPS.put("cmt:" + id, JSON.stringify(list));
        return json({ comment: c });
      }

      // POST /api/snap/{id}/comments/{cid}
      //  返信: { reply:{author,text} } はトークン不要（先方も編集者も返信可）
      //  状態/属性変更: { status?, category?, priority?, assignee?, resolved?, token } は要トークン（編集者）
      //  対応済みのみ: { resolved, up } はアップロードトークン(uptok)でも可（先方の編集者が自分で直したら自分でチェックできるように）
      if (request.method === "POST" && parts[1] === "snap" && parts[3] === "comments" && parts[4]) {
        const id = parts[2], cid = parts[4];
        const b = await request.json();
        const list = (await env.SNAPS.get("cmt:" + id, "json")) || [];
        const c = list.find((x) => x.id === cid);
        if (!c) return json({ error: "not found" }, 404);
        // 返信（無認証OK）
        if (b.reply && (b.reply.text || "").toString().trim()) {
          if (!Array.isArray(c.replies)) c.replies = [];
          if (c.replies.length < 200) {
            c.replies.push({ id: rid(8), author: (b.reply.author || "ゲスト").toString().slice(0, 60), text: b.reply.text.toString().trim().slice(0, 2000), createdAt: new Date().toISOString() });
          }
          await env.SNAPS.put("cmt:" + id, JSON.stringify(list));
          return json({ comment: c });
        }
        // 状態・属性の変更は要トークン
        const tok = await env.SNAPS.get("tok:" + id);
        const isAdmin = !!tok && tok === (b.token || "");
        let isUploader = false;
        if (!isAdmin && b.up) {
          const uptok = await env.SNAPS.get("uptok:" + id);
          isUploader = !!uptok && uptok === b.up;
        }
        if (!isAdmin && !isUploader) return json({ error: "forbidden" }, 403);
        if (typeof b.resolved === "boolean") {
          c.resolved = b.resolved;
          if (b.resolved) { if (!b.status) c.status = "完了"; }
          else if (c.status === "完了") { c.status = "未対応"; }
        }
        // アップロードトークンは対応済みフラグのみ。属性変更は編集者(管理トークン)限定。
        if (isAdmin) {
          if (typeof b.status === "string") { c.status = b.status.slice(0, 8); c.resolved = (c.status === "完了"); }
          if (typeof b.category === "string") c.category = b.category.slice(0, 20);
          if (typeof b.priority === "string") c.priority = b.priority.slice(0, 4);
          if (typeof b.assignee === "string") c.assignee = b.assignee.slice(0, 60);
        }
        await env.SNAPS.put("cmt:" + id, JSON.stringify(list));
        return json({ comment: c });
      }

      // DELETE /api/snap/{id}/comments/{cid}
      //  ?token=... ＝AK側(要トークン・無制限) / ?own=1 ＝先方が自分の誤投稿を取消（無認証・投稿から24h以内のみ）
      if (request.method === "DELETE" && parts[1] === "snap" && parts[3] === "comments" && parts[4]) {
        const id = parts[2], cid = parts[4];
        let list = (await env.SNAPS.get("cmt:" + id, "json")) || [];
        const c = list.find((x) => x.id === cid);
        const own = url.searchParams.get("own") === "1";
        if (own) {
          // 私物の取消：24h以内のみ＝荒らしで過去コメント一掃されるのを防ぐ
          if (c && (Date.now() - new Date(c.createdAt).getTime()) > 24 * 3600 * 1000) return json({ error: "期限切れ（投稿から24時間以内のみ取消可）" }, 403);
        } else {
          const tok = await env.SNAPS.get("tok:" + id);
          if (!tok || tok !== (url.searchParams.get("token") || "")) return json({ error: "forbidden" }, 403);
        }
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
        // aud（このアプリ向けトークンか）を必須検証：未設定だと他アプリのトークンでログイン可能になるため
        if (!env.GOOGLE_CLIENT_ID) return json({ error: "サーバ設定エラー（GOOGLE_CLIENT_ID 未設定）" }, 500);
        if (g.aud !== env.GOOGLE_CLIENT_ID) return json({ error: "client_id が一致しません" }, 401);
        if (!g.sub) return json({ error: "ユーザー情報を取得できませんでした" }, 401);
        if (g.email && g.email_verified === "false") return json({ error: "メール未確認のアカウントです" }, 401);
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
            doc = { id, ownerSub: u.sub, ownerEmail: myEmail, members: [myEmail], project, name: project.name || "", channel: project.channel || "", updatedAt: now() };
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

      // ===== リアルタイム共同編集：ライブドキュメント発行 =====
      // POST /api/live/create { project, prevLiveId?, editToken? } → { liveId, editToken }
      if (request.method === "POST" && parts[1] === "live" && parts[2] === "create") {
        const b = await request.json();
        if (!b.project || !Array.isArray(b.project.rows)) return json({ error: "invalid project" }, 400);
        let liveId = (b.prevLiveId || "").toString().slice(0, 16);
        let editToken = (b.editToken || "").toString();
        if (!liveId || !editToken) { liveId = rid(8); editToken = rid(20); }
        const stub = env.LIVEDOC.get(env.LIVEDOC.idFromName(liveId));
        const r = await stub.fetch("https://do/seed", { method: "POST", body: JSON.stringify({ project: b.project, editToken }) });
        if (!r.ok) return json({ error: "ライブ発行に失敗" }, 500);
        return json({ liveId, editToken });
      }

      // GET /api/live/{id}/snapshot?k=token → ライブ文書の現在値（チャンネル編集共有で最新の企画・サムネを見せる用）
      if (request.method === "GET" && parts[1] === "live" && parts[2] && parts[3] === "snapshot") {
        const stub = env.LIVEDOC.get(env.LIVEDOC.idFromName(parts[2]));
        const r = await stub.fetch("https://do/snapshot?k=" + encodeURIComponent(url.searchParams.get("k") || ""));
        const d = await r.json().catch(() => ({}));
        return json(d, r.status);
      }

      // ===== 大容量ファイル転送＋動画レビュー（R2） =====
      // 容量・件数のキャップ（先方=無認証アップの暴走防止）
      const GUEST_MAX_SIZE = 2 * 1024 * 1024 * 1024;    // 先方 1ファイル上限 2GB
      const OWNER_MAX_SIZE = 500 * 1024 * 1024 * 1024;  // AK 1ファイル上限 500GB（クライアントが動的チャンクでR2上限1万パート以内に分割）
      const GUEST_MAX_COUNT = 50;                       // 先方アップの件数上限/案件

      // ブラウザ→Worker→R2 のマルチパートアップロード（S3鍵・presign不要）。
      // 大容量はクライアントがチャンク分割し、各パートを PUT で Worker に送る。

      // POST /api/file/mpu/create  { snap, name, size, mime, token? } → { key, uploadId }
      if (request.method === "POST" && parts[1] === "file" && parts[2] === "mpu" && parts[3] === "create") {
        const b = await request.json();
        const snap = (b.snap || "").toString().slice(0, 16);
        if (!snap) return json({ error: "snap がありません" }, 400);
        if (!(await env.SNAPS.get("snap:" + snap)) && !(await env.SNAPS.get("chan:" + snap)))
          return json({ error: "not found" }, 404);
        const tok = await env.SNAPS.get("tok:" + snap);
        const isOwner = !!tok && tok === (b.token || "");
        // 編集者アップトークン（&up=）：大容量アップだけ owner 並みに許可（管理権限は無し）
        const uptok = await env.SNAPS.get("uptok:" + snap);
        const isEditor = !isOwner && !!uptok && uptok === (b.up || "");
        const isUploader = isOwner || isEditor;
        const size = Math.max(0, +b.size || 0);
        if (isUploader) {
          if (size > OWNER_MAX_SIZE) return json({ error: "ファイルが大きすぎます（500GBまで）" }, 413);
        } else {
          if (size > GUEST_MAX_SIZE) return json({ error: "ファイルが大きすぎます（このリンクは2GBまで。編集者は配布された編集者用リンクから上げてね）" }, 413);
          const ups = (await env.SNAPS.get("file_up:" + snap, "json")) || [];
          if (ups.length >= GUEST_MAX_COUNT) return json({ error: "アップロード件数の上限に達しています" }, 429);
        }
        const key = "f/" + snap + "/" + rid(8) + "-" + Date.now();
        const mpu = await env.FILES.createMultipartUpload(key, {
          httpMetadata: { contentType: (b.mime || "application/octet-stream").toString().slice(0, 120) },
        });
        return json({ key, uploadId: mpu.uploadId });
      }

      // PUT /api/file/mpu/part?key=&uploadId=&part=N   (body=チャンク) → { partNumber, etag }
      if (request.method === "PUT" && parts[1] === "file" && parts[2] === "mpu" && parts[3] === "part") {
        const key = url.searchParams.get("key") || "";
        const uploadId = url.searchParams.get("uploadId") || "";
        const partNumber = +(url.searchParams.get("part") || 0);
        if (!key || !uploadId || !partNumber) return json({ error: "パラメータ不足" }, 400);
        const mpu = env.FILES.resumeMultipartUpload(key, uploadId);
        const body = await request.arrayBuffer();
        const uploaded = await mpu.uploadPart(partNumber, body);
        return json({ partNumber, etag: uploaded.etag });
      }

      // POST /api/file/mpu/complete  { snap, key, uploadId, parts, name, size, mime, token?, retention } → { file }
      if (request.method === "POST" && parts[1] === "file" && parts[2] === "mpu" && parts[3] === "complete") {
        const b = await request.json();
        const snap = (b.snap || "").toString().slice(0, 16);
        const key = (b.key || "").toString();
        if (!snap || !key || !key.startsWith("f/" + snap + "/")) return json({ error: "不正なキーです" }, 400);
        const tok = await env.SNAPS.get("tok:" + snap);
        const isOwner = !!tok && tok === (b.token || "");
        const uptok = await env.SNAPS.get("uptok:" + snap);
        const isEditor = !isOwner && !!uptok && uptok === (b.up || "");
        const mpu = env.FILES.resumeMultipartUpload(key, (b.uploadId || "").toString());
        const partList = (Array.isArray(b.parts) ? b.parts : []).map((p) => ({ partNumber: +p.partNumber, etag: (p.etag || "").toString() }));
        await mpu.complete(partList);
        const ret = +b.retention; // 30 | 90 | 0(無期限)
        const days = ret === 30 || ret === 90 ? ret : 0;
        const meta = {
          key,
          name: (b.name || "file").toString().slice(0, 255),
          size: Math.max(0, +b.size || 0),
          mime: (b.mime || "application/octet-stream").toString().slice(0, 120),
          uploadedAt: now(),
          expiresAt: days ? new Date(Date.now() + days * 86400000).toISOString() : null,
          by: isOwner ? "owner" : (isEditor ? "editor" : "guest"),
          // role: "review"=完成動画（動画確認に出す） / 既定=素材
          role: (b.role === "review") ? "review" : "",
          planId: (b.planId || "").toString().slice(0, 40),
        };
        await env.SNAPS.put("file:" + key, JSON.stringify(meta));
        // 先方・編集者アップは案件ごとの一覧 file_up:{snap} に積む（owner はクライアントが project.files に保持）
        if (!isOwner) {
          const ups = (await env.SNAPS.get("file_up:" + snap, "json")) || [];
          ups.push(meta);
          await env.SNAPS.put("file_up:" + snap, JSON.stringify(ups));
        }
        // 完成動画(role:review)は、AKがアプリを開かなくてもその場で確認用バージョンに自動昇格＋Stream変換。
        if (meta.role === "review") {
          try { await autoRegisterReviewVersion(env, new URL(request.url).origin, snap, meta); } catch (e) {}
        }
        return json({ file: meta });
      }

      // GET /api/snap/{id}/uploads  → 先方アップロード一覧
      if (request.method === "GET" && parts[1] === "snap" && parts[3] === "uploads" && !parts[4]) {
        const ups = (await env.SNAPS.get("file_up:" + parts[2], "json")) || [];
        return json({ uploads: ups });
      }

      // ===== 縦型ショート生成ジョブ（ものがたりっち→Macエンジン のポーリング連携）=====
      // POST /api/shorts/enqueue { snap, token, videoKey, sheetUrl?, notes?, nMax?, kind? } → ジョブ登録（snap所有者のみ）
      // kind="transcribe" はショートを作らずWhisper文字起こしだけ返す（納品完了タブの実尺目次用）
      if (request.method === "POST" && parts[0] === "api" && parts[1] === "shorts" && parts[2] === "enqueue") {
        const b = await request.json().catch(() => ({}));
        const snap = (b.snap || "").toString().slice(0, 16);
        if (!snap) return json({ error: "snap必須" }, 400);
        const tok = await env.SNAPS.get("tok:" + snap);
        if (!tok || tok !== (b.token || "")) return json({ error: "forbidden" }, 403);
        if (!b.videoKey) return json({ error: "videoKey必須" }, 400);
        const kind = b.kind === "transcribe" ? "transcribe" : "shorts";
        // 同じsnapで同種ジョブが走行中なら二重登録しない（自動生成の連打・再訪で積み上がるのを防ぐ）
        const idx0 = (await env.SNAPS.get("sjobs:idx", "json")) || [];
        const dup = idx0.find((e) => e.snap === snap && (e.kind || "shorts") === kind && (e.status === "pending" || e.status === "processing"));
        if (dup) return json({ ok: true, jobId: dup.id, status: dup.status, dedup: true });
        const jobId = rid(12);
        const job = { id: jobId, snap, kind, videoKey: ("" + b.videoKey).slice(0, 200), sheetUrl: ("" + (b.sheetUrl || "")).slice(0, 300), notes: ("" + (b.notes || "")).slice(0, 1000), nMax: Math.max(1, Math.min(12, parseInt(b.nMax, 10) || 8)), status: "pending", createdAt: now(), updatedAt: now(), shorts: [], error: "" };
        await env.SNAPS.put("sjob:" + jobId, JSON.stringify(job));
        // ジョブ索引 sjobs:idx に積む。poll/list/staleはKV list()禁止（無料枠1000回/日を10秒ポーリングが食い潰す）
        const idx = idx0;
        idx.push({ id: jobId, snap, kind, status: "pending", createdAt: job.createdAt, updatedAt: job.updatedAt, error: "" });
        await env.SNAPS.put("sjobs:idx", JSON.stringify(idx.slice(-200)));
        return json({ ok: true, jobId, status: "pending" });
      }
      // GET /api/shorts/poll?key=<MG_LIST_KEY> → Macが未処理ジョブを1件取得しprocessingに
      if (request.method === "GET" && parts[0] === "api" && parts[1] === "shorts" && parts[2] === "poll") {
        if (!env.SHORTS_KEY || url.searchParams.get("key") !== env.SHORTS_KEY) return json({ error: "forbidden" }, 403);
        const idx = (await env.SNAPS.get("sjobs:idx", "json")) || [];
        let ref = null;
        for (const e of idx) if (e.status === "pending" && (!ref || e.createdAt < ref.createdAt)) ref = e;
        if (!ref) return json({ job: null });
        const picked = await env.SNAPS.get("sjob:" + ref.id, "json");
        if (!picked) { ref.status = "error"; ref.error = "job body missing"; ref.updatedAt = now(); await env.SNAPS.put("sjobs:idx", JSON.stringify(idx)); return json({ job: null }); }
        picked.status = "processing"; picked.updatedAt = now();
        ref.status = "processing"; ref.updatedAt = picked.updatedAt;
        await env.SNAPS.put("sjob:" + picked.id, JSON.stringify(picked));
        await env.SNAPS.put("sjobs:idx", JSON.stringify(idx));
        return json({ job: picked });
      }
      // POST /api/shorts/result { key, jobId, status:"done"|"error", shorts?:[{key,name,size}], transcript?:[{start,end,text}], error? } → Macが結果を返す
      if (request.method === "POST" && parts[0] === "api" && parts[1] === "shorts" && parts[2] === "result") {
        const b = await request.json().catch(() => ({}));
        if (!env.SHORTS_KEY || b.key !== env.SHORTS_KEY) return json({ error: "forbidden" }, 403);
        const job = await env.SNAPS.get("sjob:" + (b.jobId || ""), "json");
        if (!job) return json({ error: "job not found" }, 404);
        job.status = b.status === "error" ? "error" : "done";
        job.error = ("" + (b.error || "")).slice(0, 500);
        job.shorts = Array.isArray(b.shorts) ? b.shorts.slice(0, 20).map((s) => ({ key: ("" + (s.key || "")).slice(0, 200), name: ("" + (s.name || "")).slice(0, 120), size: parseInt(s.size, 10) || 0 })) : [];
        job.updatedAt = now();
        await env.SNAPS.put("sjob:" + job.id, JSON.stringify(job));
        const ridx = (await env.SNAPS.get("sjobs:idx", "json")) || [];
        const re = ridx.find((x) => x.id === job.id);
        if (re) { re.status = job.status; re.updatedAt = job.updatedAt; re.error = job.error; await env.SNAPS.put("sjobs:idx", JSON.stringify(ridx)); }
        if (job.status === "done" && job.shorts.length) await env.SNAPS.put("shorts:" + job.snap, JSON.stringify({ items: job.shorts, updatedAt: now() }));
        // 切り抜きで使ったWhisper文字起こしを保存＝納品完了タブの目次生成に流用（実尺ベースの正確なTC）
        if (job.status === "done" && Array.isArray(b.transcript) && b.transcript.length) {
          const segs = b.transcript.slice(0, 4000).map((s) => ({ start: Math.max(0, +s.start || 0), end: Math.max(0, +s.end || 0), text: ("" + (s.text || "")).slice(0, 300) }));
          await env.SNAPS.put("transcript:" + job.snap, JSON.stringify({ videoKey: job.videoKey || "", segments: segs, updatedAt: now() }));
        }
        return json({ ok: true });
      }
      // GET /api/transcript/{snap}?r=<rtok> → 切り抜き生成時のWhisper文字起こし（目次生成用・shorts listと同じ認可）
      if (request.method === "GET" && parts[0] === "api" && parts[1] === "transcript" && parts[2]) {
        const snap = parts[2];
        const rtok = await env.SNAPS.get("rtok:" + snap);
        if (rtok) {
          const r = url.searchParams.get("r") || "", t = url.searchParams.get("token") || "";
          const admin = t ? await env.SNAPS.get("tok:" + snap) : null;
          if (r !== rtok && !(admin && t === admin)) return json({ error: "unauthorized", auth_required: true }, 401);
        }
        const res = await env.SNAPS.get("transcript:" + snap, "json");
        return json(res || { videoKey: "", segments: [] });
      }
      // GET /api/shorts/list/{snap}?r=<rtok> → 生成済みショート＋ジョブ状況（ビューア＆アプリ用・snap閲覧と同じgrace）
      if (request.method === "GET" && parts[0] === "api" && parts[1] === "shorts" && parts[2] === "list" && parts[3]) {
        const snap = parts[3];
        const rtok = await env.SNAPS.get("rtok:" + snap);
        if (rtok) {
          const r = url.searchParams.get("r") || "", t = url.searchParams.get("token") || "";
          const admin = t ? await env.SNAPS.get("tok:" + snap) : null;
          if (r !== rtok && !(admin && t === admin)) return json({ error: "unauthorized", auth_required: true }, 401);
        }
        const res = await env.SNAPS.get("shorts:" + snap, "json");
        const idx = (await env.SNAPS.get("sjobs:idx", "json")) || [];
        // transcribeジョブは切り抜きUIのジョブ状況に混ぜない（ショート生成中と誤表示されるのを防ぐ）
        const jobs = idx.filter((j) => j.snap === snap && (j.kind || "shorts") !== "transcribe").map((j) => ({ id: j.id, status: j.status, createdAt: j.createdAt, error: j.error || "" }));
        return json({ shorts: (res && res.items) || [], jobs });
      }
      // PUT /api/shorts/upload?key=<MG_LIST_KEY>&snap=&name= → Macが生成ショートmp4をR2に上げる。keyを返す
      if (request.method === "PUT" && parts[0] === "api" && parts[1] === "shorts" && parts[2] === "upload") {
        if (!env.SHORTS_KEY || url.searchParams.get("key") !== env.SHORTS_KEY) return json({ error: "forbidden" }, 403);
        const snap = (url.searchParams.get("snap") || "").slice(0, 16);
        const name = (url.searchParams.get("name") || "short.mp4").replace(/[\/\\]/g, "_").slice(0, 120);
        if (!snap) return json({ error: "snap必須" }, 400);
        const rkey = `f/${snap}/shorts/${rid(8)}_${name}`;
        await env.FILES.put(rkey, request.body, { httpMetadata: { contentType: "video/mp4" } });
        await env.SNAPS.put("file:" + rkey, JSON.stringify({ name, mime: "video/mp4" }));
        return json({ ok: true, key: rkey });
      }
      // GET /api/shorts/stale?key=<MG_LIST_KEY>&thresholdMin=N → 放置ジョブ検知（cron-worker日次まとめ用）
      // SHORTS_KEYではなくMG_LIST_KEYでゲート＝Mac用ではなくcron専用の口
      if (request.method === "GET" && parts[0] === "api" && parts[1] === "shorts" && parts[2] === "stale") {
        if (!env.MG_LIST_KEY || url.searchParams.get("key") !== env.MG_LIST_KEY) return json({ error: "forbidden" }, 403);
        const thresholdMin = Math.max(5, Math.min(1440, parseInt(url.searchParams.get("thresholdMin"), 10) || 90));
        const cutoffMs = thresholdMin * 60000;
        const idx = (await env.SNAPS.get("sjobs:idx", "json")) || [];
        const stale = [];
        for (const j of idx) {
          if (j.status !== "pending" && j.status !== "processing") continue;
          const ageMs = Date.now() - new Date(j.updatedAt || j.createdAt).getTime();
          if (ageMs > cutoffMs) stale.push({ id: j.id, snap: j.snap, status: j.status, minutesStuck: Math.round(ageMs / 60000) });
        }
        return json({ stale });
      }

      // GET /shorts/{snap}?r=<rtok> → 切り抜きショートのギャラリーページ（全本を1画面で再生・DL）
      // 認可はページ自体では掛けず、中身の取得(/api/shorts/list)が rtok を要求する構造に乗る
      if (request.method === "GET" && parts[0] === "shorts" && parts[1] && !parts[2]) {
        const snap = parts[1];
        if (!/^[a-z0-9]{4,16}$/.test(snap)) return json({ error: "not found" }, 404);
        const page = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>切り抜きショート | ものがたりっち！</title>
<style>
:root{color-scheme:light}
*{box-sizing:border-box;margin:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",sans-serif;background:#fafaf9;color:#44403c;padding:24px 16px 64px}
header{max-width:1040px;margin:0 auto 20px}
h1{font-size:16px;font-weight:700;display:flex;align-items:center;gap:8px}
h1 svg{width:18px;height:18px;stroke:#e11d48}
.sub{font-size:11px;color:#a8a29e;margin-top:4px}
.grid{max-width:1040px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px}
.card{background:#fff;border:1px solid #e7e5e4;border-radius:14px;overflow:hidden}
.card video{width:100%;aspect-ratio:9/16;object-fit:contain;background:#1c1917;display:block}
.meta{padding:8px 10px 10px}
.name{font-size:11px;font-weight:700;color:#57534e;word-break:break-all}
.size{font-size:10px;color:#a8a29e;margin-top:2px}
.acts{display:flex;gap:6px;margin-top:8px}
.acts a,.acts button{flex:1;font-size:10px;font-weight:700;padding:5px 0;border-radius:8px;border:1px solid #e7e5e4;background:#fff;color:#78716c;text-align:center;text-decoration:none;cursor:pointer;font-family:inherit}
.acts a:hover,.acts button:hover{background:#f5f5f4;color:#44403c}
.empty{max-width:1040px;margin:40px auto;text-align:center;font-size:13px;color:#a8a29e}
.badge{display:inline-block;font-size:10px;font-weight:700;color:#e11d48;border:1px solid #fecdd3;background:#fff1f2;border-radius:999px;padding:2px 10px;margin-left:8px;vertical-align:1px}
.badge[hidden]{display:none}
</style></head><body>
<header><h1><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2" width="10" height="20" rx="2"></rect><path d="m10 9 5 3-5 3z" fill="#e11d48" stroke="none"></path></svg>切り抜きショート<span id="st" class="badge" hidden></span></h1><div class="sub" id="sub"></div></header>
<div class="grid" id="g"></div><div class="empty" id="e" hidden></div>
<script>
const SNAP=${JSON.stringify(snap)};
const esc=(s)=>String(s).replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const mb=(n)=>n>0?(n/1048576).toFixed(1)+" MB":"";
async function load(){
  const r=await fetch("/api/shorts/list/"+SNAP+location.search);
  const d=await r.json().catch(()=>({}));
  const g=document.getElementById("g"),e=document.getElementById("e"),st=document.getElementById("st");
  if(r.status===401){e.hidden=false;e.textContent="閲覧には共有リンク（?r=…付きURL）が必要です";return}
  const items=d.shorts||[];
  const running=(d.jobs||[]).some((j)=>j.status==="pending"||j.status==="processing");
  if(running){st.hidden=false;st.textContent="生成中";setTimeout(load,20000)}else{st.hidden=true}
  document.getElementById("sub").textContent=items.length?items.length+"本":"";
  if(!items.length){e.hidden=false;e.textContent=running?"切り抜きを生成しています。このまま待つと自動で表示されます":"切り抜きショートはまだありません";return}
  e.hidden=true;
  g.innerHTML=items.map((s)=>{
    const u="/api/file/"+encodeURIComponent(s.key).replace(/%2F/g,"/")+location.search;
    const dl=u+(location.search?"&":"?")+"dl=1";
    return '<div class="card"><video controls preload="metadata" src="'+esc(u)+'"></video><div class="meta"><div class="name">'+esc(s.name||"short.mp4")+'</div><div class="size">'+mb(s.size)+'</div><div class="acts"><a href="'+esc(dl)+'">保存</a><button data-u="'+esc(u)+'">URLコピー</button></div></div></div>';
  }).join("");
  g.querySelectorAll("button[data-u]").forEach((b)=>b.addEventListener("click",async()=>{await navigator.clipboard.writeText(location.origin+b.dataset.u);b.textContent="コピー済";setTimeout(()=>{b.textContent="URLコピー"},1500)}));
}
load();
</script></body></html>`;
        return new Response(page, { headers: { ...CORS, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; media-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:" } });
      }

      // GET /api/file/{key...}?dl=1  → R2 から原本ストリーム配信（Range対応・元ファイル名復元）
      if (request.method === "GET" && parts[1] === "file" && parts[2] && parts[2] !== "mpu") {
        const key = parts.slice(2).join("/");
        const meta = (await env.SNAPS.get("file:" + key, "json")) || {};
        // Range再生（動画シーク）時は onlyIf を渡さない＝条件付きGETでbody無し応答になりカクつくのを防ぐ
        const hasRange = request.headers.has("Range");
        const obj = await env.FILES.get(key, hasRange ? { range: request.headers } : { onlyIf: request.headers });
        if (!obj) return json({ error: "not found" }, 404);
        const h = new Headers(CORS);
        obj.writeHttpMetadata(h);
        h.set("Content-Type", meta.mime || h.get("Content-Type") || "application/octet-stream");
        h.set("etag", obj.httpEtag);
        h.set("Accept-Ranges", "bytes");
        h.set("Access-Control-Expose-Headers", "Content-Length,Content-Range,Content-Disposition,ETag,Accept-Ranges");
        // ?name= はアプリ内リネームの反映（Content-Dispositionのファイル名だけ・encodeURIComponent経由でヘッダ注入不可）
        const fname = url.searchParams.get("name") || meta.name || key.split("/").pop() || "download";
        const dl = url.searchParams.get("dl");
        // 動画/音声/画像(svg除く)/pdf 以外は ?dl 有無に関わらず attachment 強制＝HTML/SVGのインライン実行を封じる。
        const ctype = h.get("Content-Type") || "application/octet-stream";
        const inline = !dl && INLINE_OK.test(ctype);
        h.set("Content-Disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(fname)}`);
        if (!("body" in obj) || !obj.body) return new Response(null, { status: 304, headers: h }); // onlyIf 不一致
        if (obj.range) {
          let start = 0, end = (obj.size || 1) - 1;
          if ("suffix" in obj.range) { start = (obj.size || 0) - obj.range.suffix; end = (obj.size || 1) - 1; }
          else { start = obj.range.offset || 0; end = obj.range.length != null ? start + obj.range.length - 1 : (obj.size || 1) - 1; }
          h.set("Content-Range", `bytes ${start}-${end}/${obj.size}`);
          return new Response(obj.body, { status: 206, headers: h });
        }
        return new Response(obj.body, { status: 200, headers: h });
      }

      // DELETE /api/file/{key...}?snap=&token=  → オーナーのみ削除
      if (request.method === "DELETE" && parts[1] === "file" && parts[2]) {
        const key = parts.slice(2).join("/");
        const snap = url.searchParams.get("snap") || "";
        const tok = await env.SNAPS.get("tok:" + snap);
        if (!tok || tok !== (url.searchParams.get("token") || "")) return json({ error: "forbidden" }, 403);
        await env.FILES.delete(key);
        await env.SNAPS.delete("file:" + key);
        let ups = (await env.SNAPS.get("file_up:" + snap, "json")) || [];
        const before = ups.length;
        ups = ups.filter((f) => f.key !== key);
        if (ups.length !== before) await env.SNAPS.put("file_up:" + snap, JSON.stringify(ups));
        return json({ ok: true });
      }

      // POST /api/file/{key...}/trash?snap=&token=  → 即削除せず7日間の猶予期間を設定（誤削除の復元窓）
      // R2/KV本体はまだ消さず、cleanupExpiredのexpiresAtチェックに乗せて後日まとめて消す
      if (request.method === "POST" && parts[1] === "file" && parts[parts.length - 1] === "trash" && parts.length > 3) {
        const key = parts.slice(2, -1).join("/");
        const snap = url.searchParams.get("snap") || "";
        const tok = await env.SNAPS.get("tok:" + snap);
        if (!tok || tok !== (url.searchParams.get("token") || "")) return json({ error: "forbidden" }, 403);
        const meta = (await env.SNAPS.get("file:" + key, "json")) || {};
        const b = await request.json().catch(() => ({}));
        const trashedAt = now();
        const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
        await env.SNAPS.put("file:" + key, JSON.stringify({ ...meta, trashedAt, expiresAt, streamUid: (b.streamUid || "").toString().slice(0, 60) || null }));
        return json({ ok: true, expiresAt });
      }

      // POST /api/file/{key...}/restore?snap=&token=  → 猶予期間内なら削除予約を取り消し
      if (request.method === "POST" && parts[1] === "file" && parts[parts.length - 1] === "restore" && parts.length > 3) {
        const key = parts.slice(2, -1).join("/");
        const snap = url.searchParams.get("snap") || "";
        const tok = await env.SNAPS.get("tok:" + snap);
        if (!tok || tok !== (url.searchParams.get("token") || "")) return json({ error: "forbidden" }, 403);
        const meta = (await env.SNAPS.get("file:" + key, "json")) || {};
        const obj = await env.FILES.head(key);
        if (!obj) return json({ error: "既に完全削除済みで復元できません" }, 410);
        const { trashedAt, expiresAt, streamUid, ...rest } = meta;
        await env.SNAPS.put("file:" + key, JSON.stringify(rest));
        return json({ ok: true });
      }

      // ===== Cloudflare Stream（確認用動画の自動トランスコード＝Frame.io方式） =====
      // 設定: wrangler.toml [vars] STREAM_ACCOUNT_ID ＋ secret STREAM_API_TOKEN（Stream:Edit）
      const streamCfg = () => env.STREAM_ACCOUNT_ID && env.STREAM_API_TOKEN
        ? { base: "https://api.cloudflare.com/client/v4/accounts/" + env.STREAM_ACCOUNT_ID + "/stream", auth: { Authorization: "Bearer " + env.STREAM_API_TOKEN } } : null;

      // POST /api/stream/copy  { snap, token, key, name }  → R2の動画をStreamに取り込み（コピー）→ { uid }
      if (request.method === "POST" && parts[1] === "stream" && parts[2] === "copy") {
        const cfg = streamCfg();
        if (!cfg) return json({ error: "stream_disabled" }, 200);
        const b = await request.json();
        const key = (b.key || "").toString();
        if (!key) return json({ error: "key required" }, 400);
        const tok = await env.SNAPS.get("tok:" + (b.snap || ""));
        if (!tok || tok !== (b.token || "")) return json({ error: "forbidden" }, 403);
        const srcUrl = new URL(request.url).origin + "/api/file/" + key; // /api/file は公開GET＝Streamが取得可能
        const r = await fetch(cfg.base + "/copy", {
          method: "POST", headers: { ...cfg.auth, "Content-Type": "application/json" },
          body: JSON.stringify({ url: srcUrl, meta: { name: (b.name || "確認用動画").toString().slice(0, 120) }, requireSignedURLs: false }),
        });
        const d = await r.json();
        if (!d.success) return json({ error: (d.errors && d.errors[0] && d.errors[0].message) || "stream copy失敗" }, 502);
        return json({ uid: d.result.uid });
      }

      // GET /api/stream/{uid}  → 変換状況＋再生URL（HLS）
      if (request.method === "GET" && parts[1] === "stream" && parts[2]) {
        const cfg = streamCfg();
        if (!cfg) return json({ error: "stream_disabled" }, 200);
        const r = await fetch(cfg.base + "/" + parts[2], { headers: cfg.auth });
        const d = await r.json();
        if (!d.success) return json({ error: "not found" }, 404);
        const v = d.result;
        const st = v.status || {};
        return json({ ready: !!v.readyToStream, pct: st.pctComplete || null, state: st.state || null, err: st.errorReasonText || st.errorReasonCode || null, hls: v.playback && v.playback.hls, thumbnail: v.thumbnail, duration: v.duration });
      }

      // DELETE /api/stream/{uid}?snap=&token=  → オーナーのみ
      if (request.method === "DELETE" && parts[1] === "stream" && parts[2]) {
        const cfg = streamCfg();
        if (!cfg) return json({ error: "stream_disabled" }, 200);
        const tok = await env.SNAPS.get("tok:" + (url.searchParams.get("snap") || ""));
        if (!tok || tok !== (url.searchParams.get("token") || "")) return json({ error: "forbidden" }, 403);
        await fetch(cfg.base + "/" + parts[2], { method: "DELETE", headers: cfg.auth });
        return json({ ok: true });
      }

      return json({ error: "no route" }, 404);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  },

  // ===== 期限切れファイルの自動削除（cron） =====
  async scheduled(event, env, ctx) {
    ctx.waitUntil(cleanupExpired(env));
    ctx.waitUntil(purgeOldStreamVideos(env));
  },
};

/* ===== 古いStream変換版の掃除（2026-07-14 AK承認・コスト削減） =====
   Streamは保管分数課金なので無期限保持だと請求が単調増加する。STREAM_TTL_DAYS（既定60日）より
   古い版はStream動画だけ削除し、版は type:"file" に落としてR2原本の直再生へフォールバック
   （元ファイルは消さない＝視聴は失われない。再生が少し重くなるだけ）。
   R2原本(key)が無い版は消すと視聴不能になるためスキップ。KV listは日次cronの数ページのみ=枠1000/日に無害。 */
async function purgeOldStreamVideos(env) {
  if (!env.STREAM_ACCOUNT_ID || !env.STREAM_API_TOKEN) return;
  const ttlDays = parseInt(env.STREAM_TTL_DAYS || "60", 10);
  if (!(ttlDays > 0)) return; // STREAM_TTL_DAYS=0 で無効化できる
  const cutoff = Date.now() - ttlDays * 24 * 3600 * 1000;
  let purged = 0, cursor;
  do {
    const res = await env.SNAPS.list({ prefix: "snap:", cursor, limit: 1000 });
    for (const k of res.keys) {
      let snap;
      try { snap = await env.SNAPS.get(k.name, "json"); } catch (e) { continue; }
      const vers = snap && snap.project && snap.project.review && snap.project.review.versions;
      if (!Array.isArray(vers)) continue;
      let changed = false;
      for (const v of vers) {
        if (!v || v.type !== "stream" || !v.uid || !v.key) continue;
        if ((v.createdAt || 0) >= cutoff) continue;
        try {
          const r = await fetch("https://api.cloudflare.com/client/v4/accounts/" + env.STREAM_ACCOUNT_ID + "/stream/" + v.uid,
            { method: "DELETE", headers: { Authorization: "Bearer " + env.STREAM_API_TOKEN } });
          if (!r.ok && r.status !== 404) continue; // 失敗した版は次のcronで再挑戦
        } catch (e) { continue; }
        v.type = "file"; // R2直再生へ（「変換中」バッジ/ポーリングの残留も防ぐ）
        v.streamPurgedUid = v.uid; v.streamPurgedAt = Date.now();
        v.uid = ""; v.hls = ""; v.ready = false;
        changed = true; purged++;
      }
      if (changed) await env.SNAPS.put(k.name, JSON.stringify(snap));
    }
    cursor = res.list_complete ? null : res.cursor;
  } while (cursor);
  if (purged) console.log("purgeOldStreamVideos:", purged, "件のStream動画を削除(TTL", ttlDays, "日)");
}

/* ===== セッショントークン（HS256 JWT）。Google検証後に発行し、以降のKVアクセスに使う ===== */
function sessionSecret(env) { if (!env.SESSION_SECRET) throw new Error("SESSION_SECRET 未設定（wrangler secret put が必要）"); return env.SESSION_SECRET; }
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
  // ヘッダの alg を明示検証（HS256固定。将来の検証ロジック変更時の穴を防ぐ）
  let header; try { header = JSON.parse(b64urlToStr(p[0])); } catch (e) { return null; }
  if (!header || header.alg !== "HS256") return null;
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

/* ===== 期限切れファイルの掃除（cron から呼ぶ） ===== */
async function cleanupExpired(env) {
  const nowMs = Date.now();
  let cursor;
  do {
    const res = await env.SNAPS.list({ prefix: "file:", cursor, limit: 1000 });
    for (const k of res.keys) {
      const meta = await env.SNAPS.get(k.name, "json");
      if (meta && meta.expiresAt && new Date(meta.expiresAt).getTime() < nowMs) {
        const key = k.name.slice("file:".length);
        await env.FILES.delete(key);
        await env.SNAPS.delete(k.name);
        // ゴミ箱の猶予期限切れ：R2本体と一緒にStream変換版も本削除（trash時に streamUid を退避してある）
        if (meta.streamUid && env.STREAM_ACCOUNT_ID && env.STREAM_API_TOKEN) {
          try {
            await fetch("https://api.cloudflare.com/client/v4/accounts/" + env.STREAM_ACCOUNT_ID + "/stream/" + meta.streamUid, {
              method: "DELETE", headers: { Authorization: "Bearer " + env.STREAM_API_TOKEN },
            });
          } catch (e) {}
        }
        // 案件アップ一覧からも除去（file_up:{snap}）
        const m = key.match(/^f\/([^/]+)\//);
        if (m) {
          const upKey = "file_up:" + m[1];
          let ups = (await env.SNAPS.get(upKey, "json")) || [];
          const filtered = ups.filter((f) => f.key !== key);
          if (filtered.length !== ups.length) await env.SNAPS.put(upKey, JSON.stringify(filtered));
        }
      }
    }
    cursor = res.list_complete ? null : res.cursor;
  } while (cursor);
}

/* 共有スナップショットは必要な項目だけに絞る（テーマ/原稿は残す、巨大化を防ぐ） */
// マニュアル/指示書（この案件・チャンネル・全体）。share.html の paneManual が読む。
// slim/slimCI が落とすと共有ページで指示書が全部消える（review.versions と同型のバグ）。
function slimManuals(arr) {
  return Array.isArray(arr) ? arr.slice(0, 100).map((m) => ({
    id: m.id, cat: (m.cat || "").slice(0, 40), title: (m.title || "").slice(0, 200), body: (m.body || "").slice(0, 5000),
  })) : [];
}

function slim(p) {
  return {
    name: p.name || "構成台本",
    channel: p.channel || "",
    // 制作OS進捗シグナル（Flip Board連携・2026-06-22）: 案件phase自動反映用。表示は不変、読むだけ。
    status: p.status || "",
    reviewCount: (p.review && Array.isArray(p.review.versions)) ? p.review.versions.length : 0,
    format: p.format === "talk" ? "talk" : "documentary",
    talk: p.talk ? {
      highlight: p.talk.highlight || "", intro: p.talk.intro || "", cta: p.talk.cta || "",
      toc: Array.isArray(p.talk.toc) ? p.talk.toc : [],
      body: (p.talk.body || []).map((b) => ({ id: b.id, heading: b.heading || "", script: b.script || "" })),
    } : null,
    meta: p.meta || {},
    // 事前ヒアリングシート（演者の人物理解→構成のネタ元）。share.html とAI用リンク(/api/snap)で読む。
    hearing: Array.isArray(p.hearing) ? p.hearing.slice(0, 40).map((s) => ({
      id: s.id,
      title: (s.title || "").slice(0, 80),
      items: Array.isArray(s.items) ? s.items.slice(0, 40).map((it) => ({
        id: it.id,
        label: (it.label || "").slice(0, 80),
        value: (it.value || "").slice(0, 4000),
        hint: (it.hint || "").slice(0, 120),
      })) : [],
    })) : [],
    manuals: slimManuals(p.manuals),
    manualsGlobal: slimManuals(p.manualsGlobal),
    theme: p.theme || { main: "#1F2430", accent: "#E63946" },
    rate: p.rate || 5,
    timeFormat: p.timeFormat || "tc",
    rows: (p.rows || []).map((r) =>
      r.kind === "location"
        ? { id: r.id, kind: "location", label: r.label || "", address: r.address || "", time: r.time || "", note: r.note || "", done: !!r.done, peak: !!r.peak, travelBy: (r.travelBy || "").slice(0, 40), travelCost: r.travelCost === 0 || r.travelCost ? Number(r.travelCost) : null, lat: typeof r.lat === "number" ? r.lat : null, lng: typeof r.lng === "number" ? r.lng : null, placeId: (r.placeId || "").slice(0, 200) }
        : { id: r.id, kind: "scene", label: r.label || "", type: r.type, sec: r.sec ?? null, tc: r.tc ?? null, script: r.script || "" }
    ),
    plans: (p.plans || []).map((pl) => ({
      id: pl.id, title: pl.title || "", thumbText: pl.thumbText || "", note: pl.note || "",
      refs: (pl.refs || []).map((rf) => ({ vid: rf.vid || "", title: rf.title || "", channel: rf.channel || "", views: rf.views || 0, subs: rf.subs || 0, uploadDate: rf.uploadDate || "", duration: rf.duration || "" })),
      video: pl.video ? {
        type: pl.video.type === "youtube" ? "youtube" : "mp4",
        url: (pl.video.url || "").slice(0, 500),
        key: (pl.video.key || "").slice(0, 120),
        title: (pl.video.title || "").slice(0, 200),
        name: (pl.video.name || "").slice(0, 255),
      } : null,
      files: Array.isArray(pl.files) ? pl.files.slice(0, 50).map((f) => ({
        key: (f.key || "").slice(0, 120),
        name: (f.name || "").slice(0, 255),
        size: +f.size || 0,
        mime: (f.mime || "").slice(0, 120),
        uploadedAt: f.uploadedAt || "",
        expiresAt: f.expiresAt || null,
      })) : [],
    })),
    channelInfo: slimCI(p.channelInfo),
    video: p.video ? {
      type: p.video.type === "youtube" ? "youtube" : "mp4",
      url: (p.video.url || "").slice(0, 500),
      key: (p.video.key || "").slice(0, 120),
      title: (p.video.title || "").slice(0, 200),
      name: (p.video.name || "").slice(0, 255),
    } : null,
    // 動画確認（試写・修正管理）の各版。share.html の videoOptions が読む。
    // ここが無いと共有ページは review 動画を出せず p.video へフォールバック＝別動画が出る原因になる。
    review: (p.review && Array.isArray(p.review.versions)) ? {
      versions: p.review.versions.slice(0, 50).map((v) => ({
        id: v.id,
        label: (v.label || "").slice(0, 40),
        name: (v.name || "").slice(0, 255),
        type: v.type === "youtube" ? "youtube" : v.type === "stream" ? "stream" : "mp4",
        key: (v.key || "").slice(0, 120),
        url: (v.url || "").slice(0, 500),
        uid: (v.uid || "").slice(0, 120),
        hls: (v.hls || "").slice(0, 500),
        ready: !!v.ready,
        createdAt: v.createdAt || "",
        // ゴミ箱状態も共有側へ通す：share.htmlが非表示にでき、マージガードが「削除済み」を判定できる
        trashedAt: v.trashedAt || null,
      })),
    } : { versions: [] },
    files: Array.isArray(p.files) ? p.files.slice(0, 200).map((f) => ({
      key: (f.key || "").slice(0, 120),
      name: (f.name || "").slice(0, 255),
      size: +f.size || 0,
      mime: (f.mime || "").slice(0, 120),
      uploadedAt: f.uploadedAt || "",
      expiresAt: f.expiresAt || null,
    })) : [],
    // 素材管理（assets単一正本）も共有スナップに載せる＝編集者URLのファイルタブで素材をDLできる。
    // これが無いと owner が素材管理に入れた撮影素材が共有ページに一切出ない（key有り＝R2実体のみ）。
    assets: Array.isArray(p.assets) ? p.assets.filter((a) => a && a.key && a.type !== "youtube").slice(0, 300).map((a) => ({
      key: (a.key || "").slice(0, 120),
      name: (a.name || "").slice(0, 255),
      size: +a.size || 0,
      mime: (a.mime || "").slice(0, 120),
      type: (a.type || "").slice(0, 40),
      planId: (a.planId || "").slice(0, 40),
      uploadedAt: a.uploadedAt || "",
      expiresAt: a.expiresAt || null,
    })) : [],
  };
}

function slimCI(ci) {
  if (!ci) return null;
  return {
    name: ci.name || "", url: ci.url || "", concept: ci.concept || "",
    target: ci.target || "", purpose: ci.purpose || "",
    competitors: (ci.competitors || []).map((c) => ({ name: c.name || "", url: c.url || "", subs: c.subs || 0, videos: c.videos || 0, note: c.note || "", thumb: c.thumb || "" })),
    manuals: slimManuals(ci.manuals),
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
  const body = JSON.stringify({
    model,
    max_tokens: 32000,
    system: PARSE_SYSTEM,
    tools: [BUILD_TOOL],
    tool_choice: { type: "tool", name: "build_project" },
    messages: [{ role: "user", content: "以下の素材を構成台本に整形して build_project で返してください。\n\n----- 素材ここから -----\n" + raw + "\n----- 素材ここまで -----" }],
  });
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body,
      });
      if (!res.ok) {
        const t = await res.text();
        // 429/5xx は一過性なのでリトライ、それ以外は即時失敗
        if ((res.status === 429 || res.status >= 500) && attempt === 0) { lastErr = new Error("Claude API " + res.status); continue; }
        throw new Error("Claude API " + res.status + ": " + t.slice(0, 300));
      }
      const data = await res.json();
      const block = (data.content || []).find((b) => b.type === "tool_use" && b.name === "build_project");
      if (!block || !block.input) { lastErr = new Error("tool_use が返りませんでした"); continue; }
      return block.input;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("整形に失敗しました");
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
      max_tokens: 32000,
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

/* ===== 納品完了：台本からYouTube投稿用の項目を生成（タイトル・サムネ文言・概要欄・ハッシュタグ） ===== */
const DELIVER_SYSTEM = `あなたは動画プロダクション「Bird Flip」のYouTube投稿・SNS運用担当です。渡された構成台本（原稿・ハイライト・企画メモ）から、投稿に使うタイトル・サムネ文言・概要欄・ハッシュタグを作ります。

# ルール
- 台本の中身（本人の発言・事実）だけを根拠にする。台本に無い情報は創作しない
- タイトルは30〜40字程度。結論を全部言い切らず、続きが気になる言い回しにする
- サムネ文言は8〜14字程度。太字1〜2行で画面に収まる短く強い言葉
- 概要欄は250〜400字程度の文章体。箇条書き（・）は使わない。冒頭1〜2文で動画の核心と人物を紹介し、そのあと背景・見どころ・本人の思いを流れのあるつながった文章で書く。段落は2〜3つ、改行で区切ってよい。ドキュメンタリーの読み物として視聴者に語りかけるトーンで
- 概要欄の文体は丁寧語（です・ます調）で統一する。「〜だ」「〜である」調は使わない（例:×「取り組んできた獣医師だ」→○「取り組んできた獣医師です」）。本人の発言の引用「」内は原文のままでよい
- ハッシュタグは5〜8個。#固有名詞・ジャンル・感情ワードを混ぜて半角スペース区切りの1行にする
- 既に企画・サムネタブにタイトル/サムネ文言の案があれば、それを踏まえつつ最終版として磨く（無視して作り直してもよい）
- 完成動画の文字起こし（実尺タイムコード付き）が渡された場合は、それを根拠にYouTubeチャプター用の目次(chapters)も作る。
  形式は1行1章「M:SS ラベル」（例 0:00 オープニング）。必ず 0:00 から始め、話題の切り替わりで6〜12章程度。
  タイムコードは文字起こしの実TCに正確に合わせ、その話題が実際に始まる位置に置く。
  章は「視聴者が飛びたくなる話題」単位で切る。移動・待機・雑談つなぎなど中身のない区間は章にせず、直後の話題に含める。
  ラベルは全章SEO必須：視聴者が検索しそうな具体語（病名・治療法・職業・出来事・固有名詞・数字）を必ず1つ以上入れた8〜18字。
  「移動」「帰宅」「診察」「お昼」のような一般語だけのラベルは1章たりとも禁止（例:×「診察」→○「FIP疑いの猫を診察」、×「手術」→○「余命宣告された猫の手術へ」）。「？」で濁すラベルも禁止、台本と文字起こしから中身を特定して書く。
  出力前に全章を見直し、一般語だけの章が残っていたら書き直す。
  文字起こしが無い場合は chapters を省略する
- report_deliver ツールで返す`;

const DELIVER_TOOL = {
  name: "report_deliver",
  description: "YouTube投稿用のタイトル・サムネ文言・概要欄・ハッシュタグ（＋文字起こしがあれば目次）を返す",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "投稿用タイトル（30〜40字程度）" },
      thumbText: { type: "string", description: "サムネ文言（8〜14字程度）" },
      description: { type: "string", description: "概要欄テキスト（文章体250〜400字、です・ます調、箇条書き禁止）" },
      hashtags: { type: "string", description: "#区切りのハッシュタグ（5〜8個、半角スペース区切り1行）" },
      chapters: { type: "string", description: "目次。1行1章「M:SS ラベル」。0:00始まり。ラベルは検索されそうな具体語入り8〜18字。文字起こしが無い時は省略" },
    },
    required: ["title", "thumbText", "description", "hashtags"],
  },
};

/* 文字起こしを目次生成用に圧縮：セグメントを約20秒粒度に束ね「M:SS 文」の行テキストへ（トークン節約） */
function transcriptForPrompt(transcript) {
  const fmt = (s) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
  const lines = [];
  let bucketStart = -1, buf = [];
  for (const seg of transcript) {
    if (bucketStart < 0) bucketStart = seg.start || 0;
    buf.push((seg.text || "").trim());
    if ((seg.end || seg.start || 0) - bucketStart >= 20) { lines.push(fmt(bucketStart) + " " + buf.join("")); bucketStart = -1; buf = []; }
  }
  if (buf.length) lines.push(fmt(Math.max(0, bucketStart)) + " " + buf.join(""));
  return lines.join("\n").slice(0, 60000);
}

async function deliverWithClaude(project, env, transcript = null) {
  const model = env.PARSE_MODEL || "claude-sonnet-4-6";
  const ctx = "----- 台本(JSON) -----\n" + JSON.stringify(slim(project)) +
    "\n----- ここまで -----\n" +
    (transcript && transcript.length ? "\n----- 完成動画の文字起こし（実尺TC付き・目次はこれを根拠に） -----\n" + transcriptForPrompt(transcript) + "\n----- ここまで -----\n" : "") +
    "\n上の台本" + (transcript && transcript.length ? "と文字起こし" : "") + "からYouTube投稿用の項目を作って report_deliver で返してください。";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model,
      max_tokens: 3000,
      system: DELIVER_SYSTEM,
      tools: [DELIVER_TOOL],
      tool_choice: { type: "tool", name: "report_deliver" },
      messages: [{ role: "user", content: ctx }],
    }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error("Claude API " + res.status + ": " + t.slice(0, 300)); }
  const data = await res.json();
  const block = (data.content || []).find((b) => b.type === "tool_use" && b.name === "report_deliver");
  if (!block || !block.input) throw new Error("tool_use が返りませんでした");
  return block.input;
}

/* ===== ヒアリング：文字起こしから各項目を埋める ===== */
const HEARING_SYSTEM = `あなたは動画プロダクション「Bird Flip」専属の取材ディレクター補助です。一日密着ドキュメンタリーの「事前ヒアリングシート」を、演者へのインタビュー文字起こし（雑多な会話・打ち合わせ・取材メモ等）から埋めます。

# やること
- 渡された各ヒアリング項目（id・label・hint）について、文字起こしから該当する情報を抜き出し、簡潔にまとめて value に入れる
- fill_hearing ツールで、items（id と value の配列）を返す

# まとめ方のルール
- 話し言葉は要点を整理した書き言葉にする。ただし本人のニュアンス・印象的な言い回しは活かす
- 1項目は1〜数行程度。長すぎる転記はしない。事実・固有名詞・数字はそのまま正確に拾う
- 文字起こしに該当情報が無い項目は、value を空文字 "" にする（絶対に創作・推測で埋めない）
- label と hint の意図に合う内容だけを入れる（例：「幼少期」には子ども時代の話だけ）
- 1つの発言が複数項目に関係するなら、それぞれに適切に振り分ける
- summary に「埋まった項目数／取材で追加で聞くべきこと」を1〜2行で書く`;

const HEARING_TOOL = {
  name: "fill_hearing",
  description: "文字起こしから各ヒアリング項目を埋めて返す。渡された項目の id をそのまま使い、該当情報が無い項目は value を空文字にする。",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        description: "埋めた項目の配列。渡された全項目分（該当無しは value 空）を返す",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "渡された項目の id をそのまま" },
            value: { type: "string", description: "文字起こしからまとめた内容。該当無しは空文字" },
          },
          required: ["id", "value"],
        },
      },
      summary: { type: "string", description: "埋まり具合・取材で追加で聞くべき点を1〜2行" },
    },
    required: ["items"],
  },
};

async function fillHearingWithClaude(hearing, raw, env) {
  const model = env.PARSE_MODEL || "claude-sonnet-4-6";
  // 構造を id/label/hint だけのコンパクト表現に（value は渡さない＝上書き判断はフロント）
  const struct = hearing.map((s) => ({
    section: s.title || "",
    items: (s.items || []).map((it) => ({ id: it.id, label: it.label || "", hint: it.hint || "" })),
  }));
  const ctx = "----- 埋めるヒアリング項目(JSON) -----\n" + JSON.stringify(struct) +
    "\n----- 文字起こし -----\n" + raw +
    "\n----- ここまで -----\n\n上の文字起こしから各項目を埋めて fill_hearing で返してください。";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      system: HEARING_SYSTEM,
      tools: [HEARING_TOOL],
      tool_choice: { type: "tool", name: "fill_hearing" },
      messages: [{ role: "user", content: ctx }],
    }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error("Claude API " + res.status + ": " + t.slice(0, 300)); }
  const data = await res.json();
  const block = (data.content || []).find((b) => b.type === "tool_use" && b.name === "fill_hearing");
  if (!block || !block.input) throw new Error("tool_use が返りませんでした");
  return block.input;
}

/* ===== AIチャット：会話しながら台本を作る・磨く（提案→承認フロー）===== */
const CHAT_SYSTEM = `あなたは動画プロダクション「Bird Flip」専属の構成ディレクター兼作家アシスタント「ピッピ」です。構成台本ツール「ものがたりっち！」の中で、ディレクター(AK)と会話しながら台本を一緒に書き・磨きます。一日密着ドキュメンタリー(format=documentary)とトーク系YouTube台本(format=talk)の両方を扱います。

# あなたの口調・態度
- 相手はプロのディレクター。要点を先に、短く、率直に。長い前置きや一般論は不要
- 提案にはBird Flip流の「なぜ」を一言添える（例：「ここは重い話だから尺を半分にして強くした」）
- 分からない・素材に無いことは勝手に創作せず、その旨を伝えて取材で埋める導線を残す

# Bird Flip流の型（常にこれで書く＝あなたの判断基準）
A. セクション5種(documentaryのscene type)と役割
  - インサート(5秒)=映像のみ。映像指示を3〜4カットの小さな物語に
  - VLOG(15〜30秒)=他愛ない会話で人柄を出す
  - 解説系(30秒〜1分)=今から/今やる業務の説明
  - 訴求(2〜3分)=最も伝えたい核（想い・原点・商品）。動画の山場
  - ブリッジ(5〜10秒)=次の場面への自然なつなぎ
B. 脳の順番で飽きさせない設計
  - 冒頭は軽い脳から：予測→自分ごと→共感
  - 共感パートは長くてOK。重い話(決断・葛藤・意味づけ)は短く強く
  - 2〜3分に1回、予想外の「驚き」(ギャップ・意外な過去・本音)を入れる
  - ラストは「達成」より「安心・余韻」で終わる
C. インタビュアースタンス（最重要）
  - 演者を事前に知らない前提で、視聴者と同じ目線で素朴に質問する。「知ってる感」は絶対NG
  - ❌「教室もやられてるんですね！」 ⭕「それ以外にも何かされてるんですか？」
  - 核心は作業中・移動中に語らせる（手を動かしながらの本音が刺さる）
D. 原稿(script)の書式
  - インタビュアーの質問は行頭「◼ 」。演者の回答は話し言葉のまま。改行は維持
  - 目安文字数 = 秒数 × 5字（±2割）
  - 素材に無い事実・数字・固有名詞は絶対に作らない。本人の生声が要る所は「★取材：（何を聞くか）」と書いて空ける
E. トーク系(format=talk)の構成: highlight(冒頭フック/結論先出し)→intro(冒頭)→toc(目次)→body[](本編=heading+script)→cta。冒頭で結論・メリットを出し、目次と本編を一致させ、CTAを必ず置く

# 動き方（提案→承認フロー）
- ユーザーの依頼が台本の作成・編集・校正反映など「中身を変える」ものなら、propose_changes ツールを呼んで変更後の台本を提案する。実際の反映はユーザーが承認してから行われる（あなたは反映しない、提案するだけ）
- 相談・質問・雑談・方針決めなど「まだ変えない」ものは、ツールを呼ばずテキストだけで会話で返す
- propose_changes を呼ぶ時も、必ずテキストでも一言「何をどう変えたか・なぜ」を会話で添える
- propose_changes は format に合わせて片方だけ埋める：documentaryなら rows を【全行】省略せず、talkなら talk を丸ごと。変更しない行・既存内容も含めて完全な状態で返す
- 既存の id は維持する（rows[].id / body[].id）。新規行は id を空でよい
- 大きく作り直す時も、ユーザーが触れていない部分は極力そのまま残す`;

const PROPOSE_TOOL = {
  name: "propose_changes",
  description: "台本の変更案を提案する（ユーザーが承認すると反映される）。format に合わせて documentary なら rows、talk なら talk を、変更しない部分も含めた完全な状態で返す。",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "今回の変更点を日本語で1〜3行（プレビューに表示される）" },
      format: { type: "string", enum: ["documentary", "talk"], description: "対象の台本形式" },
      name: { type: "string", description: "演者名｜案件名（変える時のみ）" },
      channel: { type: "string", description: "クライアント名（変える時のみ）" },
      meta: {
        type: "object",
        properties: {
          shootDate: { type: "string" }, place: { type: "string" },
          titles: { type: "array", items: { type: "string" } },
          thumbs: { type: "array", items: { type: "string" } },
          highlight: { type: "string" },
        },
      },
      rows: {
        type: "array", description: "documentary時：構成台本の全行（省略しない）",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "既存行はそのid、新規は空" },
            kind: { type: "string", enum: ["location", "scene"] },
            label: { type: "string" },
            time: { type: "string" },
            address: { type: "string" },
            note: { type: "string" },
            type: { type: "string", enum: ["インサート", "ブリッジ", "VLOG", "解説系", "訴求"] },
            sec: { type: "number" },
            script: { type: "string" },
          },
          required: ["kind"],
        },
      },
      talk: {
        type: "object", description: "talk時：トーク台本の全体",
        properties: {
          highlight: { type: "string" }, intro: { type: "string" }, cta: { type: "string" },
          toc: { type: "array", items: { type: "string" } },
          body: {
            type: "array",
            items: {
              type: "object",
              properties: { id: { type: "string" }, heading: { type: "string" }, script: { type: "string" } },
            },
          },
        },
      },
    },
    required: ["summary", "format"],
  },
};

async function chatWithClaude(project, history, message, env) {
  const model = env.PARSE_MODEL || "claude-sonnet-4-6";
  const fmt = project && project.format === "talk" ? "talk" : "documentary";
  // 直近の会話履歴のみ（role/contentを正規化、最大20件）
  const msgs = history
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
  // 最新ターン：現在の台本(JSON)＋依頼。台本は毎回最新を渡す
  const ctx = "現在の台本(format=" + fmt + "):\n```json\n" + JSON.stringify(slim(project)) + "\n```\n\n依頼：" + message;
  msgs.push({ role: "user", content: ctx });
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model,
      max_tokens: 32000,
      system: CHAT_SYSTEM,
      tools: [PROPOSE_TOOL],
      messages: msgs,
    }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error("Claude API " + res.status + ": " + t.slice(0, 300)); }
  const data = await res.json();
  const blocks = data.content || [];
  const reply = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  const tu = blocks.find((b) => b.type === "tool_use" && b.name === "propose_changes");
  let proposal = null;
  if (tu && tu.input) {
    const p = tu.input;
    const pf = p.format === "talk" ? "talk" : "documentary";
    // 形式に合った中身がある時だけ提案として返す（空提案を弾く）
    if (pf === "documentary" && Array.isArray(p.rows) && p.rows.length) {
      proposal = { format: "documentary", summary: (p.summary || "").toString(), rows: p.rows, name: p.name, channel: p.channel, meta: p.meta };
    } else if (pf === "talk" && p.talk && typeof p.talk === "object") {
      proposal = { format: "talk", summary: (p.summary || "").toString(), talk: p.talk, name: p.name, channel: p.channel, meta: p.meta };
    }
  }
  return { reply: reply || (proposal ? (proposal.summary || "変更案を用意しました。") : "（応答がありませんでした）"), proposal };
}

/* ===== 編集者向けヘルプAIチャット（使い方サポート＋意見収集→Discord/KV） ===== */
const HELP_SYSTEM = `あなたは動画制作ツール「ものがたりっち！」の編集者向けサポート担当です。相手はこのツールで構成台本を読んだり、完成動画をアップする編集者・ディレクター。丁寧で短く、すぐ動ける答えを返してください（敬語・1〜3文・必要なら箇条書き）。

# このツールでできること（編集者がよく使う所）
- 上部タブ：概要／企画・サムネ／ヒアリング／構成台本／香盤表／素材管理／動画確認。クリックで切替。
- 完成動画のアップ：「動画（動画確認）」タブを開き、ドラッグ＆ドロップ or ファイル選択でアップ（大容量OK）。上げると即この画面で再生・確認できる。
- 撮影素材・参考ファイル：「素材管理／ファイル」タブからアップ・ダウンロード。
- 修正コメント：動画確認タブで再生を止めて「＋ここにコメント」で、その時間に修正依頼を残せる。▶で頭出し。
- 編集は自動保存・即反映。ログインは不要。左サイドバーで同じクライアントの他案件に移動できる。

# 方針
- 使い方の質問には上記をもとに具体的に答える。分からない事は無理に断定しない。
- 相手が「ここが使いにくい」「こうしてほしい」「不具合っぽい」「困った」等の要望・意見・不具合を述べたら、必ず report_feedback ツールを呼んで運営に届ける（そのうえで「運営に伝えました」と一言添える）。ただの使い方質問だけなら呼ばない。`;
const HELP_TOOL = {
  name: "report_feedback",
  description: "編集者が機能要望・改善要望・不具合報告・使いにくさ・意見を述べたときに呼ぶ。単なる使い方の質問だけのときは呼ばない。",
  input_schema: {
    type: "object",
    properties: {
      category: { type: "string", enum: ["要望", "不具合", "使い方が不明", "その他"] },
      summary: { type: "string", description: "一言要約（運営が一覧で見る用）" },
      detail: { type: "string", description: "編集者の発言の要点・具体内容" },
    },
    required: ["category", "summary"],
  },
};
async function logFeedback(env, fb, meta) {
  const entry = {
    category: (fb.category || "その他").toString().slice(0, 12),
    summary: (fb.summary || "").toString().slice(0, 300),
    detail: (fb.detail || "").toString().slice(0, 1500),
    channel: meta.channel || "", caseName: meta.caseName || "", at: now(),
  };
  try { const arr = (await env.SNAPS.get("feedback:log", "json")) || []; arr.unshift(entry); await env.SNAPS.put("feedback:log", JSON.stringify(arr.slice(0, 500))); } catch (e) {}
  if (env.DISCORD_FEEDBACK_WEBHOOK) {
    try {
      const head = "🗣️ **編集者フィードバック**" + (entry.channel ? "（" + entry.channel + "）" : "");
      const body = "**[" + entry.category + "]** " + entry.summary + (entry.detail ? "\n" + entry.detail : "") + (entry.caseName ? "\n案件: " + entry.caseName : "");
      await fetch(env.DISCORD_FEEDBACK_WEBHOOK, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: (head + "\n" + body).slice(0, 1900) }) });
    } catch (e) {}
  }
}
async function helpWithClaude(history, message, env, meta) {
  const model = env.HELP_MODEL || "claude-haiku-4-5-20251001";
  const msgs = history
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-16)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  msgs.push({ role: "user", content: message.slice(0, 8000) });
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 1200, system: HELP_SYSTEM, tools: [HELP_TOOL], messages: msgs }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error("Claude API " + res.status + ": " + t.slice(0, 300)); }
  const data = await res.json();
  const blocks = data.content || [];
  const reply = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  const tu = blocks.find((b) => b.type === "tool_use" && b.name === "report_feedback");
  let logged = false;
  if (tu && tu.input) { await logFeedback(env, tu.input, meta); logged = true; }
  return { reply: reply || (logged ? "ご意見ありがとうございます。運営に伝えました。" : "うまく聞き取れませんでした。もう一度お願いします。"), logged };
}

/* ===== リアルタイム共同編集 Durable Object（1 liveId = 1 インスタンス） =====
   B0: 全文同期（{t:"full",project}）。送信者を除いてブロードキャスト＋storage永続化。
   無認証ゆえ editToken 照合・接続上限・docサイズで濫用を抑える。 */
export class LiveDoc extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sockets = new Set();
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get("Upgrade") !== "websocket") {
      // seed（Worker からの内部 HTTP）
      if (request.method === "POST" && url.pathname.endsWith("/seed")) {
        const b = await request.json();
        if (b.project) await this.ctx.storage.put("project", b.project);
        if (b.editToken) await this.ctx.storage.put("editToken", b.editToken);
        return new Response("ok");
      }
      // snapshot（編集トークン照合つき）：チャンネル編集共有の最新表示用
      if (request.method === "GET" && url.pathname.endsWith("/snapshot")) {
        const token = url.searchParams.get("k") || "";
        const editToken = await this.ctx.storage.get("editToken");
        if (!editToken || token !== editToken) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });
        const proj = await this.ctx.storage.get("project");
        return new Response(JSON.stringify({ project: proj || null }), { headers: { "Content-Type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    }
    // 編集トークン照合
    const token = url.searchParams.get("k") || "";
    const editToken = await this.ctx.storage.get("editToken");
    if (!editToken || token !== editToken) return new Response("forbidden", { status: 403 });
    if (this.sockets.size >= 30) return new Response("too many connections", { status: 429 });

    const pair = new WebSocketPair();
    const server = pair[1];
    server.accept();
    this.sockets.add(server);
    const proj = await this.ctx.storage.get("project");
    try { server.send(JSON.stringify({ t: "init", project: proj || null })); } catch (e) {}

    server.addEventListener("message", async (ev) => {
      let m;
      try { m = JSON.parse(typeof ev.data === "string" ? ev.data : ""); } catch (e) { return; }
      if (m && m.t === "full" && m.project) {
        let s;
        try { s = JSON.stringify(m.project); } catch (e) { return; }
        if (s.length > 4000000) return; // 4MB ガード
        await this.ctx.storage.put("project", m.project);
        const out = JSON.stringify({ t: "full", project: m.project });
        for (const peer of this.sockets) { if (peer !== server) { try { peer.send(out); } catch (e) {} } }
      }
    });
    const cleanup = () => { this.sockets.delete(server); };
    server.addEventListener("close", cleanup);
    server.addEventListener("error", cleanup);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
}
