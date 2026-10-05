// 計測（`?bench=1`、または画面の「計測を実行」）。§13-1 と §13-3 の材料を出す。

import { Composer } from '../web/composer.ts';
import type { MemoryEstimate, RenderStats } from '../web/composer.ts';
import type { AssetSet } from '../web/loader.ts';
import { loadPixels } from '../web/loader.ts';
import { PROBE_ALPHAS, PROBE_WIDTH, probePixel } from './probe-pattern.ts';
import type { LabState } from './state.ts';
import { initialState, planOf } from './state.ts';

export interface AlphaProbeRow {
  alpha: number;
  /** 読み戻したアルファ（全画素同じはず）。 */
  alphaRead: number;
  /** RGB の最大誤差（0〜255）。 */
  maxError: number;
  /** RGB の 3 値がすべて元の値と一致した画素の割合（0〜1）。 */
  exact: number;
  /** 読み戻した RGB に現れた値の種類数（R チャンネル。元は 256 種類）。 */
  distinct: number;
}

export interface BenchResult {
  set: string;
  canvas: [number, number];
  userAgent: string;
  devicePixelRatio: number;
  /** 初回合成（画像の取得・復号を含む）。 */
  first: RenderStats;
  /** 何も変えずに再合成（全キャッシュ命中）。中央値。 */
  redrawMs: number;
  /** 色を 1 か所変えたときの再合成。各 5 回の中央値。 */
  colorChange: { label: string; totalMs: number; recolorMs: number; recolored: number; recoloredPixels: number }[];
  /** 色変更のキャッシュをすべて捨てて再合成。 */
  recolorAll: RenderStats;
  /** 右腕を pocket にしたとき（未読み込みの画像の取得を含む）。 */
  poseChange: RenderStats;
  memory: MemoryEstimate;
  /** 素材セット全体（全 Asset と Mask）を読んだ場合の画素数。 */
  allAssetsPixels: number;
  png: { ms: number; bytes: number };
  alphaProbe: AlphaProbeRow[];
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

/** A に値を入れた画像を Canvas 2D 経由で読み、RGB が保持されるかを調べる。 */
export async function probeAlpha(): Promise<AlphaProbeRow[]> {
  const image = await loadPixels(`${import.meta.env.BASE_URL}probe/mask_alpha_probe.png`);
  return PROBE_ALPHAS.map((alpha, row) => {
    let maxError = 0;
    let exact = 0;
    const seen = new Set<number>();
    for (let x = 0; x < PROBE_WIDTH; x++) {
      const i = (row * PROBE_WIDTH + x) * 4;
      const expected = probePixel(x, row);
      let same = true;
      for (let c = 0; c < 3; c++) {
        const error = Math.abs(image.data[i + c]! - expected[c]!);
        if (error > maxError) maxError = error;
        if (error !== 0) same = false;
      }
      if (same) exact++;
      seen.add(image.data[i]!);
    }
    return { alpha, alphaRead: image.data[row * PROBE_WIDTH * 4 + 3]!, maxError, exact: exact / PROBE_WIDTH, distinct: seen.size };
  });
}

const SKIN = ['#F2D3BD', '#C68642', '#8D5524', '#FFE0C8', '#5C3A21'];
const COAT = ['#3A3F4B', '#7A1F2B', '#1F4A7A', '#D8C8A0', '#101014'];

export async function runBench(set: AssetSet): Promise<BenchResult> {
  // 画面とは別のキャンバスで、読み込み前の状態から測る。
  const canvas = document.createElement('canvas');
  const composer = new Composer(set, canvas);
  const state: LabState = initialState(set);
  const render = (modeMultiply = false) => {
    const { plan, colors } = planOf(set, state);
    return composer.render(plan, colors, modeMultiply ? 'multiply' : undefined);
  };

  const first = await render();

  const redraws: number[] = [];
  for (let i = 0; i < 7; i++) redraws.push((await render()).totalMs);

  const colorChange: BenchResult['colorChange'] = [];
  const measure = async (label: string, apply: (color: string) => void, palette: string[]) => {
    const runs: RenderStats[] = [];
    for (const color of [...palette.slice(1), palette[0]!]) {
      apply(color);
      runs.push(await render());
    }
    colorChange.push({
      label,
      totalMs: median(runs.map((r) => r.totalMs)),
      recolorMs: median(runs.map((r) => r.recolorMs)),
      recolored: runs[0]!.recolored,
      recoloredPixels: runs[0]!.recoloredPixels,
    });
  };
  await measure('共有カラー skin.base（素体・輪郭・耳）', (c) => (state.shared['skin.base'] = c), SKIN);
  await measure('コートの main（後ろ身頃・前身頃・両袖）', (c) => (state.overrides['dev.coat_01'] = { main: { color: c } }), COAT);
  await measure('共有カラー hair.base（前髪・後髪・眉）', (c) => (state.shared['hair.base'] = c), ['#5A3E2B', '#0A0A0A', '#E8D080', '#F8F8F8', '#FF70A0']);

  composer.clearTintCache();
  const recolorAll = await render();

  const memory = composer.memory();

  const t0 = performance.now();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  const png = { ms: performance.now() - t0, bytes: blob?.size ?? 0 };

  state.armRight = 'pocket';
  const poseChange = await render();

  return {
    set: set.name,
    canvas: [set.width, set.height],
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    first,
    redrawMs: median(redraws),
    colorChange,
    recolorAll,
    poseChange,
    memory,
    allAssetsPixels: set.index.parts.reduce((sum, p) => sum + p.pixels, 0),
    png,
    alphaProbe: await probeAlpha(),
  };
}
