// 配布用の index.html を作る（Creator UI と仮素材を 1 つの HTML にまとめたもの）。
//
//   node tools/build-standalone.ts [--check]
//
// この 1 ファイルだけで動く。ダブルクリックで開けばよく、インストールも開発サーバーも要らない。
// ほかのファイルを参照しないので、index.html だけを人に渡しても使える。
// --check を付けると、index.html だけを別のフォルダへ写し、ヘッドレスの Chrome / Edge でファイルとして開いて確かめる。
//
// src/app/ や素材を変えたら、作り直すこと（内容は自動では更新されない）。

import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { Page, launchBrowser } from './cdp.ts';

const ASSET_ROOT = 'assets';
const SET = 'development';
const OUT = 'index.html';

// ---- 素材を集める（JSON はそのまま、画像は data URL にする）
const embedded: Record<string, unknown> = {};
for (const entry of readdirSync(`${ASSET_ROOT}/${SET}`, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const path = `${entry.parentPath.replaceAll('\\', '/')}/${entry.name}`;
  const key = path.slice(ASSET_ROOT.length + 1);
  if (entry.name.endsWith('.json')) embedded[key] = JSON.parse(readFileSync(path, 'utf8'));
  else if (entry.name.endsWith('.png')) embedded[key] = `data:image/png;base64,${readFileSync(path).toString('base64')}`;
}

// ---- Creator UI を 1 つのスクリプトにまとめる（モジュールではない形にする）
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

/** `</script>` が途中に現れても、そこで script 要素が終わらないようにする。 */
const inline = (text: string) => text.replaceAll('</script', '<\\/script');

const html = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>InvestiMaker</title>
    <!-- tools/build-standalone.ts が生成したファイル。手で編集しない（npm run build:standalone で作り直す）。
         この 1 ファイルだけで動く。開発用の入口は dev.html。 -->
    <style>${String(style.source)}</style>
  </head>
  <body>
    <div id="app"></div>
    <script>window.__INVESTIMAKER_ASSETS__ = ${inline(JSON.stringify(embedded))};</script>
    <script>${inline(script.code)}</script>
  </body>
</html>
`;
writeFileSync(OUT, html);
console.log(`${OUT}: ${(html.length / 1024).toFixed(0)} KB（素材 ${Object.keys(embedded).length} ファイルを埋め込み）`);

// ---- ファイルとして開いて確かめる
if (process.argv.includes('--check')) {
  const browser = await launchBrowser();
  try {
    // index.html だけを別のフォルダへ写して開く（ほかのファイルに頼っていないことを確かめる）。
    const alone = mkdtempSync(join(tmpdir(), 'investimaker-alone-'));
    copyFileSync(OUT, join(alone, 'index.html'));
    const page = await Page.open(browser.cdp, `${pathToFileURL(resolve(alone, 'index.html')).href}?notices=side`, [1280, 800]);
    // 単体版へ移る間は評価が中断されるので、移り終わるまで待ち直す。
    for (let attempt = 0; ; attempt++) {
      try {
        await page.evaluate('new Promise((r) => setTimeout(r, 300))');
        await page.waitFor('__creator');
        break;
      } catch (e) {
        if (attempt >= 20) throw e;
      }
    }
    const run = (expression: string) => page.evaluate<unknown>(expression);
    const settle = async () => {
      await run('window.__creator.idle()');
      await run('new Promise((r) => setTimeout(r, 50))');
      await run('window.__creator.idle()');
    };
    await run(`document.querySelector('[data-action="start"]').click()`);
    await settle();
    await run(`document.querySelector('[data-card="dev.hair_front_02"]').click()`);
    await settle();
    await run(`document.querySelector('[data-step="export"]').click()`);
    await run(`document.querySelector('[data-action="export"]').click()`);
    await settle();
    const state = (await run(`({
      url: location.href,
      drawn: window.__creator.inspection.drawn,
      equipped: window.__creator.character.equipment.filter((i) => i.equipped).length,
      thumbs: [...document.images].filter((i) => i.naturalWidth === 0).length,
      png: (window.__creator.hooks.lastPng || '').length,
      notices: document.querySelector('#app').dataset.notices,
    })`)) as { url: string; drawn: number; equipped: number; thumbs: number; png: number; notices: string };
    if (state.drawn === 0 || state.thumbs > 0 || state.png < 1000 || state.notices !== 'side') {
      throw new Error(`単体版が動かない: ${JSON.stringify(state)}`);
    }
    console.log(`確認：index.html だけを別のフォルダに置いて開いても、キャラクターの表示（${state.drawn} 枚）と PNG の書き出しができる`);
    await page.close();
    rmSync(alone, { recursive: true, force: true });
  } finally {
    await browser.close();
  }
}
