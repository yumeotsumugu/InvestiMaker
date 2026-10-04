// §13-3 の実測用画像を書き出す。A チャンネルに値を入れた「Mask」を想定し、
// RGB に 0〜255 の全値、行ごとに異なるアルファを持たせる。
//
//   node tools/generate-probe.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { PROBE_ALPHAS, PROBE_WIDTH, probePixel } from '../src/lab/probe-pattern.ts';
import { encodePng } from './png.ts';

const height = PROBE_ALPHAS.length;
const rgba = new Uint8ClampedArray(PROBE_WIDTH * height * 4);
for (let row = 0; row < height; row++) {
  for (let x = 0; x < PROBE_WIDTH; x++) {
    rgba.set(probePixel(x, row), (row * PROBE_WIDTH + x) * 4);
  }
}
mkdirSync('assets/probe', { recursive: true });
writeFileSync('assets/probe/mask_alpha_probe.png', encodePng(PROBE_WIDTH, height, rgba));
console.log(`assets/probe/mask_alpha_probe.png: ${PROBE_WIDTH}×${height}`);
