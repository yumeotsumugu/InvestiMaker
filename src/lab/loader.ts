// 仮素材の読み込み。すべて同一オリジンの静的ファイルで、外部通信はしない。

import type { Body, PartManifest, ValidationResult } from '../core/index.ts';
import { validateFitAgainstBodies, validateManifest } from '../core/index.ts';

export interface SetIndex {
  canvas: [number, number];
  body: string;
  parts: { id: string; files: number; pixels: number }[];
}

export interface AssetSet {
  /** `development` や `bench/1200x1800`。 */
  name: string;
  baseUrl: string;
  width: number;
  height: number;
  body: string;
  index: SetIndex;
  /** 検証を通った Part だけが入る。 */
  library: Map<string, PartManifest>;
  /** 一覧の順（既定の装備順）。 */
  order: string[];
  validation: Map<string, ValidationResult>;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

export async function loadSet(name: string): Promise<AssetSet> {
  const baseUrl = `${import.meta.env.BASE_URL}${name}/`;
  const index = (await fetchJson(`${baseUrl}index.json`)) as SetIndex;
  const library = new Map<string, PartManifest>();
  const validation = new Map<string, ValidationResult>();
  await Promise.all(
    index.parts.map(async ({ id }) => {
      const manifest = await fetchJson(`${baseUrl}${id}/manifest.json`);
      // サイズ比較用の素材セットも読めるよう、期待するキャンバスは一覧の値にする。
      const result = validateManifest(manifest, { canvas: index.canvas });
      validation.set(id, result);
      // MUST 違反の素材は読み込みを拒否する（仕様書 §0）。
      if (result.ok) library.set(id, manifest as PartManifest);
    }),
  );
  // 素体が揃ってから、when.fit を素体の fitDimensions と照合する（§6.5）。
  const bodies = new Map([...library].flatMap(([id, p]) => (p.kind === 'body' ? [[id, p as Body] as const] : [])));
  for (const [id, part] of [...library]) {
    const issues = validateFitAgainstBodies(part, bodies);
    const result = validation.get(id)!;
    result.errors.push(...issues.filter((i) => i.level === 'error'));
    result.warnings.push(...issues.filter((i) => i.level === 'warning'));
    if (result.errors.length > 0) {
      result.ok = false;
      library.delete(id);
    }
  }

  return {
    name,
    baseUrl,
    width: index.canvas[0],
    height: index.canvas[1],
    body: index.body,
    index,
    library,
    order: index.parts.map((p) => p.id),
    validation,
  };
}

/** PNG を復号する。色空間変換とアルファ乗算はできる限り止める。 */
export async function loadBitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
}

/**
 * 画像を画素として読む。Canvas 2D を経由するので、内部ではアルファが乗算される
 * （A が低い画素の RGB は精度が落ちる。§4.3 と §13-3 を参照）。
 */
export async function loadPixels(url: string): Promise<ImageData> {
  const bitmap = await loadBitmap(url);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}
