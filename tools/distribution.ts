// 配布物（利用者に渡すファイル一式）を、ソースから組み立てる。
//
// 配布物は 1 種類だけである。同じファイルが、次のどちらでも動く（基本設計書 v1.0 §2）。
//   - ZIP を解凍して、index.html をダブルクリックで開く（file://）
//   - GitHub Pages などの静的ホスティングに、そのまま置く
//
// ファイルを直接開いたとき、ブラウザはモジュールの読み込み・fetch・画像の画素の読み取りを制限する。
// そのため、スクリプトはモジュールではない形にまとめ、素材（JSON と画像）は app/assets.js に埋め込む。
// 開発用のページ（dev/ の最小 UI・検証ページ）は、配布物に入れない。
//
// ここはファイルを書かない。書く先は呼び出し側が決める：
//   tools/build-site.ts  … リポジトリのルートへ書く（リポジトリの ZIP と GitHub Pages が、そのまま配布物になる）
//   tools/dist-smoke.ts  … ZIP にして別のフォルダへ解凍し、動くことを確かめる

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { build } from 'vite';

const ASSET_ROOT = 'assets';
const SET = 'development';
const PAGES: [file: string, page: string, title: string][] = [
  ['index.html', 'create', 'InvestiMaker'],
  ['customize.html', 'customize', 'InvestiMaker — カスタマイズ'],
  ['export.html', 'export', 'InvestiMaker — 画像を書き出す'],
];

/** 配布物のファイル（パス → 内容）。パスは配布物のルートからの相対パス。 */
export type Distribution = Record<string, string>;

export async function buildDistribution(): Promise<Distribution> {
  // ---- 素材を集める（JSON はそのまま、画像は data URL にする）
  const embedded: Record<string, unknown> = {};
  const entries = readdirSync(`${ASSET_ROOT}/${SET}`, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${entry.parentPath.replaceAll('\\', '/')}/${entry.name}`)
    .sort();
  for (const path of entries) {
    const key = path.slice(ASSET_ROOT.length + 1);
    if (path.endsWith('.json')) embedded[key] = JSON.parse(readFileSync(path, 'utf8'));
    else if (path.endsWith('.png')) embedded[key] = `data:image/png;base64,${readFileSync(path).toString('base64')}`;
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

  const files: Distribution = {
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
  return files;
}
