// 仕様書 §5.3 の合成式を固定する。

import { describe, expect, it } from 'vitest';
import type { ChannelColor, ColorMode, RGB } from '../../src/core/index.ts';
import { minimalPart } from '../helpers.ts';
import { maskChannelColors, parseHex, recolor, resolveSlotColor, toHex } from '../../src/core/index.ts';

/** 1 画素を、R チャンネルの適用率 `w`（0–255）で色変更する。 */
function one(base: readonly number[], color: string, w: number, mode: ColorMode = 'tint'): number[] {
  const ch: ChannelColor = { mode, color: parseHex(color) };
  const out = recolor(base, [{ data: [w, 0, 0, 255], channels: [ch, null, null] }], new Uint8ClampedArray(4));
  return [...out];
}

const GRAY = [128, 128, 128, 255];
const COLORS = ['#3A3F4B', '#F2D3BD', '#000000', '#FFFFFF', '#FF0040', '#0A64C8', '#010203'];

describe('tint', () => {
  it('下地 #808080 では指定色そのものになる', () => {
    for (const color of COLORS) {
      expect(one(GRAY, color, 255)).toEqual([...parseHex(color), 255]);
    }
  });

  it('下地が黒なら黒', () => {
    for (const color of COLORS) expect(one([0, 0, 0, 255], color, 255)).toEqual([0, 0, 0, 255]);
  });

  it('下地が白なら白', () => {
    for (const color of COLORS) expect(one([255, 255, 255, 255], color, 255)).toEqual([255, 255, 255, 255]);
  });

  it('下地が暗い部分は影になる（指定色 × L / 基準）', () => {
    // L = 64/255、基準 128/255 → 指定色のちょうど半分
    expect(one([64, 64, 64, 255], '#C86432', 255)).toEqual([100, 50, 25, 255]);
  });

  it('下地が明るい部分はハイライトになる（指定色から白へ）', () => {
    // t = (192 − 128) / (255 − 128) = 64/127。R: 200 + 55 × 64/127 = 227.7
    expect(one([192, 192, 192, 255], '#C86432', 255)).toEqual([228, 178, 153, 255]);
  });

  it('明度は 0.2126 R + 0.7152 G + 0.0722 B で求める', () => {
    // 純粋な緑 (0, 128, 0)：L = 0.7152 × 128/255 → k = 0.7152
    expect(one([0, 128, 0, 255], '#FFFFFF', 255)).toEqual([182, 182, 182, 255]);
  });
});

describe('適用率', () => {
  it('0 なら元色のまま', () => {
    expect(one([90, 120, 30, 255], '#FF0040', 0)).toEqual([90, 120, 30, 255]);
  });

  it('50% なら元色と合成色の中間', () => {
    // w = 128/255。R: 128 × (1 − w) + 255 × w = 191.75
    expect(one(GRAY, '#FF0000', 128)).toEqual([192, 64, 64, 255]);
  });

  it('アルファは変化しない', () => {
    for (const alpha of [1, 37, 128, 254, 255]) {
      for (const mode of ['tint', 'multiply', 'fixed'] as const) {
        expect(one([128, 128, 128, alpha], '#FF0040', 200, mode)[3]).toBe(alpha);
      }
    }
  });

  it('アルファ 0 の画素は触らない', () => {
    expect(one([12, 34, 56, 0], '#FF0040', 255)).toEqual([12, 34, 56, 0]);
  });

  it('複数チャンネルは適用率で混ざる', () => {
    const red: ChannelColor = { mode: 'tint', color: [255, 0, 0] };
    const blue: ChannelColor = { mode: 'tint', color: [0, 0, 255] };
    const out = recolor(GRAY, [{ data: [51, 0, 102, 255], channels: [red, null, blue] }], new Uint8ClampedArray(4));
    // w_r = 0.2、w_b = 0.4、残り 0.4 は元色
    expect([...out]).toEqual([Math.round(128 * 0.4 + 255 * 0.2), Math.round(128 * 0.4), Math.round(128 * 0.4 + 255 * 0.4), 255]);
  });

  it('Mask を複数枚持つ Asset（masks）は全チャンネルを合算する', () => {
    const red: ChannelColor = { mode: 'tint', color: [255, 0, 0] };
    const blue: ChannelColor = { mode: 'tint', color: [0, 0, 255] };
    const out = recolor(
      GRAY,
      [
        { data: [51, 0, 0, 255], channels: [red, null, null] },
        { data: [102, 0, 0, 255], channels: [blue, null, null] },
      ],
      new Uint8ClampedArray(4),
    );
    expect([...out]).toEqual([Math.round(128 * 0.4 + 255 * 0.2), Math.round(128 * 0.4), Math.round(128 * 0.4 + 255 * 0.4), 255]);
  });

  it('適用率の合計が 1 を超えたら比例配分で 1 に収める', () => {
    const red: ChannelColor = { mode: 'tint', color: [255, 0, 0] };
    const blue: ChannelColor = { mode: 'tint', color: [0, 0, 255] };
    const out = recolor(GRAY, [{ data: [255, 0, 255, 255], channels: [red, null, blue] }], new Uint8ClampedArray(4));
    expect([...out]).toEqual([128, 0, 128, 255]);
  });
});

describe('multiply / fixed', () => {
  it('multiply は B × C', () => {
    expect(one([255, 255, 255, 255], '#C86432', 255, 'multiply')).toEqual([200, 100, 50, 255]);
    expect(one(GRAY, '#C86432', 255, 'multiply')).toEqual([100, 50, 25, 255]);
  });

  it('fixed は色変更しない', () => {
    expect(one([90, 120, 30, 255], '#FF0040', 255, 'fixed')).toEqual([90, 120, 30, 255]);
  });
});

describe('色の表記', () => {
  it('#RRGGBB を往復できる', () => {
    const rgb: RGB = parseHex('#3a3F4b');
    expect(rgb).toEqual([58, 63, 75]);
    expect(toHex(rgb)).toBe('#3A3F4B');
    expect(() => parseHex('#FFF')).toThrow();
  });
});

describe('共有カラー（§5.4）', () => {
  const linked = { id: 'skin', mode: 'tint' as const, default: '#F2D3BD', link: 'skin.base' };
  const plain = { id: 'main', mode: 'tint' as const, default: '#3A3F4B' };

  it('link を持つスロットは既定で共有色に従う', () => {
    expect(resolveSlotColor(linked, undefined, { 'skin.base': '#8D5524' })).toBe('#8D5524');
    expect(resolveSlotColor(linked, { color: '#111111' }, { 'skin.base': '#8D5524' })).toBe('#8D5524');
  });

  it('未定義のキーを参照した場合は default を使う', () => {
    expect(resolveSlotColor(linked, undefined, {})).toBe('#F2D3BD');
  });

  it('リンクを解除すると個別色になる', () => {
    expect(resolveSlotColor(linked, { linked: false, color: '#111111' }, { 'skin.base': '#8D5524' })).toBe('#111111');
    expect(resolveSlotColor(linked, { linked: false }, { 'skin.base': '#8D5524' })).toBe('#F2D3BD');
  });

  it('link を持たないスロットは個別色、なければ default', () => {
    expect(resolveSlotColor(plain, { color: '#111111' }, {})).toBe('#111111');
    expect(resolveSlotColor(plain, undefined, {})).toBe('#3A3F4B');
  });

  it('Mask のチャンネルにスロットのモードと色を割り当てる', () => {
    const part = minimalPart({
      colorSlots: [plain, { id: 'logo', mode: 'fixed', default: '#FFFFFF' }],
    });
    const mask = { file: 'assets/front/main.mask.png', channels: { r: 'main', b: 'logo' } };
    expect(maskChannelColors(part, mask, { main: '#102030' })).toEqual([
      { mode: 'tint', color: [16, 32, 48] },
      null,
      { mode: 'fixed', color: [255, 255, 255] },
    ]);
    // 比較用のモード差し替えは fixed には効かない
    expect(maskChannelColors(part, mask, {}, 'multiply').map((c) => c?.mode)).toEqual(['multiply', undefined, 'fixed']);
  });
});
