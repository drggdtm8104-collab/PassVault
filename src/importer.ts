// 【一時的な機能】標準メモに書いたパスワードを取り込むための読み取り処理。取り込みが済んだら削除する予定。
//
// メモの形式：
//   ☑ 名前            … ☑ などの印で始まる行が新しい項目の始まり（印が無いメモでは、空行の後の「：」の無い行）
//   見出し：データ     … 見出しで入れる欄を決める（全角・半角の「：」どちらも可、最初の「：」で区切る）
//   見出し：           … データが次の行に書かれている場合は、次の行をデータとして扱う
//   （「：」の無い行）  … 項目の途中ならメモ欄に足す
// どの欄か判断できない見出しは「見出し：データ」のままメモ欄に入れ、何も捨てない。

import { looksLikeSns } from './migrate-sns.ts';
import { normalizePayload, type Entry } from './model.ts';
import { normalizeForSearch } from './search.ts';

export interface Draft {
  entry: Entry;
  /** 読み取りに自信がない理由（空なら問題なし） */
  issues: string[];
}

type Target = 'username' | 'password' | 'email' | 'phone' | 'url' | 'pin' | 'number' | 'note' | 'userName';

const ITEM_MARK = /^\s*[☑☐✓✔✅□]\s*/;
const LABEL_LINE = /^([^：:]{1,20}?)\s*[：:]\s*(.*)$/;

/** 見出しから入れる欄を決める（normalizeForSearch 済みの見出しで判定。上から順に当てはめる） */
function targetOf(label: string): Target | null {
  const l = normalizeForSearch(label);
  if (/ぱす|pw|pass/.test(l)) return 'password';
  if (/暗証|pin/.test(l)) return 'pin';
  if (/めあど|めーる|mail/.test(l)) return 'email';
  if (/電話|でんわ|tel|携帯|けいたい/.test(l)) return 'phone';
  if (/url|さいと|ほーむぺーじ|hp$/.test(l)) return 'url';
  if (/口座|かーど|card/.test(l)) return 'number';
  if (/ゆーざー(名|めい|ねーむ)|username|表示名|はんどる/.test(l)) return 'userName';
  if (/id|ろぐいん|あかうんと|ゆーざー|会員|番号/.test(l)) return 'username';
  if (/めも|備考|びこう|note/.test(l)) return 'note';
  return null;
}

function labelLine(line: string): RegExpMatchArray | null {
  const m = line.match(LABEL_LINE);
  // 「https://…」の「https」を見出しと間違えない
  if (!m || /^https?$/i.test(m[1].trim())) return null;
  return m;
}

function isMarked(line: string): boolean {
  return ITEM_MARK.test(line) && !labelLine(line.replace(ITEM_MARK, ''));
}

interface Block {
  title: string;
  lines: string[];
}

/** メモ全体を項目ごとのまとまりに分ける */
function splitBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  // ☑ などの印を使っているメモでは、印だけを区切りにする（項目の途中の空行で分かれないように）
  const useMarks = lines.some(isMarked);
  const blocks: Block[] = [];
  let cur: Block | null = null;
  let afterBlank = true;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === '') {
      afterBlank = true;
      continue;
    }
    const marked = isMarked(line);
    const isLabel = labelLine(line) !== null;
    if (marked || (!useMarks && afterBlank && !isLabel) || !cur) {
      cur = { title: '', lines: [] };
      blocks.push(cur);
      if (marked || !isLabel) {
        cur.title = line.replace(ITEM_MARK, '').trim();
        afterBlank = false;
        continue;
      }
    }
    cur.lines.push(line);
    afterBlank = false;
  }
  return blocks;
}

function toDraft(b: Block): Draft {
  const e = normalizePayload({ entries: [{ title: b.title }] }).entries[0];
  const issues: string[] = [];
  const notes: string[] = [];
  let pending: { target: Target | null; label: string } | null = null;
  let userNameValue = '';

  const put = (target: Target | null, label: string, value: string) => {
    if (target === null) {
      notes.push(`${label}：${value}`);
      issues.push(`見出し「${label}」の欄が分からないのでメモに入れました`);
      return;
    }
    if (target === 'note') {
      notes.push(value);
      return;
    }
    const filled = target === 'userName' ? userNameValue : e[target];
    if (filled) {
      // 同じ欄が 2 回（旧パスワードなど）は上書きせずメモへ
      notes.push(`${label}：${value}`);
      issues.push(`「${label}」が複数あるので 2 つ目以降をメモに入れました`);
      return;
    }
    if (target === 'userName') userNameValue = value;
    else e[target] = value;
  };

  for (const line of b.lines) {
    const m = labelLine(line);
    if (m) {
      const label = m[1].trim();
      const value = m[2].trim();
      const target = targetOf(label);
      if (value === '') {
        pending = { target, label }; // データは次の行
        continue;
      }
      pending = null;
      put(target, label, value);
      continue;
    }
    const text = line.trim();
    if (pending) {
      put(pending.target, pending.label, text);
      pending = null;
    } else {
      notes.push(text);
    }
  }

  if (e.pin || e.number) e.kind = 'bank';
  else if (looksLikeSns(e)) e.kind = 'sns';

  // ユーザー名：SNS では「ユーザー名」欄（＠以降）。それ以外は ID が無ければログイン ID、あれば表示名
  if (userNameValue) {
    if (e.kind === 'sns' || e.username) e.displayName = userNameValue;
    else e.username = userNameValue;
  }
  // ログイン ID が無くメアドがあれば、メアドがログイン ID
  if (!e.username && e.email) {
    e.username = e.email;
    e.email = '';
  }
  e.note = notes.join('\n');

  if (!e.title) issues.push('名前がありません');
  if (!e.password && !e.pin) issues.push('パスワードが見つかりません');
  e.needsUpdate = issues.length > 0;
  return { entry: e, issues };
}

/** 貼り付けたメモを、登録前の確認用の下書きに変換する */
export function parseMemo(text: string): Draft[] {
  return splitBlocks(text)
    .filter((b) => b.title || b.lines.length > 0)
    .map(toDraft);
}
