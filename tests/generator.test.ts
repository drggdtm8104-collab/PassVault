import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_GEN, generatePassword, randomInt } from '../src/generator.ts';
import { assessMaster, isAcceptableMaster } from '../src/strength.ts';
import { toCsv, toText } from '../src/plaintext.ts';
import type { Entry } from '../src/model.ts';

test('指定の長さで、選んだ種類の文字をすべて含む', () => {
  for (let i = 0; i < 200; i++) {
    const s = generatePassword(DEFAULT_GEN);
    assert.equal(s.length, 20);
    assert.match(s, /[A-Z]/);
    assert.match(s, /[a-z]/);
    assert.match(s, /[0-9]/);
    assert.match(s, /[^A-Za-z0-9]/);
    assert.doesNotMatch(s, /[0O1lI|]/);
  }
});

test('数字だけ・短い指定でも動く', () => {
  const s = generatePassword({ ...DEFAULT_GEN, upper: false, lower: false, symbols: false, length: 6 });
  assert.match(s, /^[2-9]{6}$/);
  assert.throws(() => generatePassword({ ...DEFAULT_GEN, upper: false, lower: false, digits: false, symbols: false }));
});

test('randomInt に大きな偏りがない', () => {
  const n = 10;
  const counts = new Array(n).fill(0);
  const trials = 100000;
  for (let i = 0; i < trials; i++) counts[randomInt(n)]++;
  for (const c of counts) assert.ok(Math.abs(c - trials / n) < trials / n * 0.05, String(counts));
});

test('マスターパスワードの強さ判定', () => {
  assert.equal(isAcceptableMaster('short'), false);
  assert.equal(isAcceptableMaster('aaaaaaaaaaaaaaaa'), false);
  assert.equal(isAcceptableMaster('password1234'), false);
  assert.equal(isAcceptableMaster('みかん-電車-雲-えんぴつ-28'), true);
  assert.equal(isAcceptableMaster('correct horse battery staple'), true);
  assert.equal(assessMaster('').score, 0);
});

const entries: Entry[] = [
  {
    id: '1',
    kind: 'login',
    favorite: false,
    needsUpdate: false,
    title: 'A, "B"',
    username: 'u',
    email: 'mail@example.com',
    displayName: '',
    number: '',
    pin: '',
    server: '',
    phone: '',
    password: '=1+2',
    url: 'https://a.example',
    note: '1行目\n2行目',
    createdAt: 0,
    updatedAt: 0,
  },
];

test('CSV は特殊文字を正しくエスケープし、値を書き換えない', () => {
  const csv = toCsv(entries);
  assert.equal(
    csv,
    'Title,URL,Username,Password,Notes,OTPAuth\r\n"A, ""B""",https://a.example,u,=1+2,"1行目\n2行目\nメールアドレス: mail@example.com",\r\n',
  );
});

test('テキスト書き出しに全項目が含まれる', () => {
  const txt = toText(entries, 0);
  for (const s of ['名前: A, "B"', 'https://a.example', '種類: ログイン', 'ログイン ID: u', 'メールアドレス: mail@example.com', 'パスワード: =1+2', '  2行目', '件数: 1']) {
    assert.ok(!txt.includes('ユーザー名:'), '空の項目は出さない');
    assert.ok(txt.includes(s), s);
  }
});
