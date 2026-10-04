// 仕様書 §6.4 / §6.5：Asset 解決。
// ここに書かれた手順以外で画像を選ばないことが、この規格の中心である。

import type { Context, LayerContext } from './context.ts';
import { layerContext } from './context.ts';
import type { Asset, Layer, OneOrMany, PartManifest, When } from './manifest.ts';
import { compatibleBodies, toArray } from './manifest.ts';

/** ( body, pose, state, attach, fit の次元数 )。左から順に比較する。 */
export type Specificity = readonly [number, number, number, number, number];

export function specificity(when: When): Specificity {
  return [
    when.body === undefined ? 0 : 1,
    when.pose === undefined ? 0 : 1,
    when.state === undefined ? 0 : 1,
    when.attach === undefined ? 0 : 1,
    when.fit ? Object.keys(when.fit).length : 0,
  ];
}

export function compareSpecificity(a: Specificity, b: Specificity): number {
  for (let i = 0; i < a.length; i++) {
    const diff = a[i]! - b[i]!;
    if (diff !== 0) return diff;
  }
  return 0;
}

function includes(cond: OneOrMany, value: string | undefined): boolean {
  return value !== undefined && toArray(cond).includes(value);
}

/**
 * 手順 1：Context と `when` のすべてのキーが一致するか。
 * `when` が指定したキーに対して Context 側の値がない場合は不一致とする。
 */
export function matches(when: When, lctx: LayerContext, bodies: readonly string[]): boolean {
  if (!includes(when.view, lctx.view)) return false;
  // body 省略時は「Part の compatible.body すべて」（§6.4）。
  if (when.body === undefined ? !bodies.includes(lctx.body) : !includes(when.body, lctx.body)) return false;
  if (when.pose !== undefined && !includes(when.pose, lctx.pose)) return false;
  if (when.state !== undefined && !includes(when.state, lctx.state)) return false;
  if (when.attach !== undefined && !includes(when.attach, lctx.attach)) return false;
  for (const [dim, cond] of Object.entries(when.fit ?? {})) {
    if (!includes(cond, lctx.fit[dim])) return false;
  }
  return true;
}

/**
 * 手順 1–2 と 4。一致する Asset のうち具体度が最も高いものを返す。なければ null（未解決）。
 * 手順 3（`mirrorable` による反転）は今回の対象外で、未実装。
 * 同点は検証（`whenOverlaps`）で拒否済みのはずなので、起きたら例外にする。
 */
export function resolveAsset(
  assets: readonly Asset[],
  lctx: LayerContext,
  bodies: readonly string[],
): Asset | null {
  let best: Asset | null = null;
  let bestSpec: Specificity | null = null;
  let tied = false;
  for (const asset of assets) {
    if (!matches(asset.when, lctx, bodies)) continue;
    const spec = specificity(asset.when);
    const cmp = bestSpec ? compareSpecificity(spec, bestSpec) : 1;
    if (cmp > 0) {
      best = asset;
      bestSpec = spec;
      tied = false;
    } else if (cmp === 0) {
      tied = true;
    }
  }
  if (tied) {
    throw new Error(`具体度が等しい Asset が同時に一致した（検証されていない manifest）: ${best?.file}`);
  }
  return best;
}

function intersects(a: OneOrMany, b: OneOrMany): boolean {
  const set = new Set(toArray(a));
  return toArray(b).some((v) => set.has(v));
}

/**
 * 重複の禁止（§6.5）：具体度が等しく、両者が共に指定しているすべてのキー
 * （`view` と fit の各次元を含む）で値の集合が交わるなら true。
 */
export function whenOverlaps(a: When, b: When): boolean {
  if (compareSpecificity(specificity(a), specificity(b)) !== 0) return false;
  if (!intersects(a.view, b.view)) return false;
  for (const key of ['body', 'pose', 'state', 'attach'] as const) {
    const va = a[key];
    const vb = b[key];
    if (va !== undefined && vb !== undefined && !intersects(va, vb)) return false;
  }
  for (const [dim, va] of Object.entries(a.fit ?? {})) {
    const vb = b.fit?.[dim];
    if (vb !== undefined && !intersects(va, vb)) return false;
  }
  return true;
}

export interface LayerResolution {
  layer: Layer;
  /** 置き換え後の Slot（`slotOf` を渡さなければ `layer.slot`）。 */
  slot: string;
  /** 未解決なら null。 */
  asset: Asset | null;
}

export interface PartResolution {
  /** `optional` でない Layer が 1 つでも未解決なら false（Part 全体が非対応）。 */
  supported: boolean;
  layers: LayerResolution[];
  /** 非対応の原因になった Layer ID。 */
  unresolved: string[];
}

/**
 * Part の全 Layer を解決する。
 * `slotOf` は検証ページの比較切り替え用で、Layer の Slot を一時的に置き換える。
 */
export function resolvePart(
  part: PartManifest,
  ctx: Context,
  slotOf: (part: PartManifest, layer: Layer) => string = (_, layer) => layer.slot,
): PartResolution {
  const bodies = compatibleBodies(part);
  const layers = part.layers.map((layer): LayerResolution => {
    const slot = slotOf(part, layer);
    return { layer, slot, asset: resolveAsset(layer.assets, layerContext(ctx, part.category, slot), bodies) };
  });
  const unresolved = layers.filter((r) => !r.asset && !r.layer.optional).map((r) => r.layer.id);
  return { supported: unresolved.length === 0, layers, unresolved };
}
