import { test } from 'node:test';
import assert from 'node:assert/strict';
import { argon2id as argonWasm } from 'hash-wasm';
import { argon2id as argonNoble } from '@noble/hashes/argon2.js';
import {
  changePassword,
  createVault,
  InvalidFileError,
  parseVaultFile,
  resealVault,
  unlockVault,
  verifyPassword,
  WrongPasswordError,
  type VaultFile,
} from '../src/vault.ts';
import { fromB64, toB64 } from '../src/bytes.ts';
import { emptyPayload, normalizePayload, type Payload } from '../src/model.ts';

const PW = 'みかん-電車-雲-えんぴつ-28';

function samplePayload(): Payload {
  const p = emptyPayload();
  p.modifiedAt = 1000;
  p.entries.push({
    id: 'a',
    kind: 'login',
    title: 'Example',
    username: 'me@example.com',
    email: '',
    displayName: '',
    number: '',
    pin: '',
    server: '',
    password: 'p@ss"word,\n改行',
    url: 'https://example.com',
    note: 'メモ',
    createdAt: 1,
    updatedAt: 2,
  });
  return p;
}

function flipByte(b64: string, index = 0): string {
  const b = fromB64(b64);
  b[index] ^= 1;
  return toB64(b);
}

test('hash-wasm と noble の Argon2id が同じ結果を出す（独立実装での照合）', async () => {
  const salt = new Uint8Array(16).fill(7);
  const a = await argonWasm({
    password: 'password',
    salt,
    iterations: 2,
    parallelism: 1,
    memorySize: 19456,
    hashLength: 32,
    outputType: 'hex',
  });
  const b = Buffer.from(argonNoble('password', salt, { t: 2, m: 19456, p: 1, dkLen: 32 })).toString('hex');
  assert.equal(a, b);
});

test('作成 → 解除で中身が元に戻る', async () => {
  const { file } = await createVault(PW, samplePayload());
  const json = JSON.stringify(file);
  assert.ok(!json.includes('me@example.com'), '平文が保存ファイルに含まれていない');
  assert.ok(!json.includes(PW), 'パスワードが保存ファイルに含まれていない');
  const { payload } = await unlockVault<Payload>(parseVaultFile(json), PW);
  assert.deepEqual(payload, samplePayload());
});

test('間違ったパスワードでは開けない', async () => {
  const { file } = await createVault(PW, samplePayload());
  await assert.rejects(unlockVault(file, PW + 'x'), WrongPasswordError);
  assert.equal(await verifyPassword(file, 'wrong'), false);
  assert.equal(await verifyPassword(file, PW), true);
});

test('Unicode の正規化の違い（NFC/NFD）でも同じパスワードとして扱う', async () => {
  const nfc = 'がぎぐげご-パスワード-123';
  const { file } = await createVault(nfc, samplePayload());
  assert.equal(await verifyPassword(file, nfc.normalize('NFD')), true);
});

test('改ざんを検知する', async () => {
  const { file } = await createVault(PW, samplePayload());
  const cases: [string, VaultFile][] = [
    ['data.ct', { ...file, data: { ...file.data, ct: flipByte(file.data.ct, 5) } }],
    ['data.iv', { ...file, data: { ...file.data, iv: flipByte(file.data.iv) } }],
    ['wrap.ct', { ...file, wrap: { ...file.wrap, ct: flipByte(file.wrap.ct) } }],
    ['kdf.t', { ...file, kdf: { ...file.kdf, t: file.kdf.t + 1 } }],
    ['kdf.salt', { ...file, kdf: { ...file.kdf, salt: flipByte(file.kdf.salt) } }],
  ];
  for (const [name, bad] of cases) {
    await assert.rejects(unlockVault(bad, PW), WrongPasswordError, name);
  }
});

test('別の金庫のデータ部分に差し替えても開けない', async () => {
  const a = await createVault(PW, samplePayload());
  const b = await createVault(PW, emptyPayload());
  await assert.rejects(unlockVault({ ...a.file, data: b.file.data }, PW), WrongPasswordError);
});

test('保存し直すたびに IV が変わり、中身は更新される', async () => {
  const { file, dek } = await createVault(PW, samplePayload());
  const p = samplePayload();
  p.entries[0].title = 'Changed';
  const next = await resealVault(file, dek, p);
  assert.notEqual(next.data.iv, file.data.iv);
  const { payload } = await unlockVault<Payload>(next, PW);
  assert.equal(payload.entries[0].title, 'Changed');
});

test('マスターパスワード変更：新しい方で開け、古い方では開けない', async () => {
  const { file } = await createVault(PW, samplePayload());
  const changed = await changePassword(file, PW, 'new-pass-phrase-123');
  assert.notEqual(changed.kdf.salt, file.kdf.salt);
  assert.equal(changed.data, file.data);
  await assert.rejects(unlockVault(changed, PW), WrongPasswordError);
  const { payload } = await unlockVault<Payload>(changed, 'new-pass-phrase-123');
  assert.deepEqual(payload, samplePayload());
  await assert.rejects(changePassword(file, 'wrong', 'x'), WrongPasswordError);
});

test('不正なファイルや極端な鍵設定を読み込み前に拒否する', async () => {
  const { file } = await createVault(PW, samplePayload());
  const bad = (f: unknown) => assert.throws(() => parseVaultFile(JSON.stringify(f)), InvalidFileError);
  assert.throws(() => parseVaultFile('not json'), InvalidFileError);
  bad({ ...file, format: 'other' });
  bad({ ...file, version: 2 });
  bad({ ...file, kdf: { ...file.kdf, m: 4 * 1024 * 1024 } }); // 4GiB 要求で端末を固める攻撃
  bad({ ...file, kdf: { ...file.kdf, m: 1024 } }); // 弱すぎる設定
  bad({ ...file, kdf: { ...file.kdf, t: 1000 } });
  bad({ ...file, kdf: { ...file.kdf, alg: 'pbkdf2' } });
  bad({ ...file, wrap: null });
  // 余計なプロパティは取り除かれる
  const parsed = parseVaultFile(JSON.stringify({ ...file, extra: 1, kdf: { ...file.kdf, x: 1 } }));
  assert.deepEqual(Object.keys(parsed).sort(), ['data', 'format', 'kdf', 'version', 'wrap']);
  assert.deepEqual(Object.keys(parsed.kdf).sort(), ['alg', 'm', 'p', 'salt', 't']);
});

test('復号した中身の欠けや型違いを補正する', () => {
  const p = normalizePayload({ entries: [{ title: 5, password: 'x' }], settings: { autoLockMinutes: 999 } });
  assert.equal(p.entries[0].title, '');
  assert.equal(p.entries[0].kind, 'login', '種類の無い古いデータはログイン扱い');
  assert.equal(p.entries[0].pin, '');
  assert.equal(p.entries[0].password, 'x');
  assert.ok(p.entries[0].id);
  assert.equal(p.settings.autoLockMinutes, 3);
  assert.equal(p.lastBackupAt, null);
});
