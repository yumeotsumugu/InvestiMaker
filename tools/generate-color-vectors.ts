// 色計算（仕様書 §5.3）の参照ベクタを書き出す。Core 適合（§13.1）の確認に使う。
//
//   node tools/generate-color-vectors.ts
//
// 現在の実装の結果を固定するためのもので、式を変えない限り出力は変わらない。
// 式そのものの正しさは tests/core/color.test.ts が手計算の値で確かめている。

import { mkdirSync, writeFileSync } from 'node:fs';
import type { ColorMode } from '../src/core/index.ts';
import { parseHex, recolor } from '../src/core/index.ts';

interface Channel {
  mode: ColorMode;
  color: string;
}
interface Vector {
  /** 元の画素 [R, G, B, A]。 */
  base: number[];
  /** Mask ごとの、画素 [R, G, B, A] とチャンネルの割り当て。 */
  masks: { pixel: number[]; channels: { r?: Channel; g?: Channel; b?: Channel } }[];
  expect: number[];
}

function run(base: number[], masks: Vector['masks']): Vector {
  const out = recolor(
    base,
    masks.map((m) => ({
      data: m.pixel,
      channels: [m.channels.r, m.channels.g, m.channels.b].map((c) => (c ? { mode: c.mode, color: parseHex(c.color) } : null)) as never,
    })),
    new Uint8ClampedArray(4),
  );
  return { base, masks, expect: [...out] };
}

const BASES = [
  [0, 0, 0, 255],
  [64, 64, 64, 255],
  [127, 127, 127, 255],
  [128, 128, 128, 255],
  [129, 129, 129, 255],
  [198, 198, 198, 255],
  [255, 255, 255, 255],
  [42, 38, 48, 255],
  [200, 120, 40, 255],
  [128, 128, 128, 77],
  [128, 128, 128, 0],
];
const COLORS = ['#000000', '#FFFFFF', '#3A3F4B', '#F2D3BD', '#E60033', '#010203'];
const WEIGHTS = [0, 1, 128, 254, 255];

const vectors: Vector[] = [];
for (const base of BASES) {
  for (const color of COLORS) {
    for (const mode of ['tint', 'multiply', 'fixed'] as const) {
      for (const w of mode === 'tint' ? WEIGHTS : [128, 255]) {
        vectors.push(run(base, [{ pixel: [w, 0, 0, 255], channels: { r: { mode, color } } }]));
      }
    }
  }
}
// 複数チャンネル、合計が 255 を超える場合、Mask を複数枚持つ場合。
const red: Channel = { mode: 'tint', color: '#FF0000' };
const blue: Channel = { mode: 'tint', color: '#0000FF' };
const gold: Channel = { mode: 'multiply', color: '#C8A85A' };
for (const base of [[128, 128, 128, 255], [64, 64, 64, 255], [198, 198, 198, 200]]) {
  vectors.push(run(base, [{ pixel: [51, 0, 102, 255], channels: { r: red, b: blue } }]));
  vectors.push(run(base, [{ pixel: [100, 100, 55, 255], channels: { r: red, g: gold, b: blue } }]));
  vectors.push(run(base, [{ pixel: [255, 0, 255, 255], channels: { r: red, b: blue } }]));
  vectors.push(run(base, [{ pixel: [200, 200, 200, 255], channels: { r: red, g: gold, b: blue } }]));
  vectors.push(run(base, [
    { pixel: [51, 0, 0, 255], channels: { r: red } },
    { pixel: [102, 30, 0, 255], channels: { r: blue, g: gold } },
  ]));
}

mkdirSync('tests/conformance/fixtures/color', { recursive: true });
const lines = vectors.map((v) => '    ' + JSON.stringify(v));
writeFileSync(
  'tests/conformance/fixtures/color/vectors.json',
  `{\n  "spec": "§5.3",\n  "vectors": [\n${lines.join(',\n')}\n  ]\n}\n`,
);
console.log(`tests/conformance/fixtures/color/vectors.json: ${vectors.length} 件`);
