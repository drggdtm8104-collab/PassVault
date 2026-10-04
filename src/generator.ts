// パスワード生成。OS の安全な乱数を使い、剰余による偏りが出ないよう棄却サンプリングする。

export interface GenOptions {
  length: number;
  upper: boolean;
  lower: boolean;
  digits: boolean;
  symbols: boolean;
  /** 0/O、1/l/I など見間違えやすい文字を除く */
  excludeAmbiguous: boolean;
}

export const DEFAULT_GEN: GenOptions = {
  length: 20,
  upper: true,
  lower: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: true,
};

const SETS = {
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  digits: '0123456789',
  symbols: '!#$%&*+-=?@^_~',
};
const AMBIGUOUS = new Set('0O1lI|');

/** 0 以上 n 未満の一様な整数 */
export function randomInt(n: number): number {
  if (!Number.isInteger(n) || n <= 0 || n > 2 ** 32) throw new RangeError('n');
  const limit = Math.floor(2 ** 32 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

function groups(o: GenOptions): string[] {
  const keys = (['upper', 'lower', 'digits', 'symbols'] as const).filter((k) => o[k]);
  return keys
    .map((k) => [...SETS[k]].filter((c) => !(o.excludeAmbiguous && AMBIGUOUS.has(c))).join(''))
    .filter((g) => g.length > 0);
}

export function generatePassword(o: GenOptions): string {
  const gs = groups(o);
  if (gs.length === 0) throw new Error('文字の種類を 1 つ以上選んでください');
  const length = Math.max(Math.min(Math.floor(o.length), 128), gs.length);
  const all = gs.join('');
  // 選んだ種類をすべて含むまで全体を作り直す（一部だけ差し替えると偏るため）
  for (;;) {
    let s = '';
    for (let i = 0; i < length; i++) s += all[randomInt(all.length)];
    if (gs.every((g) => [...s].some((c) => g.includes(c)))) return s;
  }
}

/** 生成されるパスワードのおおよその強さ（ビット） */
export function generatedBits(o: GenOptions): number {
  const n = groups(o).join('').length;
  return n > 0 ? Math.floor(o.length * Math.log2(n)) : 0;
}
