// 配布用のページを作る：index.html・customize.html・export.html と、app/ の中身。
//
//   node tools/build-site.ts [--check]
//
// できたものは、次のどちらでも動く。インストールも開発サーバーも要らない。
//   - リポジトリの ZIP を解凍して、index.html をダブルクリックで開く（file://）
//   - GitHub Pages などに、そのまま置く
//
// ファイルを直接開いたとき、ブラウザはモジュールの読み込み・fetch・画像の画素の読み取りを制限する。
// そのため、スクリプトはモジュールではない形にまとめ、素材（JSON と画像）は app/assets.js に埋め込む。
//
// 生成物は手で編集しない。src/app/・src/web/・src/core/・素材を変えたら、作り直してコミットする。
// --check を付けると、生成物だけを別のフォルダへ写し、ヘッドレスの Chrome / Edge で index.html を
// ファイルとして開いて、3 つのページを通して動くことを確かめる。

import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { Page, launchBrowser } from './cdp.ts';

const ASSET_ROOT = 'assets';
const SET = 'development';
const PAGES: [file: string, page: string, title: string][] = [
  ['index.html', 'create', 'InvestiMaker'],
  ['customize.html', 'customize', 'InvestiMaker — カスタマイズ'],
  ['export.html', 'export', 'InvestiMaker — 画像を書き出す'],
];

// ---- 素材を集める（JSON はそのまま、画像は data URL にする）
const embedded: Record<string, unknown> = {};
for (const entry of readdirSync(`${ASSET_ROOT}/${SET}`, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const path = `${entry.parentPath.replaceAll('\\', '/')}/${entry.name}`;
  const key = path.slice(ASSET_ROOT.length + 1);
  if (entry.name.endsWith('.json')) embedded[key] = JSON.parse(readFileSync(path, 'utf8'));
  else if (entry.name.endsWith('.png')) embedded[key] = `data:image/png;base64,${readFileSync(path).toString('base64')}`;
}

// ---- Creator UI を 1 つのスクリプトにまとめる（モジュールではない形）
const result = await build({
  configFile: false,
  base: './',
  logLevel: 'error',
  publicDir: false,
  build: {
    write: false,
    cssCodeSplit: false,
    rollupOptions: { input: 'src/app/main.ts', output: { format: 'iife' } },
  },
});
const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => ('output' in r ? r.output : []));
const script = outputs.find((o) => o.type === 'chunk');
const style = outputs.find((o) => o.type === 'asset' && o.fileName.endsWith('.css'));
if (!script || script.type !== 'chunk' || !style || style.type !== 'asset') throw new Error('ビルドの出力が想定と違う');

const files: Record<string, string> = {
  'app/investimaker.js': `/* tools/build-site.ts が生成したファイル。手で編集しない。 */\n${script.code}`,
  'app/investimaker.css': `/* tools/build-site.ts が生成したファイル。手で編集しない。 */\n${String(style.source)}`,
  'app/assets.js': `/* tools/build-site.ts が生成したファイル。手で編集しない。素材（assets/${SET}）を埋め込んだもの。 */\nwindow.__INVESTIMAKER_ASSETS__ = ${JSON.stringify(embedded)};\n`,
};
// 内容が変わったら、ブラウザや GitHub Pages が古いファイルを使い続けないよう、印を付けて読む。
const stamp = (name: string) => createHash('sha256').update(files[name]!).digest('hex').slice(0, 10);

for (const [file, page, title] of PAGES) {
  files[file] = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <!-- tools/build-site.ts が生成したファイル。手で編集しない（npm run build:site で作り直す）。 -->
    <link rel="stylesheet" href="app/investimaker.css?v=${stamp('app/investimaker.css')}" />
  </head>
  <body data-page="${page}">
    <div id="app"></div>
    <script src="app/assets.js?v=${stamp('app/assets.js')}"></script>
    <script src="app/investimaker.js?v=${stamp('app/investimaker.js')}"></script>
  </body>
</html>
`;
}

mkdirSync('app', { recursive: true });
for (const [name, content] of Object.entries(files)) writeFileSync(name, content);
const size = Object.values(files).reduce((sum, c) => sum + c.length, 0);
console.log(`${Object.keys(files).join('、')}（合計 ${(size / 1024).toFixed(0)} KB、素材 ${Object.keys(embedded).length} ファイルを埋め込み）`);

// ---- 生成物だけを別のフォルダへ写し、ファイルとして開いて確かめる
if (process.argv.includes('--check')) {
  const alone = mkdtempSync(join(tmpdir(), 'investimaker-site-'));
  for (const name of Object.keys(files)) cpSync(name, join(alone, name));
  const browser = await launchBrowser();
  try {
    const page = await Page.open(browser.cdp, pathToFileURL(resolve(alone, 'index.html')).href, [1280, 800]);
    /** ページが移り終わって、Creator UI が使えるようになるまで待つ。 */
    const ready = async (file: string) => {
      for (let attempt = 0; ; attempt++) {
        try {
          await page.evaluate('new Promise((r) => setTimeout(r, 200))');
          const at = await page.evaluate<string>(`window.__creator ? location.pathname.split('/').pop() : ''`);
          if (at === file) return;
        } catch {
          // 移動中は評価が中断される。待ち直す。
        }
        if (attempt >= 40) throw new Error(`${file} が開かない`);
      }
    };
    const run = (expression: string) => page.evaluate<unknown>(expression);
    const click = (selector: string) => run(`document.querySelector(${JSON.stringify(selector)}).click()`);

    await ready('index.html');
    await run(`(() => { const el = document.querySelector('[data-create="name"]'); el.value = '夢生ツムグ'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await click('[data-action="start"]');
    await ready('customize.html');
    await click('[data-card="dev.hair_front_02"]');
    await run('window.__creator.idle()');
    await click('[data-step="export"]');
    await ready('export.html');
    await run('window.__creator.idle()');
    await click('[data-action="export"]');
    await run('new Promise((r) => setTimeout(r, 200))');
    const state = (await run(`({
      name: window.__creator.character.name,
      drawn: window.__creator.inspection.drawn,
      hair: window.__creator.character.equipment.some((i) => i.partId === 'dev.hair_front_02' && i.equipped),
      png: (window.__creator.hooks.lastPng || '').length,
      broken: [...document.images].filter((i) => i.naturalWidth === 0).length,
    })`)) as { name: string; drawn: number; hair: boolean; png: number; broken: number };
    if (state.name !== '夢生ツムグ' || state.drawn === 0 || !state.hair || state.png < 1000 || state.broken > 0) {
      throw new Error(`配布用のページが動かない: ${JSON.stringify(state)}`);
    }
    console.log(`確認：生成物だけを別のフォルダに置き、index.html → customize.html → export.html と移って、表示（${state.drawn} 枚）と PNG の書き出しができる`);
    await page.close();
  } finally {
    await browser.close();
    rmSync(alone, { recursive: true, force: true });
  }
}
