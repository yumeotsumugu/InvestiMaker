// ワイヤーフレーム（docs/design/wireframes/phase1c-wireframes.html）を、画面ごとの PNG にする。
//
//   node tools/render-wireframes.ts
//
// ローカルにインストール済みの Chrome / Edge をヘッドレスで使う。開くのはローカルのファイルだけ。

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Page, launchBrowser } from './cdp.ts';

const SOURCE = 'docs/design/wireframes/phase1c-wireframes.html';
const OUT = 'docs/design/wireframes/images';
mkdirSync(OUT, { recursive: true });

const browser = await launchBrowser();
try {
  const page = await Page.open(browser.cdp, pathToFileURL(resolve(SOURCE)).href, [1340, 900]);
  const frames = await page.waitFor<{ id: string; title: string }[]>('__frames');
  // 画像の読み込みを待つ
  await page.evaluate('Promise.all([...document.images].map((i) => i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })))');
  const broken = await page.evaluate<number>('[...document.images].filter((i) => i.naturalWidth === 0).length');
  if (broken > 0) throw new Error(`読み込めない画像が ${broken} 枚ある`);

  for (const frame of frames) {
    const box = await page.evaluate<{ x: number; y: number; width: number; height: number }>(
      `(() => { const r = document.getElementById(${JSON.stringify(frame.id)}).getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }; })()`,
    );
    const { data } = await page.send<{ data: string }>('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...box, scale: 1 } });
    writeFileSync(`${OUT}/${frame.id}.png`, Buffer.from(data, 'base64'));
    console.log(`${OUT}/${frame.id}.png  ${frame.title}`);
  }
  await page.close();
} finally {
  await browser.close();
}
