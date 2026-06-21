// ものがたりっち Service Worker — オフライン動作 & デスクトップアプリ化用
const CACHE = "monogatari-v26";
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./settings.html",
  "./cases.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
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
  // no-cache: ブラウザHTTPキャッシュを毎回サーバ検証（古いapp.jsを掴む問題の対策）
  e.respondWith(
    fetch(e.request, { cache: "no-cache" })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((m) => m || caches.match("./index.html")))
  );
});
