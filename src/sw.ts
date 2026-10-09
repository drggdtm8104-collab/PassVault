/// <reference lib="webworker" />
// アプリ本体のファイルを端末に保存し、オフラインでも開けるようにする。
// 外部への通信は行わない。同じサイトのファイル以外は扱わない。

/** バージョン番号＋中身のハッシュ。ファイルが変われば必ず変わる */
declare const __BUILD_ID__: string;
declare const __PRECACHE__: string[];

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `passvault-${__BUILD_ID__}`;

sw.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(__PRECACHE__.map((p) => new Request(p, { cache: 'reload' }))))
      .then(() => sw.skipWaiting()),
  );
});

sw.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('passvault-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== sw.location.origin) return;
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (req.mode === 'navigate') {
        return (await cache.match('./index.html')) ?? fetch(req);
      }
      return (await cache.match(req, { ignoreSearch: true })) ?? fetch(req);
    })(),
  );
});

export {};
