import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unwrapWithPrf, wrapWithPrf } from '../src/biometric.ts';
import { randomBytes } from '../src/bytes.ts';
import { WrongPasswordError } from '../src/vault.ts';

test('PRF の出力で DEK を包み、同じ出力で取り出せる', async () => {
  const prf = randomBytes(32);
  const dek = randomBytes(32);
  const rec = await wrapWithPrf(prf, dek, 'cred-1', 'salt');
  assert.ok(!JSON.stringify(rec).includes(Buffer.from(dek).toString('base64')), '生の DEK が記録に含まれない');
  assert.deepEqual(await unwrapWithPrf(prf, rec), dek);
});

test('PRF の出力が違えば取り出せない', async () => {
  const rec = await wrapWithPrf(randomBytes(32), randomBytes(32), 'cred-1', 'salt');
  await assert.rejects(unwrapWithPrf(randomBytes(32), rec), WrongPasswordError);
});

test('別のパスキーの記録に差し替えると取り出せない（credential ID を AAD に含める）', async () => {
  const prf = randomBytes(32);
  const rec = await wrapWithPrf(prf, randomBytes(32), 'cred-1', 'salt');
  await assert.rejects(unwrapWithPrf(prf, { ...rec, credId: 'cred-2' }), WrongPasswordError);
});
