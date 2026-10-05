// 図形の並びを、Asset 画像と Mask 画像にラスタライズする。
//
// 仮素材に持たせる性質（指示書 ステップ 4）：
// - 色変更領域は 50% グレー（128）基準の無彩色で、ハイライトと影を含む
// - 暗色の輪郭線があり、線の上の Mask 値は 0
// - Mask の境界（線の内側の縁）はアンチエイリアスされ、適用率が中間値になる
// - 余白をトリミングして offset を付ける

import type { BBox, Shape } from './sdf.ts';
import { unionBBox } from './sdf.ts';

export type RGB = readonly [number, number, number];

export const LINE_COLOR: RGB = [42, 38, 48];
/** 輪郭線の太さ（設計座標）。 */
export const LINE_WIDTH = 6;

export interface Region {
  shape: Shape;
  /** 色変更領域なら Mask のチャンネル（0 = R、1 = G、2 = B）。 */
  channel?: 0 | 1 | 2;
  /** 色変更しない領域の色。`channel` を持つ領域では使わない。 */
  color?: RGB;
  /** 輪郭線を引くか。既定 true。 */
  outline?: boolean;
  /** ハイライトと影を付けるか。既定 true（色変更領域のみ）。 */
  shade?: boolean;
  /** 不透明度。既定 1。 */
  opacity?: number;
  /** 指定すると、縁をこの幅（設計座標）でぼかす。 */
  soft?: number;
}

/** 1 枚の Asset の絵。`regions` は奥から手前の順。 */
export interface Art {
  regions: Region[];
}

export interface Raster {
  width: number;
  height: number;
  offset: [number, number];
  rgba: Uint8ClampedArray;
  /** 色変更領域がなければ null。A は常に 255。 */
  mask: Uint8ClampedArray | null;
}

/** 設計座標 → 画素座標の変換（等倍率 + 平行移動）。 */
export interface View {
  width: number;
  height: number;
  scale: number;
  tx: number;
  ty: number;
}

export function artBBox(art: Art): BBox {
  return unionBBox(art.regions.map((r) => r.shape.bbox));
}

const clamp01 = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v);

/**
 * 下地のグレー値。領域の左 1/4 がハイライト（最大 198）、中央は基準の 128、
 * 右 3 割が影（最小 64）。128 の平坦部を残すのは、指定色そのものになる部分を確認するため。
 */
function shadeGray(x: number, box: BBox): number {
  const t = (x - box.x0) / (box.x1 - box.x0);
  if (t < 0.25) return 128 + 70 * clamp01((0.25 - t) / 0.25);
  if (t > 0.7) return 128 - 64 * clamp01((t - 0.7) / 0.3);
  return 128;
}

export function rasterize(art: Art, view: View): Raster | null {
  const { scale: k, tx, ty } = view;
  const box = artBBox(art);
  const px0 = Math.max(0, Math.floor(box.x0 * k + tx) - 2);
  const py0 = Math.max(0, Math.floor(box.y0 * k + ty) - 2);
  const px1 = Math.min(view.width, Math.ceil(box.x1 * k + tx) + 2);
  const py1 = Math.min(view.height, Math.ceil(box.y1 * k + ty) + 2);
  const w = px1 - px0;
  const h = py1 - py0;
  if (w <= 0 || h <= 0) return null;

  const rgba = new Float32Array(w * h * 4);
  const mask = new Float32Array(w * h * 3);
  const hasMask = art.regions.some((r) => r.channel !== undefined);
  const lineWidth = LINE_WIDTH * k;

  for (let py = 0; py < h; py++) {
    const y = (py + py0 + 0.5 - ty) / k;
    for (let px = 0; px < w; px++) {
      const x = (px + px0 + 0.5 - tx) / k;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let m0 = 0;
      let m1 = 0;
      let m2 = 0;

      for (const region of art.regions) {
        const rb = region.shape.bbox;
        if (x < rb.x0 - 2 || x > rb.x1 + 2 || y < rb.y0 - 2 || y > rb.y1 + 2) continue;
        const d = region.shape.d(x, y) * k;
        const edge = region.soft ? clamp01(-d / (region.soft * k)) : clamp01(0.5 - d);
        const cov = edge * (region.opacity ?? 1);
        if (cov <= 0) continue;

        // 線の内側の縁より内側が塗り。線は境界から内側へ lineWidth の帯。
        const outline = region.outline ?? true;
        const fill = outline ? cov * clamp01(0.5 - (d + lineWidth)) : cov;
        const line = cov - fill;

        let fr: number;
        let fg: number;
        let fb: number;
        if (region.channel !== undefined) {
          fr = fg = fb = (region.shade ?? true) ? shadeGray(x, rb) : 128;
        } else {
          [fr, fg, fb] = region.color ?? LINE_COLOR;
        }
        const cr = (LINE_COLOR[0] * line + fr * fill) / cov;
        const cg = (LINE_COLOR[1] * line + fg * fill) / cov;
        const cb = (LINE_COLOR[2] * line + fb * fill) / cov;

        // 通常合成（非プリマルチプライ）。
        const rest = a * (1 - cov);
        const outA = cov + rest;
        r = (cr * cov + r * rest) / outA;
        g = (cg * cov + g * rest) / outA;
        b = (cb * cov + b * rest) / outA;
        a = outA;

        // Mask は「画素のうち各スロットの塗りが占める割合」を持ち回り、最後に不透明度で割る。
        m0 *= 1 - cov;
        m1 *= 1 - cov;
        m2 *= 1 - cov;
        if (region.channel === 0) m0 += fill;
        else if (region.channel === 1) m1 += fill;
        else if (region.channel === 2) m2 += fill;
      }

      if (a <= 0) continue;
      const i = (py * w + px) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = a * 255;
      const j = (py * w + px) * 3;
      mask[j] = (m0 / a) * 255;
      mask[j + 1] = (m1 / a) * 255;
      mask[j + 2] = (m2 / a) * 255;
    }
  }

  // トリミング：アルファが 0 でない画素の外接矩形だけを残す。
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      if (Math.round(rgba[(py * w + px) * 4 + 3]!) === 0) continue;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
  }
  if (maxX < 0) return null;

  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const outRgba = new Uint8ClampedArray(cw * ch * 4);
  const outMask = hasMask ? new Uint8ClampedArray(cw * ch * 4) : null;
  for (let py = 0; py < ch; py++) {
    for (let px = 0; px < cw; px++) {
      const src = (py + minY) * w + px + minX;
      const dst = (py * cw + px) * 4;
      const alpha = Math.round(rgba[src * 4 + 3]!);
      if (alpha > 0) {
        outRgba[dst] = Math.round(rgba[src * 4]!);
        outRgba[dst + 1] = Math.round(rgba[src * 4 + 1]!);
        outRgba[dst + 2] = Math.round(rgba[src * 4 + 2]!);
        outRgba[dst + 3] = alpha;
      }
      if (outMask) {
        if (alpha > 0) {
          outMask[dst] = Math.round(mask[src * 3]!);
          outMask[dst + 1] = Math.round(mask[src * 3 + 1]!);
          outMask[dst + 2] = Math.round(mask[src * 3 + 2]!);
        }
        outMask[dst + 3] = 255;
      }
    }
  }
  return { width: cw, height: ch, offset: [px0 + minX, py0 + minY], rgba: outRgba, mask: outMask };
}
