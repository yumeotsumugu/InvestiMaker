// 本体の最小 UI を、ヘッドレスの Chrome / Edge で実際に操作して確かめる。
//
//   node tools/browser-smoke.ts
//
// ボタン・選択・入力は画面の要素に対して行い、JSON の読込はファイル選択として行う。
// 途中で期待と違えば、その場で失敗して終了する。
// 結果は docs/reports/data/app-smoke.json と docs/reports/images/app_*.png に書く。

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { Page, launchBrowser } from './cdp.ts';

const OUT_DATA = 'docs/reports/data';
const OUT_IMAGES = 'docs/reports/images';
mkdirSync(OUT_DATA, { recursive: true });
mkdirSync(OUT_IMAGES, { recursive: true });

const steps: { step: string; result: unknown }[] = [];
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`期待と違う: ${message}`);
}

const server = await createServer({ server: { port: 5197, strictPort: false }, logLevel: 'error' });
await server.listen();
const address = server.httpServer!.address();
if (!address || typeof address === 'string') throw new Error('開発サーバーのアドレスが取れない');
const base = `http://127.0.0.1:${address.port}/`;
const browser = await launchBrowser();
const temp = mkdtempSync(join(tmpdir(), 'investimaker-smoke-'));

try {
  console.log(`${browser.product}（ヘッドレス） / ${base}`);
  const page = await Page.open(browser.cdp, base, [1500, 1300]);
  await page.waitFor('__app');

  // ---- 画面の操作
  const settle = () => page.evaluate<void>('window.__app.idle()');
  const click = async (selector: string) => {
    await page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('要素がない: ' + ${JSON.stringify(selector)}); el.click(); })()`);
    await settle();
  };
  const input = async (selector: string, value: string) => {
    await page.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('要素がない: ' + ${JSON.stringify(selector)});
      el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await settle();
  };
  const loadFile = async (name: string, text: string) => {
    const path = join(temp, name);
    writeFileSync(path, text);
    await page.setFiles('[data-role="load-file"]', [path]);
    await page.evaluate('new Promise((r) => setTimeout(r, 150))'); // ファイルの読み取りを待つ
    await settle();
  };

  // ---- 画面と状態の読み取り
  interface Snapshot {
    validity: string;
    notice: string | null;
    exportDisabled: boolean;
    blocked: string | null;
    issues: string[];
    equipped: string[];
    missingListed: string[];
    duplicates: string[];
    character: string;
    drawn: number;
    opaque: number;
  }
  const snapshot = () =>
    page.evaluate<Snapshot>(`(() => {
      const text = (sel) => document.querySelector(sel)?.textContent ?? null;
      const cv = document.querySelector('[data-role="preview"]');
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let opaque = 0; for (let i = 3; i < d.length; i += 4) if (d[i] === 255) opaque++;
      const app = window.__app;
      return {
        validity: text('[data-role="validity"]'),
        notice: text('[data-role="notice"]'),
        exportDisabled: document.querySelector('[data-action="export"]').disabled,
        blocked: text('[data-role="export-blocked"]'),
        issues: [...document.querySelectorAll('.issues li')].map((li) => li.textContent),
        equipped: app.character.equipment.filter((i) => i.equipped).map((i) => i.partId),
        missingListed: [...document.querySelectorAll('[data-category="missing"] [data-instance]')].map((el) => el.dataset.part),
        duplicates: [...document.querySelectorAll('[data-role="duplicate"]')].map((el) => el.dataset.category),
        character: JSON.stringify(app.character),
        drawn: app.inspection.plan ? app.inspection.plan.entries.filter((e) => e.status === 'draw').length : 0,
        opaque,
      };
    })()`);
  const instanceOf = (partId: string) =>
    page.evaluate<string>(`window.__app.character.equipment.findLast((i) => i.partId === ${JSON.stringify(partId)}).instanceId`);
  const preview = () => page.evaluate<string>(`document.querySelector('[data-role="preview"]').toDataURL('image/png')`);
  const record = async (step: string, extra: object = {}) => {
    const s = await snapshot();
    const { character: _c, ...summary } = s;
    steps.push({ step, result: { ...summary, ...extra } });
    console.log(`  ${step}: ${s.validity}、装備 ${s.equipped.length}、描画 ${s.drawn} 枚`);
    return s;
  };

  // 1) 新規作成
  await click('[data-action="new"]');
  await input('[data-role="name"]', '夢生ツムグ');
  let s = await record('新規作成');
  check(s.validity === 'VALID' && s.equipped.length === 13 && s.opaque > 100_000, '新規作成で素体と基本の Part が描画される');
  await page.screenshot(`${OUT_IMAGES}/app_new.png`);

  // 2) Part 選択：同じ category の別の Part に切り替える
  await click('[data-action="equip"][data-part="dev.shirt_02"]');
  await click('[data-action="equip"][data-part="dev.hair_front_02"]');
  await click('[data-action="equip"][data-part="dev.glasses_01"]');
  s = await record('Part 選択');
  check(s.equipped.includes('dev.shirt_02') && !s.equipped.includes('dev.shirt_01'), 'シャツが切り替わり、前のシャツは外れる');
  check(s.equipped.includes('dev.hair_front_02') && !s.equipped.includes('dev.hair_front_01'), '前髪が切り替わる');
  check(JSON.parse(s.character).equipment.some((i: { partId: string; equipped: boolean }) => i.partId === 'dev.shirt_01' && !i.equipped), '外したシャツの Instance は残る');
  check(s.duplicates.length === 0, '通常の操作では category の重複が起きない');

  // 3) 色：個別色、共有色、リンクの解除
  await click(`[data-action="select"][data-instance="${await instanceOf('dev.shirt_02')}"]`);
  await input('[data-slot="main"]', '#e60033');
  await input('[data-shared="hair.base"]', '#202028');
  await click(`[data-action="select"][data-instance="${await instanceOf('dev.eyebrows_01')}"]`);
  await click('[data-link="color"]');
  s = await record('色変更');
  const afterColor = JSON.parse(s.character) as { sharedColors: Record<string, string>; equipment: { partId: string; colors: Record<string, { linked?: boolean; color?: string }> }[] };
  check(afterColor.sharedColors['hair.base'] === '#202028', '共有色が変わる');
  check(afterColor.equipment.find((i) => i.partId === 'dev.shirt_02')!.colors.main!.color === '#E60033', '個別色が変わる');
  const brow = afterColor.equipment.find((i) => i.partId === 'dev.eyebrows_01')!.colors.color!;
  check(brow.linked === false && brow.color === '#202028', 'リンク解除時に、その時点の共有色が個別色へコピーされる');

  // 4) Transform：基本の補正と、条件別の補正
  await click(`[data-action="select"][data-instance="${await instanceOf('dev.glasses_01')}"]`);
  const beforeTransform = await preview();
  await input('[data-transform="y"]', '-40');
  await input('[data-transform="rotation"]', '10');
  const withBase = await preview();
  check(withBase !== beforeTransform, '基本の補正がプレビューに反映される');
  await input('[data-transform="scope"]', 'arm.right');
  await input('[data-transform="x"]', '60');
  const withOverride = await preview();
  check(withOverride !== withBase, '条件別の補正が、基本の補正を置き換える');
  await input('[data-state="pose.arm.right"]', 'pocket');
  const otherPose = await preview();
  s = await record('Transform');
  check(otherPose !== withOverride, 'ポーズを変えると、条件に当てはまらなくなる');
  await input('[data-state="pose.arm.right"]', 'down');
  check((await preview()) === withOverride, 'ポーズを戻すと、条件別の補正に戻る');
  await input('[data-state="expression"]', 'smile');
  await input('[data-state="fit.chest"]', 'large');
  await page.screenshot(`${OUT_IMAGES}/app_edited.png`);

  // 5) JSON 保存 → 新規作成 → JSON 読込 → 同じ画像
  await click('[data-action="save"]');
  await click('[data-action="export"]');
  const saved = await page.evaluate<string>('window.__app.hooks.lastSaved');
  const pngBefore = await page.evaluate<string>('window.__app.hooks.lastPng');
  const characterBefore = (await snapshot()).character;
  writeFileSync(`${OUT_DATA}/app-smoke-character.json`, saved);
  writeFileSync(`${OUT_IMAGES}/app_export.png`, Buffer.from(pngBefore.replace(/^data:image\/png;base64,/, ''), 'base64'));

  await click('[data-action="new"]');
  check((await snapshot()).character !== characterBefore, '新規作成で別のキャラクターになる');
  await loadFile('saved.json', saved);
  await click('[data-action="export"]');
  s = await record('保存 → 読込');
  check(s.character === characterBefore, '読み込んだ Character が保存前と同じ');
  check((await page.evaluate<string>('window.__app.hooks.lastPng')) === pngBefore, '読み込み後の PNG が保存前と同じ');

  // 6) 不足 Part：読み込めて、PNG も出せる。保存しても Instance が残る
  const withMissing = JSON.parse(saved);
  const coat = {
    instanceId: '00000000-0000-4000-8000-000000000099',
    partId: 'author.special_coat',
    equipped: true,
    colors: { main: { color: '#7A1F2B' } },
    transform: { x: 4, y: -12 },
  };
  withMissing.equipment.splice(2, 0, coat);
  await loadFile('missing.json', JSON.stringify(withMissing));
  s = await record('不足 Part');
  check(s.validity === 'UNRESOLVED' && s.missingListed.includes('author.special_coat'), '不足 Part が表示され、UNRESOLVED になる');
  check(!s.exportDisabled && s.drawn > 0, '不足 Part があっても PNG を出力できる');
  await click('[data-action="export"]');
  await click('[data-action="save"]');
  const resaved = JSON.parse(await page.evaluate<string>('window.__app.hooks.lastSaved'));
  check(JSON.stringify(resaved.equipment[2]) === JSON.stringify(coat), '不足 Part の Instance が、位置・色・transform ごと保存される');
  check(resaved.requirements.parts.includes('author.special_coat'), 'requirements に不足 Part が残る');
  await page.screenshot(`${OUT_IMAGES}/app_missing.png`);

  // 7) 実装が知らないポーズ：読み込めるが、描画と PNG 出力はできない
  const unknownPose = JSON.parse(saved);
  unknownPose.state.pose['arm.right'] = 'crossed';
  await loadFile('unknown-pose.json', JSON.stringify(unknownPose));
  s = await record('未知のポーズ');
  check(s.validity === 'UNRESOLVED' && s.exportDisabled && s.blocked !== null, '未知のポーズでは PNG 出力ができない');
  check(s.opaque === 0, '描画順が決まらないので、何も描かない');
  check(JSON.parse(s.character).state.pose['arm.right'] === 'crossed', '未知のポーズの値は保持する');

  // 7b) 描画される Layer が 0 件：Character は VALID のまま、PNG 出力だけができない
  await loadFile('saved-again.json', saved);
  await input('[data-state="view"]', 'side_left');
  s = await record('描画される Layer が 0 件');
  check(s.validity === 'VALID' && s.drawn === 0 && s.exportDisabled, '素材のない VIEW では PNG 出力ができない');
  check(s.blocked !== null && s.blocked.includes('描画できる Layer がありません'), '出力できない理由が表示される');
  await input('[data-state="view"]', 'front');
  check(!(await snapshot()).exportDisabled, 'VIEW を戻すと出力できる');
  await loadFile('unknown-pose-again.json', JSON.stringify(unknownPose));

  // 8) INVALID：現在のキャラクターを置き換えない
  const beforeInvalid = (await snapshot()).character;
  const invalid = JSON.parse(saved);
  invalid.canvas = [2000, 3000];
  await loadFile('invalid.json', JSON.stringify(invalid));
  s = await record('INVALID の読込');
  check(s.character === beforeInvalid, 'INVALID の JSON では現在のキャラクターが変わらない');
  check(s.notice !== null && s.notice.includes('読み込めない'), '読み込めない理由が表示される');
  await loadFile('broken.json', '{ "format": ');
  check((await snapshot()).character === beforeInvalid, '壊れた JSON でも現在のキャラクターが変わらない');

  // 9) category の重複：勝手に直さず、両方描画して注意を出す
  const duplicated = JSON.parse(saved);
  for (const inst of duplicated.equipment) if (inst.partId === 'dev.shirt_01') inst.equipped = true;
  await loadFile('duplicate.json', JSON.stringify(duplicated));
  s = await record('category の重複');
  check(s.validity === 'VALID' && s.duplicates.includes('outfit.top'), '重複が注意として表示される');
  check(s.equipped.includes('dev.shirt_01') && s.equipped.includes('dev.shirt_02'), '両方とも装備中のまま');
  await page.screenshot(`${OUT_IMAGES}/app_duplicate.png`);

  await page.close();
  writeFileSync(`${OUT_DATA}/app-smoke.json`, JSON.stringify({ browser: browser.product, headless: true, steps }, null, 2) + '\n');
  console.log(`すべて通過。${OUT_DATA}/app-smoke.json を書き出した`);
} finally {
  await browser.close();
  await server.close();
  rmSync(temp, { recursive: true, force: true });
}
