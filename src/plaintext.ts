// 平文での書き出し（非常用）。誰でも読めるファイルになるので、呼び出し側で再認証と警告を必ず行う。

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
    lines.push('----------------------------------------');
    lines.push(`サイト名: ${e.title}`);
    if (e.url) lines.push(`URL: ${e.url}`);
    lines.push(`ログインID: ${e.username}`);
    if (e.email) lines.push(`登録メール: ${e.email}`);
    if (e.displayName) lines.push(`ユーザー名: ${e.displayName}`);
    lines.push(`パスワード: ${e.password}`);
    if (e.note) {
      lines.push('メモ:');
      for (const l of e.note.split(/\r?\n/)) lines.push(`  ${l}`);
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
 * パスワードを書き換えないよう、表計算ソフト向けの「=」等の無害化はしない。
 */
export function toCsv(entries: Entry[]): string {
  const rows = [['Title', 'URL', 'Username', 'Password', 'Notes', 'OTPAuth']];
  for (const e of entries) {
    // 取り込み先に専用の列が無いので、登録メールとユーザー名はメモに追記する
    const notes = [e.note, e.email && `登録メール: ${e.email}`, e.displayName && `ユーザー名: ${e.displayName}`]
      .filter(Boolean)
      .join('\n');
    rows.push([e.title, e.url, e.username, e.password, notes, '']);
  }
  return rows.map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}
