import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeSns, migrateSns } from '../src/migrate-sns.ts';
import { normalizePayload, type Entry } from '../src/model.ts';

const e = (title: string, url = ''): Entry => normalizePayload({ entries: [{ title, url }] }).entries[0];

test('Twitter・X・Instagram の項目を見分ける', () => {
  for (const t of ['Twitter', 'twitter（趣味）', 'ツイッター', 'ついったー仕事', 'Instagram', 'インスタ（サブ）', 'X', 'X（趣味用）', 'x 仕事', 'X(旧Twitter)', 'Ｘ（メイン）']) {
    assert.ok(looksLikeSns(e(t)), t);
  }
  assert.ok(looksLikeSns(e('趣味のアカウント', 'https://x.com/hiro')));
  assert.ok(looksLikeSns(e('サブ', 'twitter.com/sub')));
  assert.ok(looksLikeSns(e('写真', 'https://www.instagram.com/me/')));
});

test('別のサービスは SNS にしない', () => {
  for (const t of ['Xserver', 'Xbox', 'Amazon', 'Gmail（仕事用）', 'Box', 'XMind']) {
    assert.ok(!looksLikeSns(e(t)), t);
  }
  assert.ok(!looksLikeSns(e('サーバー', 'https://www.xserver.ne.jp/')));
  assert.ok(!looksLikeSns(e('箱', 'https://box.com/')));
});

test('ログインの項目だけを SNS に移し、中身はそのまま（1 回だけ）', () => {
  const p = normalizePayload({
    entries: [
      { kind: 'login', title: 'Twitter（趣味）', username: 'me@example.com', password: 'pw', displayName: 'hiro', note: 'メモ' },
      { kind: 'login', title: 'Amazon' },
      { kind: 'bank', title: 'X銀行' }, // ログイン以外は触らない
    ],
  });
  assert.equal(p.snsMigrated, false, '移行前のデータ');
  const { payload, moved } = migrateSns(p);
  assert.equal(moved, 1);
  assert.deepEqual(payload.entries.map((x) => x.kind), ['sns', 'login', 'bank']);
  const t = payload.entries[0];
  assert.deepEqual([t.username, t.password, t.displayName, t.note], ['me@example.com', 'pw', 'hiro', 'メモ']);
  assert.equal(payload.snsMigrated, true);

  // 実行済みなら、手動でログインに戻したものを再び移さない
  payload.entries[0].kind = 'login';
  assert.equal(migrateSns(payload).moved, 0);
});

test('新しく作った金庫は移行済み扱い', async () => {
  const { emptyPayload } = await import('../src/model.ts');
  assert.equal(emptyPayload().snsMigrated, true);
});
