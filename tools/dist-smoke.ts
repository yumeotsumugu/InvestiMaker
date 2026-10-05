// 配布物の検証（基本設計書 v1.0 §18.3 Distribution Smoke Test、§18.4 Offline Test）。
//
//   node tools/dist-smoke.ts [--write]
//
// 1. ソースから配布物を組み立てる。リポジトリのルートに置いてある配布物と同じであることを確かめる。
// 2. 配布物を ZIP にする（release/InvestiMaker.zip）。OS の展開機能で、別のフォルダへ解凍する。
// 3. 解凍したフォルダの index.html を、ファイルとして開く（file://）。このブラウザは、外部と通信できない状態で起動する。
// 4. 同じ ZIP を解凍したものを、静的な HTTP サーバーで配る（GitHub Pages と同じく、サブフォルダの下に置く）。
// 5. 両方で、同じ操作を画面の要素に対して行う：
//      スタート画面 → 作成を開始 → カスタマイズ → JSON を保存 → 別のキャラクターを作る → JSON を読み込む → PNG を書き出す
// 6. 両方の保存データと PNG を比べる。
//
// 途中で期待と違えば、その場で失敗して終了する。
// --write を付けたときだけ、画面の画像を docs/reports/images/distribution_*.png に、結果を docs/reports/data/distribution-smoke.json に書く。

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Browser } from './cdp.ts';
import { Page, launchBrowser } from './cdp.ts';
import { buildDistribution } from './distribution.ts';
import { decodePng } from './png.ts';
import { unzip, zip } from './zip.ts';

const WRITE = process.argv.includes('--write');
const ZIP_PATH = 'release/InvestiMaker.zip';
const OUT_DATA = 'docs/reports/data';
const OUT_IMAGES = 'docs/reports/images';
/** GitHub Pages では、リポジトリ名のサブフォルダの下に置かれる。同じ形で配る。 */
const WEB_PREFIX = '/InvestiMaker/';

const checks: string[] = [];
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`期待と違う: ${message}`);
  checks.push(message);
}
const sha = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

// ---------------------------------------------------------------- 1. 組み立てる

const files = await buildDistribution();
const names = Object.keys(files).sort();
check(names.join(' ') === 'app/assets.js app/investimaker.css app/investimaker.js customize.html export.html index.html', '配布物は、3 つのページと app/ の 3 ファイルだけ（開発用のページを含まない）');
const stale = names.filter((name) => !existsSync(name) || readFileSync(name, 'utf8') !== files[name]);
check(stale.length === 0, `リポジトリのルートの配布物が、ソースから作ったものと同じ（違う場合は npm run build:site で作り直す）${stale.length ? `：${stale.join('、')}` : ''}`);

// 外部の URL を読み込む記述がないこと（CDN・外部フォント・解析タグを使わない）。
for (const name of names.filter((n) => n.endsWith('.html'))) {
  const refs = [...files[name]!.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]!);
  check(refs.length > 0 && refs.every((ref) => /^app\/[a-z]+\.(?:js|css)\?v=[0-9a-f]+$/.test(ref)), `${name} が読み込むのは、app/ の中のファイルだけ`);
}
check(!/@import|url\(\s*["']?(?:https?:)?\/\//.test(files['app/investimaker.css']!), 'スタイルが、外部のファイルを読み込まない');

// ---------------------------------------------------------------- 2. ZIP にして、解凍する

const archive = zip(Object.fromEntries(names.map((name) => [name, Buffer.from(files[name]!, 'utf8')])));
mkdirSync(dirname(ZIP_PATH), { recursive: true });
writeFileSync(ZIP_PATH, archive);
check(Object.keys(unzip(archive)).includes('index.html'), 'ZIP のルートに index.html がある');

const temp = mkdtempSync(join(tmpdir(), 'investimaker-dist-'));
const localDir = join(temp, 'local', 'InvestiMaker');
const webDir = join(temp, 'web', 'InvestiMaker');

/** 利用者と同じように、OS の展開機能で解凍する。使えない環境では、このリポジトリの読み取り処理を使う。 */
function extract(to: string): string {
  mkdirSync(to, { recursive: true });
  const tools: [name: string, command: string, args: string[]][] =
    process.platform === 'win32'
      ? [['Windows 付属の tar', join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe'), ['-xf', resolve(ZIP_PATH), '-C', to]]]
      : [['unzip', 'unzip', ['-q', resolve(ZIP_PATH), '-d', to]]];
  for (const [name, command, args] of tools) {
    try {
      execFileSync(command, args, { stdio: 'ignore' });
      return name;
    } catch {
      // 次の手段へ
    }
  }
  for (const [name, data] of Object.entries(unzip(readFileSync(ZIP_PATH)))) {
    mkdirSync(dirname(join(to, name)), { recursive: true });
    writeFileSync(join(to, name), data);
  }
  return 'tools/zip.ts';
}
const extractedWith = extract(localDir);
extract(webDir);
for (const dir of [localDir, webDir]) {
  const found = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name).slice(dir.length + 1).replaceAll('\\', '/'))
    .sort();
  check(found.join(' ') === names.join(' ') && names.every((name) => readFileSync(join(dir, name), 'utf8') === files[name]), `解凍した中身が、配布物と同じ（${dir === localDir ? 'ローカル用' : 'Web 用'}）`);
}

// ---------------------------------------------------------------- 4. 静的な HTTP サーバー

const TYPES: Record<string, string> = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8' };
const served: string[] = [];
const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname);
  const name = path.startsWith(WEB_PREFIX) ? path.slice(WEB_PREFIX.length) || 'index.html' : null;
  if (name === null || !names.includes(name)) {
    response.writeHead(404).end();
    return;
  }
  served.push(name);
  response.writeHead(200, { 'Content-Type': TYPES[name.split('.').pop()!] ?? 'application/octet-stream' }).end(readFileSync(join(webDir, name)));
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

// ---------------------------------------------------------------- 5. 同じ操作を、両方で行う

interface FlowResult {
  /** 自分で作って保存した Character JSON。 */
  json: string;
  /** 保存 → 読込の後に書き出した PNG（data URL）。 */
  png: string;
  requests: string[];
}

class Flow {
  readonly page: Page;
  readonly label: string;
  readonly requests: string[];
  private readonly shots: string;

  private constructor(page: Page, label: string, requests: string[], shots: string) {
    this.page = page;
    this.label = label;
    this.requests = requests;
    this.shots = shots;
  }

  static async open(browser: Browser, url: string, label: string, shots: string): Promise<Flow> {
    const requests: string[] = [];
    return new Flow(await Page.open(browser.cdp, url, [1280, 800], 1, requests), label, requests, shots);
  }

  /** 指定のページが開き、使えるようになるまで待つ（移動中は評価が中断されるので、待ち直す）。 */
  async at(page: 'create' | 'customize' | 'export') {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.page.evaluate('new Promise((r) => setTimeout(r, 100))');
        if ((await this.page.evaluate<string>(`window.__creator ? document.body.dataset.page : ''`)) === page) {
          await this.page.evaluate<void>('window.__creator.idle()');
          return;
        }
      } catch {
        // 移動中
      }
      if (attempt >= 100) throw new Error(`${this.label}: ${page} のページが開かない`);
    }
  }

  get<T>(expression: string) {
    return this.page.evaluate<T>(expression);
  }

  async click(selector: string) {
    await this.get(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('要素がない: ' + ${JSON.stringify(selector)}); if (el.disabled) throw new Error('押せない: ' + ${JSON.stringify(selector)}); el.click(); })()`);
    await this.get('new Promise((r) => setTimeout(r, 50))');
  }

  async type(selector: string, value: string) {
    await this.get(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  }

  async shot(name: string) {
    if (WRITE) await this.page.screenshot(`${OUT_IMAGES}/distribution_${this.shots}_${name}.png`);
  }

  equipped() {
    return this.get<string[]>('window.__creator.character.equipment.filter((i) => i.equipped).map((i) => i.partId)');
  }

  /** 「保存」を押して、保存された JSON を返す。 */
  async save() {
    await this.click('[data-action="save"]');
    return this.get<string>('window.__creator.hooks.lastSaved');
  }

  /** スタート画面で「保存データを読み込む」を押し、ファイルを選ぶ。 */
  async load(path: string) {
    await this.click('[data-action="create-load"]');
    if (await this.get<boolean>(`!!document.querySelector('[data-role="modal"]')`)) await this.click('[data-action="confirm-discard"]');
    await this.page.setFiles('[data-role="load-file"]', [path]);
    await this.at('customize');
  }

  /** 書き出しのページへ移り、PNG を書き出す。 */
  async exportPng() {
    await this.click('[data-step="export"]');
    await this.at('export');
    await this.click('[data-action="export"]');
    await this.get('new Promise((r) => setTimeout(r, 200))');
    await this.get<void>('window.__creator.idle()');
    return this.get<string>('window.__creator.hooks.lastPng');
  }

  /** スタート画面 → 作成 → 保存 → 別のキャラクター → 読込 → 書き出し。 */
  async run(): Promise<FlowResult> {
    const { label } = this;
    await this.at('create');
    const start = await this.get<{ header: string; steps: string; presets: string[]; drawn: number; character: boolean; text: string; broken: number }>(`({
      header: getComputedStyle(document.querySelector('.hd')).display,
      steps: getComputedStyle(document.querySelector('.steps')).display,
      presets: [...document.querySelectorAll('[data-preset]')].map((el) => el.dataset.preset),
      drawn: window.__creator.inspection ? window.__creator.inspection.drawn : 0,
      character: window.__creator.character !== null,
      text: document.querySelector('#app').innerText,
      broken: [...document.images].filter((i) => i.naturalWidth === 0).length,
    })`);
    check(start.header === 'none' && start.steps === 'none' && !start.character, `${label}: index.html はスタート画面で、まだキャラクターはない`);
    check(['キャラクターの名前', 'はじめのセット', '作成を開始', '保存データを読み込む'].every((t) => start.text.includes(t)), `${label}: スタート画面に、名前・はじめのセット・「作成を開始」・「保存データを読み込む」がある`);
    check(start.presets.length === 2 && start.drawn > 0, `${label}: はじめのセットを選べて、選んだセットの見た目が出る`);

    // CREATE：名前とセットを決めて始める
    await this.type('[data-create="name"]', '夢生ツムグ');
    await this.click('[data-preset$=":starter"]');
    await this.get<void>('window.__creator.idle()');
    await this.shot('1_start');
    await this.click('[data-action="start"]');
    await this.at('customize');
    check((await this.get<string>('window.__creator.character.name')) === '夢生ツムグ' && (await this.equipped()).length === 13, `${label}: 「作成を開始」でページが移り、基本のセットを付けたキャラクターができる`);

    // CUSTOMIZE：髪を変える
    await this.click('[data-card="dev.hair_front_02"]');
    await this.get<void>('window.__creator.idle()');
    check((await this.equipped()).includes('dev.hair_front_02') && (await this.get<number>('window.__creator.inspection.drawn')) > 0, `${label}: パーツを選ぶと、装備と表示が変わる`);
    await this.shot('2_customize');

    // JSON を保存
    const json = await this.save();
    check(JSON.parse(json).name === '夢生ツムグ', `${label}: キャラクターを JSON に保存できる`);
    const saved = join(temp, `${this.shots}-own.json`);
    writeFileSync(saved, json);

    // 別のキャラクターを作ってから、保存した JSON を読み込む
    await this.click('[data-step="create"]');
    await this.at('create');
    check(await this.get<boolean>(`!!document.querySelector('[data-action="resume"]')`), `${label}: スタート画面に戻ると、編集中のキャラクターの続きを選べる`);
    await this.type('[data-create="name"]', '別のキャラクター');
    await this.click('[data-preset$=":bare"]');
    await this.click('[data-action="start"]');
    await this.at('customize');
    check((await this.equipped()).length === 1, `${label}: 「素体だけ」で始めると、素体だけのキャラクターができる`);
    await this.click('[data-step="create"]');
    await this.at('create');
    await this.load(saved);
    check((await this.save()) === json, `${label}: 読み込んで保存し直した JSON が、元の JSON と 1 バイトも違わない`);

    // PNG を書き出す
    const png = await this.exportPng();
    await this.shot('3_export');
    const image = decodePng(Buffer.from(png.slice(png.indexOf(',') + 1), 'base64'));
    check(image.width === 1600 && image.height === 2400, `${label}: 1600×2400 の PNG を書き出せる`);
    check((await this.get<number>('[...document.images].filter((i) => i.naturalWidth === 0).length')) === 0, `${label}: 読み込めない画像がない`);
    return { json, png, requests: this.requests };
  }

  /** 渡された JSON を読み込み、保存し直した JSON と、書き出した PNG を返す。 */
  async reproduce(path: string) {
    await this.click('[data-step="create"]');
    await this.at('create');
    await this.load(path);
    const json = await this.save();
    return { json, png: await this.exportPng() };
  }
}

/** 外部と通信できないブラウザ：すべての通信を、存在しない中継先へ向ける（自分の PC 宛ても含む）。 */
const offline = await launchBrowser(['--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>']);
const online = await launchBrowser();
let report: Record<string, unknown> = {};
try {
  console.log(`${online.product}（ヘッドレス）`);
  const reach = async (browser: Browser) => {
    // 配布物を置いたサーバーのページを開いてみる。届けばスタート画面が出て、届かなければブラウザのエラー画面になる。
    const page = await Page.open(browser.cdp, `${origin}${WEB_PREFIX}`);
    let result = 'blocked';
    for (let attempt = 0; attempt < 30 && result === 'blocked'; attempt++) {
      try {
        await page.evaluate('new Promise((r) => setTimeout(r, 100))');
        if (await page.evaluate<boolean>(`location.href.startsWith(${JSON.stringify(origin)}) && !!window.__creator`)) result = 'reached';
      } catch {
        // 移動中
      }
    }
    await page.close();
    return result;
  };
  check((await reach(online)) === 'reached' && (await reach(offline)) === 'blocked', 'オフライン用のブラウザは、通信ができない状態になっている（通常のブラウザでは届く相手に、届かない）');

  const localUrl = pathToFileURL(join(localDir, 'index.html')).href;
  const webUrl = `${origin}${WEB_PREFIX}`;
  console.log(`  ローカル：${localUrl}（通信できない状態）`);
  const local = await Flow.open(offline, localUrl, 'ローカル（file://・オフライン）', 'local');
  const localResult = await local.run();
  console.log(`  Web：${webUrl}`);
  const web = await Flow.open(online, webUrl, 'Web（静的 HTTP）', 'web');
  const webResult = await web.run();

  // ---- 通信の記録
  const localRoot = pathToFileURL(localDir).href;
  const inline = (url: string) => url.startsWith('data:') || url.startsWith('blob:');
  const localOutside = localResult.requests.filter((url) => !inline(url) && !url.startsWith(`${localRoot}/`));
  const webOutside = webResult.requests.filter((url) => !inline(url) && !url.startsWith(`${origin}/`));
  check(localResult.requests.some((url) => url.startsWith(localRoot)) && localOutside.length === 0, `ローカル：読み込んだのは、解凍したフォルダの中のファイルだけ（外部への通信は 0 件）${localOutside.length ? `：${localOutside.join('、')}` : ''}`);
  check(webOutside.length === 0, `Web：読み込んだのは、配布物を置いたサーバーのファイルだけ（ほかへの通信は 0 件）${webOutside.length ? `：${webOutside.join('、')}` : ''}`);
  check(names.every((name) => served.includes(name)), 'Web：配布物の全ファイルが、サーバーから配られた');

  // ---- 6. 両方の結果を比べる
  // ID は作るたびに変わる（乱数）ので、同じ操作で作った JSON は、ID を出てきた順の番号に置き換えて比べる。
  const withoutIds = (json: string) => {
    const seen: string[] = [];
    return json.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (id) => `id-${seen.includes(id) ? seen.indexOf(id) : seen.push(id) - 1}`);
  };
  check(withoutIds(localResult.json) === withoutIds(webResult.json), '同じ操作で作った保存データが、ローカルと Web で同じ（作るたびに変わる ID を除く）');
  check(localResult.png === webResult.png, '同じ操作で作った PNG が、ローカルと Web で 1 バイトも違わない');

  // 同じ Character（ローカルで保存した JSON）を、両方で読み込んで比べる。
  const shared = join(temp, 'local-own.json');
  const localAgain = await local.reproduce(shared);
  const webAgain = await web.reproduce(shared);
  check(localAgain.json === localResult.json && webAgain.json === localResult.json, '同じ Character を読み込んで保存し直した JSON が、ローカルと Web で 1 バイトも違わない');
  check(localAgain.png === webAgain.png && localAgain.png === localResult.png, '同じ Character から書き出した PNG が、ローカルと Web で 1 バイトも違わない');

  report = {
    browser: online.product,
    zip: { path: ZIP_PATH, bytes: archive.length, sha256: sha(archive), extractedWith },
    files: Object.fromEntries(names.map((name) => [name, { bytes: Buffer.byteLength(files[name]!), sha256: sha(files[name]!) }])),
    local: { url: 'file://…/InvestiMaker/index.html', offline: true, requests: localResult.requests.length, outside: localOutside.length },
    web: { url: `http://127.0.0.1:<port>${WEB_PREFIX}`, requests: webResult.requests.length, outside: webOutside.length },
    result: { characterJsonSha256: sha(localResult.json), pngSha256: sha(Buffer.from(localResult.png.slice(localResult.png.indexOf(',') + 1), 'base64')) },
    checks,
  };
  await local.page.close();
  await web.page.close();
} finally {
  await offline.close();
  await online.close();
  await new Promise((done) => server.close(done));
  rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

for (const line of checks) console.log(`  ✓ ${line}`);
console.log(`配布物の検証：${checks.length} 項目すべて通った（${ZIP_PATH}、${(archive.length / 1024).toFixed(0)} KB）`);
if (WRITE) {
  mkdirSync(OUT_DATA, { recursive: true });
  writeFileSync(`${OUT_DATA}/distribution-smoke.json`, `${JSON.stringify(report, null, 2)}\n`);
}
