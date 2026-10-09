import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flagAllForReview } from '../src/migrate-flag.ts';
import { emptyPayload, normalizePayload } from '../src/model.ts';

test('登録済みの全項目に「更新が必要」を付ける（1 回だけ、中身はそのまま）', () => {
  const p = normalizePayload({ entries: [{ title: 'A', password: 'pa' }, { title: 'B', needsUpdate: true }] });
  assert.equal(p.flagAllDone, false, '移行前のデータ');
  const { payload, flagged } = flagAllForReview(p);
  assert.equal(flagged, 1, '既に付いているものは数えない');
  assert.deepEqual(payload.entries.map((e) => e.needsUpdate), [true, true]);
  assert.equal(payload.entries[0].password, 'pa');
  assert.equal(payload.flagAllDone, true);

  // 実行済みなら、後で外した印を付け直さない
  payload.entries[0].needsUpdate = false;
  const again = flagAllForReview(payload);
  assert.equal(again.flagged, 0);
  assert.equal(again.payload.entries[0].needsUpdate, false);
});

test('新しく作った金庫は実行済み扱い（追加する項目には付けない）', () => {
  assert.equal(emptyPayload().flagAllDone, true);
});
