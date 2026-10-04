import { boot } from './app.ts';

boot(document.getElementById('app')!);

// オフラインで動かすための Service Worker（データには触れず、アプリのファイルを保存するだけ）
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((e) => console.warn('SW 登録失敗', e));
}
