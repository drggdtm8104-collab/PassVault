import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPhones, migratePhones } from '../src/phone.ts';
import { normalizePayload } from '../src/model.ts';

test('よくある書き方の電話番号を見つける（書かれたままの形で）', () => {
  assert.deepEqual(extractPhones('携帯 090-1234-5678'), ['090-1234-5678']);
  assert.deepEqual(extractPhones('TEL:03-1234-5678 まで'), ['03-1234-5678']);
  assert.deepEqual(extractPhones('窓口 0120-123-456'), ['0120-123-456']);
  assert.deepEqual(extractPhones('09012345678'), ['09012345678']);
  assert.deepEqual(extractPhones('０９０－１２３４－５６７８'), ['０９０－１２３４－５６７８']);
  assert.deepEqual(extractPhones('(03)1234-5678'), ['(03)1234-5678']);
  assert.deepEqual(extractPhones('電話（090-1234-5678）'), ['090-1234-5678']);
  assert.deepEqual(extractPhones('+81-90-1234-5678'), ['+81-90-1234-5678']);
  assert.deepEqual(extractPhones('自宅 03-1111-2222、携帯 080-3333-4444'), ['03-1111-2222', '080-3333-4444']);
});

test('電話番号でない数字は拾わない', () => {
  for (const s of [
    '普通 1234567', // 口座番号
    '4980 1234 5678 9012', // カード番号
    '暗証番号 0123',
    '2024-10-05', // 日付
    '〒123-4567', // 郵便番号
    '1234-5678-9012-3456',
    '会員番号 0012345678901234', // 長い番号の一部
    '',
  ]) {
    assert.deepEqual(extractPhones(s), [], s);
  }
});

test('同じ番号は 1 回だけ', () => {
  assert.deepEqual(extractPhones('090-1234-5678 / 09012345678'), ['090-1234-5678']);
});

test('メモの電話番号を電話番号の欄へコピーし、メモはそのまま残す（1 回だけ）', () => {
  const p = normalizePayload({
    entries: [
      { title: 'A', note: '問い合わせ 0120-123-456\n担当: 田中' },
      { title: 'B', note: '番号なし' },
      { title: 'C', note: '090-1111-2222', phone: '03-0000-0000' }, // 既に入力済みは上書きしない
    ],
  });
  assert.equal(p.phoneMigrated, false, '移行前のデータ');
  const { payload, copied } = migratePhones(p);
  assert.equal(copied, 1);
  assert.equal(payload.entries[0].phone, '0120-123-456');
  assert.equal(payload.entries[0].note, '問い合わせ 0120-123-456\n担当: 田中', 'メモは変えない');
  assert.equal(payload.entries[1].phone, '');
  assert.equal(payload.entries[2].phone, '03-0000-0000');
  assert.equal(payload.phoneMigrated, true);

  // 実行済みなら、後で欄を空にしてもコピーし直さない
  payload.entries[0].phone = '';
  assert.equal(migratePhones(payload).copied, 0);
  assert.equal(migratePhones(payload).payload.entries[0].phone, '');
});

test('新しく作った金庫は移行済み扱い', async () => {
  const { emptyPayload } = await import('../src/model.ts');
  assert.equal(emptyPayload().phoneMigrated, true);
});
