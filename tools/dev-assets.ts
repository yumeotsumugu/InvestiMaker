// 仮素材一式をメモリ上に生成する。同じ入力なら同じ出力になる（乱数・時刻を使わない）。

import type { Asset, Bitmap, Body, Context, Part, PartManifest } from '../src/core/index.ts';
import { planRender, resolvePartColors } from '../src/core/index.ts';
import type { AssetDef, PartDef } from './dev-parts.ts';
import { ALTERNATE_IDS, BODY_ID, DEV_PARTS, STARTER_IDS } from './dev-parts.ts';
import type { Art, View } from './paint.ts';
import { artBBox, rasterize } from './paint.ts';
import { encodePng } from './png.ts';
import { renderPlan } from './render.ts';
import { unionBBox } from './sdf.ts';

/** 設計座標の基準キャンバス。 */
export const DESIGN_WIDTH = 1600;
export const DESIGN_HEIGHT = 2400;
export const PREVIEW_SIZE = 256;

export interface GeneratedPart {
  manifest: PartManifest;
  /** manifest が参照するパス → 画像。 */
  images: Map<string, Bitmap>;
  preview: Bitmap;
}

export interface GeneratedSet {
  width: number;
  height: number;
  parts: GeneratedPart[];
}

const LICENSE = {
  name: 'InvestiMaker 開発用仮素材（リポジトリ内のスクリプトで生成）',
  url: '',
  commercial: false,
  modify: true,
  redistributable: false,
  creditRequired: false,
  creditText: '',
};

/** 既定の状態（プレビューと、検証ページの初期状態）。 */
export function defaultContext(): Context {
  return {
    view: 'front',
    body: BODY_ID,
    pose: { torso: 'stand', 'arm.left': 'down', 'arm.right': 'down' },
    expression: { id: 'normal', eyes: 'open', eyebrows: 'neutral', mouth: 'closed' },
    fit: { chest: 'medium' },
  };
}

const assetPath = (def: AssetDef) => `assets/front/${def.name}.png`;
const maskPath = (def: AssetDef) => `assets/front/${def.name}.mask.png`;

function generatePart(def: PartDef, view: View): GeneratedPart {
  const images = new Map<string, Bitmap>();
  const arts = new Map<string, Art>();

  const layers = def.layers.map((layerDef) => ({
    id: layerDef.id,
    slot: layerDef.slot,
    ...(layerDef.optional ? { optional: true } : {}),
    ...(layerDef.zBias !== undefined ? { zBias: layerDef.zBias } : {}),
    assets: layerDef.assets.map((assetDef): Asset => {
      const raster = rasterize(assetDef.art, view);
      if (!raster) throw new Error(`${def.id}/${assetDef.name}: 描画範囲が空`);
      const file = assetPath(assetDef);
      arts.set(file, assetDef.art);
      images.set(file, { width: raster.width, height: raster.height, data: raster.rgba });
      const asset: Asset = { when: { view: 'front', ...assetDef.when }, file, offset: raster.offset };
      if (assetDef.channels) {
        if (!raster.mask) throw new Error(`${def.id}/${assetDef.name}: channels があるのに色変更領域がない`);
        images.set(maskPath(assetDef), { width: raster.width, height: raster.height, data: raster.mask });
        asset.mask = { file: maskPath(assetDef), channels: assetDef.channels };
      }
      return asset;
    }),
  }));

  const common = {
    format: 'INVESTIMAKER_PART' as const,
    formatVersion: 1,
    id: def.id,
    version: '0.1.0',
    name: def.name,
    author: 'InvestiMaker (dev)',
    category: def.category,
    canvas: [view.width, view.height] as [number, number],
    tags: ['仮素材', ...(def.tags ?? [])],
    license: LICENSE,
  };
  const rest = {
    requires: def.requires ?? [],
    conflicts: def.conflicts ?? [],
    hides: def.hides ?? [],
    mirrorable: false,
    colorSlots: def.colorSlots ?? [],
    layers,
  };

  let manifest: PartManifest;
  if (def.body) {
    const anchors = Object.fromEntries(
      Object.entries(def.body.anchors).map(([v, points]) => [
        v,
        Object.fromEntries(
          Object.entries(points).map(([name, [x, y]]) => [name, [Math.round(x * view.scale), Math.round(y * view.scale)]]),
        ),
      ]),
    ) as Body['anchors'];
    manifest = { ...common, kind: 'body', category: 'body', views: def.body.views, fitDimensions: def.body.fitDimensions, anchors, ...rest };
  } else {
    manifest = { ...common, kind: 'part', compatible: { body: [BODY_ID] }, ...rest } satisfies Part;
  }

  return { manifest, images, preview: renderPreview(manifest, arts) };
}

/** 既定の状態で解決した Layer を、既定色で 256×256 に収めて描く。 */
function renderPreview(manifest: PartManifest, arts: ReadonlyMap<string, Art>): Bitmap {
  const library = new Map([[manifest.id, manifest]]);
  const plan = planRender(library, [manifest.id], defaultContext());
  const files = plan.entries.flatMap((e) => (e.asset ? [e.asset.file] : []));
  const box = unionBBox(files.map((f) => artBBox(arts.get(f)!)));
  const scale = (PREVIEW_SIZE - 20) / Math.max(box.x1 - box.x0, box.y1 - box.y0);
  const view: View = {
    width: PREVIEW_SIZE,
    height: PREVIEW_SIZE,
    scale,
    tx: PREVIEW_SIZE / 2 - ((box.x0 + box.x1) / 2) * scale,
    ty: PREVIEW_SIZE / 2 - ((box.y0 + box.y1) / 2) * scale,
  };

  const small = new Map<string, Bitmap>();
  const offsets = new Map<string, readonly [number, number]>();
  for (const entry of plan.entries) {
    if (!entry.asset) continue;
    const raster = rasterize(arts.get(entry.asset.file)!, view);
    if (!raster) continue;
    small.set(entry.asset.file, { width: raster.width, height: raster.height, data: raster.rgba });
    offsets.set(entry.asset.file, raster.offset);
    if (entry.asset.mask && raster.mask) {
      small.set(entry.asset.mask.file, { width: raster.width, height: raster.height, data: raster.mask });
    }
  }
  // 小さすぎて画素が残らなかった Layer は描かない。
  const drawable = { ...plan, entries: plan.entries.filter((e) => e.asset && small.has(e.asset.file)) };
  return renderPlan({
    plan: drawable,
    library,
    image: (_, file) => small.get(file)!,
    offsetOf: (_, file) => offsets.get(file)!,
    colors: { [manifest.id]: resolvePartColors(manifest, undefined, {}) },
    width: PREVIEW_SIZE,
    height: PREVIEW_SIZE,
  });
}

/** 仮素材一式を指定のキャンバスサイズで生成する。 */
export function generateDevAssets(width = DESIGN_WIDTH, height = DESIGN_HEIGHT): GeneratedSet {
  const scale = Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT);
  const view: View = { width, height, scale, tx: 0, ty: 0 };
  return { width, height, parts: DEV_PARTS.map((def) => generatePart(def, view)) };
}

/** 検証ページが最初に読む一覧（`index.json`）。 */
export function buildIndex(set: GeneratedSet) {
  return {
    canvas: [set.width, set.height],
    body: BODY_ID,
    parts: set.parts.map((p) => {
      const images = [...p.images.values()];
      return {
        id: p.manifest.id,
        // 検証ページが最初に装備するか（選択肢として足した Part は装備しない）
        default: !ALTERNATE_IDS.includes(p.manifest.id),
        // 新規キャラクターが最初に装備するか
        starter: STARTER_IDS.includes(p.manifest.id),
        files: images.length,
        pixels: images.reduce((sum, img) => sum + img.width * img.height, 0),
      };
    }),
  };
}

/** 配列を 1 行にまとめた JSON（offset や anchors が縦に伸びないようにする）。 */
function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/\[\n\s+(-?\d+),\n\s+(-?\d+)\n\s+\]/g, '[$1, $2]') + '\n';
}

/** 書き出すファイルの一覧（出力先からの相対パス → 内容）。 */
export function serializeSet(set: GeneratedSet): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  for (const part of set.parts) {
    const dir = part.manifest.id;
    files.set(`${dir}/manifest.json`, Buffer.from(formatJson(part.manifest), 'utf8'));
    files.set(`${dir}/preview.png`, encodePng(part.preview.width, part.preview.height, part.preview.data));
    for (const [file, image] of part.images) {
      files.set(`${dir}/${file}`, encodePng(image.width, image.height, image.data));
    }
  }
  files.set('index.json', Buffer.from(formatJson(buildIndex(set)), 'utf8'));
  return files;
}
