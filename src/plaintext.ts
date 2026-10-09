// 平文での書き出し（非常用）。誰でも読めるファイルになるので、呼び出し側で再認証と警告を必ず行う。

import { kindDef } from './kinds.ts';
import type { Entry } from './model.ts';

function formatDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 印刷・保管向けのテキスト */
export function toText(entries: Entry[], now = Date.now()): string {
  const lines = [
    'PassVault 書き出し（平文）',
    `作成日時: ${formatDate(now)}`,
    `件数: ${entries.length}`,
    '※ このファイルは誰でも読めます。用が済んだら削除してください。',
    '',
  ];
  for (const e of entries) {
    const def = kindDef(e.kind);
    lines.push('----------------------------------------');
    lines.push(`名前: ${e.title}`);
    lines.push(`種類: ${def.label}`);
    if (e.needsUpdate) lines.push('状態: 更新が必要');
    for (const f of def.fields) {
      const v = e[f.key];
      // 空の任意項目は出さない。必須の欄は空でも見出しを出す（書き漏れに気づけるように）
      if (!v && (f.optional || f.input === 'textarea' || f.key === 'url')) continue;
      if (v.includes('\n')) {
        lines.push(`${f.label}:`);
        for (const l of v.split(/\r?\n/)) lines.push(`  ${l}`);
      } else {
        lines.push(`${f.label}: ${v}`);
      }
    }
  }
  lines.push('----------------------------------------');
  return lines.join('\n') + '\n';
}

function csvField(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * 乗り換え向けの CSV。列は iPhone の「パスワード」アプリの取り込み形式に合わせる。
 * 専用の列が無い欄（登録メール・暗証番号など）は Notes 列に「見出し: 値」で追記する。
 * パスワードを書き換えないよう、表計算ソフト向けの「=」等の無害化はしない。
 */
export function toCsv(entries: Entry[]): string {
  const rows = [['Title', 'URL', 'Username', 'Password', 'Notes', 'OTPAuth']];
  for (const e of entries) {
    const def = kindDef(e.kind);
    const extra = def.fields
      .filter((f) => !['username', 'password', 'url', 'note'].includes(f.key) && e[f.key])
      .map((f) => `${f.label}: ${e[f.key]}`);
    const notes = [e.note, e.kind !== 'login' && `種類: ${def.label}`, e.needsUpdate && '状態: 更新が必要', ...extra]
      .filter(Boolean)
      .join('\n');
    rows.push([e.title, e.url, e.username, e.password, notes, '']);
  }
  return rows.map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}
