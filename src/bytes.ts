// バイト列と文字列の相互変換。DOM に依存しないので Node のテストからも使える。

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

export function utf8(s: string): Uint8Array<ArrayBuffer> {
  return enc.encode(s);
}

export function fromUtf8(b: Uint8Array): string {
  return dec.decode(b);
}

export function toB64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) {
    s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromB64(s: string): Uint8Array<ArrayBuffer> {
  if (typeof s !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) {
    throw new Error('invalid base64');
  }
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

/** 鍵素材などをメモリから消す（JS では完全な消去は保証できないが、残る時間を短くする） */
export function wipe(b: Uint8Array | null | undefined): void {
  if (b) b.fill(0);
}
