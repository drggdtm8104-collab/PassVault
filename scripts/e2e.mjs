// 画面の通し確認（Edge をヘッドレスで操作）。先に npm run build と npm run serve を実行しておく。
// 使い方: node scripts/e2e.mjs [スクリーンショット保存先]
import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL ?? 'http://localhost:8080/';
const shots = process.argv[2];
if (shots) mkdirSync(shots, { recursive: true });
const MASTER = 'みかん-電車-雲-えんぴつ-28';
const SECRET = 'S3cret!Pass-For-Test';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const iphone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true };

async function newPage() {
  const ctx = await browser.newContext(iphone);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(String(e)));
  // 共有シートが無い環境としてダウンロードで受け取る
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { value: undefined });
    document.addEventListener('securitypolicyviolation', (e) => console.error('CSP violation', e.violatedDirective, e.blockedURI));
  });
  return { ctx, page, problems };
}

const shot = async (page, name) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true }); };
const btn = (page, name) => page.getByRole('button', { name, exact: true });
const step = (s) => console.log(`- ${s}`);

const { ctx, page, problems } = await newPage();
await page.goto(BASE);
await page.getByText('新しく始める').waitFor();
await shot(page, '01-welcome');
step('初回画面が表示される');

await btn(page, '新しく始める').click();
await page.getByLabel('マスターパスワード', { exact: true }).fill('password1234');
await page.getByLabel('もう一度入力').fill('password1234');
await btn(page, '作成する').click();
await page.getByText('弱すぎます', { exact: false }).first().waitFor();
step('弱いマスターパスワードは拒否される');

await page.getByLabel('マスターパスワード', { exact: true }).fill(MASTER);
await page.getByLabel('もう一度入力').fill(MASTER);
await shot(page, '02-create');
await btn(page, '作成する').click();
await page.getByText('注意事項を確認', { exact: false }).waitFor();
await page.getByText('忘れると復元できないことを理解しました').click();
await btn(page, '作成する').click();
await page.getByText('まだ登録がありません', { exact: false }).waitFor();
step('金庫を作成できる');

// 追加（生成器を使う）
await btn(page, '追加').click();
await page.getByLabel('名前', { exact: true }).fill('Example <script>alert(1)</script>');
assert.equal(await page.getByRole('tab', { name: 'ログイン' }).getAttribute('aria-selected'), 'true', '最初はログインが選ばれている');
await page.getByLabel('ログイン ID').fill('me@example.com');
assert.equal(await page.getByLabel('メールアドレス').count(), 0, '任意の欄は最初は隠れている');
assert.deepEqual(await page.locator('.fields .adds button').allTextContents(), ['＋ ユーザー名', '＋ メールアドレス', '＋ 電話番号', '＋ URL'], 'ログインの＋ボタンの順番');
assert.equal(await page.locator('main small').count(), 0, '入力欄の外の説明文は無い');
await shot(page, '02b-edit-login');
await btn(page, '＋ メールアドレス').click();
await page.getByLabel('メールアドレス').fill('contact@example.com');
await btn(page, '＋ 電話番号').click();
await page.getByLabel('電話番号').fill('090-1234-5678');
assert.equal((await page.getByLabel('電話番号').boundingBox()).height, (await page.getByLabel('ログイン ID').boundingBox()).height, '電話番号欄も他と同じ高さ');
const hEmail = (await page.getByLabel('メールアドレス').boundingBox()).height;
const hId = (await page.getByLabel('ログイン ID').boundingBox()).height;
assert.equal(hEmail, hId, `メール欄の高さ ${hEmail} が他の欄 ${hId} と同じ`);
await btn(page, '生成').click();
await shot(page, '03-generator');
await btn(page, 'これを使う').click();
const generated = await page.getByLabel('パスワード').inputValue();
assert.equal(generated.length, 20);
await page.getByLabel('パスワード').fill(SECRET);
await btn(page, '＋ URL').click();
await page.getByLabel('URL').fill('javascript:alert(1)');
await btn(page, '保存').click();
await page.getByText('更新：', { exact: false }).waitFor();
await page.getByText('contact@example.com').waitFor();
await page.getByText('090-1234-5678').waitFor();
assert.equal(await page.getByText('ユーザー名').count(), 0, '空の項目は詳細に出さない');
assert.equal(await btn(page, '開く').count(), 0, 'javascript: URL に「開く」ボタンを出さない');
assert.ok(await page.getByText('Example <script>alert(1)</script>').first().isVisible(), 'HTML は文字として表示される');
assert.ok(!(await page.getByText(SECRET).isVisible().catch(() => false)), 'パスワードは最初は伏せ字');
await btn(page, '表示').click();
await page.getByText(SECRET).waitFor();
await shot(page, '04-detail');
step('登録・伏せ字・表示切り替え・危険な URL/HTML の無害化');

await page.getByRole('button', { name: 'コピー' }).nth(1).click();
assert.equal(await page.evaluate(() => navigator.clipboard.readText()), SECRET);
step('パスワードをコピーできる');

// 保存内容に平文が含まれない
const stored = await page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('passvault');
  r.onsuccess = () => {
    const g = r.result.transaction('kv').objectStore('kv').get('vault');
    g.onsuccess = () => res(JSON.stringify(g.result));
  };
}));
for (const s of [SECRET, 'me@example.com', 'Example', MASTER]) assert.ok(!stored.includes(s), `保存データに平文 ${s} が無い`);
step('端末内の保存データは暗号化されている');

// バックグラウンドに移ったら即ロック
await page.evaluate(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
  delete document.hidden;
});
await page.getByLabel('マスターパスワード').waitFor();
assert.equal(await page.getByText(SECRET).count(), 0);
await shot(page, '05-locked');
step('アプリを離れると即ロックされ、画面から中身が消える');

// 解除：間違い → 正解
await page.getByLabel('マスターパスワード').fill('wrong-password');
await btn(page, '開く').click();
await page.getByText('パスワードが違います').waitFor();
await page.getByLabel('マスターパスワード').fill(MASTER);
await btn(page, '開く').click();
await page.getByText('Example <script>', { exact: false }).waitFor();
step('間違ったパスワードでは開かず、正しいパスワードで開く');

// 検索（全角・登録メール・複数語）
const search = page.getByPlaceholder('検索', { exact: false });
await search.fill('ｅｘａｍｐｌｅ');
await page.getByText('Example <script>', { exact: false }).waitFor();
await search.fill('contact example');
await page.getByText('Example <script>', { exact: false }).waitFor();
await search.fill('存在しない');
await page.getByText('見つかりません').waitFor();
await search.fill('');
step('検索：全角・登録メール・複数語で見つかり、無ければ「見つかりません」');

// 種類：銀行・カードなどを登録し、種類で絞り込む
await btn(page, '追加').click();
assert.deepEqual(await page.getByRole('tab').allTextContents(), ['ログイン', 'SNS', 'メール', '銀行・カード'], '種類のタブ（その他は無い）');
await page.getByLabel('名前', { exact: true }).fill('自宅の Wi-Fi');
await page.getByLabel('ログイン ID').fill('MyHomeNet');
await page.getByLabel('パスワード', { exact: true }).fill('wifi-pass-123');
await shot(page, '15-edit-tabs');
await btn(page, '保存').click();
await page.getByText('MyHomeNet').waitFor();
await btn(page, '一覧').click();

await btn(page, '追加').click();
await page.getByRole('tab', { name: '銀行・カード' }).click();
await page.getByLabel('名前', { exact: true }).fill('楽天銀行');
await page.getByLabel('口座番号・カード番号').fill('普通 1234567');
await page.getByLabel('暗証番号').fill('4321');
await btn(page, '保存').click();
await page.getByText('普通 1234567').waitFor();
assert.equal(await page.getByText('4321').count(), 0, '暗証番号は最初は伏せ字');
await page.getByRole('button', { name: '表示' }).first().click();
await page.getByText('4321').waitFor();
await shot(page, '16-detail-bank');
await btn(page, '一覧').click();

const filter = page.getByLabel('表示');
assert.ok((await filter.locator('option[value="bank"]').textContent()).includes('銀行・カード（1）'), '件数が選択肢に出る');
assert.equal(await filter.locator('option[value="other"]').count(), 0, '「その他」は選択肢に無い');
await filter.selectOption('bank');
await page.getByText('楽天銀行').waitFor();
assert.equal(await page.getByText('自宅の Wi-Fi').count(), 0);
assert.equal(await page.getByText('Example <script>', { exact: false }).count(), 0);
await shot(page, '17-filter-bank');
await filter.selectOption('all');
await page.getByText('楽天銀行').waitFor();
// 種類の表示は右端に固定
const listBox = await page.locator('.list').boundingBox();
const filterBox = await filter.boundingBox();
assert.ok(listBox.y - (filterBox.y + filterBox.height) >= 12, 'プルダウンと一覧の間に隙間がある');
for (const b of await page.locator('.list .badge').all()) {
  const box = await b.boundingBox();
  assert.ok(Math.abs(listBox.x + listBox.width - (box.x + box.width)) < 24, '種類の表示が右端にある');
}
await shot(page, '17b-list-all');
await page.getByText('Example <script>', { exact: false }).first().waitFor();
// SNS：入力欄の順番と＋で追加する欄
await btn(page, '追加').click();
await page.getByRole('tab', { name: 'SNS' }).click();
const labels = await page.locator('.fields .field > label').allTextContents();
assert.deepEqual(labels, ['ログイン ID', 'パスワード', 'ユーザー名', 'メモ'], 'SNS の欄の順番');
assert.deepEqual(await page.locator('.fields .adds button').allTextContents(), ['＋ メールアドレス', '＋ 電話番号', '＋ URL']);
assert.equal(await page.getByLabel('ユーザー名').getAttribute('placeholder'), '＠以降を入力');
await shot(page, '20-edit-sns');
await btn(page, 'キャンセル').click();
step('種類のタブ（その他なし）、銀行の入力欄、暗証番号の伏せ字、種類での絞り込み、プルダウンと一覧の隙間');

// お気に入り
await page.getByText('楽天銀行').click();
await page.getByRole('button', { name: 'お気に入りに追加' }).click();
await page.getByText('お気に入りに追加しました').waitFor();
assert.equal(await page.getByRole('button', { name: 'お気に入りから外す' }).count(), 1);
await btn(page, '一覧').click();
await page.getByLabel('表示').selectOption('fav');
await page.getByText('楽天銀行').waitFor();
assert.equal(await page.getByText('自宅の Wi-Fi').count(), 0);
await shot(page, '18-filter-fav');
await page.getByText('楽天銀行').click();
await page.getByRole('button', { name: 'お気に入りから外す' }).click();
await page.getByText('お気に入りから外しました').waitFor();
await btn(page, '一覧').click();
assert.ok((await page.getByLabel('表示').locator('option[value="fav"]').textContent()).includes('お気に入り（0）'));
await page.getByLabel('表示').selectOption('all');
step('お気に入りの追加・解除、お気に入りでの絞り込み');

// 暗号化バックアップ
await btn(page, '設定').click();
const [dl] = await Promise.all([page.waitForEvent('download'), btn(page, '暗号化バックアップを保存').click()]);
const backupPath = await dl.path();
const backup = readFileSync(backupPath, 'utf8');
assert.ok(backup.includes('"format": "passvault"') && !backup.includes(SECRET));
await page.getByText('前回のバックアップ：なし').waitFor({ state: 'detached' });
await shot(page, '06-settings');
step('暗号化バックアップを書き出せる（平文を含まない）');

// 平文書き出し（CSV）
await btn(page, '平文で書き出す…').click();
await page.getByText('CSV（', { exact: false }).click();
await page.getByText('上記を理解したうえで書き出します').click();
await page.getByLabel('マスターパスワード（再確認）').fill('wrong');
await btn(page, '確認する').click();
await page.getByText('マスターパスワードが違います').waitFor();
await page.getByLabel('マスターパスワード（再確認）').fill(MASTER);
await btn(page, '確認する').click();
await shot(page, '07-plain-export');
const [dl2] = await Promise.all([page.waitForEvent('download'), btn(page, 'CSV ファイルを保存').click()]);
const csv = readFileSync(await dl2.path(), 'utf8');
assert.ok(csv.startsWith('Title,URL,Username,Password,Notes,OTPAuth') && csv.includes(SECRET));
step('平文の書き出しは再認証後にのみ可能');

// マスターパスワード変更
await btn(page, '戻る').click();
await btn(page, 'マスターパスワードを変更').click();
const NEW = 'りんご-バス-星-ノート-91';
await page.getByLabel('今のマスターパスワード').fill(MASTER);
await page.getByLabel('新しいマスターパスワード').fill(NEW);
await page.getByLabel('もう一度入力').fill(NEW);
page.once('dialog', (d) => d.accept());
await btn(page, '変更する').click();
await page.getByText('前回のバックアップ', { exact: false }).waitFor();
await btn(page, '一覧').click();
await btn(page, 'ロック').click();
await page.getByLabel('マスターパスワード').fill(MASTER);
await btn(page, '開く').click();
await page.getByText('パスワードが違います').waitFor();
await page.getByLabel('マスターパスワード').fill(NEW);
await btn(page, '開く').click();
await page.getByText('Example <script>', { exact: false }).waitFor();
step('マスターパスワードを変更すると、古いものでは開けない');

// 別の端末（PC）でバックアップを閲覧
const other = await newPage();
await other.page.goto(BASE);
await other.page.getByText('新しく始める').waitFor();
const chooser = other.page.waitForEvent('filechooser');
await btn(other.page, 'バックアップを開いて見るだけ（保存しない）').click();
await (await chooser).setFiles(backupPath);
await other.page.getByLabel('バックアップ作成時のマスターパスワード').fill(MASTER);
await btn(other.page, '開く').click();
await other.page.getByText('閲覧モード', { exact: false }).waitFor();
await other.page.getByText('Example <script>', { exact: false }).waitFor();
assert.equal(await btn(other.page, '追加').count(), 0);
await shot(other.page, '08-viewer');
const otherStored = await other.page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('passvault');
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => {
    const g = r.result.transaction('kv').objectStore('kv').get('vault');
    g.onsuccess = () => res(g.result ?? null);
  };
}));
assert.equal(otherStored, null, '閲覧モードでは保存しない');
step('別端末でバックアップを閲覧でき、閲覧モードでは何も保存しない');

// アプリを離れたときの猶予
const setHidden = (p, hidden) => p.evaluate((hidden) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
  delete document.hidden;
}, hidden);
await btn(page, '設定').click();
await page.getByLabel('アプリを離れたとき').selectOption('60');
await page.getByText('変更しました').waitFor();
await btn(page, '一覧').click();
await page.getByText('Example <script>', { exact: false }).first().click();
await btn(page, '表示').click();
await page.getByText(SECRET).waitFor();
await setHidden(page, true);
assert.equal(await page.getByText(SECRET).count(), 0, '離れている間は中身を隠す');
await shot(page, '09-cover');
await setHidden(page, false);
await page.getByText(SECRET).waitFor();
step('猶予 1 分：離れている間は隠し、戻ると解除なしで続きから使える');
await btn(page, '一覧').click();
await btn(page, '設定').click();
await page.getByLabel('アプリを離れたとき').selectOption('0');
await page.getByText('変更しました').waitFor();
await btn(page, '一覧').click();

// Face ID（PRF 対応の仮想認証器で代用）
const cdp = await ctx.newCDPSession(page);
await cdp.send('WebAuthn.enable');
const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: {
    protocol: 'ctap2',
    transport: 'internal',
    hasResidentKey: true,
    hasUserVerification: true,
    isUserVerified: true,
    hasPrf: true,
    automaticPresenceSimulation: true,
  },
});
await btn(page, '設定').click();
await btn(page, 'Face ID を有効にする').click();
await page.getByLabel('マスターパスワード（確認）').fill('wrong');
await btn(page, '確認する').click();
await page.getByText('マスターパスワードが違います').waitFor();
await page.getByLabel('マスターパスワード（確認）').fill(NEW);
await btn(page, '確認する').click();
await btn(page, 'Face ID を登録する').click();
await page.getByText('有効です', { exact: false }).waitFor();
await shot(page, '10-faceid-settings');
const bioStored = await page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('passvault');
  r.onsuccess = () => {
    const g = r.result.transaction('kv').objectStore('kv').get('bio');
    g.onsuccess = () => res(g.result ?? null);
  };
}));
assert.ok(bioStored && bioStored.credId && bioStored.wrap.ct, 'Face ID 用の包んだ鍵が保存される');
step('マスターパスワードの確認後に Face ID を登録できる');

await btn(page, '一覧').click();
// 今の一覧に印を付け、ロック → Face ID 解除で「新しい一覧」が描かれることを確認する
await page.evaluate(() => { document.querySelector('.list').dataset.old = '1'; });
await btn(page, 'ロック').click();
await page.locator('.list:not([data-old])').waitFor();
await page.getByText('Example <script>', { exact: false }).waitFor();
step('ロック画面で自動的に Face ID が求められ、通れば開く');

// Face ID が失敗したらマスターパスワードで開ける
await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false });
await btn(page, 'ロック').click();
await btn(page, 'Face ID で開く').waitFor();
await shot(page, '11-faceid-unlock');
await btn(page, 'Face ID で開く').click();
await page.getByText('Face ID で開けませんでした', { exact: false }).waitFor();
await page.getByLabel('またはマスターパスワードで開く').fill(NEW);
await btn(page, '開く').click();
await page.getByText('Example <script>', { exact: false }).waitFor();
step('Face ID に失敗したときはマスターパスワードで開ける');

// 無効化
await btn(page, '設定').click();
await btn(page, 'Face ID を無効にする').click();
await btn(page, 'Face ID を有効にする').waitFor();
await btn(page, '一覧').click();
step('Face ID を無効にできる');

// 連続失敗で待ち時間
await btn(page, 'ロック').click();
for (let i = 0; i < 5; i++) {
  await page.getByLabel('マスターパスワード').fill(`bad-${i}`);
  await btn(page, '開く').click();
  await page.waitForTimeout(700);
}
await page.getByText('秒待ってください', { exact: false }).waitFor();
assert.ok(await btn(page, '開く').isDisabled());
step('5 回失敗すると待ち時間がかかる');

// 電話番号の移行：電話番号の欄が無かった頃の形式のバックアップを復元すると、メモの番号がコピーされる
const { createVault } = await import('../src/vault.ts');
const oldPayload = {
  entries: [
    { id: 'old1', kind: 'login', title: '旧データ', username: 'old@example.com', password: 'pw', url: '', note: '窓口 0120-123-456\n担当 田中', createdAt: 1, updatedAt: 1 },
    { id: 'tw1', kind: 'login', title: 'Twitter（趣味）', username: 'tw@example.com', password: 'twpw', url: '', note: '', createdAt: 1, updatedAt: 1 },
    { id: 'x1', kind: 'login', title: 'X（仕事用）', username: 'x@example.com', password: 'xpw', url: '', note: '', createdAt: 1, updatedAt: 1 },
    { id: 'ig1', kind: 'login', title: 'Instagram', username: 'ig@example.com', password: 'igpw', url: '', note: '', createdAt: 1, updatedAt: 1 },
    { id: 'xs1', kind: 'login', title: 'Xserver', username: 'xs', password: 'xspw', url: '', note: '', createdAt: 1, updatedAt: 1 },
  ],
  settings: { autoLockMinutes: 3, clipboardClearSeconds: 30, relockGraceSeconds: 0 },
  modifiedAt: 1,
  lastBackupAt: null,
};
const { file: oldFile } = await createVault(MASTER, oldPayload);
const oldPath = join(tmpdir(), 'passvault-e2e-old.json');
writeFileSync(oldPath, JSON.stringify(oldFile));
const third = await newPage();
await third.page.goto(BASE);
const chooser3 = third.page.waitForEvent('filechooser');
await btn(third.page, 'バックアップから復元する').click();
await (await chooser3).setFiles(oldPath);
await third.page.getByLabel('バックアップ作成時のマスターパスワード').fill(MASTER);
await btn(third.page, '復元する').click();
await third.page.getByText('電話番号を 1 件', { exact: false }).waitFor();
await third.page.getByText('Twitter・Instagram の 3 件を SNS に移しました', { exact: false }).waitFor();
assert.ok((await third.page.getByLabel('表示').locator('option[value="sns"]').textContent()).includes('SNS（3）'), 'SNS が 3 件');
await third.page.getByLabel('表示').selectOption('sns');
for (const t of ['Twitter（趣味）', 'X（仕事用）', 'Instagram']) await third.page.locator('.list .name', { hasText: t }).first().waitFor();
assert.equal(await third.page.locator('.list .name').count(), 3, 'SNS で絞り込むと 3 件');
assert.equal(await third.page.getByText('Xserver').count(), 0, 'Xserver は SNS にしない');
await shot(third.page, '21-sns-migrated');
await third.page.getByLabel('表示').selectOption('all');
await third.page.getByText('旧データ').click();
await third.page.getByText('0120-123-456').first().waitFor();
assert.equal(await third.page.locator('.detail-row', { hasText: '電話番号' }).count(), 1, '電話番号の欄に入っている');
assert.ok(await third.page.getByText('担当 田中', { exact: false }).isVisible(), 'メモはそのまま');
await shot(third.page, '19-phone-migrated');
// もう一度ロック → 解除しても、再びコピーの通知は出ない（1 回だけ）
await third.page.locator('#toast.show').waitFor({ state: 'detached' });
await btn(third.page, '一覧').click();
await btn(third.page, 'ロック').click();
await third.page.getByLabel('マスターパスワード').fill(MASTER);
await btn(third.page, '開く').click();
await third.page.getByText('旧データ').waitFor();
await third.page.waitForTimeout(500);
assert.equal(await third.page.locator('#toast.show', { hasText: '件' }).count(), 0, '移行は 1 回だけ');
await third.page.getByText('旧データ').click();
await third.page.locator('.detail-row', { hasText: '電話番号' }).waitFor();
step('旧形式のデータ：メモの電話番号をコピー、Twitter・X・Instagram を SNS に移す（1 回だけ）');

const all = [...problems, ...other.problems, ...third.problems].filter((p) => !p.includes('favicon'));
assert.deepEqual(all, [], 'コンソールエラー・CSP 違反なし');
step('コンソールエラー・CSP 違反なし');

await browser.close();
console.log('E2E OK');
