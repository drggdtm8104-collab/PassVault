import { boot, onAppUpdated } from './app.ts';

boot(document.getElementById('app')!);

// オフラインで動かすための Service Worker（データには触れず、アプリのファイルを保存するだけ）
if ('serviceWorker' in navigator) {
  // 初めてのインストールでも controllerchange が起きるので、そのときは読み込み直さない。
  // 2 回目以降の切り替わり（＝新しい版）だけを更新として扱う
  let controlled = navigator.serviceWorker.controller !== null;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (controlled) onAppUpdated();
    controlled = true;
  });

  navigator.serviceWorker
    .register('./sw.js', { scope: './' })
    .then((reg) => {
      // iPhone ではホーム画面から戻っても再読み込みされないので、戻ってきたときにも更新を確認する
      let lastCheck = 0;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible' || Date.now() - lastCheck < 60_000) return;
        lastCheck = Date.now();
        reg.update().catch(() => {
          // オフラインなどで確認できなくても、今の版のまま使える
        });
      });
    })
    .catch((e) => console.warn('SW 登録失敗', e));
}
