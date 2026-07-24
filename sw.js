// ものがたりっち Service Worker — オフライン動作 & デスクトップアプリ化用
const CACHE = "monogatari-v127";
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./tailwind.css",
  "./settings.html",
  "./cases.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // cache:"reload" — ブラウザHTTPキャッシュを経由せず、必ずサーバから最新を取ってプリキャッシュする
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 同一オリジンの GET は network-first（更新を取りこぼさない）、失敗時キャッシュ。
// 外部API（Gemini等）はそのまま素通し。
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: "no-cache" })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(async () => {
        // ignoreSearch:true — app.js?v=xxxx のようなバージョン付きURLでも
        // プリキャッシュ済みの app.js にヒットさせる（旧実装はここでミスして
        // オフライン時に index.html を app.js として返し、アプリが起動不能になっていた）
        const m = await caches.match(e.request, { ignoreSearch: true });
        if (m) return m;
        // index.html へのフォールバックは「ページ遷移」のときだけ。
        // JS/CSS/画像の失敗にHTMLを返すと壊れるため。
        if (e.request.mode === "navigate") {
          const page = await caches.match("./index.html");
          if (page) return page;
        }
        return Response.error();
      })
  );
});
