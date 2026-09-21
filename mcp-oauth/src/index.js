/* ============================================================
   mg-mcp：claude.ai 用の OAuth 付き入口（ものがたりっち MCP）
   - claude.ai のカスタムコネクタは固定Bearerヘッダーを送れないので、MCP標準のOAuthをここで受ける。
   - OAuthサーバー機能は @cloudflare/workers-oauth-provider（トークン類は OAUTH_KV にハッシュで保存）。
   - 本人確認はアプリと同じ Google ログイン。ボタンは許可済みオリジンの
     monogataritch.pages.dev/mcp-login に置き、IDトークンを /callback で検証する（シークレット不要）。
   - 認可後の /mcp は、書き込みキーを付けて mg-share Worker の /mcp へそのまま渡すだけ。
     台本の読み書きロジックは mg-share 側（worker/src/mcp.js）の1か所にしか無い。
   ============================================================ */

import { OAuthProvider, AuthorizationError } from "@cloudflare/workers-oauth-provider";

// 認可コードの送り先として許すのは claude.ai のコールバックだけ。
// 誰でもクライアント登録はできるが、ここ以外へはコードを渡さない＝第三者は権限を受け取れない。
const REDIRECT_ALLOW = ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"];
const STATE_TTL_SEC = 600;

const enc = new TextEncoder();
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64uDecode = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

const hmacKey = (secret) => crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

async function signState(payload, secret) {
  const body = b64u(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body));
  return body + "." + b64u(sig);
}

async function readState(state, secret) {
  const [body, sig] = (state || "").split(".");
  if (!body || !sig) return null;
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), b64uDecode(sig), enc.encode(body));
  if (!ok) return null;
  const payload = JSON.parse(new TextDecoder().decode(b64uDecode(body)));
  return payload.exp > Date.now() / 1000 ? payload : null;
}

// Googleのログインボタンに渡す nonce。state から決まるので、別の認可要求向けのIDトークンは使い回せない。
const nonceOf = async (state) => hex(await crypto.subtle.digest("SHA-256", enc.encode(state))).slice(0, 32);

const page = (message, status = 400) =>
  new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>ものがたりっち MCP</title><body style="font-family:sans-serif;max-width:32em;margin:4em auto;padding:0 16px;line-height:1.8">' +
      "<h1 style=\"font-size:18px\">ものがたりっち MCP</h1><p>" + message + "</p>",
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  );

const defaultHandler = {
  async fetch(request, env) {
    const url = new URL(request.url);

    // GET /authorize：要求を検証し、署名付きの state を持たせてログイン画面へ送る
    if (request.method === "GET" && url.pathname === "/authorize") {
      let oauthRequest;
      try {
        oauthRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      } catch (error) {
        if (!(error instanceof AuthorizationError)) throw error;
        if (!error.redirectUri || !REDIRECT_ALLOW.includes(error.redirectUri)) return page("認可リクエストが正しくありません。");
        const back = new URL(error.redirectUri);
        back.searchParams.set("error", error.code);
        back.searchParams.set("error_description", error.description);
        if (error.state) back.searchParams.set("state", error.state);
        if (error.issuer) back.searchParams.set("iss", error.issuer);
        return Response.redirect(back.toString(), 302);
      }
      if (!REDIRECT_ALLOW.includes(oauthRequest.redirectUri)) return page("このMCPは claude.ai からの接続だけを受け付けます。", 403);
      const state = await signState({ r: oauthRequest, exp: Math.floor(Date.now() / 1000) + STATE_TTL_SEC }, env.STATE_SECRET);
      return Response.redirect(env.LOGIN_PAGE + "?s=" + encodeURIComponent(state), 302);
    }

    // POST /callback：ログイン画面から { credential(GoogleのIDトークン), state } がフォームで届く
    if (request.method === "POST" && url.pathname === "/callback") {
      const form = await request.formData();
      const state = (form.get("state") || "").toString();
      const credential = (form.get("credential") || "").toString();
      const payload = await readState(state, env.STATE_SECRET).catch(() => null);
      if (!payload) return page("有効期限が切れました。claude.ai から接続をやり直してください。");
      if (!REDIRECT_ALLOW.includes(payload.r.redirectUri)) return page("このMCPは claude.ai からの接続だけを受け付けます。", 403);

      // 検証は mg-share の /api/auth/google と同じ方式（tokeninfo＋aud必須）
      const ti = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(credential));
      if (!ti.ok) return page("Google の検証に失敗しました。", 401);
      const g = await ti.json();
      if (g.aud !== env.GOOGLE_CLIENT_ID) return page("client_id が一致しません。", 401);
      if (g.nonce !== (await nonceOf(state))) return page("ログインのやり直しが必要です。claude.ai から接続し直してください。", 401);
      const email = (g.email || "").toLowerCase();
      const allowed = (env.ALLOWED_EMAILS || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
      if (!g.sub || !email || String(g.email_verified) !== "true" || !allowed.includes(email))
        return page("このGoogleアカウントでは接続できません。", 403);

      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: payload.r,
        userId: g.sub,
        metadata: { email },
        scope: payload.r.scope,
        props: { email },
      });
      return Response.redirect(redirectTo, 303);
    }

    return page("claude.ai のコネクタ設定に、このサーバーの /mcp のURLを登録してください。", 404);
  },
};

// 認可済みの /mcp。ここに来た時点でOAuthトークンは検証済み（未認可はライブラリが401を返す）。
const apiHandler = {
  async fetch(request, env) {
    return env.MG_SHARE.fetch("https://mg-share/mcp", {
      method: request.method,
      headers: { "Content-Type": request.headers.get("Content-Type") || "application/json", Authorization: "Bearer " + env.MCP_WRITE_KEY },
      body: request.method === "POST" ? request.body : undefined,
    });
  },
};

export default new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler,
  defaultHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  clientIdMetadataDocumentEnabled: true,
  // トークン更新のたびにKVへ書く。KVの書き込みは 1,000回/日（アカウント共通）なので更新頻度を下げる。
  accessTokenTTL: 86400,
  clientRegistrationCallback: ({ clientMetadata }) => {
    const uris = Array.isArray(clientMetadata.redirect_uris) ? clientMetadata.redirect_uris : [];
    if (!uris.length || !uris.every((u) => REDIRECT_ALLOW.includes(u)))
      return { code: "invalid_redirect_uri", description: "redirect_uris must be the claude.ai MCP callback" };
  },
});
