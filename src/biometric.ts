// Face ID（パスキーの PRF 拡張）での解除。
//
//   パスキー（iCloud キーチェーン）+ Face ID --PRF--> 32 バイトの秘密
//     --HKDF-SHA256--> 包む鍵 --AES-256-GCM--> DEK を包んで、この端末にだけ保存
//
// PRF の秘密は Face ID（ユーザー確認）が通らないと得られない。包んだ DEK はバックアップに含めない。
// サーバーが無いので署名の検証はしない（安全性は PRF の秘密を知らないと DEK を取り出せないことで担保する）。

import { fromB64, randomBytes, toB64, utf8, wipe } from './bytes.ts';
import { open, seal, WrongPasswordError, type Sealed } from './vault.ts';

export interface BioRecord {
  version: 1;
  /** パスキーの credential ID（base64） */
  credId: string;
  /** PRF に渡す salt（base64） */
  prfSalt: string;
  /** PRF から作った鍵で包んだ DEK */
  wrap: Sealed;
  createdAt: number;
}

export class BioUnavailableError extends Error {}
export class BioCancelledError extends Error {}

const INFO = utf8('passvault/bio/v1');

function aad(credId: string): Uint8Array<ArrayBuffer> {
  return utf8(`passvault/bio/v1|${credId}`);
}

async function keyFromPrf(prf: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', prf, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: INFO },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** PRF の出力で DEK を包む（WebAuthn から切り離した部分。テスト可能） */
export async function wrapWithPrf(
  prf: Uint8Array<ArrayBuffer>,
  rawDek: Uint8Array<ArrayBuffer>,
  credId: string,
  prfSalt: string,
): Promise<BioRecord> {
  const key = await keyFromPrf(prf);
  return { version: 1, credId, prfSalt, wrap: await seal(key, rawDek, aad(credId)), createdAt: Date.now() };
}

/** PRF の出力で DEK を取り出す。呼び出し側で必ず wipe すること */
export async function unwrapWithPrf(prf: Uint8Array<ArrayBuffer>, rec: BioRecord): Promise<Uint8Array<ArrayBuffer>> {
  const key = await keyFromPrf(prf);
  const raw = await open(key, rec.wrap, aad(rec.credId));
  if (raw.length !== 32) throw new WrongPasswordError();
  return raw;
}

// ---------------------------------------------------------------- WebAuthn

interface PrfResults {
  enabled?: boolean;
  results?: { first?: BufferSource };
}

type PrfExtensionOutputs = AuthenticationExtensionsClientOutputs & { prf?: PrfResults };

/** 同じ user.id で作り直すと、iCloud キーチェーン上の古いパスキーが置き換わる */
const USER_ID = utf8('passvault-local-user');

function rpId(): string {
  return location.hostname;
}

function toBytes(b: BufferSource): Uint8Array<ArrayBuffer> {
  const src = b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  return new Uint8Array(src); // コピーして元のバッファと切り離す
}

function prfOutput(cred: PublicKeyCredential): Uint8Array<ArrayBuffer> | null {
  const first = (cred.getClientExtensionResults() as PrfExtensionOutputs).prf?.results?.first;
  return first ? toBytes(first) : null;
}

function mapError(e: unknown): never {
  const name = (e as Error)?.name;
  if (name === 'NotAllowedError' || name === 'AbortError') throw new BioCancelledError('キャンセルされました');
  throw e;
}

/** この端末で Face ID / Touch ID / Windows Hello が使えそうか */
export async function bioAvailable(): Promise<boolean> {
  try {
    if (typeof PublicKeyCredential === 'undefined') return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

async function evaluatePrf(credId: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  let cred: PublicKeyCredential;
  try {
    cred = (await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        rpId: rpId(),
        allowCredentials: [{ type: 'public-key', id: credId }],
        userVerification: 'required',
        timeout: 60_000,
        extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential;
  } catch (e) {
    mapError(e);
  }
  const out = prfOutput(cred);
  if (!out) throw new BioUnavailableError('この端末・ブラウザは Face ID 解除（PRF）に対応していません');
  return out;
}

/**
 * パスキーを作成し、DEK を包んだ記録を返す。
 * 作成時に PRF の値が返らない環境では、続けてもう一度 Face ID を求める。
 */
export async function enrollBio(rawDek: Uint8Array<ArrayBuffer>): Promise<BioRecord> {
  const salt = randomBytes(32);
  let cred: PublicKeyCredential;
  try {
    cred = (await navigator.credentials.create({
      publicKey: {
        rp: { name: 'PassVault', id: rpId() },
        user: { id: USER_ID, name: 'PassVault', displayName: 'PassVault' },
        challenge: randomBytes(32),
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' },
        attestation: 'none',
        timeout: 60_000,
        extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential;
  } catch (e) {
    mapError(e);
  }
  const ext = cred.getClientExtensionResults() as PrfExtensionOutputs;
  if (ext.prf?.enabled === false) throw new BioUnavailableError('この端末・ブラウザは Face ID 解除（PRF）に対応していません');
  const credId = new Uint8Array(cred.rawId);
  const prf = prfOutput(cred) ?? (await evaluatePrf(credId, salt));
  try {
    return await wrapWithPrf(prf, rawDek, toB64(credId), toB64(salt));
  } finally {
    wipe(prf);
  }
}

/** Face ID で DEK を取り出す。呼び出し側で必ず wipe すること */
export async function unlockBio(rec: BioRecord): Promise<Uint8Array<ArrayBuffer>> {
  const prf = await evaluatePrf(fromB64(rec.credId), fromB64(rec.prfSalt));
  try {
    return await unwrapWithPrf(prf, rec);
  } finally {
    wipe(prf);
  }
}
