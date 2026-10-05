// Canvas 2D による合成。色変更は getImageData で得た画素を core の recolor で演算し、
// 結果を Asset ごとにキャッシュする。

import type { ColorMode, RenderPlan } from '../core/index.ts';
import { maskChannelColors, masksOf, recolor } from '../core/index.ts';
import type { AssetSet } from './loader.ts';
import { loadBitmap, loadPixels } from './loader.ts';

export interface RenderStats {
  /** 画像の取得と復号。読み込み済みなら 0 に近い。 */
  loadMs: number;
  /** 画素演算による色変更。 */
  recolorMs: number;
  /** drawImage と、描画を確定させるための 1 画素の読み戻し。 */
  drawMs: number;
  totalMs: number;
  /** 描画した Layer の数。 */
  drawn: number;
  /** そのうち、今回色変更をやり直した Layer の数と画素数。 */
  recolored: number;
  recoloredPixels: number;
}

export interface MemoryEstimate {
  /** 読み込んだ画像（Asset と Mask）の枚数と総画素数。 */
  images: number;
  sourcePixels: number;
  /** 色変更結果のキャッシュの総画素数。 */
  cachePixels: number;
  /** 出力キャンバスの画素数。 */
  canvasPixels: number;
  /** 1 画素 4 バイトとして合計したバイト数。 */
  bytes: number;
}

interface Tinted {
  key: string;
  canvas: HTMLCanvasElement;
}

export class Composer {
  private readonly pixels = new Map<string, Promise<ImageData>>();
  private readonly bitmaps = new Map<string, Promise<ImageBitmap>>();
  private readonly tinted = new Map<string, Tinted>();
  private sourcePixels = 0;
  private images = 0;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly set: AssetSet;
  private readonly canvas: HTMLCanvasElement;

  constructor(set: AssetSet, canvas: HTMLCanvasElement) {
    this.set = set;
    this.canvas = canvas;
    canvas.width = set.width;
    canvas.height = set.height;
    this.ctx = canvas.getContext('2d')!;
  }

  private url(partId: string, file: string): string {
    return `${this.set.baseUrl}${partId}/${file}`;
  }

  private count<T extends { width: number; height: number }>(image: T): T {
    this.images++;
    this.sourcePixels += image.width * image.height;
    return image;
  }

  private getPixels(url: string): Promise<ImageData> {
    let p = this.pixels.get(url);
    if (!p) this.pixels.set(url, (p = loadPixels(url).then((d) => this.count(d))));
    return p;
  }

  private getBitmap(url: string): Promise<ImageBitmap> {
    let p = this.bitmaps.get(url);
    if (!p) this.bitmaps.set(url, (p = loadBitmap(url).then((b) => this.count(b))));
    return p;
  }

  /**
   * @param colors Part ID → スロット ID → `#RRGGBB`
   * @param modeOverride 比較用。`fixed` 以外のスロットの合成モードを差し替える
   */
  async render(
    plan: RenderPlan,
    colors: Readonly<Record<string, Readonly<Record<string, string>>>>,
    modeOverride?: ColorMode,
  ): Promise<RenderStats> {
    const t0 = performance.now();
    const entries = plan.entries.filter((e) => e.status === 'draw' && e.asset);

    // 1) 読み込み。Mask を持つ Asset は画素として、持たない Asset はビットマップとして持つ。
    const loaded = await Promise.all(
      entries.map(async (entry) => {
        const asset = entry.asset!;
        const masks = masksOf(asset);
        if (masks.length === 0) {
          return { entry, masked: false as const, bitmap: await this.getBitmap(this.url(entry.partId, asset.file)) };
        }
        const [base, ...maskPixels] = await Promise.all([
          this.getPixels(this.url(entry.partId, asset.file)),
          ...masks.map((m) => this.getPixels(this.url(entry.partId, m.file))),
        ]);
        for (const m of maskPixels) {
          if (m.width !== base!.width || m.height !== base!.height) {
            throw new Error(`${entry.partId} ${asset.file}: Mask と Asset のサイズが一致しない`);
          }
        }
        return { entry, masked: true as const, base: base!, maskPixels, masks };
      }),
    );
    const t1 = performance.now();

    // 2) 色変更。色とモードが前回と同じ Asset はキャッシュを使う。
    let recolored = 0;
    let recoloredPixels = 0;
    const sources = loaded.map((item): CanvasImageSource => {
      if (!item.masked) return item.bitmap;
      const part = this.set.library.get(item.entry.partId)!;
      const inputs = item.masks.map((mask, i) => ({
        data: item.maskPixels[i]!.data,
        channels: maskChannelColors(part, mask, colors[part.id] ?? {}, modeOverride),
      }));
      const cacheId = this.url(part.id, item.entry.asset!.file);
      const key = JSON.stringify(inputs.map((m) => m.channels));
      const hit = this.tinted.get(cacheId);
      if (hit?.key === key) return hit.canvas;

      const out = new ImageData(item.base.width, item.base.height);
      recolor(item.base.data, inputs, out.data);
      const canvas = hit?.canvas ?? document.createElement('canvas');
      canvas.width = out.width;
      canvas.height = out.height;
      canvas.getContext('2d')!.putImageData(out, 0, 0);
      this.tinted.set(cacheId, { key, canvas });
      recolored++;
      recoloredPixels += out.width * out.height;
      return canvas;
    });
    const t2 = performance.now();

    // 3) 描画。奥から手前へ重ねるだけ。
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    loaded.forEach(({ entry }, i) => {
      const [ox, oy] = entry.asset!.offset ?? [0, 0];
      this.ctx.drawImage(sources[i]!, ox, oy);
    });
    this.ctx.getImageData(0, 0, 1, 1); // GPU 側の描画を確定させてから時間を測る
    const t3 = performance.now();

    return {
      loadMs: t1 - t0,
      recolorMs: t2 - t1,
      drawMs: t3 - t2,
      totalMs: t3 - t0,
      drawn: entries.length,
      recolored,
      recoloredPixels,
    };
  }

  /** 色変更結果のキャッシュを捨てる（計測用）。 */
  clearTintCache(): void {
    this.tinted.clear();
  }

  memory(): MemoryEstimate {
    let cachePixels = 0;
    for (const { canvas } of this.tinted.values()) cachePixels += canvas.width * canvas.height;
    const canvasPixels = this.canvas.width * this.canvas.height;
    return {
      images: this.images,
      sourcePixels: this.sourcePixels,
      cachePixels,
      canvasPixels,
      bytes: (this.sourcePixels + cachePixels + canvasPixels) * 4,
    };
  }
}
