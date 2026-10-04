// 端末内の保存（IndexedDB）。保存するのは暗号化済みの金庫ファイルだけ。

import type { BioRecord } from './biometric.ts';
import type { VaultFile } from './vault.ts';

const DB = 'passvault';
const STORE = 'kv';
const KEY = 'vault';
/** Face ID 用に包んだ DEK。この端末だけのもので、バックアップには含めない */
const BIO_KEY = 'bio';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadVault(): Promise<VaultFile | null> {
  return (await run<VaultFile | undefined>('readonly', (s) => s.get(KEY))) ?? null;
}

export async function saveVault(file: VaultFile): Promise<void> {
  await run('readwrite', (s) => s.put(file, KEY));
}

/** 金庫を削除する。DEK が変わる・無くなるので Face ID の記録も一緒に消す */
export async function deleteVault(): Promise<void> {
  await run('readwrite', (s) => s.delete(KEY));
  await deleteBio();
}

export async function loadBio(): Promise<BioRecord | null> {
  return (await run<BioRecord | undefined>('readonly', (s) => s.get(BIO_KEY))) ?? null;
}

export async function saveBio(rec: BioRecord): Promise<void> {
  await run('readwrite', (s) => s.put(rec, BIO_KEY));
}

export async function deleteBio(): Promise<void> {
  await run('readwrite', (s) => s.delete(BIO_KEY));
}

/** ブラウザに「この保存領域を勝手に消さないで」と依頼する */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

// 解除の連続失敗に待ち時間をかける（画面からの総当たり対策。ファイルを盗まれた場合は Argon2id が守る）
const THROTTLE_KEY = 'passvault.unlockFailures';
const FREE_ATTEMPTS = 5;

interface Throttle {
  fails: number;
  until: number;
}

function readThrottle(): Throttle {
  try {
    const t = JSON.parse(localStorage.getItem(THROTTLE_KEY) ?? '') as Throttle;
    if (Number.isFinite(t.fails) && Number.isFinite(t.until)) return t;
  } catch {
    // 読めなければ初期状態として扱う
  }
  return { fails: 0, until: 0 };
}

/** 次に試せるまでの残りミリ秒 */
export function throttleRemaining(now = Date.now()): number {
  return Math.max(0, readThrottle().until - now);
}

export function recordFailure(now = Date.now()): void {
  const t = readThrottle();
  t.fails += 1;
  if (t.fails >= FREE_ATTEMPTS) {
    // 30 秒から倍々に増やし、最大 15 分
    const wait = Math.min(30_000 * 2 ** (t.fails - FREE_ATTEMPTS), 15 * 60_000);
    t.until = now + wait;
  }
  try {
    localStorage.setItem(THROTTLE_KEY, JSON.stringify(t));
  } catch {
    // 保存できない環境でも解除処理自体は続ける
  }
}

export function resetFailures(): void {
  try {
    localStorage.removeItem(THROTTLE_KEY);
  } catch {
    // 同上
  }
}
