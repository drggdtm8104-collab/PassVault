// public/ と src/ から、GitHub Pages で配信する docs/ を作る。
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';

const out = 'docs';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync('public', out, { recursive: true });

const common = { bundle: true, target: ['safari16'], legalComments: 'eof', logLevel: 'warning' };

// 1) アプリ本体（バージョンは中身のハッシュで決める）
const app = await build({
  ...common,
  entryPoints: ['src/main.ts'],
  format: 'iife',
  minify: true,
  write: false,
  define: { __APP_VERSION__: '"__VERSION__"' },
});
let appJs = app.outputFiles[0].text;

const hash = createHash('sha256');
hash.update(appJs);
for (const f of readdirSync('public').sort()) hash.update(f).update(readFileSync(`public/${f}`));
const version = `${JSON.parse(readFileSync('package.json', 'utf8')).version}+${hash.digest('hex').slice(0, 10)}`;
appJs = appJs.replaceAll('__VERSION__', version);
writeFileSync(`${out}/app.js`, appJs);

// 2) Service Worker（保存するファイルの一覧を埋め込む）
const precache = ['./', ...readdirSync(out).filter((f) => f !== 'sw.js').map((f) => `./${f}`)];
await build({
  ...common,
  entryPoints: ['src/sw.ts'],
  format: 'iife',
  minify: true,
  outfile: `${out}/sw.js`,
  define: { __APP_VERSION__: JSON.stringify(version), __PRECACHE__: JSON.stringify(precache) },
});

// GitHub Pages の Jekyll 処理を止める
writeFileSync(`${out}/.nojekyll`, '');

console.log(`built ${out}/ version ${version}`);
for (const f of readdirSync(out)) console.log(`  ${f}`);
