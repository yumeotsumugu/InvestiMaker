// 検証ページをヘッドレスの Chrome / Edge で開き、合成時間などを実測する。
//
//   node tools/browser-bench.ts
//
// - ローカルにインストール済みのブラウザを使う（BROWSER_PATH で指定可）。
// - 通信先は自分の PC 内（Vite の開発サーバーとブラウザの DevTools、どちらも 127.0.0.1）だけ。
// - 依存を増やさないため、DevTools Protocol を Node 標準の WebSocket で直接話す。
// - 結果は docs/reports/data/browser-bench.json と docs/reports/images/ に書く。

import type { ChildProcess } from 'node:child_process';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import type { BenchResult } from '../src/lab/bench.ts';
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

function findBrowser(): string {
  const candidates = [
    process.env.BROWSER_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  const found = candidates.find((p) => p && existsSync(p));
  if (!found) throw new Error('Chrome / Edge が見つからない。BROWSER_PATH で実行ファイルを指定してください。');
  return found;
}

/** DevTools Protocol の最小クライアント。 */
class Cdp {
  private nextId = 1;
  private readonly waiting = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  private readonly ws: WebSocket;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } };
      if (msg.id === undefined) return;
      const w = this.waiting.get(msg.id);
      this.waiting.delete(msg.id);
      if (msg.error) w?.reject(new Error(msg.error.message));
      else w?.resolve(msg.result);
    });
  }

  static connect(url: string): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => resolve(new Cdp(ws)));
      ws.addEventListener('error', () => reject(new Error(`DevTools に接続できない: ${url}`)));
    });
  }

  send<T = Record<string, unknown>>(method: string, params: object = {}, sessionId?: string): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  close() {
    this.ws.close();
  }
}

class Page {
  private readonly cdp: Cdp;
  private readonly sessionId: string;
  private readonly targetId: string;

  private constructor(cdp: Cdp, sessionId: string, targetId: string) {
    this.cdp = cdp;
    this.sessionId = sessionId;
    this.targetId = targetId;
  }

  static async open(cdp: Cdp, url: string, viewport?: [number, number], cpuThrottle = 1): Promise<Page> {
    const { targetId } = await cdp.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(cdp, sessionId, targetId);
    if (viewport) {
      await page.send('Emulation.setDeviceMetricsOverride', { width: viewport[0], height: viewport[1], deviceScaleFactor: 1, mobile: false });
    }
    if (cpuThrottle !== 1) await page.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle });
    await page.send('Page.enable');
    await page.send('Page.navigate', { url });
    return page;
  }

  send<T = Record<string, unknown>>(method: string, params: object = {}): Promise<T> {
    return this.cdp.send<T>(method, params, this.sessionId);
  }

  /** ページ内で式を評価する。Promise なら解決を待つ。 */
  async evaluate<T>(expression: string): Promise<T> {
    const res = await this.send<{ result: { value: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
    );
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
    return res.result.value;
  }

  /** `window` のプロパティが現れるまで待って、その値を返す。 */
  waitFor<T>(name: string): Promise<T> {
    return this.evaluate<T>(
      `new Promise((resolve) => { const t = setInterval(() => { if (window.${name}) { clearInterval(t); resolve(window.${name}); } }, 50); })`,
    );
  }

  async screenshot(path: string): Promise<void> {
    const { data } = await this.send<{ data: string }>('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(path, Buffer.from(data, 'base64'));
  }

  async close(): Promise<void> {
    await this.cdp.send('Target.closeTarget', { targetId: this.targetId });
  }
}

function launch(path: string, profile: string): Promise<{ process: ChildProcess; wsUrl: string }> {
  const child = spawn(
    path,
    ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('ブラウザが起動しない')), 30_000);
    child.stderr!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buffer);
      if (m) {
        clearTimeout(timer);
        resolve({ process: child, wsUrl: m[1]! });
      }
    });
    child.on('error', reject);
  });
}

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
  for (let i = 0; i < reference.data.length; i += 4) {
    let d = 0;
    for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(reference.data[i + c]! - browser.data[i + c]!));
    // アルファ 0 の画素は RGB が見えないので比べない。
    if (reference.data[i + 3] === 0 && browser.data[i + 3] === 0) continue;
    if (d > 0) differing++;
    maxDiff = Math.max(maxDiff, d);
    if (reference.data[i + 3] === 255) maxDiffOpaque = Math.max(maxDiffOpaque, d);
  }
  return { pixels: reference.data.length / 4, differing, maxDiff, maxDiffOpaque };
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

const browserPath = findBrowser();
const profile = mkdtempSync(join(tmpdir(), 'investimaker-bench-'));
const browser = await launch(browserPath, profile);
const cdp = await Cdp.connect(browser.wsUrl);

try {
  const version = await cdp.send<{ product: string }>('Browser.getVersion');
  console.log(`${version.product}（ヘッドレス） / ${base}`);

  const measure = async (throttle: number) => {
    const out = [];
    for (const [w, h] of SIZES) {
      const runs: BenchResult[] = [];
      for (let i = 0; i < RUNS; i++) {
        // 毎回新しいタブで開き、読み込み前の状態から測る。
        const page = await Page.open(cdp, `${base}?set=bench/${w}x${h}&bench=1`, undefined, throttle);
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
  const page = await Page.open(cdp, base, [1500, 1100]);
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
  cdp.close();
  browser.process.kill();
  await server.close();
  await new Promise((r) => setTimeout(r, 500));
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
