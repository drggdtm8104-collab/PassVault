// マスターパスワードの強さの目安。厳密な推定ではなく、明らかに弱いものを止めるためのもの。

export const MIN_MASTER_LENGTH = 12;

export interface Strength {
  /** 0〜4 */
  score: number;
  label: string;
  hint: string;
}

const COMMON = ['password', 'passw0rd', 'qwerty', 'letmein', 'iloveyou', 'admin', 'welcome', 'abc123', '123456'];

export function estimateBits(pw: string): number {
  const chars = [...pw];
  if (chars.length === 0) return 0;
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[^A-Za-z0-9぀-ヿ一-鿿\s]/.test(pw)) pool += 30;
  if (/[぀-ヿ]/.test(pw)) pool += 80;
  if (/[一-鿿]/.test(pw)) pool += 1000;
  if (/\s/.test(pw)) pool += 1;
  // 同じ文字の繰り返しは数えない
  const unique = new Set(chars).size;
  const effLen = Math.min(chars.length, unique * 2);
  let bits = effLen * Math.log2(Math.max(pool, 2));
  const lower = pw.toLowerCase();
  if (COMMON.some((w) => lower.includes(w))) bits -= 20;
  if (/(.)\1{3,}/.test(pw) || /(0123|1234|2345|3456|4567|5678|6789|abcd|qwer)/i.test(pw)) bits -= 15;
  return Math.max(0, Math.round(bits));
}

export function assessMaster(pw: string): Strength {
  const len = [...pw].length;
  if (len < MIN_MASTER_LENGTH) {
    return { score: 0, label: '短すぎます', hint: `${MIN_MASTER_LENGTH} 文字以上にしてください` };
  }
  const bits = estimateBits(pw);
  if (bits < 50) return { score: 1, label: '弱い', hint: '単語を増やすか、記号や数字を混ぜてください' };
  if (bits < 65) return { score: 2, label: 'ふつう', hint: 'もう 1〜2 単語足すと安心です' };
  if (bits < 80) return { score: 3, label: '強い', hint: '' };
  return { score: 4, label: 'とても強い', hint: '' };
}

/** 作成を許可する最低ライン */
export function isAcceptableMaster(pw: string): boolean {
  return assessMaster(pw).score >= 2;
}
