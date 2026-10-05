// 配布物を、リポジトリのルートへ書く：index.html・customize.html・export.html と、app/ の中身。
//
//   node tools/build-site.ts
//
// リポジトリのルートが、そのまま配布物になる（リポジトリの ZIP を解凍して index.html を開く／GitHub Pages に置く）。
// 生成物は手で編集しない。src/app/・src/web/・src/core/・素材を変えたら、作り直してコミットする。
// 作ったものが実際に動くことは、tools/dist-smoke.ts（npm run smoke:dist）で確かめる。

import { mkdirSync, writeFileSync } from 'node:fs';
import { buildDistribution } from './distribution.ts';

const files = await buildDistribution();
mkdirSync('app', { recursive: true });
for (const [name, content] of Object.entries(files)) writeFileSync(name, content);
const size = Object.values(files).reduce((sum, c) => sum + Buffer.byteLength(c), 0);
console.log(`${Object.keys(files).join('、')}（合計 ${(size / 1024).toFixed(0)} KB）`);
