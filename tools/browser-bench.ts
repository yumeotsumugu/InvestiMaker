// 検証ページをヘッドレスの Chrome / Edge で開き、合成時間などを実測する。
//
//   node tools/browser-bench.ts
//
// - ローカルにインストール済みのブラウザを使う（BROWSER_PATH で指定可）。
// - 通信先は自分の PC 内（Vite の開発サーバーとブラウザの DevTools、どちらも 127.0.0.1）だけ。
// - 結果は docs/reports/data/browser-bench.json と docs/reports/images/ に書く。

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import type { BenchResult } from '../src/lab/bench.ts';
import { Page, launchBrowser } from './cdp.ts';
import { defaultState, renderCharacter } from './character.ts';
import { generateDevAssets } from './dev-assets.ts';
import { decodePng } from './png.ts';

const SIZES: [number, number][] = [
  [1200, 1800],
  [1600, 2400],
  [2000, 3000],
];
const RUNS = 3;
const OUT_DATA = 'docs/reports/data';
const OUT_IMAGES = 'docs/reports/images';

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

/** 複数回の計測から、時間は中央値、それ以外は最初の回の値を取る。 */
function summarize(runs: BenchResult[]) {
  const pick = (f: (r: BenchResult) => number) => Number(median(runs.map(f)).toFixed(1));
  const r0 = runs[0]!;
  return {
    canvas: r0.canvas,
    runs: runs.length,
    firstTotalMs: pick((r) => r.first.totalMs),
    firstLoadMs: pick((r) => r.first.loadMs),
    firstRecolorMs: pick((r) => r.first.recolorMs),
    firstDrawMs: pick((r) => r.first.drawMs),
    firstLayers: r0.first.drawn,
    redrawMs: pick((r) => r.redrawMs),
    colorChange: r0.colorChange.map((c, i) => ({
      label: c.label,
      totalMs: pick((r) => r.colorChange[i]!.totalMs),
      recolorMs: pick((r) => r.colorChange[i]!.recolorMs),
      recolored: c.recolored,
      recoloredMpx: Number((c.recoloredPixels / 1e6).toFixed(2)),
    })),
    recolorAllMs: pick((r) => r.recolorAll.totalMs),
    recolorAllMpx: Number((r0.recolorAll.recoloredPixels / 1e6).toFixed(2)),
    poseChangeMs: pick((r) => r.poseChange.totalMs),
    pngExportMs: pick((r) => r.png.ms),
    pngBytes: r0.png.bytes,
    memory: {
      images: r0.memory.images,
      sourceMpx: Number((r0.memory.sourcePixels / 1e6).toFixed(2)),
      cacheMpx: Number((r0.memory.cachePixels / 1e6).toFixed(2)),
      canvasMpx: Number((r0.memory.canvasPixels / 1e6).toFixed(2)),
      estimatedMB: Number((r0.memory.bytes / 1024 / 1024).toFixed(1)),
    },
    allAssetsMB: Number(((r0.allAssetsPixels * 4) / 1024 / 1024).toFixed(1)),
    fullCanvasLayersMB: Number(((r0.canvas[0] * r0.canvas[1] * 4 * r0.memory.images) / 1024 / 1024).toFixed(1)),
  };
}

/** ブラウザの書き出しと、ブラウザを使わない合成（tools/render.ts）を画素ごとに比べる。 */
function compareWithReference(dataUrl: string) {
  const browser = decodePng(Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
  const set = generateDevAssets(browser.width, browser.height);
  const reference = renderCharacter(set, defaultState(set)).bitmap;
  let differing = 0;
  let maxDiff = 0;
  let maxDiffOpaque = 0;
  let maxDiffPremultiplied = 0;
  for (let i = 0; i < reference.data.length; i += 4) {
    // アルファを乗算した値（画面に実際に現れる寄与）での差。
    for (let c = 0; c < 3; c++) {
      const a = (reference.data[i + c]! * reference.data[i + 3]!) / 255;
      const b = (browser.data[i + c]! * browser.data[i + 3]!) / 255;
      maxDiffPremultiplied = Math.max(maxDiffPremultiplied, Math.abs(a - b));
    }
    maxDiffPremultiplied = Math.max(maxDiffPremultiplied, Math.abs(reference.data[i + 3]! - browser.data[i + 3]!));
    let d = 0;
    for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(reference.data[i + c]! - browser.data[i + c]!));
    // アルファ 0 の画素は RGB が見えないので比べない。
    if (reference.data[i + 3] === 0 && browser.data[i + 3] === 0) continue;
    if (d > 0) differing++;
    maxDiff = Math.max(maxDiff, d);
    if (reference.data[i + 3] === 255) maxDiffOpaque = Math.max(maxDiffOpaque, d);
  }
  return { pixels: reference.data.length / 4, differing, maxDiff, maxDiffOpaque, maxDiffPremultiplied: Number(maxDiffPremultiplied.toFixed(2)) };
}

// ---------------------------------------------------------------- 実行

for (const [w, h] of SIZES) {
  const dir = `assets/bench/${w}x${h}`;
  if (existsSync(`${dir}/index.json`)) continue;
  console.log(`${dir} を生成…`);
  const res = spawnSync(process.execPath, ['tools/generate-dev-assets.ts', '--width', String(w), '--height', String(h), '--out', dir], { stdio: 'inherit' });
  if (res.status !== 0) throw new Error('仮素材の生成に失敗');
}

mkdirSync(OUT_DATA, { recursive: true });
mkdirSync(OUT_IMAGES, { recursive: true });

const server = await createServer({ server: { port: 5199, strictPort: false }, logLevel: 'error' });
await server.listen();
const address = server.httpServer!.address();
if (!address || typeof address === 'string') throw new Error('開発サーバーのアドレスが取れない');
const base = `http://127.0.0.1:${address.port}/`;

const browser = await launchBrowser();
const cdp = browser.cdp;

try {
  const version = { product: browser.product };
  console.log(`${version.product}（ヘッドレス） / ${base}`);

  const measure = async (throttle: number) => {
    const out = [];
    for (const [w, h] of SIZES) {
      const runs: BenchResult[] = [];
      for (let i = 0; i < RUNS; i++) {
        // 毎回新しいタブで開き、読み込み前の状態から測る。
        const page = await Page.open(cdp, `${base}lab.html?set=bench/${w}x${h}&bench=1`, undefined, throttle);
        runs.push(await page.waitFor<BenchResult>('__benchResult'));
        await page.close();
      }
      const summary = summarize(runs);
      console.log(`  ${w}×${h} ×${throttle}: 初回 ${summary.firstTotalMs} ms、全色変更 ${summary.recolorAllMs} ms、見積もり ${summary.memory.estimatedMB} MB`);
      out.push({ summary, alphaProbe: runs[0]!.alphaProbe, userAgent: runs[0]!.userAgent });
    }
    return out;
  };

  console.log('計測（CPU 制限なし）');
  const normal = await measure(1);
  console.log('計測（CPU 4 倍低速のエミュレーション）');
  const throttled = await measure(4);

  // 画面のスクリーンショットと、ブラウザからの書き出し。
  const page = await Page.open(cdp, `${base}lab.html`, [1500, 1100]);
  await page.waitFor('__lab');
  await page.screenshot(`${OUT_IMAGES}/lab_default.png`);
  const exported = await page.evaluate<string>('window.__lab.exportPng()');
  writeFileSync(`${OUT_IMAGES}/browser_export_default.png`, Buffer.from(exported.replace(/^data:image\/png;base64,/, ''), 'base64'));
  await page.evaluate(`document.querySelectorAll('input[name="arm-right"]')[1].click(); window.__lab.update()`);
  await page.screenshot(`${OUT_IMAGES}/lab_pocket.png`);
  await page.close();

  const result = {
    browser: version.product,
    headless: true,
    platform: `${process.platform} ${process.arch}`,
    userAgent: normal[0]!.userAgent,
    note: 'デスクトップ PC のヘッドレスブラウザでの値。スマホ実機の値ではない。',
    sizes: normal.map((n) => n.summary),
    sizesCpu4xSlower: throttled.map((n) => n.summary),
    alphaProbe: normal[1]!.alphaProbe,
    exportVsReference: compareWithReference(exported),
  };
  writeFileSync(`${OUT_DATA}/browser-bench.json`, JSON.stringify(result, null, 2) + '\n');
  console.log(`${OUT_DATA}/browser-bench.json を書き出した`);
} finally {
  await browser.close();
  await server.close();
}
