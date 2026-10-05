// 配置補正（Asset Specification §9）。
// 適用順は「pivot を中心に拡大縮小 → 回転（度、時計回り）→ 平行移動」。

import type { Transform } from './manifest.ts';
import type { Bitmap } from './raster.ts';
import { compositeOver } from './raster.ts';

/**
 * アフィン変換。Canvas 2D の `setTransform(a, b, c, d, e, f)` と同じ並びで、
 * `x' = a·x + c·y + e`、`y' = b·x + d·y + f`。座標はキャンバスの画素（Y は下が正）。
 */
export type Matrix = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/**
 * `diff` を `base` に対する差分として合成する：位置と回転は加算、拡大縮小は乗算。
 * pivot は `diff` にあればそれを、なければ `base` のものを使う。
 */
export function combineTransforms(base: Transform | undefined, diff: Transform | undefined): Transform {
  const pivot = diff?.pivot ?? base?.pivot;
  return {
    x: (base?.x ?? 0) + (diff?.x ?? 0),
    y: (base?.y ?? 0) + (diff?.y ?? 0),
    scaleX: (base?.scaleX ?? 1) * (diff?.scaleX ?? 1),
    scaleY: (base?.scaleY ?? 1) * (diff?.scaleY ?? 1),
    rotation: (base?.rotation ?? 0) + (diff?.rotation ?? 0),
    ...(pivot ? { pivot } : {}),
  };
}

/** `pivot` 省略時はキャンバス中央。 */
export function transformMatrix(t: Transform, canvas: readonly [number, number]): Matrix {
  const [px, py] = t.pivot ?? [canvas[0] / 2, canvas[1] / 2];
  const sx = t.scaleX ?? 1;
  const sy = t.scaleY ?? 1;
  const rad = ((t.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Y が下向きの座標系では、この回転行列が画面上の時計回りになる。
  const a = cos * sx;
  const b = sin * sx;
  const c = -sin * sy + 0; // −0 を 0 に揃える
  const d = cos * sy;
  return [a, b, c, d, px - (a * px + c * py) + (t.x ?? 0), py - (b * px + d * py) + (t.y ?? 0)];
}

export function isIdentity(m: Matrix): boolean {
  return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
}

/** 補正が何も指定されていない（描画に影響しない）か。 */
export function isNeutral(t: Transform | undefined): boolean {
  return !t || ((t.x ?? 0) === 0 && (t.y ?? 0) === 0 && (t.scaleX ?? 1) === 1 && (t.scaleY ?? 1) === 1 && (t.rotation ?? 0) === 0);
}

/**
 * `(ox, oy)` に置いた `src` を、行列 `m` で変換して `dst` に通常合成する（ソフトウェア合成）。
 * 整数の平行移動だけなら画素をそのまま写し、それ以外は双線形補間で標本化する。
 */
export function compositeTransformed(dst: Bitmap, src: Bitmap, ox: number, oy: number, m: Matrix): void {
  const [a, b, c, d, e, f] = m;
  if (a === 1 && b === 0 && c === 0 && d === 1 && Number.isInteger(e) && Number.isInteger(f)) {
    compositeOver(dst, src, ox + e, oy + f);
    return;
  }
  const det = a * d - b * c;
  if (det === 0) return; // 拡大率 0。何も描かない

  // 変換後の外接矩形だけを走査する。
  const corners = [[ox, oy], [ox + src.width, oy], [ox, oy + src.height], [ox + src.width, oy + src.height]].map(
    ([x, y]) => [a * x! + c * y! + e, b * x! + d * y! + f] as const,
  );
  const x0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p[0]))));
  const y0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p[1]))));
  const x1 = Math.min(dst.width, Math.ceil(Math.max(...corners.map((p) => p[0]))));
  const y1 = Math.min(dst.height, Math.ceil(Math.max(...corners.map((p) => p[1]))));

  // 逆変換：出力の画素中心 → 元画像の画素座標。
  const ia = d / det;
  const ib = -b / det;
  const ic = -c / det;
  const id = a / det;
  // (u, v) は元画像の左上を原点とする連続座標。画像の外は透明、内側は端の画素で止めて補間する
  // （画像の縁が半透明ににじまないようにする。トリミングした画像は縁まで不透明な画素がある）。
  const sample = (u: number, v: number, out: Float64Array) => {
    out.fill(0);
    if (u < 0 || v < 0 || u > src.width || v > src.height) return;
    const sx = Math.max(0, Math.min(src.width - 1, u - 0.5));
    const sy = Math.max(0, Math.min(src.height - 1, v - 0.5));
    const fx = Math.floor(sx);
    const fy = Math.floor(sy);
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 2; i++) {
        const px = fx + i;
        const py = fy + j;
        if (px >= src.width || py >= src.height) continue;
        const w = (i ? sx - fx : 1 - (sx - fx)) * (j ? sy - fy : 1 - (sy - fy));
        if (w === 0) continue;
        const k = (py * src.width + px) * 4;
        const alpha = (src.data[k + 3]! / 255) * w;
        // アルファを乗算してから補間する（透明な画素の色がにじまないようにする）。
        out[0]! += src.data[k]! * alpha;
        out[1]! += src.data[k + 1]! * alpha;
        out[2]! += src.data[k + 2]! * alpha;
        out[3]! += alpha;
      }
    }
  };

  const s = new Float64Array(4);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const cx = x + 0.5 - e;
      const cy = y + 0.5 - f;
      sample(ia * cx + ic * cy - ox, ib * cx + id * cy - oy, s);
      const sa = s[3]!;
      if (sa <= 0) continue;
      const k = (y * dst.width + x) * 4;
      const rest = (dst.data[k + 3]! / 255) * (1 - sa);
      const outA = sa + rest;
      dst.data[k] = Math.round((s[0]! + dst.data[k]! * rest) / outA);
      dst.data[k + 1] = Math.round((s[1]! + dst.data[k + 1]! * rest) / outA);
      dst.data[k + 2] = Math.round((s[2]! + dst.data[k + 2]! * rest) / outA);
      dst.data[k + 3] = Math.round(outA * 255);
    }
  }
}
