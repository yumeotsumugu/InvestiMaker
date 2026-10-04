// 仮素材を `.impart` を展開した形で書き出す。
//
//   node tools/generate-dev-assets.ts [--width 1600] [--height 2400] [--out assets/development]
//
// 出力先は作り直す（古いファイルを残さない）。

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildIndex, generateDevAssets, serializeSet } from './dev-assets.ts';

function parseArgs(argv: string[]) {
  const args = { width: 1600, height: 2400, out: 'assets/development' };
  for (let i = 0; i < argv.length; i += 2) {
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`値がない: ${argv[i]}`);
    if (argv[i] === '--width') args.width = Number(value);
    else if (argv[i] === '--height') args.height = Number(value);
    else if (argv[i] === '--out') args.out = value;
    else throw new Error(`不明な引数: ${argv[i]}`);
  }
  if (!Number.isInteger(args.width) || !Number.isInteger(args.height) || args.width <= 0 || args.height <= 0) {
    throw new Error('--width と --height は正の整数');
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const started = performance.now();
const set = generateDevAssets(args.width, args.height);

rmSync(args.out, { recursive: true, force: true });
let bytes = 0;
for (const [path, data] of serializeSet(set)) {
  const full = join(args.out, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, data);
  bytes += data.length;
}

const index = buildIndex(set);
console.log(
  `${args.out}: ${set.parts.length} Part、キャンバス ${args.width}×${args.height}、` +
    `画像 ${index.parts.reduce((s, p) => s + p.files, 0)} 枚（${(index.parts.reduce((s, p) => s + p.pixels, 0) / 1e6).toFixed(1)} Mpx）、` +
    `${(bytes / 1024).toFixed(0)} KB、${((performance.now() - started) / 1000).toFixed(1)} 秒`,
);
