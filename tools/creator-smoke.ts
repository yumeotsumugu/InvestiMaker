// Creator UI（開発用のページ dev/index.html → dev/customize.html → dev/export.html）を、ヘッドレスの Chrome / Edge で実際に操作して確かめる。
//
//   node tools/creator-smoke.ts [--write]
//
// ボタン・カード・入力は画面の要素に対して行い、JSON の読込はファイル選択として行う。
// 途中で期待と違えば、その場で失敗して終了する。
// --write を付けたときだけ、画面の画像を docs/reports/images/creator_*.png に、結果を docs/reports/data/creator-smoke.json に書く。

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { Page, launchBrowser } from './cdp.ts';

const WRITE = process.argv.includes('--write');
const OUT_DATA = 'docs/reports/data';
const OUT_IMAGES = 'docs/reports/images';
if (WRITE) {
  mkdirSync(OUT_DATA, { recursive: true });
  mkdirSync(OUT_IMAGES, { recursive: true });
}

const steps: { step: string; result: unknown }[] = [];
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`期待と違う: ${message}`);
}

/** 通常の画面に出てはいけない内部の語。 */
const INTERNAL = /UNRESOLVED|INVALID|\bVALID\b|Instance|instanceId|Layer|manifest|category|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|dev\.[a-z0-9_]+|\b(?:face|hair|outfit|arm)\.[a-z.]+/;

const server = await createServer({ server: { port: 5196, strictPort: false }, logLevel: 'error' });
await server.listen();
const address = server.httpServer!.address();
if (!address || typeof address === 'string') throw new Error('開発サーバーのアドレスが取れない');
const base = `http://127.0.0.1:${address.port}/`;
const browser = await launchBrowser();
const temp = mkdtempSync(join(tmpdir(), 'investimaker-creator-'));

try {
  console.log(`${browser.product}（ヘッドレス） / ${base}`);
  const page = await Page.open(browser.cdp, `${base}dev/index.html`, [1280, 800]);

  // ---- ページの移動
  /** 指定のページが開き、Creator UI が使えるようになるまで待つ（移動中は評価が中断されるので、待ち直す）。 */
  const waitPage = async (target: Page, file: string) => {
    for (let attempt = 0; ; attempt++) {
      try {
        await target.evaluate('new Promise((r) => setTimeout(r, 100))');
        const at = await target.evaluate<string>(`window.__creator ? location.pathname.split('/').pop() : ''`);
        if (at === file) {
          await target.evaluate<void>('window.__creator.idle()');
          return;
        }
      } catch {
        // 移動中
      }
      if (attempt >= 80) throw new Error(`${file} が開かない`);
    }
  };
  await waitPage(page, 'index.html');
  const pageName = () => page.evaluate<string>(`location.pathname.split('/').pop()`);
  /** 押すと別のページへ移る操作。 */
  const nav = async (selector: string, file: string) => {
    await page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('要素がない: ' + ${JSON.stringify(selector)}); if (el.disabled) throw new Error('押せない: ' + ${JSON.stringify(selector)}); el.click(); })()`);
    await waitPage(page, file);
  };

  // ---- 画面の操作
  const settle = async () => {
    await page.evaluate<void>('window.__creator.idle()');
    await page.evaluate('new Promise((r) => setTimeout(r, 30))'); // 「パーツの中心」など、非同期の後処理を待つ
    await page.evaluate<void>('window.__creator.idle()');
  };
  const click = async (selector: string) => {
    await page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('要素がない: ' + ${JSON.stringify(selector)}); if (el.disabled) throw new Error('押せない: ' + ${JSON.stringify(selector)}); el.click(); })()`);
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
  /** ファイルを選んで読み込む。`movesTo` は、読み込むと別のページへ移る場合の行き先。 */
  const loadFile = async (name: string, text: string, movesTo?: string) => {
    const path = join(temp, name);
    writeFileSync(path, text);
    await page.setFiles('[data-role="load-file"]', [path]);
    if (movesTo) return waitPage(page, movesTo);
    await page.evaluate('new Promise((r) => setTimeout(r, 150))');
    await settle();
  };
  const shot = async (name: string) => {
    if (WRITE) await page.screenshot(`${OUT_IMAGES}/creator_${name}.png`);
  };

  // ---- 画面と状態の読み取り
  interface Snapshot {
    step: string;
    text: string;
    visibleText: string;
    chip: string | null;
    message: string | null;
    notices: string[];
    title: string | null;
    equipped: string[];
    kept: string[];
    character: string | null;
    drawn: number;
    exportDisabled: boolean | null;
    modal: boolean;
  }
  const snapshot = () =>
    page.evaluate<Snapshot>(`(() => {
      const c = window.__creator;
      const text = (sel) => document.querySelector(sel)?.textContent ?? null;
      const internal = document.querySelector('[data-role="internal"]');
      // 内部情報の欄（詳細設定の中）を除いた、画面に見えている文字。
      const clone = document.querySelector('#app').cloneNode(true);
      for (const el of clone.querySelectorAll('[data-role="internal"], .detail, [hidden]')) el.remove();
      const exportButton = document.querySelector('[data-action="export"]');
      return {
        step: c.ui.step,
        text: document.querySelector('#app').innerText,
        visibleText: clone.textContent,
        chip: text('[data-role="chip"]'),
        message: text('[data-role="message"]'),
        notices: [...document.querySelectorAll('[data-notice]')].map((el) => el.querySelector('.notice-text').textContent),
        title: text('[data-role="edit-title"]'),
        equipped: c.character ? c.character.equipment.filter((i) => i.equipped).map((i) => i.partId) : [],
        kept: c.character ? c.character.equipment.filter((i) => !i.equipped).map((i) => i.partId) : [],
        character: c.character ? JSON.stringify(c.character) : null,
        drawn: c.inspection ? c.inspection.drawn : 0,
        exportDisabled: exportButton ? exportButton.disabled : null,
        modal: !!document.querySelector('[data-role="modal"]'),
      };
    })()`);
  const cards = () =>
    page.evaluate<{ id: string; selected: boolean; available: boolean; why: string | null }[]>(
      `[...document.querySelectorAll('[data-card]')].map((el) => ({ id: el.dataset.card, selected: el.dataset.selected === 'true', available: el.dataset.available === 'true', why: el.querySelector('.why')?.textContent ?? null }))`,
    );
  const preview = () => page.evaluate<string>(`document.querySelector('[data-role="preview"]').toDataURL('image/png')`);
  const record = async (step: string) => {
    const s = await snapshot();
    steps.push({ step, result: { step: s.step, chip: s.chip, message: s.message, notices: s.notices, title: s.title, equipped: s.equipped.length, drawn: s.drawn } });
    console.log(`  ${step}: 装備 ${s.equipped.length}、描画 ${s.drawn} 枚${s.notices.length ? `、注意 ${s.notices.length} 件` : ''}`);
    check(!INTERNAL.test(s.visibleText), `内部の語が画面に出ている（${step}）: ${INTERNAL.exec(s.visibleText)?.[0]}`);
    return s;
  };

  // 1) CREATE：名前を付けて始める
  let s = await record('CREATE（開いた直後）');
  check(s.step === 'create' && s.character === null, '最初は CREATE で、キャラクターはまだない');
  await shot('1_create');
  check((await pageName()) === 'index.html', '最初のページは index.html');
  await input('[data-create="name"]', '夢生ツムグ');
  await nav('[data-action="start"]', 'customize.html');
  s = await record('CUSTOMIZE（始めた直後）');
  check((await pageName()) === 'customize.html', '「作成を開始」で、作成画面のページ（customize.html）へ移る');
  check(s.step === 'customize' && s.equipped.length === 13 && s.drawn > 0, '基本のパーツを付けて始まる');
  check(s.notices.length === 0 && s.chip === null, '問題がなければ、状態は何も出さない');
  const started = JSON.parse(s.character!) as { name: string; sharedColors: Record<string, string> };
  check(started.name === '夢生ツムグ', '名前が入る');
  check(started.sharedColors['skin.base'] === '#F2D3BD' && started.sharedColors['hair.base'] === '#5A3E2B' && started.sharedColors['eyes.left'] === '#4A6FA5', '全体の色が、素材の既定色で始まる');

  // 2) 髪と服を選ぶ
  let list = await cards();
  check(list.some((c) => c.id === 'none') && list.find((c) => c.id === 'dev.hair_front_01')?.selected, '前髪の一覧に「なし」があり、いまの前髪が選ばれている');
  await click('[data-card="dev.hair_front_02"]');
  s = await snapshot();
  check(s.equipped.includes('dev.hair_front_02') && s.kept.includes('dev.hair_front_01'), '前髪が入れ替わり、前の前髪の設定は残る');
  check(s.title === '仮・前髪（ぱっつん）', 'カードを選ぶと、そのパーツが編集対象になる');
  await shot('2_customize_hair');
  await click('[data-major="outfit"]');
  await click('[data-card="dev.shirt_02"]');
  s = await record('髪と服を選ぶ');
  check(s.equipped.includes('dev.shirt_02') && !s.equipped.includes('dev.shirt_01'), 'トップスが入れ替わる');

  // 3) 色：個別の色、全体の色、「このパーツだけ色を変える」
  await input('[data-slot="main"]', '#e60033');
  await shot('3_color');
  await click('[data-major="hair"]');
  await click('[data-card="dev.hair_front_02"]');
  const beforeUnlink = await preview();
  await click('[data-own="base"]');
  check((await preview()) === beforeUnlink, '「このパーツだけ色を変える」に印を付けた瞬間は、見た目が変わらない');
  await input('[data-slot="base"]', '#e8d080');
  await click('[data-major="body"]');
  await input('[data-shared="hair.base"]', '#202028');
  s = await record('色変更');
  const colored = JSON.parse(s.character!) as { sharedColors: Record<string, string>; equipment: { partId: string; colors: Record<string, { linked?: boolean; color?: string }> }[] };
  check(colored.sharedColors['hair.base'] === '#202028', '全体の髪色が変わる');
  check(JSON.stringify(colored.equipment.find((i) => i.partId === 'dev.hair_front_02')!.colors.base) === JSON.stringify({ linked: false, color: '#E8D080' }), '前髪だけが別の色を持つ');
  check(colored.equipment.find((i) => i.partId === 'dev.shirt_02')!.colors.main!.color === '#E60033', '服の色が変わる');
  await shot('4_body_shared_colors');

  // 4) 表情：プリセットと、個別の変更で「カスタム」
  await click('[data-major="expression"]');
  await click('[data-preset="smile"]');
  s = await snapshot();
  check(s.title === '表情：笑顔', 'プリセットを選ぶと、表情が設定される');
  check(JSON.stringify(JSON.parse(s.character!).state.expression) === JSON.stringify({ eyes: 'smile', eyebrows: 'relaxed', mouth: 'smile_open' }), '保存されるのは目・眉・口の状態');
  await shot('5_expression');
  await click('[data-mouth="closed"]');
  s = await record('表情');
  check(s.title === '表情：カスタム', '個別に変えてプリセットから外れると「カスタム」になる');
  await click('[data-preset="smile"]');

  // 5) ポーズ・向き：コートを着てから右腕をポケットに → 注意が出る
  await click('[data-major="outfit"]');
  await click('[data-sub="outfit.outer"]');
  await click('[data-card="dev.coat_01"]');
  await click('[data-major="pose"]');
  list = await page.evaluate(`[...document.querySelectorAll('[data-view]')].map((el) => ({ id: el.dataset.view, selected: el.dataset.selected === 'true', available: el.dataset.available === 'true', why: el.querySelector('.why')?.textContent ?? null }))`);
  check(list.find((v) => v.id === 'front')?.selected && list.filter((v) => !v.available).length === 4 && list.every((v) => v.id === 'front' || v.why === '素材なし'), '素材のない向きは選べず、「素材なし」と出る');
  await click('[data-pose-arm\\.right="pocket"]');
  s = await record('ポーズ（右腕ポケット）');
  check(s.notices.some((n) => n.includes('仮・コート') && n.includes('表示できません')) && s.chip === '注意 1 件', '表示できなくなったパーツを知らせる');
  check(s.equipped.includes('dev.coat_01'), '勝手には外さない');
  await shot('6_pose_notice');
  await click('[data-major="outfit"]');
  list = await cards();
  check(list.find((c) => c.id === 'dev.coat_01')?.selected, '装備中のパーツは、使えなくなっても選ばれたまま');
  await click('[data-notice-action="unequip"]');
  s = await snapshot();
  check(!s.equipped.includes('dev.coat_01') && s.notices.length === 0, '注意から外せる');
  list = await cards();
  check(list.find((c) => c.id === 'dev.coat_01')?.available === false && list.find((c) => c.id === 'dev.coat_01')?.why === 'いまの向き・ポーズには未対応', '使えないパーツは選べず、理由が出る');
  const afterPeek = (await snapshot()).character;
  await click('[data-sub="outfit.top"]');
  await click('[data-sub="outfit.outer"]');
  check((await snapshot()).character === afterPeek, '一覧を見ているだけでは、キャラクターは変わらない');
  await shot('7_unavailable_card');
  await click('[data-major="pose"]');
  await click('[data-pose-arm\\.right="down"]');

  // 6) 詳細設定：位置と回転、条件つきの調整、中心
  await click('[data-major="accessory"]');
  await click('[data-card="dev.glasses_01"]');
  check(!(await snapshot()).text.includes('dev.glasses_01'), '内部情報を開くまで、内部の ID は見えない');
  check((await page.evaluate<boolean>(`!!document.querySelector('[data-tf="y"]')`)), '詳細設定は、最初から開いている');
  await click('[data-action="internal"]');
  const plain = await preview();
  await input('[data-tf="y"]', '-40');
  await input('[data-tf="rotation"]', '10');
  check((await preview()) !== plain, '位置と回転が表示に反映される');
  s = await snapshot();
  const glasses = (JSON.parse(s.character!) as { equipment: { partId: string; transform?: { x?: number; y?: number; rotation?: number; pivot?: [number, number] }; overrides?: unknown }[] }).equipment.find((i) => i.partId === 'dev.glasses_01')!;
  check(glasses.transform?.y === -40 && glasses.transform.rotation === 10, '調整が保存される');
  check(Array.isArray(glasses.transform.pivot) && Math.abs(glasses.transform.pivot[0] - 800) <= 1 && Math.abs(glasses.transform.pivot[1] - 405) <= 2, `中心は「パーツの中心」（メガネの位置）になる: ${glasses.transform.pivot}`);
  check((await page.evaluate<string>(`document.querySelector('[data-tf="pivot-mode"]').value`)) === 'part', '中心の選択は「パーツの中心」と表示される');
  check(s.text.includes('dev.glasses_01'), '内部情報を開いたときだけ、内部の ID が見える');
  await shot('8_advanced');
  await input('[data-tf="scope"]', 'arm.right');
  check((await page.evaluate<string>(`document.querySelector('[data-tf="y"]').value`)) === '-40', '条件つきの調整は、いまの調整の値から始まる');
  await input('[data-tf="x"]', '60');
  const withCondition = await preview();
  await click('[data-major="pose"]');
  await click('[data-pose-arm\\.right="pocket"]');
  check((await preview()) !== withCondition, 'ポーズを変えると、条件に当てはまらなくなる');
  await click('[data-pose-arm\\.right="down"]');
  check((await preview()) === withCondition, 'ポーズを戻すと、条件つきの調整に戻る');
  await click('[data-major="accessory"]');
  await click('[data-card="dev.glasses_01"]');
  await input('[data-tf="pivot-mode"]', 'canvas');
  const noPivot = (JSON.parse((await snapshot()).character!) as { equipment: { partId: string; overrides?: { transform: { transform: { pivot?: unknown } }[] } }[] }).equipment.find((i) => i.partId === 'dev.glasses_01')!;
  check(noPivot.overrides!.transform[0]!.transform.pivot === undefined, '「キャンバスの中心」では、中心を保存しない');
  await input('[data-tf="pivot-mode"]', 'part');
  await record('詳細設定');
  await click('[data-action="internal"]');
  // 詳細設定は閉じられ、閉じたことはページを移っても覚えている（後で開き直す）。
  await click('[data-action="advanced"]');
  check(!(await page.evaluate<boolean>(`!!document.querySelector('[data-tf="y"]')`)), '詳細設定は閉じられる');
  await click('[data-action="advanced"]');

  // 7) 保存 → 新規作成（確認が出る）→ 読込 → EXPORT で同じ画像
  const beforeMove = (await snapshot()).character;
  await nav('[data-step="export"]', 'export.html');
  check((await snapshot()).character === beforeMove, 'ページを移っても、編集中のキャラクターはそのまま');
  await click('[data-action="export"]');
  const pngBefore = await page.evaluate<string>('window.__creator.hooks.lastPng');
  await shot('9_export');
  await nav('[data-step="create"]', 'index.html');
  check((await snapshot()).text.includes('編集中のキャラクターがあります'), '最初のページに戻ると、編集中のキャラクターがあることが分かる');
  await input('[data-create="name"]', '別のキャラクター');
  await click('[data-action="start"]');
  check((await snapshot()).modal, '保存していない変更があると、確認が出る');
  await shot('10_confirm');
  await click('[data-action="confirm-cancel"]');
  check((await pageName()) === 'index.html' && JSON.parse((await snapshot()).character!).name === '夢生ツムグ', 'やめると、いまのキャラクターはそのまま');
  await nav('[data-action="resume"]', 'customize.html');
  check((await snapshot()).character === beforeMove, '「続きから編集する」で、同じ内容の作成画面に戻る');
  await click('[data-action="save"]');
  const saved = await page.evaluate<string>('window.__creator.hooks.lastSaved');
  const characterBefore = (await snapshot()).character;
  if (WRITE) writeFileSync(`${OUT_DATA}/creator-smoke-character.json`, saved);
  if (WRITE) writeFileSync(`${OUT_IMAGES}/creator_export.png`, Buffer.from(pngBefore.replace(/^data:image\/png;base64,/, ''), 'base64'));
  await nav('[data-step="create"]', 'index.html');
  await input('[data-create="name"]', '別のキャラクター');
  await nav('[data-action="start"]', 'customize.html');
  s = await snapshot();
  check(s.step === 'customize' && JSON.parse(s.character!).name === '別のキャラクター', '保存した後は、確認なしで新しく始められる');
  await click('[data-action="save"]');
  // 最初のページから読み込むと、作成画面へ移る
  await nav('[data-step="create"]', 'index.html');
  await loadFile('saved.json', saved, 'customize.html');
  s = await record('保存 → 新規作成 → 読込');
  check(s.character === characterBefore, '読み込んだキャラクターが、保存前と同じ');
  check(s.message !== null && s.message.includes('読み込みました'), '読み込んだことを、移った先のページで知らせる');
  await nav('[data-step="export"]', 'export.html');
  await click('[data-action="export"]');
  check((await page.evaluate<string>('window.__creator.hooks.lastPng')) === pngBefore, '読み込み後の PNG が、保存前と同じ');

  // 8) 見つからない素材：読み込めて、編集・保存・書き出しができる
  const withMissing = JSON.parse(saved);
  const coat = { instanceId: '00000000-0000-4000-8000-000000000099', partId: 'author.special_coat', equipped: true, colors: { main: { color: '#7A1F2B' } }, transform: { x: 4, y: -12 } };
  withMissing.equipment.splice(2, 0, coat);
  await loadFile('missing.json', JSON.stringify(withMissing));
  s = await record('見つからない素材');
  check(s.notices.some((n) => n.includes('見つからない素材') && n.includes('author.special_coat')), '見つからない素材を知らせる（この場面でだけ素材の ID を出す）');
  await shot('11_missing');
  check((await pageName()) === 'export.html' && (await snapshot()).exportDisabled === false, '見つからない素材があっても、書き出せる');
  await click('[data-action="export"]');
  await click('[data-action="save"]');
  const resaved = JSON.parse(await page.evaluate<string>('window.__creator.hooks.lastSaved'));
  check(JSON.stringify(resaved.equipment[2]) === JSON.stringify(coat), '見つからない素材の設定が、位置・色ごと保存される');

  // 9) 知らないポーズ：読み込めるが、表示と書き出しはできない
  const unknownPose = JSON.parse(saved);
  unknownPose.state.pose['arm.right'] = 'crossed';
  await loadFile('unknown-pose.json', JSON.stringify(unknownPose));
  s = await record('知らないポーズ');
  check(s.notices.some((n) => n.includes('知らないポーズ')) && s.drawn === 0, '知らないポーズを知らせ、何も表示しない');
  s = await snapshot();
  check(s.exportDisabled === true && s.text.includes('画像を書き出せません'), '書き出せない理由が出る');
  check(JSON.parse(s.character!).state.pose['arm.right'] === 'crossed', '知らないポーズの値は保持する');
  await shot('12_export_blocked');
  await click('[data-action="save"]');

  // 10) 読み込めないファイル：いまのキャラクターはそのまま
  const beforeInvalid = (await snapshot()).character;
  const invalid = JSON.parse(saved);
  invalid.formatVersion = 2;
  await loadFile('newer.json', JSON.stringify(invalid));
  s = await record('読み込めないファイル');
  check(s.character === beforeInvalid && s.message !== null && s.message.includes('新しい版'), '新しい版のファイルは読み込まず、理由を知らせる');
  await loadFile('broken.json', '{ "format": ');
  s = await snapshot();
  check(s.character === beforeInvalid && s.message !== null && s.message.includes('読み込めません'), '壊れたファイルも読み込まない');

  // 11) 素材のない向き：表示するものがなく、直し方を示す
  const sideView = JSON.parse(saved);
  sideView.state.view = 'side_left';
  await loadFile('side.json', JSON.stringify(sideView));
  s = await record('素材のない向き');
  check(s.drawn === 0 && s.notices.some((n) => n.includes('表示できる素材がありません')), '表示できる素材がないことを知らせる');
  check((await snapshot()).exportDisabled === true, '書き出せない');
  await shot('13_no_layer');
  await click('[data-notice-action="reset-view"]');
  s = await snapshot();
  check(s.drawn > 0 && s.exportDisabled === false && JSON.parse(s.character!).state.view === 'front', '「向きを正面に戻す」で直せる');

  // 12) 分類の重複：直さずに両方表示し、知らせる
  const duplicated = JSON.parse(saved);
  for (const inst of duplicated.equipment) if (inst.partId === 'dev.shirt_01') inst.equipped = true;
  await loadFile('duplicate.json', JSON.stringify(duplicated));
  s = await record('分類の重複');
  check(s.notices.some((n) => n.includes('トップス') && n.includes('複数')), '重複を知らせる');
  check(s.equipped.includes('dev.shirt_01') && s.equipped.includes('dev.shirt_02'), '両方とも装備したまま');
  await nav('[data-step="customize"]', 'customize.html');
  await click('[data-major="outfit"]');
  await click('[data-sub="outfit.top"]');
  await click('[data-card="dev.shirt_02"]');
  check(!(await snapshot()).equipped.includes('dev.shirt_01'), 'パーツを選び直すと 1 つになる');

  // 13) 最近使った色：押すと、その欄の色になる
  await click('[data-recent="#202028"][data-recent-for="main"]');
  s = await record('最近使った色');
  check((JSON.parse(s.character!) as { equipment: { partId: string; equipped: boolean; colors: Record<string, { color?: string }> }[] }).equipment.find((i) => i.partId === 'dev.shirt_02' && i.equipped)!.colors.main!.color === '#202028', '最近使った色を押すと、その欄に適用される');

  // 14) 設定：外したパーツの設定は、ここで見て削除できる（詳細設定には出ない）
  check((await page.evaluate<number>(`document.querySelectorAll('.edit [data-action="forget"]').length`)) === 0, '詳細設定に、外したパーツの設定は出ない');
  check((await snapshot()).kept.includes('dev.shirt_01'), '外したシャツの設定を覚えている');
  await click('[data-action="settings"]');
  await shot('14_settings');
  await click('[data-action="forget"][data-part="dev.shirt_01"]');
  s = await snapshot();
  check(!s.kept.includes('dev.shirt_01') && s.modal, '設定から削除でき、設定は開いたまま');
  await click('[data-action="settings-close"]');
  await page.close();

  // 15) 画面の大きさを変えても、プレビューは 2:3 のまま（細くなったり、伸びたりしない）
  for (const [width, height] of [[1024, 768], [1280, 800], [1600, 900], [1920, 1080]] as const) {
    const p = await Page.open(browser.cdp, `${base}dev/index.html`, [width, height]);
    await waitPage(p, 'index.html');
    const ratio = () => p.evaluate<number>(`(() => { const r = document.querySelector('[data-role="preview"]').getBoundingClientRect(); return r.width / r.height; })()`);
    const sizes: string[] = [];
    for (const [action, file] of [[null, 'index.html'], ['[data-action="start"]', 'customize.html'], ['[data-step="export"]', 'export.html']] as const) {
      if (action) {
        await p.evaluate(`document.querySelector(${JSON.stringify(action)}).click()`);
        await waitPage(p, file);
      }
      const value = await ratio();
      check(Math.abs(value - 2 / 3) < 0.005, `プレビューの縦横比が 2:3（${width}×${height}、${file}）: ${value.toFixed(3)}`);
      check((await p.evaluate<number>('document.documentElement.scrollWidth')) <= width, `横にはみ出さない（${width}×${height}、${file}）`);
      sizes.push(await p.evaluate<string>(`(() => { const r = document.querySelector('[data-role="preview"]').getBoundingClientRect(); return Math.round(r.width) + '×' + Math.round(r.height); })()`));
    }
    if (WRITE && width === 1024) await p.screenshot(`${OUT_IMAGES}/creator_width_1024.png`);
    steps.push({ step: `画面の大きさ ${width}×${height}`, result: sizes });
    console.log(`  画面 ${width}×${height}: プレビュー ${sizes.join(' / ')}（スタート / 作成 / 書き出し）`);
    await p.evaluate('sessionStorage.clear()');
    await p.close();
  }

  // 16) 【検証用】通知の置き場所の 4 方式。現状以外は、通知が出ても消えてもプレビューの大きさが変わらない
  for (const mode of ['under', 'side', 'overlay', 'chip'] as const) {
    const p = await Page.open(browser.cdp, `${base}dev/index.html?notices=${mode}`, [1280, 800]);
    await waitPage(p, 'index.html');
    const wait = async () => {
      await p.evaluate<void>('window.__creator.idle()');
      await p.evaluate('new Promise((r) => setTimeout(r, 30))');
    };
    const press = async (selector: string) => {
      await p.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('要素がない: ' + ${JSON.stringify(selector)}); el.click(); })()`);
      await wait();
    };
    const rect = () => p.evaluate<string>(`(() => { const r = document.querySelector('.canvas-wrap').getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map((v) => Math.round(v)).join(','); })()`);
    const where = () => p.evaluate<string[]>(`[...document.querySelectorAll('[data-notice]')].filter((el) => el.offsetParent !== null).map((el) => el.closest('.under') ? 'under' : el.closest('.edit') ? 'side' : el.closest('[data-role="notice-overlay"]') ? 'overlay' : el.closest('[data-role="notice-popover"]') ? 'chip' : 'other')`);

    await p.evaluate(`document.querySelector('[data-action="start"]').click()`);
    await waitPage(p, 'customize.html');
    check((await p.evaluate<string>(`document.querySelector('#app').dataset.notices`)) === mode, `通知の置き場所の指定は、ページを移っても引き継がれる（${mode}）`);
    await press('[data-major="outfit"]');
    await press('[data-sub="outfit.outer"]');
    await press('[data-card="dev.coat_01"]');
    const before = await rect();
    await press('[data-action="save"]');
    check((await rect()) === before, `「保存しました」が出ても、プレビューの大きさは変わらない（${mode}）`);
    await press('[data-major="pose"]');
    await press('[data-pose-arm\\.right="pocket"]');
    if (mode === 'chip') {
      check((await where()).length === 0, '「注意 n 件」を押すまで、通知は開かない');
      await press('[data-role="chip"]');
    }
    const shown = await where();
    check(shown.length === 1 && shown[0] === mode, `通知が決めた場所に出る（${mode}）: ${shown}`);
    const withNotice = await rect();
    if (WRITE) await p.screenshot(`${OUT_IMAGES}/creator_notices_${mode}.png`);
    if (mode === 'under') check(withNotice !== before, '現状（プレビューの下）では、通知でプレビューが縮む（比較の基準）');
    else check(withNotice === before, `通知が出ても、プレビューの大きさは変わらない（${mode}）: ${before} → ${withNotice}`);
    await press('[data-notice-action="unequip"]');
    check((await where()).length === 0 && (await rect()) === before, `通知が消えると、元の大きさのまま（${mode}）`);
    steps.push({ step: `通知の置き場所: ${mode}`, result: { before, withNotice, changed: withNotice !== before } });
    console.log(`  通知の置き場所 ${mode}: プレビュー ${before} → ${withNotice}${withNotice === before ? '（変化なし）' : '（縮む）'}`);
    await p.close();
  }

  if (WRITE) writeFileSync(`${OUT_DATA}/creator-smoke.json`, JSON.stringify({ browser: browser.product, headless: true, viewport: [1280, 800], steps }, null, 2) + '\n');
  console.log('すべて通過。');
} finally {
  await browser.close();
  await server.close();
  rmSync(temp, { recursive: true, force: true });
}
