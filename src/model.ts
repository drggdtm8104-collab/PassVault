// 金庫の中身（暗号化される JSON）の型と、読み込み時の正規化。

import { toKind, type Kind } from './kinds.ts';

export interface Entry {
  id: string;
  /** 種類（ログイン・SNS・メール・銀行カード）。種類によって使う欄が変わる（kinds.ts） */
  kind: Kind;
  title: string;
  /** お気に入り */
  favorite: boolean;
  /** ログイン ID（ログイン画面で入力するもの。メールアドレス・ユーザー名・会員番号など） */
  username: string;
  /** 登録メールアドレス（ログイン ID と別の場合だけ） */
  email: string;
  /** ユーザー名・表示名（ログインに使わない名前がある場合だけ） */
  displayName: string;
  password: string;
  /** 口座番号・カード番号 */
  number: string;
  /** 暗証番号 */
  pin: string;
  /** メールのサーバー情報 */
  server: string;
  /** 電話番号 */
  phone: string;
  url: string;
  note: string;
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  /** 無操作で自動ロックするまでの分数 */
  autoLockMinutes: number;
  /** コピー後にクリップボード消去を試みるまでの秒数 */
  clipboardClearSeconds: number;
  /** アプリを離れてから、解除なしで戻れる秒数（0 = すぐロック） */
  relockGraceSeconds: number;
}

export interface Payload {
  entries: Entry[];
  settings: Settings;
  /** 最後に中身を変更した時刻 */
  modifiedAt: number;
  /** 最後に暗号化バックアップを書き出した時刻 */
  lastBackupAt: number | null;
  /** メモの電話番号を電話番号の欄へコピーする処理を実行済みか（phone.ts） */
  phoneMigrated: boolean;
  /** ログインの Twitter・Instagram を SNS に移す処理を実行済みか（migrate-sns.ts） */
  snsMigrated: boolean;
}

export const AUTO_LOCK_CHOICES = [1, 3, 5, 10];
export const RELOCK_GRACE_CHOICES = [0, 60, 300];

export function emptyPayload(): Payload {
  return {
    entries: [],
    settings: { autoLockMinutes: 3, clipboardClearSeconds: 30, relockGraceSeconds: 0 },
    modifiedAt: Date.now(),
    lastBackupAt: null,
    phoneMigrated: true,
    snsMigrated: true,
  };
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** 復号した JSON を、欠けた項目を補いつつ Payload に整える */
export function normalizePayload(x: unknown): Payload {
  const p = (x ?? {}) as Partial<Payload>;
  const base = emptyPayload();
  const entries = Array.isArray(p.entries) ? p.entries : [];
  const s = (p.settings ?? {}) as Partial<Settings>;
  return {
    entries: entries.map((e) => ({
      id: str(e?.id) || crypto.randomUUID(),
      // 種類が無いのは種類導入前のデータ、その他・Wi-Fi・メモは廃止した種類なので「ログイン」として扱う
      kind: toKind(e?.kind),
      title: str(e?.title),
      favorite: e?.favorite === true,
      username: str(e?.username),
      email: str(e?.email),
      displayName: str(e?.displayName),
      password: str(e?.password),
      number: str(e?.number),
      pin: str(e?.pin),
      server: str(e?.server),
      phone: str(e?.phone),
      url: str(e?.url),
      note: str(e?.note),
      createdAt: num(e?.createdAt, Date.now()),
      updatedAt: num(e?.updatedAt, Date.now()),
    })),
    settings: {
      autoLockMinutes: AUTO_LOCK_CHOICES.includes(s.autoLockMinutes as number)
        ? (s.autoLockMinutes as number)
        : base.settings.autoLockMinutes,
      clipboardClearSeconds: num(s.clipboardClearSeconds, base.settings.clipboardClearSeconds),
      relockGraceSeconds: RELOCK_GRACE_CHOICES.includes(s.relockGraceSeconds as number)
        ? (s.relockGraceSeconds as number)
        : base.settings.relockGraceSeconds,
    },
    modifiedAt: num(p.modifiedAt, base.modifiedAt),
    lastBackupAt: typeof p.lastBackupAt === 'number' ? p.lastBackupAt : null,
    phoneMigrated: p.phoneMigrated === true,
    snsMigrated: p.snsMigrated === true,
  };
}
