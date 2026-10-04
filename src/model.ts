// 金庫の中身（暗号化される JSON）の型と、読み込み時の正規化。

export interface Entry {
  id: string;
  title: string;
  username: string;
  password: string;
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
}

export interface Payload {
  entries: Entry[];
  settings: Settings;
  /** 最後に中身を変更した時刻 */
  modifiedAt: number;
  /** 最後に暗号化バックアップを書き出した時刻 */
  lastBackupAt: number | null;
}

export const AUTO_LOCK_CHOICES = [1, 3, 5, 10];

export function emptyPayload(): Payload {
  return {
    entries: [],
    settings: { autoLockMinutes: 3, clipboardClearSeconds: 30 },
    modifiedAt: Date.now(),
    lastBackupAt: null,
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
      title: str(e?.title),
      username: str(e?.username),
      password: str(e?.password),
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
    },
    modifiedAt: num(p.modifiedAt, base.modifiedAt),
    lastBackupAt: typeof p.lastBackupAt === 'number' ? p.lastBackupAt : null,
  };
}
