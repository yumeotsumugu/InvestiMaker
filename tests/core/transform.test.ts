// 配置補正（Asset Specification §9）：pivot を中心に拡大縮小 → 回転（時計回り）→ 平行移動。

import { describe, expect, it } from 'vitest';
import type { Bitmap, Matrix } from '../../src/core/index.ts';
import { IDENTITY, combineTransforms, compositeOver, compositeTransformed, createBitmap, isIdentity, isNeutral, transformMatrix } from '../../src/core/index.ts';

const CANVAS = [1600, 2400] as const;
const at = (m: Matrix, x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]].map((v) => Math.round(v * 1000) / 1000);

describe('行列', () => {
  it('何も指定しなければ恒等変換', () => {
    expect(isIdentity(transformMatrix({}, CANVAS))).toBe(true);
    expect(transformMatrix({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, pivot: [10, 20] }, CANVAS)).toEqual(IDENTITY);
    expect(isNeutral(undefined) && isNeutral({}) && isNeutral({ pivot: [1, 2] })).toBe(true);
    expect(isNeutral({ x: 1 })).toBe(false);
  });

  it('平行移動', () => {
    expect(at(transformMatrix({ x: 30, y: -40 }, CANVAS), 100, 200)).toEqual([130, 160]);
  });

  it('拡大縮小は pivot を中心にする', () => {
    const m = transformMatrix({ scaleX: 2, scaleY: 0.5, pivot: [100, 100] }, CANVAS);
    expect(at(m, 100, 100)).toEqual([100, 100]);
    expect(at(m, 110, 120)).toEqual([120, 110]);
  });

  it('pivot を省略するとキャンバス中央', () => {
    const m = transformMatrix({ scaleX: 2, scaleY: 2 }, CANVAS);
    expect(at(m, 800, 1200)).toEqual([800, 1200]);
    expect(at(m, 0, 0)).toEqual([-800, -1200]);
  });

  it('回転は度で、画面上の時計回り', () => {
    // 90 度：pivot の右にある点が、pivot の下へ動く（Y は下が正）
    const m = transformMatrix({ rotation: 90, pivot: [100, 100] }, CANVAS);
    expect(at(m, 110, 100)).toEqual([100, 110]);
    expect(at(m, 100, 110)).toEqual([90, 100]);
  });

  it('適用順は 拡大縮小 → 回転 → 平行移動', () => {
    const m = transformMatrix({ x: 5, y: 7, scaleX: 2, scaleY: 1, rotation: 90, pivot: [0, 0] }, CANVAS);
    // (10, 0) → 拡大 (20, 0) → 回転 (0, 20) → 移動 (5, 27)
    expect(at(m, 10, 0)).toEqual([5, 27]);
  });
});

describe('差分としての合成', () => {
  it('位置と回転は加算、拡大縮小は乗算。pivot は後から指定した方', () => {
    expect(combineTransforms({ x: 10, y: 5, scaleX: 2, rotation: 30, pivot: [1, 2] }, { x: 3, scaleX: 1.5, scaleY: 0.5, rotation: -10 })).toEqual({
      x: 13,
      y: 5,
      scaleX: 3,
      scaleY: 0.5,
      rotation: 20,
      pivot: [1, 2],
    });
    expect(combineTransforms({ pivot: [1, 2] }, { pivot: [3, 4] }).pivot).toEqual([3, 4]);
    expect(isNeutral(combineTransforms(undefined, undefined))).toBe(true);
  });
});

describe('ソフトウェア合成への反映', () => {
  const dot = (): Bitmap => {
    const b = createBitmap(2, 2);
    b.data.set([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255]);
    return b;
  };
  const opaque = (b: Bitmap) => {
    const out: string[] = [];
    for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) if (b.data[(y * b.width + x) * 4 + 3] === 255) out.push(`${x},${y}`);
    return out;
  };

  it('整数の平行移動は、置く位置をずらしたのと画素単位で同じ', () => {
    const moved = createBitmap(8, 8);
    compositeTransformed(moved, dot(), 1, 1, transformMatrix({ x: 3, y: 2 }, [8, 8]));
    const placed = createBitmap(8, 8);
    compositeOver(placed, dot(), 4, 3);
    expect([...moved.data]).toEqual([...placed.data]);
  });

  it('2 倍に拡大すると、同じ色が 2×2 の範囲に広がる', () => {
    const out = createBitmap(8, 8);
    compositeTransformed(out, dot(), 2, 2, transformMatrix({ scaleX: 2, scaleY: 2, pivot: [2, 2] }, [8, 8]));
    expect(opaque(out)).toHaveLength(16);
    const px = (x: number, y: number) => [...out.data.subarray((y * 8 + x) * 4, (y * 8 + x) * 4 + 3)];
    // 四隅は元の 4 画素の色のまま（内側の画素は隣の色と補間される）
    expect(px(2, 2)).toEqual([255, 0, 0]);
    expect(px(5, 2)).toEqual([0, 255, 0]);
    expect(px(2, 5)).toEqual([0, 0, 255]);
    expect(px(5, 5)).toEqual([255, 255, 0]);
  });

  it('90 度回転すると、画素が時計回りに入れ替わる', () => {
    const out = createBitmap(4, 4);
    compositeTransformed(out, dot(), 1, 1, transformMatrix({ rotation: 90, pivot: [2, 2] }, [4, 4]));
    const px = (x: number, y: number) => [...out.data.subarray((y * 4 + x) * 4, (y * 4 + x) * 4 + 4)];
    // 左上の赤 → 右上、右上の緑 → 右下、右下の黄 → 左下、左下の青 → 左上
    expect(px(2, 1)).toEqual([255, 0, 0, 255]);
    expect(px(2, 2)).toEqual([0, 255, 0, 255]);
    expect(px(1, 2)).toEqual([255, 255, 0, 255]);
    expect(px(1, 1)).toEqual([0, 0, 255, 255]);
  });

  it('拡大率 0 は何も描かない。キャンバスの外は切り捨てる', () => {
    const out = createBitmap(4, 4);
    compositeTransformed(out, dot(), 1, 1, transformMatrix({ scaleX: 0 }, [4, 4]));
    expect(opaque(out)).toEqual([]);
    compositeTransformed(out, dot(), 1, 1, transformMatrix({ x: 100.5 }, [4, 4]));
    expect(opaque(out)).toEqual([]);
  });
});
