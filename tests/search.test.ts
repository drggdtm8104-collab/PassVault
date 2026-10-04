import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesQuery, normalizeForSearch, parseQuery } from '../src/search.ts';
import type { Entry } from '../src/model.ts';

function entry(p: Partial<Entry>): Entry {
  return { id: '1', kind: 'login', title: '', number: '', pin: '', server: '', username: '', email: '', displayName: '', password: 'SECRET', url: '', note: '', createdAt: 0, updatedAt: 0, ...p };
}

const find = (e: Entry, q: string) => matchesQuery(e, parseQuery(q));

test('ひらがな・カタカナ・半角カナを区別しない', () => {
  const e = entry({ title: 'ツイッター（仕事用）' });
  assert.ok(find(e, 'ついったー'));
  assert.ok(find(e, 'ﾂｲｯﾀｰ'));
  assert.ok(find(e, 'ツイッター'));
});

test('全角・半角、大文字・小文字、記号の違いを区別しない', () => {
  const e = entry({ title: 'Gmail', email: 'me.name@example.com', url: 'https://mail.google.com' });
  assert.ok(find(e, 'ｇｍａｉｌ'));
  assert.ok(find(e, 'GMAIL'));
  assert.ok(find(e, 'mename'));
  assert.ok(find(e, 'mail google'));
});

test('名前以外の欄（ログイン ID・登録メール・ユーザー名・メモ）も対象', () => {
  const e = entry({ title: 'X', username: 'hiro_123', email: 'sub@example.com', displayName: 'ひろ', note: '秘密の質問：初めてのペット' });
  assert.ok(find(e, 'hiro123'));
  assert.ok(find(e, 'sub@example'));
  assert.ok(find(e, 'ヒロ'));
  assert.ok(find(e, 'ぺっと'));
});

test('複数の語はすべて含むものだけ', () => {
  const work = entry({ title: 'X（仕事用）' });
  const hobby = entry({ title: 'X（趣味用）' });
  assert.ok(find(work, 'x 仕事'));
  assert.ok(!find(hobby, 'x 仕事'));
  assert.ok(find(work, 'x　仕事'), '全角スペース区切りも可');
});

test('パスワードと暗証番号は検索対象にしない', () => {
  assert.ok(!find(entry({ title: 'A' }), 'secret'));
  assert.ok(!find(entry({ title: 'A', kind: 'bank', pin: '4321' }), '4321'));
  assert.ok(find(entry({ title: 'A', kind: 'bank', number: '普通 1234567' }), '1234567'));
});

test('欄の境目をまたいで一致しない', () => {
  assert.ok(!find(entry({ title: 'ab', username: 'cd' }), 'bc'));
});

test('空や記号だけの検索語はすべて表示', () => {
  assert.deepEqual(parseQuery('  ・ '), []);
  assert.ok(find(entry({ title: 'A' }), ''));
  assert.equal(normalizeForSearch('Ａ－Ｂ'), 'ab');
});
