// 「ログイン」で登録されている Twitter(X)・Instagram の項目を「SNS」に移す（1 回だけの移行処理）。
// ログインと SNS は使う欄が同じなので、中身はそのまま残る。

import type { Entry, Payload } from './model.ts';
import { normalizeForSearch } from './search.ts';

/** 名前に含まれていれば SNS とみなす語（normalizeForSearch 後の形：小文字・ひらがな） */
const NAME_WORDS = ['twitter', 'ついったー', 'ついった', 'instagram', 'いんすたぐらむ', 'いんすた'];
/** 名前が「X」だけ、または「X（趣味用）」「X 仕事」のように X で始まる（Xserver などは除く） */
const X_NAME = /^x(?:$|[\s(（・\-_:：/／]|旧)/;
const SNS_HOST = /(?:^|\/\/|\.)(?:twitter|x|instagram)\.com(?:[/:?#]|$)/i;

export function looksLikeSns(e: Entry): boolean {
  const name = normalizeForSearch(e.title);
  if (NAME_WORDS.some((w) => name.includes(w))) return true;
  if (X_NAME.test(e.title.normalize('NFKC').trim().toLowerCase())) return true;
  return SNS_HOST.test(e.url.trim());
}

export function migrateSns(p: Payload): { payload: Payload; moved: number } {
  if (p.snsMigrated) return { payload: p, moved: 0 };
  let moved = 0;
  const entries = p.entries.map((e) => {
    if (e.kind !== 'login' || !looksLikeSns(e)) return e;
    moved++;
    return { ...e, kind: 'sns' as const };
  });
  return { payload: { ...p, entries, snsMigrated: true }, moved };
}
