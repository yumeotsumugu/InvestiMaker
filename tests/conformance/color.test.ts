// 仕様書 §13.1 Core 適合：色計算は参照ベクタと完全に一致する。入力は fixtures/color/vectors.json。

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ColorMode, MaskInput } from '../../src/core/index.ts';
import { parseHex, recolor } from '../../src/core/index.ts';

interface Channel {
  mode: ColorMode;
  color: string;
}
interface Vector {
  base: number[];
  masks: { pixel: number[]; channels: { r?: Channel; g?: Channel; b?: Channel } }[];
  expect: number[];
}

const { vectors } = JSON.parse(
  readFileSync(new URL('./fixtures/color/vectors.json', import.meta.url), 'utf8'),
) as { vectors: Vector[] };

const toInput = (m: Vector['masks'][number]): MaskInput => {
  const of = (c?: Channel) => (c ? { mode: c.mode, color: parseHex(c.color) } : null);
  return { data: m.pixel, channels: [of(m.channels.r), of(m.channels.g), of(m.channels.b)] };
};

describe('§5.3 色計算の参照ベクタ', () => {
  it('ベクタが揃っている', () => {
    expect(vectors.length).toBeGreaterThan(500);
  });

  it('すべてのベクタで結果が完全に一致する', () => {
    for (const v of vectors) {
      const out = recolor(v.base, v.masks.map(toInput), new Uint8ClampedArray(4));
      expect([...out], JSON.stringify(v)).toEqual(v.expect);
    }
  });

  it('下地 #808080・適用率 255 の tint は、どのベクタでも指定色そのもの', () => {
    const exact = vectors.filter(
      (v) => v.masks.length === 1 && v.base.join() === '128,128,128,255' && v.masks[0]!.pixel[0] === 255 && v.masks[0]!.channels.r?.mode === 'tint' && !v.masks[0]!.channels.b,
    );
    expect(exact.length).toBeGreaterThan(0);
    for (const v of exact) expect(v.expect.slice(0, 3)).toEqual([...parseHex(v.masks[0]!.channels.r!.color)]);
  });
});
