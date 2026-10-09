// public/ と src/ から、GitHub Pages で配信する docs/ を作る。
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';

const out = 'docs';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync('public', out, { recursive: true });

const common = { bundle: true, target: ['safari16'], legalComments: 'eof', logLevel: 'warning' };

// バージョン：画面に出すのは package.json の番号（メジャー.マイナー.パッチ、手動で上げる）。
// 端末に保存したファイルの更新の合図には、中身のハッシュを付けたビルド ID を使う（上げ忘れても必ず更新される）。
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;

// 1) アプリ本体
const app = await build({
  ...common,
  entryPoints: ['src/main.ts'],
  format: 'iife',
  minify: true,
  write: false,
  define: { __APP_VERSION__: JSON.stringify(version) },
});
const appJs = app.outputFiles[0].text;
writeFileSync(`${out}/app.js`, appJs);

const hash = createHash('sha256');
hash.update(appJs);
for (const f of readdirSync('public').sort()) hash.update(f).update(readFileSync(`public/${f}`));
const buildId = `${version}+${hash.digest('hex').slice(0, 10)}`;

// 2) Service Worker（保存するファイルの一覧を埋め込む）
const precache = ['./', ...readdirSync(out).filter((f) => f !== 'sw.js').map((f) => `./${f}`)];
await build({
  ...common,
  entryPoints: ['src/sw.ts'],
  format: 'iife',
  minify: true,
  outfile: `${out}/sw.js`,
  define: { __BUILD_ID__: JSON.stringify(buildId), __PRECACHE__: JSON.stringify(precache) },
});

// GitHub Pages の Jekyll 処理を止める
writeFileSync(`${out}/.nojekyll`, '');

console.log(`built ${out}/ version ${version} (build ${buildId})`);
for (const f of readdirSync(out)) console.log(`  ${f}`);
