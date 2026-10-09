import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearUnusedFields, KINDS, subtitle, toKind } from '../src/kinds.ts';
import { normalizePayload } from '../src/model.ts';
import { toCsv, toText } from '../src/plaintext.ts';
import type { Entry } from '../src/model.ts';

function entry(p: Partial<Entry>): Entry {
  return {
    id: '1', kind: 'login', favorite: false, title: 'T', username: '', password: '', email: '', displayName: '',
    number: '', pin: '', server: '', phone: '', url: '', note: '', createdAt: 0, updatedAt: 0, ...p,
  };
}

test('種類の定義：すべての種類に名前があり、欄の重複がない', () => {
  for (const k of KINDS) {
    assert.ok(k.label && k.fields.length > 0, k.id);
    const keys = k.fields.map((f) => f.key);
    assert.equal(new Set(keys).size, keys.length, k.id);
  }
});

test('種類を変えたら、使わない欄は空にする', () => {
  const e = clearUnusedFields(entry({ kind: 'email', username: 'me@example.com', password: 'pw', displayName: 'ひろ', url: 'https://x', pin: '1234' }));
  assert.equal(e.username, 'me@example.com');
  assert.equal(e.password, 'pw');
  assert.equal(e.url, 'https://x');
  assert.equal(e.displayName, '');
  assert.equal(e.pin, '');
});

test('一覧の 2 行目に秘密の欄を出さない', () => {
  assert.equal(subtitle(entry({ kind: 'login', username: 'me' })), 'me');
  assert.equal(subtitle(entry({ kind: 'sns', username: 'me', displayName: '@hiro' })), 'me');
  assert.equal(subtitle(entry({ kind: 'bank', number: '1234', pin: '9999' })), '');
});

test('銀行・カードの平文書き出し：暗証番号・番号も含める', () => {
  const e = entry({ kind: 'bank', title: '楽天銀行', number: '普通 1234567', pin: '4321', username: 'id1', password: 'pw1' });
  const txt = toText([e], 0);
  for (const s of ['種類: 銀行・カード', '口座番号・カード番号: 普通 1234567', '暗証番号: 4321', 'ネットバンキングのログイン ID: id1']) {
    assert.ok(txt.includes(s), s);
  }
  const csv = toCsv([e]);
  assert.ok(csv.includes('楽天銀行,,id1,pw1,"種類: 銀行・カード\n口座番号・カード番号: 普通 1234567\n暗証番号: 4321",'), csv);
});

test('メモの複数行は字下げして書き出す', () => {
  const txt = toText([entry({ kind: 'login', title: 'コード', note: 'aaa\nbbb' })], 0);
  assert.ok(txt.includes('メモ:\n  aaa\n  bbb'));
});

test('廃止した種類（その他・Wi-Fi・メモ）は「ログイン」として読み込み、中身は残す', () => {
  assert.ok(!KINDS.some((k) => (k.id as string) === 'other'), '「その他」は選べない');
  assert.equal(toKind('other'), 'login');
  assert.equal(toKind('wifi'), 'login');
  assert.equal(toKind('note'), 'login');
  assert.equal(toKind('bank'), 'bank');
  assert.equal(toKind(undefined), 'login');
  assert.equal(toKind('unknown'), 'login');
  const p = normalizePayload({ entries: [
    { kind: 'wifi', title: '自宅', username: 'MySSID', password: 'pw' },
    { kind: 'note', title: 'コード', note: 'aaa' },
    { kind: 'other', title: '保険', username: 'No.123', password: 'pw2', url: 'https://ins.example', note: 'メモ' },
  ] });
  assert.deepEqual(p.entries.map((e) => [e.kind, e.username, e.password, e.url, e.note]), [
    ['login', 'MySSID', 'pw', '', ''],
    ['login', '', '', '', 'aaa'],
    ['login', 'No.123', 'pw2', 'https://ins.example', 'メモ'],
  ]);
});

test('SNS の入力欄：指定の順番で、メールアドレスと電話番号は＋で追加する任意の欄', () => {
  const sns = KINDS.find((k) => k.id === 'sns')!;
  assert.equal(sns.label, 'SNS');
  assert.deepEqual(sns.fields.map((f) => f.key), ['username', 'password', 'displayName', 'url', 'note', 'email', 'phone']);
  assert.deepEqual(sns.fields.filter((f) => f.optional).map((f) => f.key), ['email', 'phone']);
  assert.equal(KINDS[1].id, 'sns', 'タブはログインの隣');
});

test('ログインの入力欄：パスワード以降はユーザー名・メールアドレス・電話番号・URL の順で、すべて＋で追加', () => {
  const login = KINDS.find((k) => k.id === 'login')!;
  assert.deepEqual(login.fields.map((f) => f.key), ['username', 'password', 'displayName', 'email', 'phone', 'url', 'note']);
  assert.deepEqual(login.fields.filter((f) => f.optional).map((f) => f.key), ['displayName', 'email', 'phone', 'url']);
});
