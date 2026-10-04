// 一覧の検索。表記ゆれ（ひらがな/カタカナ、全角/半角、大文字/小文字、空白・記号）を吸収し、
// 空白区切りの複数語はすべて含むものだけを残す。

import type { Entry } from './model.ts';

const IGNORED = /[\s\-_.,・･'"`’”（）()「」『』【】［］[\]{}<>＜＞/／\\|:：;；!！?？]/g;

/** 比較用に文字列を正規化する */
export function normalizeForSearch(s: string): string {
  return s
    .normalize('NFKC') // 全角英数→半角、半角カナ→全角カナ
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)) // カタカナ→ひらがな
    .replace(IGNORED, '');
}

function haystack(e: Entry): string {
  // 欄の境目をまたいで一致しないよう、正規化で消えない区切りを入れる
  // パスワードと暗証番号は対象にしない（一部を打つと候補が出て推測の手がかりになるため）
  return [e.title, e.username, e.email, e.displayName, e.number, e.server, e.url, e.note].map(normalizeForSearch).join('\u0000');
}

/** 検索語を語ごとに分けて正規化する（空になった語は捨てる） */
export function parseQuery(query: string): string[] {
  return query
    .normalize('NFKC')
    .split(/\s+/)
    .map(normalizeForSearch)
    .filter((t) => t.length > 0);
}

export function matchesQuery(e: Entry, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const text = haystack(e);
  return terms.every((t) => text.includes(t));
}
