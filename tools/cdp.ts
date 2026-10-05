// ヘッドレスの Chrome / Edge を DevTools Protocol で操作する最小クライアント。
// 依存を増やさないため、Node 標準の WebSocket で直接話す。通信先は自分の PC 内（127.0.0.1）だけ。

import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function findBrowser(): string {
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

export class Cdp {
  private nextId = 1;
  private readonly waiting = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  private readonly ws: WebSocket;
  private readonly listeners: ((method: string, params: Record<string, unknown>, sessionId?: string) => void)[] = [];

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: Record<string, unknown>; sessionId?: string };
      if (msg.id === undefined) {
        if (msg.method) for (const listener of this.listeners) listener(msg.method, msg.params ?? {}, msg.sessionId);
        return;
      }
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

  /** ブラウザからの通知（イベント）を受け取る。 */
  onEvent(listener: (method: string, params: Record<string, unknown>, sessionId?: string) => void) {
    this.listeners.push(listener);
  }

  close() {
    this.ws.close();
  }
}

export class Page {
  private readonly cdp: Cdp;
  private readonly sessionId: string;
  private readonly targetId: string;

  private constructor(cdp: Cdp, sessionId: string, targetId: string) {
    this.cdp = cdp;
    this.sessionId = sessionId;
    this.targetId = targetId;
  }

  /**
   * `requests` を渡すと、このページが読み込もうとした URL をすべて記録する（外部と通信していないことの確認用）。
   */
  static async open(cdp: Cdp, url: string, viewport?: [number, number], cpuThrottle = 1, requests?: string[]): Promise<Page> {
    const { targetId } = await cdp.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(cdp, sessionId, targetId);
    if (viewport) {
      await page.send('Emulation.setDeviceMetricsOverride', { width: viewport[0], height: viewport[1], deviceScaleFactor: 1, mobile: false });
    }
    if (cpuThrottle !== 1) await page.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle });
    await page.send('Page.enable');
    if (requests) {
      cdp.onEvent((method, params, session) => {
        if (session === sessionId && method === 'Network.requestWillBeSent') requests.push((params.request as { url: string }).url);
      });
      await page.send('Network.enable');
    }
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

  /** `<input type="file">` にローカルのファイルを選ばせる（利用者がファイルを選ぶ操作に相当）。 */
  async setFiles(selector: string, files: string[]): Promise<void> {
    const res = await this.send<{ result: { objectId?: string } }>('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(selector)})` });
    if (!res.result.objectId) throw new Error(`要素がない: ${selector}`);
    await this.send('DOM.setFileInputFiles', { files, objectId: res.result.objectId });
  }

  async screenshot(path: string): Promise<void> {
    const { data } = await this.send<{ data: string }>('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(path, Buffer.from(data, 'base64'));
  }

  async close(): Promise<void> {
    await this.cdp.send('Target.closeTarget', { targetId: this.targetId });
  }
}

export interface Browser {
  cdp: Cdp;
  product: string;
  close(): Promise<void>;
}

/** ブラウザを起動して接続する。終了時は `close()` で一時プロファイルごと片付ける。 */
export async function launchBrowser(extraArgs: string[] = []): Promise<Browser> {
  const profile = mkdtempSync(join(tmpdir(), 'investimaker-browser-'));
  const child: ChildProcess = spawn(
    findBrowser(),
    ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', ...extraArgs, 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const wsUrl = await new Promise<string>((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('ブラウザが起動しない')), 30_000);
    child.stderr!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buffer);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]!);
      }
    });
    child.on('error', reject);
  });
  const cdp = await Cdp.connect(wsUrl);
  const { product } = await cdp.send<{ product: string }>('Browser.getVersion');
  return {
    cdp,
    product,
    async close() {
      cdp.close();
      child.kill();
      await new Promise((r) => setTimeout(r, 500));
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}
