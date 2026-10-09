import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMemo } from '../src/importer.ts';

const MEMO = `☑Amazon
メアド：me@example.com
パスワード：Abc:def123

☑ 楽天銀行
口座番号：普通 1234567
暗証番号：4321
ログインID：rakuten01
パスワード：
pw-next-line

☑Twitter（趣味）
メアド：tw@example.com
ユーザー名：hiro_tw
パスワード：tw-pass
2段階認証あり

☑Gmail
ID：me@gmail.com
メールアドレス：sub@example.com
パスワード：g-pass
電話番号：090-1234-5678
URL：https://mail.google.com
秘密の質問：初めてのペット
旧パスワード：old-pass

☑ポイントカード
会員番号：0012-3456
`;

test('☑ ごとに項目を分け、見出しで欄に入れる', () => {
  const d = parseMemo(MEMO);
  assert.deepEqual(d.map((x) => x.entry.title), ['Amazon', '楽天銀行', 'Twitter（趣味）', 'Gmail', 'ポイントカード']);

  const amazon = d[0].entry;
  assert.equal(amazon.kind, 'login');
  assert.equal(amazon.username, 'me@example.com', 'メアドしか無ければログイン ID');
  assert.equal(amazon.email, '');
  assert.equal(amazon.password, 'Abc:def123', 'パスワード内の「:」で崩れない');
  assert.deepEqual(d[0].issues, []);
  assert.equal(amazon.needsUpdate, false);
});

test('銀行：暗証番号・口座番号で種類を判定、次の行に書いたデータも読む', () => {
  const bank = parseMemo(MEMO)[1].entry;
  assert.equal(bank.kind, 'bank');
  assert.equal(bank.number, '普通 1234567');
  assert.equal(bank.pin, '4321');
  assert.equal(bank.username, 'rakuten01');
  assert.equal(bank.password, 'pw-next-line');
});

test('SNS：種類は SNS、ユーザー名は「ユーザー名」欄、見出しの無い行はメモ', () => {
  const tw = parseMemo(MEMO)[2].entry;
  assert.equal(tw.kind, 'sns');
  assert.equal(tw.username, 'tw@example.com');
  assert.equal(tw.displayName, 'hiro_tw');
  assert.equal(tw.password, 'tw-pass');
  assert.equal(tw.note, '2段階認証あり');
});

test('分からない見出し・重複した見出しはメモに残し、要更新にする', () => {
  const g = parseMemo(MEMO)[3];
  assert.equal(g.entry.username, 'me@gmail.com');
  assert.equal(g.entry.email, 'sub@example.com');
  assert.equal(g.entry.phone, '090-1234-5678');
  assert.equal(g.entry.url, 'https://mail.google.com');
  assert.equal(g.entry.password, 'g-pass');
  assert.equal(g.entry.note, '秘密の質問：初めてのペット\n旧パスワード：old-pass');
  assert.equal(g.entry.needsUpdate, true);
  assert.equal(g.issues.length, 2);
});

test('会員番号はログイン ID（銀行扱いにしない）、パスワードが無ければ要更新', () => {
  const p = parseMemo(MEMO)[4];
  assert.equal(p.entry.kind, 'login');
  assert.equal(p.entry.username, '0012-3456');
  assert.ok(p.issues.includes('パスワードが見つかりません'));
  assert.equal(p.entry.needsUpdate, true);
});

test('☑ のあるメモでは、項目の途中の空行で分かれない', () => {
  const d = parseMemo('☑A\nID：a\n\nパスワード：p\n\n☑B\nパスワード：q');
  assert.deepEqual(d.map((x) => [x.entry.title, x.entry.username, x.entry.password]), [['A', 'a', 'p'], ['B', '', 'q']]);
});

test('☑ が消えたメモ（チェックリストをコピー）は空行と 1 行目で分ける', () => {
  const d = parseMemo('Amazon\nメアド：a@x\nパスワード：p1\n\nNetflix\nメアド：n@x\nパスワード：p2\n');
  assert.deepEqual(d.map((x) => [x.entry.title, x.entry.username, x.entry.password]), [['Amazon', 'a@x', 'p1'], ['Netflix', 'n@x', 'p2']]);
});

test('全角・半角の「：」、見出しの表記ゆれ（PW・メール・ログインパスワード）', () => {
  const d = parseMemo('☑A\nmail: a@x\nPW:p1\n☑B\nメール：b@x\nログインパスワード：p2\nＩＤ：bid');
  assert.deepEqual([d[0].entry.username, d[0].entry.password], ['a@x', 'p1']);
  assert.deepEqual([d[1].entry.username, d[1].entry.email, d[1].entry.password], ['bid', 'b@x', 'p2']);
});

test('URL の行の「https:」を見出しと間違えない', () => {
  const d = parseMemo('☑A\nパスワード：p\nhttps://example.com/login');
  assert.equal(d[0].entry.note, 'https://example.com/login');
  assert.deepEqual(d[0].issues, []);
});
