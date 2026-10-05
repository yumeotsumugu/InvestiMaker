// 描画計画をブラウザなしで画像にする（プレビュー生成・テスト・レポート用画像で共用）。
// 検証ページの Canvas 2D 合成と同じ手順を、core のソフトウェア合成で行う。

import type { Bitmap, ColorMode, PartManifest, RenderPlan } from '../src/core/index.ts';
import { compositeOver, createBitmap, maskChannelColors, masksOf, recolor } from '../src/core/index.ts';

export interface RenderInput {
  plan: RenderPlan;
  library: ReadonlyMap<string, PartManifest>;
  /** Part ID とファイルパスから画像を得る。 */
  image(partId: string, file: string): Bitmap;
  /** 装備の識別子（`PlanEntry.instanceId`）→ スロット ID → `#RRGGBB`。 */
  colors: Readonly<Record<string, Readonly<Record<string, string>>>>;
  width: number;
  height: number;
  /** Asset の offset を差し替える（プレビューのように別の座標系へ描くとき）。 */
  offsetOf?(partId: string, file: string): readonly [number, number];
  modeOverride?: ColorMode;
}

export function renderPlan(input: RenderInput): Bitmap {
  const canvas = createBitmap(input.width, input.height);
  for (const entry of input.plan.entries) {
    if (entry.status !== 'draw' || !entry.asset) continue;
    const part = input.library.get(entry.partId)!;
    const asset = entry.asset;
    let bitmap = input.image(part.id, asset.file);
    const masks = masksOf(asset);
    if (masks.length > 0) {
      const colored = recolor(
        bitmap.data,
        masks.map((mask) => ({
          data: input.image(part.id, mask.file).data,
          channels: maskChannelColors(part, mask, input.colors[entry.instanceId] ?? {}, input.modeOverride),
        })),
        new Uint8ClampedArray(bitmap.data.length),
      );
      bitmap = { width: bitmap.width, height: bitmap.height, data: colored };
    }
    const [ox, oy] = input.offsetOf?.(part.id, asset.file) ?? asset.offset ?? [0, 0];
    compositeOver(canvas, bitmap, ox, oy);
  }
  return canvas;
}
