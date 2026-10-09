// メモに書かれた電話番号を見つけて、電話番号の欄にコピーする（1 回だけの移行処理）。
// 口座番号・カード番号・暗証番号などを誤って拾わないよう、0 か + で始まり、
// 桁数が電話番号として妥当なものだけを対象にする。

import type { Payload } from './model.ts';

const D = '[0-9０-９]';
const SEP = '[\\s\\-‐－−ー―()（）]?';
// 前後に数字が続く場合は対象外（長い番号の一部を拾わない）
const CANDIDATE = new RegExp(`(?<!${D})(?:[+＋]${D}{1,3}${SEP})?[(（]?${D}{1,5}${SEP}${D}{1,4}${SEP}${D}{3,4}(?!${D})`, 'g');

function digits(s: string): string {
  return s.normalize('NFKC').replace(/[^0-9]/g, '');
}

function isPhoneNumber(s: string): boolean {
  const t = s.normalize('NFKC').trim();
  const n = digits(t);
  if (t.startsWith('+')) return n.length >= 10 && n.length <= 13;
  // 国内の番号は 0 始まりの 10〜11 桁（携帯・固定・0120・0570 など）
  return n.startsWith('0') && (n.length === 10 || n.length === 11);
}

/** 文章の中の電話番号を、書かれたままの形で取り出す */
export function extractPhones(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(CANDIDATE)) {
    // 片方だけの括弧は取り除き、「(03)1234-5678」のような対の括弧は書かれたまま残す
    let v = m[0].trim();
    const opens = (v.match(/[(（]/g) ?? []).length;
    const closes = (v.match(/[)）]/g) ?? []).length;
    if (opens > closes) v = v.replace(/^[(（]/, '');
    if (closes > opens) v = v.replace(/[)）]$/, '');
    if (isPhoneNumber(v) && !found.some((f) => digits(f) === digits(v))) found.push(v);
  }
  return found;
}

/**
 * 電話番号の欄が空の項目について、メモの電話番号をコピーする（メモはそのまま残す）。
 * 一度実行したら phoneMigrated を立て、以後は行わない（後で欄を空にしても戻さない）。
 */
export function migratePhones(p: Payload): { payload: Payload; copied: number } {
  if (p.phoneMigrated) return { payload: p, copied: 0 };
  let copied = 0;
  const entries = p.entries.map((e) => {
    if (e.phone || !e.note) return e;
    const phones = extractPhones(e.note);
    if (phones.length === 0) return e;
    copied++;
    return { ...e, phone: phones.join(' / ') };
  });
  return { payload: { ...p, entries, phoneMigrated: true }, copied };
}
