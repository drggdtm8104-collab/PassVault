// 登録済みのすべての項目に「更新が必要」（一覧の「確認」の印）を付ける（1 回だけの移行処理）。
// 取り込んだデータを 1 件ずつ見直すため。以後に追加する項目には付けない。

import type { Payload } from './model.ts';

export function flagAllForReview(p: Payload): { payload: Payload; flagged: number } {
  if (p.flagAllDone) return { payload: p, flagged: 0 };
  let flagged = 0;
  const entries = p.entries.map((e) => {
    if (e.needsUpdate) return e;
    flagged++;
    return { ...e, needsUpdate: true };
  });
  return { payload: { ...p, entries, flagAllDone: true }, flagged };
}
