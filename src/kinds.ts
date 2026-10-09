// 登録する「種類」と、種類ごとの入力欄の定義。画面・検索・書き出しで共通に使う。

import type { Entry } from './model.ts';

export type Kind = 'login' | 'email' | 'bank' | 'other';

/** 種類によって使い分ける Entry の欄 */
export type FieldKey = 'username' | 'password' | 'email' | 'displayName' | 'phone' | 'number' | 'pin' | 'server' | 'url' | 'note';

export interface FieldDef {
  key: FieldKey;
  label: string;
  hint?: string;
  placeholder?: string;
  /** 詳細画面で伏せ字にし、「表示」で見せる */
  secret?: boolean;
  /** 最初は「＋ ラベル」ボタンにして隠しておく任意の欄 */
  optional?: boolean;
  input?: 'text' | 'email' | 'tel' | 'url' | 'textarea';
  /** 数字のキーボードを出す */
  numeric?: boolean;
  /** パスワード生成器を使える */
  generate?: boolean;
  /** 等幅で表示する（ID や番号の読み間違い防止） */
  mono?: boolean;
}

export interface KindDef {
  id: Kind;
  label: string;
  titlePlaceholder: string;
  fields: FieldDef[];
}

const URL_FIELD: FieldDef = { key: 'url', label: 'URL', input: 'url', placeholder: 'https://', mono: true };
const NOTE_FIELD: FieldDef = { key: 'note', label: 'メモ', input: 'textarea' };
const PHONE_FIELD: FieldDef = { key: 'phone', label: '電話番号', input: 'tel', optional: true, mono: true };

export const KINDS: KindDef[] = [
  {
    id: 'login',
    label: 'ログイン',
    titlePlaceholder: '例：Amazon、X（仕事用）',
    fields: [
      { key: 'username', label: 'ログイン ID', hint: 'ログイン画面で入力するもの', placeholder: 'メールアドレス、ユーザー名、会員番号など', mono: true },
      { key: 'password', label: 'パスワード', secret: true, generate: true },
      { key: 'email', label: '登録メールアドレス', hint: 'ログイン ID と別のときだけ', input: 'email', optional: true, mono: true },
      { key: 'displayName', label: 'ユーザー名', hint: 'ログインに使わない表示名など', optional: true },
      PHONE_FIELD,
      URL_FIELD,
      NOTE_FIELD,
    ],
  },
  {
    id: 'email',
    label: 'メール',
    titlePlaceholder: '例：Gmail（メイン）',
    fields: [
      { key: 'username', label: 'メールアドレス', input: 'email', placeholder: 'me@example.com', mono: true },
      { key: 'password', label: 'パスワード', secret: true, generate: true },
      { key: 'server', label: 'サーバー情報', hint: '受信・送信サーバー名やポート番号など', input: 'textarea', optional: true },
      PHONE_FIELD,
      URL_FIELD,
      NOTE_FIELD,
    ],
  },
  {
    id: 'bank',
    label: '銀行・カード',
    titlePlaceholder: '例：楽天銀行、楽天カード',
    fields: [
      { key: 'number', label: '口座番号・カード番号', hint: '支店名・支店番号なども自由に', mono: true },
      { key: 'pin', label: '暗証番号', secret: true, numeric: true },
      { key: 'username', label: 'ネットバンキングのログイン ID', mono: true },
      { key: 'password', label: 'ネットバンキングのパスワード', secret: true, generate: true },
      PHONE_FIELD,
      URL_FIELD,
      NOTE_FIELD,
    ],
  },
  {
    id: 'other',
    label: 'その他',
    titlePlaceholder: '例：自宅の Wi-Fi、マイナンバーカード',
    fields: [
      { key: 'username', label: 'ID', hint: 'ID・番号・ネットワーク名など', mono: true },
      { key: 'password', label: 'パスワード', hint: 'パスワード・暗証番号など', secret: true, generate: true },
      PHONE_FIELD,
      URL_FIELD,
      NOTE_FIELD,
    ],
  },
];

/** 廃止した種類（Wi-Fi・メモ）は「その他」として読み込む */
const RETIRED_KINDS: Record<string, Kind> = { wifi: 'other', note: 'other' };

/** 保存データの種類の値を、今の種類に直す（不明なものは「ログイン」） */
export function toKind(v: unknown): Kind {
  if (isKind(v)) return v;
  return RETIRED_KINDS[v as string] ?? 'login';
}

export const KIND_IDS = KINDS.map((k) => k.id);

export function kindDef(kind: Kind): KindDef {
  return KINDS.find((k) => k.id === kind) ?? KINDS[0];
}

export function isKind(v: unknown): v is Kind {
  return KIND_IDS.includes(v as Kind);
}

/** 一覧でタイトルの下に出す 1 行（秘密の欄は出さない） */
export function subtitle(e: Entry): string {
  return kindDef(e.kind).fields.some((f) => f.key === 'username') ? e.username : '';
}

/** 種類を変えたとき、その種類で使わない欄を空にする（見えない値が残らないように） */
export function clearUnusedFields(e: Entry): Entry {
  const used = new Set(kindDef(e.kind).fields.map((f) => f.key));
  const out = { ...e };
  for (const key of ['username', 'password', 'email', 'displayName', 'phone', 'number', 'pin', 'server', 'url', 'note'] as const) {
    if (!used.has(key)) out[key] = '';
  }
  return out;
}
