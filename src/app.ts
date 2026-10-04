// 画面と操作。解除中のデータはメモリ上の session にだけ置き、ロック時に破棄する。

import { BioCancelledError, BioUnavailableError, bioAvailable, enrollBio, unlockBio, type BioRecord } from './biometric.ts';
import { wipe } from './bytes.ts';
import { clear, h } from './dom.ts';
import { DEFAULT_GEN, generatedBits, generatePassword, type GenOptions } from './generator.ts';
import { AUTO_LOCK_CHOICES, RELOCK_GRACE_CHOICES, emptyPayload, normalizePayload, type Entry, type Payload } from './model.ts';
import { toCsv, toText } from './plaintext.ts';
import {
  deleteBio,
  deleteVault,
  loadBio,
  loadVault,
  recordFailure,
  requestPersistence,
  resetFailures,
  saveBio,
  saveVault,
  throttleRemaining,
} from './storage.ts';
import { assessMaster, isAcceptableMaster, MIN_MASTER_LENGTH } from './strength.ts';
import {
  changePassword,
  createVault,
  InvalidFileError,
  parseVaultFile,
  resealVault,
  unlockVault,
  unlockWithRawDek,
  unwrapDek,
  verifyPassword,
  WrongPasswordError,
  type VaultFile,
} from './vault.ts';

declare const __APP_VERSION__: string;

interface Session {
  file: VaultFile;
  dek: CryptoKey;
  payload: Payload;
  /** バックアップを見るだけのモード（端末には保存しない） */
  readOnly: boolean;
}

let session: Session | null = null;
let root: HTMLElement;

// ---------------------------------------------------------------- 共通

function screen(title: string, actions: Node[], ...body: (Node | null | false)[]): HTMLElement {
  return h(
    'div',
    { class: 'screen' },
    h('header', { class: 'bar' }, h('h1', null, title), h('div', { class: 'actions' }, ...actions)),
    session?.readOnly ? h('div', { class: 'banner warn' }, '閲覧モード：このデータは端末に保存されていません') : null,
    h('main', null, ...body),
  );
}

function show(el: HTMLElement): void {
  clear(root);
  root.append(el);
  window.scrollTo(0, 0);
  const first = el.querySelector<HTMLElement>('[autofocus]');
  first?.focus();
}

let toastTimer = 0;
function toast(msg: string): void {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 3000);
}

function button(label: string, onClick: (e: Event) => void, cls = ''): HTMLButtonElement {
  return h('button', { type: 'button', class: cls, on: { click: onClick } }, label);
}

/** 非同期処理中はボタンを無効にし、二重実行を防ぐ */
async function busy(btn: HTMLButtonElement, label: string, fn: () => Promise<void>): Promise<void> {
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
  try {
    await fn();
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
}

let fieldSeq = 0;

/** ラベル付きの入力欄。ラベルは中の最初の入力要素に for で結び付ける（ボタンをラベル名に含めない） */
function field(label: string, input: HTMLElement, hint?: string): HTMLElement {
  const control = input.matches('input, select, textarea') ? input : input.querySelector('input, select, textarea');
  if (control && !control.id) control.id = `f${++fieldSeq}`;
  return h(
    'div',
    { class: 'field' },
    h('label', { class: 'label', for: control?.id }, label),
    input,
    hint ? h('small', null, hint) : null,
  );
}

/** パスワード入力欄。iOS の予測変換に学習されないよう type=password を基本にする */
function secretInput(opts: { placeholder?: string; autofocus?: boolean; autocomplete?: string } = {}): HTMLInputElement {
  return h('input', {
    type: 'password',
    autocomplete: opts.autocomplete ?? 'off',
    autocapitalize: 'none',
    spellcheck: false,
    placeholder: opts.placeholder ?? '',
    autofocus: opts.autofocus ?? false,
  });
}

function textInput(value = '', opts: { placeholder?: string; type?: string; autofocus?: boolean } = {}): HTMLInputElement {
  return h('input', {
    type: opts.type ?? 'text',
    value,
    autocomplete: 'off',
    autocapitalize: 'none',
    spellcheck: false,
    placeholder: opts.placeholder ?? '',
    autofocus: opts.autofocus ?? false,
    autocorrect: 'off',
  });
}

function withRevealToggle(input: HTMLInputElement): HTMLElement {
  const t = button('表示', () => {
    const hidden = input.type === 'password';
    input.type = hidden ? 'text' : 'password';
    t.textContent = hidden ? '隠す' : '表示';
  }, 'small');
  return h('div', { class: 'row' }, input, t);
}

function strengthMeter(input: HTMLInputElement): HTMLElement {
  const bar = h('div', { class: 'meter-bar' });
  const text = h('small', null, '');
  const update = () => {
    const s = assessMaster(input.value);
    bar.dataset.score = String(input.value ? s.score : -1);
    text.textContent = input.value ? `強さ：${s.label}${s.hint ? '　' + s.hint : ''}` : '';
  };
  input.addEventListener('input', update);
  update();
  return h('div', { class: 'meter' }, h('div', { class: 'meter-track' }, bar), text);
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
}

function formatDate(ms: number | null): string {
  if (!ms) return 'なし';
  return new Date(ms).toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' });
}

function dateStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/**
 * ファイルを端末の外へ渡す。iPhone では共有シート（「ファイル」に保存、AirDrop など）を使う。
 * 共有シートはユーザー操作の直後にしか開けないので、クリック処理の中から同期的に呼ぶこと。
 * @returns 実際に渡せたら true（キャンセルなら false）
 */
async function deliverFile(name: string, mime: string, content: string): Promise<boolean> {
  const file = new File([content], name, { type: mime });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return false;
      throw e;
    }
  }
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, class: 'hidden' });
    input.addEventListener('change', () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve(null);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

// ---------------------------------------------------------------- クリップボード
//
// Safari ではユーザー操作なしにクリップボードを書き換えられないため、
// 時間が過ぎた後の「次の画面タップ」またはロック操作のときに消去する。

let clipDeadline = 0;

async function copyText(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    const sec = session?.payload.settings.clipboardClearSeconds ?? 30;
    clipDeadline = Date.now() + sec * 1000;
    toast(`${what}をコピーしました（${sec}秒後の次の操作で消去します）`);
  } catch {
    toast('コピーできませんでした');
  }
}

function clearClipboardIfDue(force = false): void {
  if (!clipDeadline || (!force && Date.now() < clipDeadline)) return;
  clipDeadline = 0;
  navigator.clipboard.writeText('').catch(() => {
    // ユーザー操作の外では失敗することがある。その場合は上書きされるまで残る
  });
}

// ---------------------------------------------------------------- 自動ロック

let idleTimer = 0;

function resetIdle(): void {
  clearTimeout(idleTimer);
  if (!session) return;
  idleTimer = window.setTimeout(() => lock('しばらく操作がなかったのでロックしました'), session.payload.settings.autoLockMinutes * 60_000);
}

/** ロック時にゼロで消す一時的な鍵素材（Face ID 登録の 2 段階目まで保持する DEK など） */
const pendingSecrets = new Set<Uint8Array>();

function lock(message?: string): void {
  const wasReadOnly = session?.readOnly;
  session = null;
  parked = null;
  clearTimeout(idleTimer);
  clearClipboardIfDue(true);
  for (const b of pendingSecrets) wipe(b);
  pendingSecrets.clear();
  void start(message ?? (wasReadOnly ? '閲覧を終了しました' : undefined));
}

function enterSession(file: VaultFile, dek: CryptoKey, payload: unknown, readOnly = false): void {
  session = { file, dek, payload: normalizePayload(payload), readOnly };
  autoBio = null;
  if (!readOnly) void requestPersistence();
  resetIdle();
  show(listScreen());
}

// ---------------------------------------------------------------- アプリを離れたとき
//
// 既定ではすぐロックする。猶予を設定した場合も、離れている間は画面の中身を外して隠し、
// 猶予を過ぎて戻ったらロックする（iOS がアプリを終了させた場合はメモリごと消える）。

let parked: Node[] | null = null;
let hiddenAt = 0;
/** Face ID の登録中など、システムの画面が一時的に重なる間はロックしない */
let suppressLock = 0;
/** ロック画面が表示されたときに Face ID を自動で求める処理 */
let autoBio: (() => void) | null = null;

function onHidden(): void {
  if (!session || suppressLock > 0) return;
  const grace = session.payload.settings.relockGraceSeconds;
  if (grace <= 0 || session.readOnly) {
    lock();
    return;
  }
  hiddenAt = Date.now();
  parked = [...root.childNodes];
  root.replaceChildren(h('div', { class: 'cover' }, h('p', null, 'PassVault')));
}

function onVisible(): void {
  if (parked && session) {
    const nodes = parked;
    parked = null;
    if (Date.now() - hiddenAt <= session.payload.settings.relockGraceSeconds * 1000) {
      root.replaceChildren(...nodes);
      resetIdle();
    } else {
      lock();
    }
    return;
  }
  autoBio?.();
}

// ---------------------------------------------------------------- 保存

async function commit(mutate: (p: Payload) => void, opts: { touch?: boolean } = {}, s = session): Promise<void> {
  // ロック後に別の解除が行われていたら、古い状態で上書きしない
  if (!s || s.readOnly || (session && session !== s)) return;
  const next = structuredClone(s.payload);
  mutate(next);
  if (opts.touch !== false) next.modifiedAt = Date.now();
  const file = await resealVault(s.file, s.dek, next);
  await saveVault(file);
  // 保存に成功してからメモリ上の状態を更新する
  s.file = file;
  s.payload = next;
}

// ---------------------------------------------------------------- 起動・初期設定

export async function start(message?: string): Promise<void> {
  autoBio = null;
  const file = await loadVault();
  if (file) show(unlockScreen(file, await loadBio(), message));
  else show(welcomeScreen(message));
}

function welcomeScreen(message?: string): HTMLElement {
  const installHint =
    isIos() && !isStandalone()
      ? h(
          'div',
          { class: 'banner warn' },
          '先に Safari の共有ボタン →「ホーム画面に追加」をして、ホーム画面のアイコンから開いてください。',
          'Safari のタブとホーム画面のアプリでは、保存場所が別々になります。',
        )
      : null;
  return screen(
    'PassVault',
    [],
    message ? h('p', { class: 'banner' }, message) : null,
    installHint,
    h('p', null, 'パスワードを端末の中だけに、暗号化して保管します。通信は一切しません。'),
    h('div', { class: 'stack' },
      button('新しく始める', () => show(createScreen()), 'primary'),
      button('バックアップから復元する', () => void restoreFlow('restore')),
      button('バックアップを開いて見るだけ（保存しない）', () => void restoreFlow('view')),
    ),
  );
}

function createScreen(): HTMLElement {
  const pw1 = secretInput({ autofocus: true, autocomplete: 'new-password' });
  const pw2 = secretInput({ autocomplete: 'new-password' });
  const agree = h('input', { type: 'checkbox' });
  const err = h('p', { class: 'error', role: 'alert' });
  const submit = button('作成する', () => {
    err.textContent = '';
    if (!isAcceptableMaster(pw1.value)) {
      err.textContent = `マスターパスワードが弱すぎます。${MIN_MASTER_LENGTH} 文字以上で、強さ「ふつう」以上にしてください。`;
      return;
    }
    if (pw1.value !== pw2.value) {
      err.textContent = '確認用のパスワードが一致しません。';
      return;
    }
    if (!agree.checked) {
      err.textContent = '注意事項を確認してチェックを入れてください。';
      return;
    }
    void busy(submit, '作成中…', async () => {
      const payload = emptyPayload();
      const { file, dek } = await createVault(pw1.value, payload);
      await saveVault(file);
      pw1.value = pw2.value = '';
      enterSession(file, dek, payload);
      toast((await bioAvailable()) ? '金庫を作成しました。設定から Face ID を有効にできます' : '金庫を作成しました');
    });
  }, 'primary');

  return screen(
    'マスターパスワードの作成',
    [button('戻る', () => void start())],
    h('p', null, 'このアプリを開くための、ただ 1 つのパスワードです。'),
    h('ul', { class: 'notes' },
      h('li', null, h('strong', null, 'どこにも保存されません。'), '忘れると、誰にも（作者にも）復元できません。'),
      h('li', null, '関係のない単語を 4〜5 個つなげた長いものがおすすめです。例：みかん-電車-雲-えんぴつ-28'),
      h('li', null, '紙に書いて自宅の安全な場所に保管しておくと安心です。'),
    ),
    field('マスターパスワード', withRevealToggle(pw1)),
    strengthMeter(pw1),
    field('もう一度入力', pw2),
    h('label', { class: 'check' }, agree, '忘れると復元できないことを理解しました'),
    err,
    submit,
  );
}

function unlockScreen(file: VaultFile, bio: BioRecord | null, message?: string): HTMLElement {
  const pw = secretInput({ autofocus: !bio, autocomplete: 'current-password' });
  const err = h('p', { class: 'error', role: 'alert' });
  let tick = 0;

  const submit = button('開く', () => void tryUnlock(), bio ? '' : 'primary');
  const form = h('form', { on: { submit: (e) => { e.preventDefault(); void tryUnlock(); } } },
    field(bio ? 'またはマスターパスワードで開く' : 'マスターパスワード', withRevealToggle(pw)),
    err,
    submit,
  );

  function showWait(): boolean {
    const ms = throttleRemaining();
    clearTimeout(tick);
    if (ms <= 0) {
      submit.disabled = false;
      return false;
    }
    submit.disabled = true;
    err.textContent = `失敗が続いたため、あと ${Math.ceil(ms / 1000)} 秒待ってください。`;
    tick = window.setTimeout(() => {
      if (!showWait()) err.textContent = '';
    }, 1000);
    return true;
  }

  async function tryUnlock(): Promise<void> {
    if (submit.disabled || showWait() || !pw.value) return;
    err.textContent = '';
    await busy(submit, '確認中…', async () => {
      try {
        const u = await unlockVault<unknown>(file, pw.value);
        pw.value = '';
        resetFailures();
        enterSession(file, u.dek, u.payload);
      } catch (e) {
        if (!(e instanceof WrongPasswordError)) throw e;
        recordFailure();
        pw.value = '';
        err.textContent = 'パスワードが違います。';
      }
    });
    showWait();
  }

  const bioBtn = bio ? button('Face ID で開く', () => void tryBio(false), 'primary') : null;
  let bioBusy = false;

  async function tryBio(auto: boolean): Promise<void> {
    if (!bio || !bioBtn || bioBusy || document.hidden) return;
    bioBusy = true;
    err.textContent = '';
    try {
      await busy(bioBtn, '認証中…', async () => {
        try {
          const raw = await unlockBio(bio);
          try {
            const u = await unlockWithRawDek<unknown>(file, raw);
            resetFailures();
            enterSession(file, u.dek, u.payload);
          } finally {
            wipe(raw);
          }
        } catch (e) {
          if (e instanceof BioCancelledError) {
            if (!auto) err.textContent = 'Face ID で開けませんでした。もう一度試すか、マスターパスワードで開いてください。';
          } else if (e instanceof WrongPasswordError) {
            // 金庫が置き換わったなどで、包んだ鍵が合わなくなった
            await deleteBio();
            bioBtn.remove();
            err.textContent = 'Face ID の設定が無効になりました。マスターパスワードで開いてから、設定で有効にし直してください。';
          } else if (e instanceof BioUnavailableError) {
            err.textContent = e.message;
          } else {
            throw e;
          }
        }
      });
    } finally {
      bioBusy = false;
    }
  }

  queueMicrotask(showWait);
  if (bio) {
    // 表示されたら一度だけ自動で Face ID を求める（ユーザー操作が必要な環境では失敗するのでボタンで）
    let tried = false;
    autoBio = () => {
      if (tried || document.hidden) return;
      tried = true;
      void tryBio(true);
    };
    queueMicrotask(() => autoBio?.());
  }

  return screen(
    'PassVault',
    [],
    message ? h('p', { class: 'banner' }, message) : null,
    bioBtn,
    form,
    h('details', { class: 'trouble' },
      h('summary', null, '困ったとき'),
      h('div', { class: 'stack' },
        button('バックアップを開いて見るだけ（保存しない）', () => void restoreFlow('view')),
        button('バックアップで置き換える', () => void restoreFlow('restore')),
        button('すべて削除して最初からやり直す', () => void wipeAll(), 'danger'),
      ),
    ),
  );
}

async function wipeAll(): Promise<void> {
  const answer = prompt('端末内の金庫を完全に削除します。元に戻せません。\n実行するには「削除」と入力してください。');
  if (answer !== '削除') return;
  await deleteVault();
  resetFailures();
  lock('データを削除しました');
}

/** バックアップファイルを読み込み、置き換え（restore）または閲覧（view）する */
async function restoreFlow(mode: 'restore' | 'view'): Promise<void> {
  const picked = await pickFile('.json,application/json');
  if (!picked) return;
  let file: VaultFile;
  try {
    if (picked.size > 20 * 1024 * 1024) throw new InvalidFileError('ファイルが大きすぎます');
    file = parseVaultFile(await picked.text());
  } catch (e) {
    alert(`読み込めませんでした：${(e as Error).message}`);
    return;
  }

  const hasVault = mode === 'restore' && (await loadVault()) !== null;
  const pw = secretInput({ autofocus: true });
  const err = h('p', { class: 'error', role: 'alert' });
  const submit = button(mode === 'restore' ? '復元する' : '開く', () => void go(), 'primary');
  async function go(): Promise<void> {
    if (!pw.value) return;
    err.textContent = '';
    await busy(submit, '確認中…', async () => {
      try {
        const u = await unlockVault<unknown>(file, pw.value);
        pw.value = '';
        if (mode === 'restore') {
          await saveVault(file);
          // データ鍵が変わるので、以前の Face ID の設定は使えない
          await deleteBio();
          resetFailures();
        }
        enterSession(file, u.dek, u.payload, mode === 'view');
        toast(mode === 'restore' ? '復元しました。今後はバックアップ時のマスターパスワードで開きます' : 'バックアップを開きました');
      } catch (e) {
        if (!(e instanceof WrongPasswordError)) throw e;
        err.textContent = 'パスワードが違います（バックアップを作ったときのマスターパスワードが必要です）。';
      }
    });
  }

  show(screen(
    mode === 'restore' ? 'バックアップから復元' : 'バックアップを見る',
    [button('戻る', () => void start())],
    h('p', null, `ファイル：${picked.name}`),
    hasVault ? h('div', { class: 'banner danger' }, '今この端末にあるデータは、バックアップの内容で置き換えられます。元に戻せません。') : null,
    mode === 'view' ? h('p', null, '中身は画面に表示するだけで、この端末には保存しません。') : null,
    h('form', { on: { submit: (e) => { e.preventDefault(); void go(); } } },
      field('バックアップ作成時のマスターパスワード', withRevealToggle(pw)),
      err,
      submit,
    ),
  ));
}

// ---------------------------------------------------------------- 一覧・詳細・編集

function needsBackup(p: Payload): boolean {
  if (p.entries.length === 0) return false;
  if (p.lastBackupAt === null) return true;
  return p.modifiedAt > p.lastBackupAt && Date.now() - p.lastBackupAt > 7 * 24 * 3600_000;
}

function listScreen(query = ''): HTMLElement {
  const s = session!;
  const search = textInput(query, { type: 'search', placeholder: '検索' });
  const list = h('ul', { class: 'list' });

  const render = () => {
    const q = search.value.trim().toLowerCase();
    const items = s.payload.entries
      .filter((e) => !q || [e.title, e.username, e.url].some((v) => v.toLowerCase().includes(q)))
      .sort((a, b) => a.title.localeCompare(b.title, 'ja'));
    clear(list);
    if (items.length === 0) {
      list.append(h('li', { class: 'empty' }, s.payload.entries.length ? '見つかりません' : 'まだ登録がありません。「追加」から登録してください。'));
    }
    for (const e of items) {
      list.append(h('li', null,
        h('button', { type: 'button', class: 'item', on: { click: () => show(detailScreen(e.id)) } },
          h('span', { class: 'title' }, e.title || '（名前なし）'),
          h('span', { class: 'sub' }, e.username),
        ),
      ));
    }
  };
  search.addEventListener('input', render);
  render();

  const actions = s.readOnly
    ? [button('終了', () => lock())]
    : [button('追加', () => show(editScreen(null)), 'primary small'), button('設定', () => show(settingsScreen()), 'small'), button('ロック', () => lock(), 'small')];

  return screen(
    'PassVault',
    actions,
    !s.readOnly && needsBackup(s.payload)
      ? h('div', { class: 'banner warn' },
          s.payload.lastBackupAt ? '前回のバックアップから変更があります。' : 'まだバックアップがありません。',
          button('今すぐバックアップ', () => void backupNow(), 'small'),
        )
      : null,
    search,
    list,
  );
}

function findEntry(id: string): Entry | undefined {
  return session?.payload.entries.find((e) => e.id === id);
}

function safeUrl(url: string): string | null {
  // javascript: などを開かないよう http/https だけ許可する
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

function detailScreen(id: string): HTMLElement {
  const e = findEntry(id);
  if (!e) return listScreen();
  const ro = session!.readOnly;

  const pwText = h('span', { class: 'mono masked' }, '••••••••');
  let revealed = false;
  const revealBtn = button('表示', () => {
    revealed = !revealed;
    pwText.textContent = revealed ? e.password : '••••••••';
    pwText.classList.toggle('masked', !revealed);
    revealBtn.textContent = revealed ? '隠す' : '表示';
  }, 'small');

  const url = safeUrl(e.url);
  const row = (label: string, value: Node, ...btns: (Node | string)[]) =>
    h('div', { class: 'detail-row' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value), h('div', { class: 'btns' }, ...btns));

  return screen(
    e.title || '（名前なし）',
    [button('一覧', () => show(listScreen())), ro ? null : button('編集', () => show(editScreen(e.id)), 'small')].filter(Boolean) as Node[],
    h('div', { class: 'card' },
      row('ログイン ID', h('span', { class: 'mono' }, e.username || '—'), e.username ? button('コピー', () => void copyText(e.username, 'ログイン ID'), 'small') : ''),
      row('パスワード', pwText, revealBtn, e.password ? button('コピー', () => void copyText(e.password, 'パスワード'), 'small') : ''),
      e.email ? row('登録メール', h('span', { class: 'mono' }, e.email), button('コピー', () => void copyText(e.email, 'メールアドレス'), 'small')) : null,
      e.displayName ? row('ユーザー名', h('span', null, e.displayName), button('コピー', () => void copyText(e.displayName, 'ユーザー名'), 'small')) : null,
      e.url ? row('URL', h('span', { class: 'mono' }, e.url), url ? button('開く', () => window.open(url, '_blank', 'noopener,noreferrer'), 'small') : '') : null,
      e.note ? row('メモ', h('span', { class: 'note' }, e.note)) : null,
    ),
    h('p', { class: 'muted' }, `更新：${formatDate(e.updatedAt)}`),
    ro ? null : button('削除', () => {
      if (!confirm(`「${e.title}」を削除します。よろしいですか？`)) return;
      void commit((p) => { p.entries = p.entries.filter((x) => x.id !== e.id); }).then(() => {
        show(listScreen());
        toast('削除しました');
      });
    }, 'danger'),
  );
}

function generatorPanel(onUse: (pw: string) => void): HTMLElement {
  const opts: GenOptions = { ...DEFAULT_GEN };
  const out = h('div', { class: 'mono gen-out' });
  const bits = h('small', null);
  const lenLabel = h('span', null);
  const regen = () => {
    try {
      out.textContent = generatePassword(opts);
      bits.textContent = `強さの目安：約 ${generatedBits(opts)} ビット`;
    } catch (e) {
      out.textContent = '';
      bits.textContent = (e as Error).message;
    }
    lenLabel.textContent = `長さ：${opts.length}`;
  };
  const range = h('input', { type: 'range', min: 8, max: 64, value: String(opts.length) });
  range.addEventListener('input', () => { opts.length = Number(range.value); regen(); });
  const check = (key: 'upper' | 'lower' | 'digits' | 'symbols' | 'excludeAmbiguous', label: string) => {
    const c = h('input', { type: 'checkbox', checked: opts[key] });
    c.addEventListener('change', () => { opts[key] = c.checked; regen(); });
    return h('label', { class: 'check' }, c, label);
  };
  regen();
  return h('div', { class: 'card gen' },
    out,
    bits,
    h('label', { class: 'field' }, lenLabel, range),
    h('div', { class: 'checks' }, check('upper', 'A-Z'), check('lower', 'a-z'), check('digits', '0-9'), check('symbols', '記号'), check('excludeAmbiguous', '紛らわしい文字を除く')),
    h('div', { class: 'row' },
      button('作り直す', regen, 'small'),
      button('これを使う', () => { if (out.textContent) onUse(out.textContent); }, 'primary small'),
    ),
  );
}

/** 値があるときだけ欄を出し、無いときは「＋ ラベル」ボタンにしておく */
function optionalField(label: string, input: HTMLInputElement, hint: string): HTMLElement {
  const wrap = h('div', { class: 'add-slot' });
  const reveal = () => {
    wrap.classList.add('full');
    wrap.replaceChildren(field(label, input, hint));
  };
  if (input.value) reveal();
  else wrap.append(button(`＋ ${label}`, () => { reveal(); input.focus(); }, 'small'));
  return wrap;
}

function editScreen(id: string | null): HTMLElement {
  const e = id ? findEntry(id) : undefined;
  const title = textInput(e?.title ?? '', { autofocus: !e, placeholder: '例：Amazon、Gmail（仕事用）、自宅の Wi-Fi' });
  const username = textInput(e?.username ?? '', { placeholder: 'メールアドレス、ユーザー名、会員番号など' });
  const email = textInput(e?.email ?? '', { type: 'email', placeholder: 'me@example.com' });
  const displayName = textInput(e?.displayName ?? '', { placeholder: 'ニックネームや表示名' });
  const password = secretInput({ autocomplete: 'new-password' });
  password.value = e?.password ?? '';
  const url = textInput(e?.url ?? '', { type: 'url', placeholder: 'https://' });
  const note = h('textarea', { rows: 4, autocapitalize: 'none', autocorrect: 'off', spellcheck: false, value: e?.note ?? '' });
  const err = h('p', { class: 'error', role: 'alert' });
  const genSlot = h('div');

  const genBtn = button('生成', () => {
    if (genSlot.firstChild) {
      clear(genSlot);
      return;
    }
    genSlot.append(generatorPanel((pw) => {
      password.value = pw;
      password.type = 'text';
      clear(genSlot);
    }));
  }, 'small');

  const save = button('保存', () => {
    err.textContent = '';
    if (!title.value.trim()) {
      err.textContent = '名前を入力してください。';
      return;
    }
    void busy(save, '保存中…', async () => {
      const now = Date.now();
      const entry: Entry = {
        id: e?.id ?? crypto.randomUUID(),
        title: title.value.trim(),
        username: username.value.trim(),
        email: email.value.trim(),
        displayName: displayName.value.trim(),
        password: password.value,
        url: url.value.trim(),
        note: note.value,
        createdAt: e?.createdAt ?? now,
        updatedAt: now,
      };
      await commit((p) => {
        const i = p.entries.findIndex((x) => x.id === entry.id);
        if (i >= 0) p.entries[i] = entry;
        else p.entries.push(entry);
      });
      show(detailScreen(entry.id));
      toast('保存しました');
    });
  }, 'primary');

  return screen(
    e ? '編集' : '追加',
    [button('キャンセル', () => show(e ? detailScreen(e.id) : listScreen()))],
    field('名前', title, '同じサービスが複数あるときは「X（仕事用）」のように区別すると探しやすくなります'),
    field('ログイン ID', username, 'ログイン画面で入力するもの'),
    field('パスワード', h('div', { class: 'row' }, withRevealToggle(password), genBtn)),
    genSlot,
    h('div', { class: 'adds' },
      optionalField('登録メールアドレス', email, 'ログイン ID と別のときだけ'),
      optionalField('ユーザー名', displayName, 'ログインに使わない表示名など'),
    ),
    field('URL', url),
    field('メモ', note),
    err,
    save,
  );
}

// ---------------------------------------------------------------- 設定

async function backupNow(): Promise<void> {
  const s = session;
  if (!s || s.readOnly) return;
  // 共有シートはクリック直後にしか開けないため、await より前に呼ぶ
  const shared = deliverFile(`passvault-backup-${dateStamp()}.json`, 'application/json', JSON.stringify(s.file, null, 1));
  try {
    if (!(await shared)) return;
  } catch (e) {
    alert(`保存できませんでした：${(e as Error).message}`);
    return;
  }
  // 共有シートの間にロックされていても記録できるよう、開始時のセッションを渡す
  await commit((p) => { p.lastBackupAt = Date.now(); }, { touch: false }, s);
  toast('バックアップを書き出しました');
  if (session === s) show(settingsScreen());
}

function settingsScreen(): HTMLElement {
  const s = session!;
  const autoLock = h('select', null,
    ...AUTO_LOCK_CHOICES.map((m) => h('option', { value: String(m), selected: m === s.payload.settings.autoLockMinutes }, `${m} 分`)),
  );
  autoLock.addEventListener('change', () => {
    void commit((p) => { p.settings.autoLockMinutes = Number(autoLock.value); }, { touch: false }).then(() => {
      resetIdle();
      toast('変更しました');
    });
  });

  const grace = h('select', null,
    ...RELOCK_GRACE_CHOICES.map((sec) => h('option', { value: String(sec), selected: sec === s.payload.settings.relockGraceSeconds },
      sec === 0 ? 'すぐにロック（おすすめ）' : `${sec / 60} 分以内に戻れば解除不要`)),
  );
  grace.addEventListener('change', () => {
    void commit((p) => { p.settings.relockGraceSeconds = Number(grace.value); }, { touch: false }).then(() => toast('変更しました'));
  });

  const bioSlot = h('div', { class: 'stack' }, h('p', { class: 'muted' }, '確認中…'));
  void Promise.all([loadBio(), bioAvailable()]).then(([rec, available]) => {
    clear(bioSlot);
    if (rec) {
      bioSlot.append(
        h('p', null, '✅ 有効です（この端末のみ）'),
        button('Face ID を無効にする', () => {
          void deleteBio().then(() => {
            show(settingsScreen());
            toast('Face ID を無効にしました。「パスワード」アプリの PassVault のパスキーも削除できます');
          });
        }),
      );
    } else if (available) {
      bioSlot.append(
        h('p', null, '毎回のマスターパスワード入力の代わりに、Face ID で開けるようにします。'),
        button('Face ID を有効にする', () => show(bioEnrollScreen()), 'primary'),
      );
    } else {
      bioSlot.append(h('p', { class: 'muted' }, 'この端末・ブラウザでは使えません。'));
    }
  });

  const persisted = h('span', null, '確認中…');
  navigator.storage?.persisted?.().then((v) => { persisted.textContent = v ? '保護されています' : '保護されていません（ブラウザが削除する可能性あり）'; })
    .catch(() => { persisted.textContent = '不明'; });

  return screen(
    '設定',
    [button('一覧', () => show(listScreen()))],
    h('section', null,
      h('h2', null, 'バックアップ'),
      h('p', null, '暗号化したファイルを書き出します。iCloud Drive や PC に置いても、マスターパスワードがなければ読めません。'),
      h('p', { class: 'muted' }, `前回のバックアップ：${formatDate(s.payload.lastBackupAt)}`),
      button('暗号化バックアップを保存', () => void backupNow(), 'primary'),
    ),
    h('section', null,
      h('h2', null, 'Face ID'),
      bioSlot,
    ),
    h('section', null,
      h('h2', null, '自動ロック'),
      h('div', { class: 'stack' },
        field('操作がないときにロックするまで', autoLock),
        field('アプリを離れたとき', grace, '猶予を付けても、離れている間は画面の中身を隠します。iPhone がアプリを終了させた場合はロックされます。'),
      ),
    ),
    h('section', null,
      h('h2', null, 'マスターパスワード'),
      button('マスターパスワードを変更', () => show(changePasswordScreen())),
    ),
    h('section', null,
      h('h2', null, '平文で書き出す（非常用）'),
      h('p', null, '誰でも読めるファイルとして書き出します。乗り換えや紙での保管が必要なときだけ使ってください。'),
      button('平文で書き出す…', () => show(plainExportScreen()), 'danger'),
    ),
    h('section', null,
      h('h2', null, 'データ'),
      h('div', { class: 'stack' },
        button('バックアップで置き換える', () => {
          lock();
          void restoreFlow('restore');
        }),
        button('すべて削除', () => void wipeAll(), 'danger'),
      ),
    ),
    h('section', null,
      h('h2', null, 'このアプリについて'),
      h('ul', { class: 'notes' },
        h('li', null, `バージョン：${__APP_VERSION__}`),
        h('li', null, `登録件数：${s.payload.entries.length}`),
        h('li', null, '暗号化：AES-256-GCM ／ 鍵の生成：Argon2id（64MiB・3 回）'),
        h('li', null, '保存場所：この端末のみ（通信なし） ／ ', persisted),
      ),
    ),
  );
}

function bioEnrollScreen(): HTMLElement {
  const pw = secretInput({ autofocus: true, autocomplete: 'current-password' });
  const err = h('p', { class: 'error', role: 'alert' });
  const step2 = h('div');

  const verify = button('確認する', () => {
    err.textContent = '';
    clear(step2);
    void busy(verify, '確認中…', async () => {
      const s = session;
      if (!s) return;
      let raw: Uint8Array<ArrayBuffer>;
      try {
        raw = await unwrapDek(s.file, pw.value);
      } catch (e) {
        if (!(e instanceof WrongPasswordError)) throw e;
        err.textContent = 'マスターパスワードが違います。';
        return;
      }
      pw.value = '';
      pendingSecrets.add(raw);
      // Face ID の登録画面はユーザー操作の直後にしか開けないので、もう一度ボタンを押してもらう
      const enroll = button('Face ID を登録する', () => {
        suppressLock++;
        const done = enrollBio(raw);
        void busy(enroll, '登録中…', async () => {
          try {
            const rec = await done;
            await saveBio(rec);
            if (session === s) show(settingsScreen());
            toast('Face ID を有効にしました');
          } catch (e) {
            if (e instanceof BioCancelledError) err.textContent = '登録がキャンセルされました。';
            else if (e instanceof BioUnavailableError) err.textContent = e.message;
            else throw e;
          } finally {
            suppressLock--;
            wipe(raw);
            pendingSecrets.delete(raw);
          }
        });
      }, 'primary');
      step2.append(enroll);
    });
  });

  return screen(
    'Face ID を有効にする',
    [button('戻る', () => { show(settingsScreen()); })],
    h('ul', { class: 'notes' },
      h('li', null, 'iCloud キーチェーンに「PassVault」のパスキーを作り、Face ID が通ったときだけ開けるようにします。'),
      h('li', null, h('strong', null, 'iOS の仕様で、Face ID に失敗すると iPhone のパスコードでも開けます。'), 'パスコードを他人に知られないようにしてください。'),
      h('li', null, 'この設定はこの端末だけのものです。バックアップには含まれず、バックアップは今まで通りマスターパスワードで開きます。'),
      h('li', null, 'Face ID が使えないときは、いつでもマスターパスワードで開けます。'),
    ),
    field('マスターパスワード（確認）', pw),
    err,
    verify,
    step2,
  );
}

function changePasswordScreen(): HTMLElement {
  const cur = secretInput({ autofocus: true, autocomplete: 'current-password' });
  const pw1 = secretInput({ autocomplete: 'new-password' });
  const pw2 = secretInput({ autocomplete: 'new-password' });
  const err = h('p', { class: 'error', role: 'alert' });
  const submit = button('変更する', () => {
    err.textContent = '';
    if (!isAcceptableMaster(pw1.value)) {
      err.textContent = `新しいパスワードが弱すぎます。${MIN_MASTER_LENGTH} 文字以上で、強さ「ふつう」以上にしてください。`;
      return;
    }
    if (pw1.value !== pw2.value) {
      err.textContent = '確認用のパスワードが一致しません。';
      return;
    }
    void busy(submit, '変更中…', async () => {
      const s = session;
      if (!s) return;
      try {
        const file = await changePassword(s.file, cur.value, pw1.value);
        await saveVault(file);
        s.file = file;
        cur.value = pw1.value = pw2.value = '';
        show(settingsScreen());
        alert('変更しました。\n\n以前のバックアップは、以前のマスターパスワードで開きます。新しいバックアップを保存しておきましょう。');
      } catch (e) {
        if (!(e instanceof WrongPasswordError)) throw e;
        err.textContent = '今のマスターパスワードが違います。';
      }
    });
  }, 'primary');

  return screen(
    'マスターパスワードの変更',
    [button('戻る', () => show(settingsScreen()))],
    field('今のマスターパスワード', cur),
    field('新しいマスターパスワード', withRevealToggle(pw1)),
    strengthMeter(pw1),
    field('もう一度入力', pw2),
    err,
    submit,
  );
}

function plainExportScreen(): HTMLElement {
  const s = session!;
  const agree = h('input', { type: 'checkbox' });
  const pw = secretInput({ autocomplete: 'current-password' });
  const fmtTxt = h('input', { type: 'radio', name: 'fmt', value: 'txt', checked: true });
  const fmtCsv = h('input', { type: 'radio', name: 'fmt', value: 'csv' });
  const err = h('p', { class: 'error', role: 'alert' });
  const step2 = h('div');

  const verify = button('確認する', () => {
    err.textContent = '';
    clear(step2);
    if (!agree.checked) {
      err.textContent = '注意事項を確認してチェックを入れてください。';
      return;
    }
    void busy(verify, '確認中…', async () => {
      if (!(await verifyPassword(s.file, pw.value))) {
        err.textContent = 'マスターパスワードが違います。';
        return;
      }
      pw.value = '';
      const csv = fmtCsv.checked;
      // 共有シートはユーザー操作の直後にしか開けないので、もう一度ボタンを押してもらう
      step2.append(button(csv ? 'CSV ファイルを保存' : 'テキストファイルを保存', () => {
        const entries = session?.payload.entries ?? [];
        const name = `passvault-plain-${dateStamp()}.${csv ? 'csv' : 'txt'}`;
        const content = csv ? toCsv(entries) : toText(entries);
        deliverFile(name, csv ? 'text/csv' : 'text/plain', content)
          .then((ok) => { if (ok) { clear(step2); toast('書き出しました。用が済んだらファイルを削除してください'); } })
          .catch((e) => alert(`保存できませんでした：${(e as Error).message}`));
      }, 'danger'));
    });
  });

  return screen(
    '平文で書き出す',
    [button('戻る', () => show(settingsScreen()))],
    h('div', { class: 'banner danger' },
      h('strong', null, 'このファイルは誰でも読めます。'),
      'ファイルを手に入れた人に、すべての ID とパスワードを知られます。',
    ),
    h('ul', { class: 'notes' },
      h('li', null, 'メールやメッセージで送らないでください。'),
      h('li', null, 'iCloud Drive などに置きっぱなしにしないでください。'),
      h('li', null, '印刷・乗り換えが済んだら、すぐに削除してください（「最近削除した項目」からも）。'),
      h('li', null, 'ふだんのバックアップには「暗号化バックアップ」を使ってください。'),
    ),
    h('div', { class: 'checks' },
      h('label', { class: 'check' }, fmtTxt, 'テキスト（印刷・保管向け）'),
      h('label', { class: 'check' }, fmtCsv, 'CSV（iPhone の「パスワード」アプリ等への乗り換え向け）'),
    ),
    h('label', { class: 'check' }, agree, '上記を理解したうえで書き出します'),
    field('マスターパスワード（再確認）', pw),
    err,
    verify,
    step2,
  );
}

// ---------------------------------------------------------------- 起動

export function boot(el: HTMLElement): void {
  root = el;

  // 他のサイトの枠内に埋め込まれていたら動かない（クリックジャッキング対策）
  if (window.top !== window.self) {
    root.textContent = 'このページは単独で開いてください。';
    return;
  }

  // アプリを離れたらロック（App スイッチャーに中身を残さない）
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) onHidden();
    else onVisible();
  });
  window.addEventListener('pagehide', () => {
    if (session) lock();
  });

  for (const ev of ['pointerdown', 'keydown', 'input'] as const) {
    document.addEventListener(ev, () => {
      clearClipboardIfDue();
      resetIdle();
    }, { capture: true, passive: true });
  }

  window.addEventListener('unhandledrejection', (e) => {
    console.error(e.reason);
    toast(`エラー：${(e.reason as Error)?.message ?? e.reason}`);
  });

  void start();
}
