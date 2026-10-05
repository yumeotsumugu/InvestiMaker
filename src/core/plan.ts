// 装備中の Part から描画計画を作る。§6.1（描画順・zBias）、§6.5（非対応）、§8（不足・競合・hides）。

import { conflictReasons } from './compat.ts';
import type { Context } from './context.ts';
import { armLayout } from './context.ts';
import { standardSlotOrder } from './drawOrder.ts';
import type { Asset, Layer, PartManifest } from './manifest.ts';
import { compatibleBodies } from './manifest.ts';
import { resolvePart } from './resolve.ts';

/** §8 の 3 分類と、問題なしの `ok`。 */
export type PartStatus = 'ok' | 'missing' | 'unsupported' | 'conflict';

/** 装備の 1 件。同じ Part を複数装備できるよう、Part ID とは別に識別子を持つ。 */
export interface EquippedRef {
  instanceId: string;
  partId: string;
}

export interface PartReport {
  /** 装備の識別子。Part ID だけで装備を渡した場合は Part ID と同じ。 */
  instanceId: string;
  partId: string;
  status: PartStatus;
  reasons: string[];
  /** この Part の Layer が描画されるか。 */
  drawn: boolean;
}

/**
 * - `draw`：描画する
 * - `omitted`：未解決だが `optional` なので省いた
 * - `unresolved`：未解決（Part 非対応の原因）
 * - `hidden`：他の Part の `hides` で非表示
 * - `skipped`：解決はできたが、Part が非対応または競合のため描画しない
 */
export type LayerStatus = 'draw' | 'omitted' | 'unresolved' | 'hidden' | 'skipped';

export interface PlanEntry {
  instanceId: string;
  partId: string;
  layer: Layer;
  slot: string;
  asset: Asset | null;
  status: LayerStatus;
}

export interface RenderPlan {
  parts: PartReport[];
  /** 描画順（奥 → 手前）。描画しない Layer も、あるべき位置に含む。 */
  entries: PlanEntry[];
}

export interface PlanOptions {
  /** 既定は §6.1 の標準順。検証ページの比較切り替えで差し替える。 */
  slotOrder?: readonly string[];
  /** Layer の Slot を一時的に置き換える（比較切り替え用）。 */
  slotOf?: (part: PartManifest, layer: Layer) => string;
  /**
   * 競合の Part を描画するか。規格上は描画でき、止めるかどうかは UI 側の方針（§8）。
   * 既定は true（描画して警告だけ出す）。
   */
  drawConflicted?: boolean;
}

/** 現在のポーズでの標準描画順（§6.1、§6.2）。 */
export function defaultSlotOrder(ctx: Context): string[] {
  const { placement, order } = armLayout(ctx);
  return standardSlotOrder(placement, order);
}

/**
 * @param library 読み込み済みの Part（ID → manifest）
 * @param equipped 装備（素体を含む）。並びが装備順になる。Part ID だけを渡すと、それを識別子としても使う
 */
export function planRender(
  library: ReadonlyMap<string, PartManifest>,
  equipped: readonly (string | EquippedRef)[],
  ctx: Context,
  options: PlanOptions = {},
): RenderPlan {
  const refs = equipped.map((e): EquippedRef => (typeof e === 'string' ? { instanceId: e, partId: e } : e));
  const slotOrder = options.slotOrder ?? defaultSlotOrder(ctx);
  const slotIndex = new Map(slotOrder.map((slot, i) => [slot, i]));
  const drawConflicted = options.drawConflicted ?? true;

  const found = refs.flatMap((ref) => library.get(ref.partId) ?? []);
  const parts: PartReport[] = [];
  const entries: (PlanEntry & { equipIndex: number; layerIndex: number })[] = [];

  refs.forEach(({ instanceId, partId }, equipIndex) => {
    const part = library.get(partId);
    if (!part) {
      parts.push({ instanceId, partId, status: 'missing', reasons: ['Part が見つからない'], drawn: false });
      return;
    }

    const reasons: string[] = [];
    let status: PartStatus = 'ok';

    const resolution = resolvePart(part, ctx, options.slotOf);
    if (!compatibleBodies(part).includes(ctx.body)) {
      status = 'unsupported';
      reasons.push(`素体 ${ctx.body} に対応していない`);
    } else if (!resolution.supported) {
      status = 'unsupported';
      reasons.push(`Layer が未解決: ${resolution.unresolved.join(', ')}`);
    }

    const conflicts = conflictReasons(part, found, ctx);
    reasons.push(...conflicts);
    if (status === 'ok' && conflicts.length > 0) status = 'conflict';

    const drawn = status === 'ok' || (status === 'conflict' && drawConflicted);
    parts.push({ instanceId, partId, status, reasons, drawn });

    resolution.layers.forEach(({ layer, slot, asset }, layerIndex) => {
      let layerStatus: LayerStatus;
      if (!asset) layerStatus = layer.optional ? 'omitted' : 'unresolved';
      else layerStatus = drawn ? 'draw' : 'skipped';
      entries.push({ instanceId, partId, layer, slot, asset, status: layerStatus, equipIndex, layerIndex });
    });
  });

  // hides は、実際に描画される Part のものだけを適用する。
  const hidden = new Set(parts.filter((p) => p.drawn).flatMap((p) => library.get(p.partId)?.hides ?? []));
  for (const e of entries) {
    if (e.status === 'draw' && hidden.has(e.slot)) e.status = 'hidden';
  }

  const indexOf = (slot: string): number => {
    const i = slotIndex.get(slot);
    if (i === undefined) throw new Error(`描画順に存在しない Slot: ${slot}`);
    return i;
  };
  // Slot 順 → zBias の昇順 → 装備順（§6.1）。同一 Part 内は manifest の並び。
  entries.sort(
    (a, b) =>
      indexOf(a.slot) - indexOf(b.slot) ||
      (a.layer.zBias ?? 0) - (b.layer.zBias ?? 0) ||
      a.equipIndex - b.equipIndex ||
      a.layerIndex - b.layerIndex,
  );

  return {
    parts,
    entries: entries.map(({ instanceId, partId, layer, slot, asset, status }) => ({ instanceId, partId, layer, slot, asset, status })),
  };
}
