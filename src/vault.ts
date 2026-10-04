// 金庫ファイルの暗号化・復号。
//
//   マスターパスワード --Argon2id--> KEK（鍵を包む鍵）
//   ランダムな DEK（データ鍵）を KEK で AES-256-GCM 暗号化して保存
//   中身（JSON）は DEK で AES-256-GCM 暗号化して保存
//
// マスターパスワードと生の鍵はどこにも保存しない。保存ファイルとバックアップは同じ形式。

import { argon2id } from 'hash-wasm';
import { fromB64, fromUtf8, randomBytes, toB64, utf8, wipe } from './bytes.ts';

export const FORMAT = 'passvault';
export const VERSION = 1;

export interface KdfParams {
  alg: 'argon2id';
  /** メモリ量（KiB） */
  m: number;
  /** 反復回数 */
  t: number;
  /** 並列度 */
  p: number;
  /** base64 */
  salt: string;
}

export interface Sealed {
  iv: string;
  ct: string;
}

export interface VaultFile {
  format: typeof FORMAT;
  version: typeof VERSION;
  kdf: KdfParams;
  wrap: Sealed;
  data: Sealed;
}

/** 新規作成時の既定値。64MiB・3 回（iPhone で 1 秒以内を目安） */
export const DEFAULT_KDF = { m: 65536, t: 3, p: 1 } as const;

// 外部から読み込んだファイルで極端な値を指定され、端末が固まるのを防ぐ範囲
const KDF_LIMITS = { mMin: 19456, mMax: 262144, tMin: 1, tMax: 10, pMin: 1, pMax: 4 };

export class WrongPasswordError extends Error {
  constructor() {
    super('wrong password or corrupted file');
  }
}

export class InvalidFileError extends Error {}

export interface Unlocked<T> {
  /** 中身の暗号化に使う鍵（取り出し不可の CryptoKey） */
  dek: CryptoKey;
  payload: T;
}

async function deriveKek(password: string, kdf: KdfParams): Promise<CryptoKey> {
  const raw = (await argon2id({
    password: utf8(password.normalize('NFC')),
    salt: fromB64(kdf.salt),
    iterations: kdf.t,
    parallelism: kdf.p,
    memorySize: kdf.m,
    hashLength: 32,
    outputType: 'binary',
  })) as Uint8Array<ArrayBuffer>;
  try {
    return await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  } finally {
    wipe(raw);
  }
}

function importDek(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

// KDF パラメータを AAD（認証付きの追加データ）に含め、書き換えを検知する
function wrapAad(kdf: KdfParams): Uint8Array<ArrayBuffer> {
  return utf8(`${FORMAT}/wrap/v${VERSION}|${kdf.alg}|${kdf.m}|${kdf.t}|${kdf.p}|${kdf.salt}`);
}

const DATA_AAD = utf8(`${FORMAT}/data/v${VERSION}`);

async function seal(key: CryptoKey, plain: Uint8Array<ArrayBuffer>, aad: Uint8Array<ArrayBuffer>): Promise<Sealed> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, plain);
  return { iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

async function open(key: CryptoKey, s: Sealed, aad: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(s.iv), additionalData: aad },
      key,
      fromB64(s.ct),
    );
    return new Uint8Array(pt);
  } catch {
    throw new WrongPasswordError();
  }
}

function newKdf(): KdfParams {
  return { alg: 'argon2id', ...DEFAULT_KDF, salt: toB64(randomBytes(16)) };
}

async function wrapDek(password: string, rawDek: Uint8Array<ArrayBuffer>): Promise<{ kdf: KdfParams; wrap: Sealed }> {
  const kdf = newKdf();
  const kek = await deriveKek(password, kdf);
  return { kdf, wrap: await seal(kek, rawDek, wrapAad(kdf)) };
}

/** パスワードから DEK の生バイトを取り出す。呼び出し側で必ず wipe すること */
async function unwrapDek(file: VaultFile, password: string): Promise<Uint8Array<ArrayBuffer>> {
  const kek = await deriveKek(password, file.kdf);
  const raw = await open(kek, file.wrap, wrapAad(file.kdf));
  if (raw.length !== 32) throw new InvalidFileError('bad key length');
  return raw;
}

export async function createVault<T>(password: string, payload: T): Promise<{ file: VaultFile; dek: CryptoKey }> {
  const rawDek = randomBytes(32);
  try {
    const { kdf, wrap } = await wrapDek(password, rawDek);
    const dek = await importDek(rawDek);
    const data = await seal(dek, utf8(JSON.stringify(payload)), DATA_AAD);
    return { file: { format: FORMAT, version: VERSION, kdf, wrap, data }, dek };
  } finally {
    wipe(rawDek);
  }
}

export async function unlockVault<T>(file: VaultFile, password: string): Promise<Unlocked<T>> {
  const rawDek = await unwrapDek(file, password);
  try {
    const dek = await importDek(rawDek);
    const payload = JSON.parse(fromUtf8(await open(dek, file.data, DATA_AAD))) as T;
    return { dek, payload };
  } finally {
    wipe(rawDek);
  }
}

/** 中身を新しい IV で暗号化し直した金庫ファイルを返す（鍵まわりはそのまま） */
export async function resealVault<T>(file: VaultFile, dek: CryptoKey, payload: T): Promise<VaultFile> {
  const data = await seal(dek, utf8(JSON.stringify(payload)), DATA_AAD);
  return { ...file, data };
}

/** パスワードが正しいかだけを確かめる（平文書き出しなどの再認証用） */
export async function verifyPassword(file: VaultFile, password: string): Promise<boolean> {
  try {
    wipe(await unwrapDek(file, password));
    return true;
  } catch (e) {
    if (e instanceof WrongPasswordError) return false;
    throw e;
  }
}

/** マスターパスワードを変更する。DEK は同じなので中身の再暗号化は不要 */
export async function changePassword(file: VaultFile, oldPassword: string, newPassword: string): Promise<VaultFile> {
  const rawDek = await unwrapDek(file, oldPassword);
  try {
    const { kdf, wrap } = await wrapDek(newPassword, rawDek);
    return { ...file, kdf, wrap };
  } finally {
    wipe(rawDek);
  }
}

function isSealed(x: unknown): x is Sealed {
  const s = x as Sealed;
  return !!s && typeof s.iv === 'string' && typeof s.ct === 'string';
}

function inRange(n: unknown, min: number, max: number): boolean {
  return Number.isInteger(n) && (n as number) >= min && (n as number) <= max;
}

/** 外部から読み込んだ JSON が金庫ファイルとして妥当か検査する（中身の復号はしない） */
export function parseVaultFile(text: string): VaultFile {
  let x: VaultFile;
  try {
    x = JSON.parse(text);
  } catch {
    throw new InvalidFileError('JSON として読めません');
  }
  if (!x || x.format !== FORMAT) throw new InvalidFileError('PassVault のファイルではありません');
  if (x.version !== VERSION) throw new InvalidFileError(`未対応のバージョンです (${String(x.version)})`);
  const k = x.kdf;
  const L = KDF_LIMITS;
  if (
    !k ||
    k.alg !== 'argon2id' ||
    !inRange(k.m, L.mMin, L.mMax) ||
    !inRange(k.t, L.tMin, L.tMax) ||
    !inRange(k.p, L.pMin, L.pMax) ||
    typeof k.salt !== 'string' ||
    fromB64(k.salt).length < 16
  ) {
    throw new InvalidFileError('鍵の設定が不正です');
  }
  if (!isSealed(x.wrap) || !isSealed(x.data)) throw new InvalidFileError('ファイルが壊れています');
  return {
    format: FORMAT,
    version: VERSION,
    kdf: { alg: 'argon2id', m: k.m, t: k.t, p: k.p, salt: k.salt },
    wrap: { iv: x.wrap.iv, ct: x.wrap.ct },
    data: { iv: x.data.iv, ct: x.data.ct },
  };
}
