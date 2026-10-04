// 仕様書 §5.3 / §5.4：色合成と共有カラー。
// 計算は sRGB の 8bit 値を 0–1 に正規化したまま行い、線形化はしない。

import type { ColorMode, ColorSlot, Mask, MaskChannel, PartManifest } from './manifest.ts';

/** 0–255 の整数。 */
export type RGB = readonly [number, number, number];

/**
 * `tint` の基準下地の明度。
 * 仕様書の式は 0.5 を境にしているが、#808080 は 128/255 ≈ 0.50196 で 0.5 と一致せず、
 * 式のままでは「下地が #808080 のとき指定色そのものになる」が 8bit で最大 1 段ずれる。
 * 両立させるため、境界を 128/255 とする解釈を採った（レポートの変更提案を参照）。
 */
export const TINT_PIVOT = 128 / 255;

export function parseHex(hex: string): RGB {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) throw new Error(`#RRGGBB ではない: ${hex}`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex(rgb: RGB): string {
  return '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export interface ChannelColor {
  mode: ColorMode;
  color: RGB;
}

export interface MaskInput {
  /** Asset と同じ大きさの RGBA。R / G / B が各スロットの適用率。 */
  data: ArrayLike<number>;
  /** R / G / B の順。割り当てのないチャンネルは null。 */
  channels: readonly [ChannelColor | null, ChannelColor | null, ChannelColor | null];
}

/** 0–1 の値を 8bit に戻す。丸めは四捨五入（仕様書に規定がなく、実装側で固定した）。 */
function to8bit(v: number): number {
  return v <= 0 ? 0 : v >= 1 ? 255 : Math.floor(v * 255 + 0.5);
}

/**
 * Mask に従って画素の色を置き換える。
 * `result = B × (1 − Σw) + Σ(w × out)`、アルファは B のまま。
 * Σw が 1 を超える画素（§4.3 の SHOULD 違反）は、適用率を比例配分で 1 に収める。
 */
export function recolor<T extends Uint8Array | Uint8ClampedArray>(
  base: ArrayLike<number>,
  masks: readonly MaskInput[],
  out: T,
): T {
  const active: { data: ArrayLike<number>; c: number; mode: ColorMode; r: number; g: number; b: number }[] = [];
  for (const mask of masks) {
    mask.channels.forEach((ch, c) => {
      if (!ch || ch.mode === 'fixed') return; // fixed は out = B なので何もしないのと同じ
      active.push({ data: mask.data, c, mode: ch.mode, r: ch.color[0] / 255, g: ch.color[1] / 255, b: ch.color[2] / 255 });
    });
  }

  for (let i = 0; i < base.length; i += 4) {
    const alpha = base[i + 3]!;
    out[i] = base[i]!;
    out[i + 1] = base[i + 1]!;
    out[i + 2] = base[i + 2]!;
    out[i + 3] = alpha;
    if (alpha === 0) continue;

    const br = base[i]! / 255;
    const bg = base[i + 1]! / 255;
    const bb = base[i + 2]! / 255;
    let sum = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    for (const ch of active) {
      const w = ch.data[i + ch.c]! / 255;
      if (w === 0) continue;
      sum += w;
      if (ch.mode === 'multiply') {
        r += w * br * ch.r;
        g += w * bg * ch.g;
        b += w * bb * ch.b;
      } else {
        const lum = 0.2126 * br + 0.7152 * bg + 0.0722 * bb;
        if (lum <= TINT_PIVOT) {
          const k = lum / TINT_PIVOT;
          r += w * ch.r * k;
          g += w * ch.g * k;
          b += w * ch.b * k;
        } else {
          const t = (lum - TINT_PIVOT) / (1 - TINT_PIVOT);
          r += w * (ch.r + (1 - ch.r) * t);
          g += w * (ch.g + (1 - ch.g) * t);
          b += w * (ch.b + (1 - ch.b) * t);
        }
      }
    }
    if (sum === 0) continue;
    if (sum > 1) {
      r /= sum;
      g /= sum;
      b /= sum;
      sum = 1;
    }
    const keep = 1 - sum;
    out[i] = to8bit(br * keep + r);
    out[i + 1] = to8bit(bg * keep + g);
    out[i + 2] = to8bit(bb * keep + b);
  }
  return out;
}

/** 装備インスタンスごとの色指定。 */
export interface SlotColorOverride {
  /** 共有カラーに従うか。既定 true。`link` を持たないスロットでは無視する。 */
  linked?: boolean;
  /** 個別色 `#RRGGBB`。 */
  color?: string;
}

/**
 * スロットの色を決める（§5.4）。
 * リンク中は共有色、共有色が未定義のキーなら `default`、リンク解除中は個別色（なければ `default`）。
 */
export function resolveSlotColor(
  slot: ColorSlot,
  override: SlotColorOverride | undefined,
  shared: Readonly<Record<string, string>>,
): string {
  if (slot.link !== undefined && override?.linked !== false) {
    return shared[slot.link] ?? slot.default;
  }
  return override?.color ?? slot.default;
}

/** Part の全スロットの色（スロット ID → `#RRGGBB`）。 */
export function resolvePartColors(
  part: PartManifest,
  overrides: Readonly<Record<string, SlotColorOverride>> | undefined,
  shared: Readonly<Record<string, string>>,
): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const slot of part.colorSlots ?? []) {
    colors[slot.id] = resolveSlotColor(slot, overrides?.[slot.id], shared);
  }
  return colors;
}

const CHANNELS: readonly MaskChannel[] = ['r', 'g', 'b'];

/**
 * Mask の各チャンネルに、スロットの合成モードと色を割り当てる。
 * `modeOverride` は検証ページの比較切り替え用で、`fixed` 以外のモードを差し替える。
 */
export function maskChannelColors(
  part: PartManifest,
  mask: Mask,
  colors: Readonly<Record<string, string>>,
  modeOverride?: ColorMode,
): MaskInput['channels'] {
  const of = (channel: MaskChannel): ChannelColor | null => {
    const slotId = mask.channels[channel];
    const slot = part.colorSlots?.find((s) => s.id === slotId);
    if (!slot) return null;
    const mode = slot.mode === 'fixed' ? 'fixed' : (modeOverride ?? slot.mode);
    return { mode, color: parseHex(colors[slot.id] ?? slot.default) };
  };
  return [of(CHANNELS[0]!), of(CHANNELS[1]!), of(CHANNELS[2]!)];
}
