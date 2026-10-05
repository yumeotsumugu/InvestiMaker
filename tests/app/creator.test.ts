// Creator UI の操作（src/app/）を、DOM なしで確かめる。Phase 1-C-2 の指示書 §13 の項目に対応する。
// 画面からの操作は tools/creator-smoke.ts がヘッドレスのブラウザで確かめる。

import { beforeAll, describe, expect, it } from 'vitest';
import { MAJORS, REQUIRED_CATEGORIES, visibleMajors } from '../../src/app/catalog.ts';
import { hasLabel, label } from '../../src/app/labels.ts';
import { buildNotices, cardProblemText, exportBlockText, loadErrorText } from '../../src/app/messages.ts';
import type { Bounds, Catalog } from '../../src/app/session.ts';
import {
  applyExpressionPreset,
  cardStates,
  chooseCard,
  chooseNone,
  clearTransform,
  editTransform,
  initialSharedColors,
  inspect,
  isDirty,
  keptInstances,
  loadCharacterText,
  noneSelected,
  partCenter,
  pivotMode,
  setPivot,
  sharedColorRows,
  snapshotOf,
  presets,
  startCharacter,
  storedTransform,
  viewChoices,
} from '../../src/app/session.ts';
import type { Bitmap, Character } from '../../src/core/index.ts';
import {
  CATEGORIES,
  POSE_DEFINITIONS,
  SHARED_COLOR_KEYS,
  STANDARD_EXPRESSIONS,
  STANDARD_STATES,
  VIEWS,
  expressionPresetOf,
  relinkColor,
  resolveSlotColor,
  serializeCharacter,
  setExpression,
  setInstanceColor,
  setPose,
  setSharedColor,
  setView,
  stringifyCharacter,
  unlinkColor,
  validateCharacterJson,
} from '../../src/core/index.ts';
import { renderCharacterData } from '../../tools/character.ts';
import type { GeneratedSet } from '../../tools/dev-assets.ts';
import { generateDevAssets } from '../../tools/dev-assets.ts';
import { STARTER_IDS } from '../../tools/dev-parts.ts';

const BODY = 'dev.body_adult_standard';
let set: GeneratedSet;
let catalog: Catalog;
let counter = 0;
const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

beforeAll(() => {
  set = generateDevAssets(400, 600);
  catalog = { library: new Map(set.parts.map((p) => [p.manifest.id, p.manifest])), order: set.parts.map((p) => p.manifest.id), starter: STARTER_IDS };
}, 60_000);

const start = (withStarter = true): Character => startCharacter(catalog, newId, { name: 'テスト', bodyId: BODY, withStarter });
const equipped = (c: Character) => c.equipment.filter((i) => i.equipped).map((i) => i.partId);
const instance = (c: Character, partId: string) => c.equipment.findLast((i) => i.partId === partId)!;
const pick = (c: Character, partId: string) => chooseCard(c, catalog, partId, newId);
const image = (c: Character): Bitmap => renderCharacterData(set, c, catalog.library).bitmap;
const same = (a: Bitmap, b: Bitmap) => Buffer.from(a.data).equals(Buffer.from(b.data));
const card = (c: Character, category: string, partId: string) => cardStates(c, catalog, category).find((s) => s.partId === partId)!;
/** 利用者向けの文に出てはいけない内部の語。 */
const INTERNAL = /UNRESOLVED|INVALID|VALID|Instance|Layer|manifest|category|未解決|requires|conflicts/;

describe('はじめのセット（スタート画面）', () => {
  it('素体ごとに、基本のパーツを付けたものと、素体だけのものを選べる', () => {
    expect(presets(catalog)).toEqual([
      { id: `${BODY}:starter`, bodyId: BODY, withStarter: true },
      { id: `${BODY}:bare`, bodyId: BODY, withStarter: false },
    ]);
    expect(presets({ ...catalog, starter: [] })).toEqual([{ id: `${BODY}:bare`, bodyId: BODY, withStarter: false }]);
  });

  it('選んだセットは Character に残らない（残るのは、装備されたパーツだけ）', () => {
    for (const preset of presets(catalog)) {
      const c = startCharacter(catalog, newId, { name: 'テスト', bodyId: preset.bodyId, withStarter: preset.withStarter });
      expect(JSON.stringify(c)).not.toMatch(/preset|starter|bare/);
      expect(equipped(c)).toEqual(preset.withStarter ? [BODY, ...STARTER_IDS.filter((id) => id !== BODY)] : [BODY]);
    }
  });
});

describe('分類と表示名', () => {
  it('分類の構成が、Asset 仕様の全 category を過不足なく含む', () => {
    const used = MAJORS.flatMap((m) => m.subs.map((s) => s.category));
    expect(new Set(used).size).toBe(used.length);
    expect(new Set(used)).toEqual(CATEGORIES);
    for (const category of REQUIRED_CATEGORIES) expect(CATEGORIES.has(category)).toBe(true);
  });

  it('素材のない小分類と、空になった大分類は出さない。表情とポーズ・向きは常に出す', () => {
    const majors = visibleMajors(catalog.library);
    expect(majors.map((m) => m.major.id)).toEqual(['body', 'face', 'hair', 'outfit', 'accessory', 'expression', 'pose', 'other']);
    expect(majors.find((m) => m.major.id === 'hair')!.subs.map((s) => s.category)).toEqual(['hair.front', 'hair.back', 'hair.extra']);
    expect(visibleMajors(new Map()).map((m) => m.major.id)).toEqual(['expression', 'pose']);
  });

  it('表示名の辞書に、標準の値がすべてある', () => {
    for (const category of CATEGORIES) expect(hasLabel('category', category), category).toBe(true);
    for (const m of MAJORS) expect(hasLabel('major', m.id), m.id).toBe(true);
    for (const key of ['eyes', 'eyebrows', 'mouth'] as const) for (const s of STANDARD_STATES[key]) expect(hasLabel(key, s), s).toBe(true);
    for (const e of STANDARD_EXPRESSIONS) expect(hasLabel('expression', e.id), e.id).toBe(true);
    for (const d of POSE_DEFINITIONS) expect(hasLabel('pose', d.id) && hasLabel('region', d.region), d.id).toBe(true);
    for (const v of VIEWS) expect(hasLabel('view', v), v).toBe(true);
    for (const k of SHARED_COLOR_KEYS) expect(hasLabel('shared', k), k).toBe(true);
  });

  it('辞書にない値は、そのまま表示する', () => {
    expect(label('pose', 'crossed')).toBe('crossed');
    expect(label('view', 'front')).toBe('正面');
  });
});

describe('新規作成', () => {
  it('基本のパーツあり：素体と最初のパーツを装備する', () => {
    const c = start();
    expect(equipped(c)).toEqual([...STARTER_IDS]);
    expect(validateCharacterJson(serializeCharacter(c)).errors).toEqual([]);
    expect(inspect(c, catalog)).toMatchObject({ export: { allowed: true }, problems: [] });
    expect(buildNotices(c, catalog, inspect(c, catalog))).toEqual([]);
  });

  it('基本のパーツなし：素体だけで始まる', () => {
    const c = start(false);
    expect(equipped(c)).toEqual([BODY]);
    expect(c.sharedColors).toEqual({ 'skin.base': '#F2D3BD' });
  });

  it('全体の色は、装備している素材の既定色から作る', () => {
    expect(start().sharedColors).toEqual({ 'skin.base': '#F2D3BD', 'eyes.left': '#4A6FA5', 'eyes.right': '#4A6FA5', 'hair.base': '#5A3E2B' });
  });

  it('全体の色は装備順だけで決まり、素材の読み込み順には左右されない', () => {
    const c = start();
    const reversed = new Map([...catalog.library].reverse());
    expect(initialSharedColors(c, reversed)).toEqual(initialSharedColors(c, catalog.library));
    // 装備順が変われば、最初に見つかる既定色も変わりうる（ここでは同じ色なので結果は同じ）
    const reordered = { ...c, equipment: [...c.equipment].reverse() };
    expect(Object.keys(initialSharedColors(reordered, catalog.library)).sort()).toEqual(Object.keys(c.sharedColors).sort());
  });

  it('作った直後の見た目は、全体の色を入れる前（素材の既定色）と変わらない', () => {
    const c = start();
    expect(same(image(c), image({ ...c, sharedColors: {} }))).toBe(true);
  });
});

describe('カードの選択', () => {
  it('1 つだけ選べる分類：別のカードを選ぶと入れ替わる。選び直しても外れない', () => {
    const c = start();
    const next = pick(c, 'dev.shirt_02');
    expect(equipped(next.character)).toContain('dev.shirt_02');
    expect(equipped(next.character)).not.toContain('dev.shirt_01');
    expect(next.instanceId).toBe(instance(next.character, 'dev.shirt_02').instanceId);
    const again = pick(next.character, 'dev.shirt_02');
    expect(again.character).toEqual(next.character);
    expect(again.instanceId).toBe(next.instanceId);
  });

  it('外したパーツを選び直すと、設定と位置が戻る', () => {
    let c = start();
    const shirt = instance(c, 'dev.shirt_01');
    const index = c.equipment.indexOf(shirt);
    c = setInstanceColor(c, shirt.instanceId, 'main', '#E60033');
    const original = image(c);
    c = pick(c, 'dev.shirt_02').character;
    expect(keptInstances(c).map((i) => i.partId)).toEqual(['dev.shirt_01']);
    c = pick(c, 'dev.shirt_01').character;
    expect(c.equipment[index]).toMatchObject({ instanceId: shirt.instanceId, equipped: true, colors: { main: { color: '#E60033' } } });
    expect(same(image(c), original)).toBe(true);
  });

  it('「なし」：その分類のパーツを外す。なくせない分類では何も起きない', () => {
    const c = start();
    const bare = chooseNone(c, catalog, 'outfit.top');
    expect(equipped(bare)).not.toContain('dev.shirt_01');
    expect(noneSelected(bare, catalog, 'outfit.top')).toBe(true);
    expect(noneSelected(c, catalog, 'outfit.top')).toBe(false);
    for (const category of REQUIRED_CATEGORIES) expect(chooseNone(c, catalog, category)).toBe(c);
  });

  it('複数選べる分類：押すたびに付ける／外すが切り替わり、同じパーツは 2 つにならない', () => {
    const on = pick(start(), 'dev.blush_01');
    expect(equipped(on.character)).toContain('dev.blush_01');
    const off = pick(on.character, 'dev.blush_01');
    expect(equipped(off.character)).not.toContain('dev.blush_01');
    expect(off.instanceId).toBeNull();
    const again = pick(off.character, 'dev.blush_01');
    expect(again.character.equipment.filter((i) => i.partId === 'dev.blush_01')).toHaveLength(1);
    expect(again.instanceId).toBe(on.instanceId);
  });

  it('素体のカードは、いまの素体を編集対象にするだけ', () => {
    const c = start();
    expect(pick(c, BODY)).toEqual({ character: c, instanceId: c.appearance.body });
  });
});

describe('一覧のカードの状態', () => {
  it('選択中・選べる・選べない（理由つき）を、core の判定から求める', () => {
    const c = start();
    expect(card(c, 'outfit.top', 'dev.shirt_01')).toMatchObject({ selected: true, available: true });
    expect(card(c, 'outfit.top', 'dev.shirt_02')).toMatchObject({ selected: false, available: true, instanceId: null });
    expect(card(c, 'outfit.outer', 'dev.coat_01')).toMatchObject({ selected: false, available: true });

    // 右腕がポケット：コートは袖の絵がないので選べない
    const pocket = setPose(c, 'arm.right', 'pocket');
    const coat = card(pocket, 'outfit.outer', 'dev.coat_01');
    expect(coat).toMatchObject({ available: false, problem: { status: 'unsupported' } });
    expect(cardProblemText(coat)).toBe('いまの向き・ポーズには未対応');

    // トップスがない：コートは「トップスが必要」
    const bare = card(chooseNone(c, catalog, 'outfit.top'), 'outfit.outer', 'dev.coat_01');
    expect(bare).toMatchObject({ available: false, problem: { status: 'conflict', requiresCategory: 'outfit.top' } });
    expect(cardProblemText(bare)).toBe('「トップス」が必要');
  });

  it('装備中のパーツは、後から使えなくなっても選ばれたまま（勝手に外さない）', () => {
    const c = setPose(pick(start(), 'dev.coat_01').character, 'arm.right', 'pocket');
    expect(card(c, 'outfit.outer', 'dev.coat_01')).toMatchObject({ selected: true, available: true });
    expect(equipped(c)).toContain('dev.coat_01');
  });

  it('判定は現在のキャラクターに一切触れない（保存していない変更にも、装備にも影響しない）', () => {
    const c = setPose(start(), 'arm.right', 'pocket');
    const frozen = structuredClone(c);
    const saved = snapshotOf(c);
    for (const major of MAJORS) for (const sub of major.subs) cardStates(c, catalog, sub.category);
    expect(c).toEqual(frozen);
    expect(isDirty(c, saved)).toBe(false);
    expect(c.equipment.map((i) => i.instanceId)).toEqual(frozen.equipment.map((i) => i.instanceId));
  });

  it('知らないポーズで描画順が決まらないときは、選べるものとして扱う', () => {
    const c = setPose(start(), 'arm.right', 'crossed');
    expect(card(c, 'outfit.outer', 'dev.coat_01')).toMatchObject({ available: true });
  });
});

describe('色', () => {
  it('全体の色の編集、切り離し、戻す', () => {
    let c = start();
    const brows = instance(c, 'dev.eyebrows_01');
    const slot = catalog.library.get('dev.eyebrows_01')!.colorSlots![0]!;
    const shown = (x: Character) => resolveSlotColor(slot, instance(x, 'dev.eyebrows_01').colors[slot.id], x.sharedColors);

    c = setSharedColor(c, 'hair.base', '#E8D080');
    expect(shown(c)).toBe('#E8D080');
    const linked = image(c);
    c = unlinkColor(c, brows.instanceId, slot);
    expect(same(image(c), linked)).toBe(true);
    c = setSharedColor(c, 'hair.base', '#101014');
    expect(shown(c)).toBe('#E8D080');
    c = relinkColor(c, brows.instanceId, slot.id);
    expect(shown(c)).toBe('#101014');
  });
});

describe('全体の色の一覧', () => {
  it('設定済みの色と、装備中のパーツが参照している色を出す', () => {
    const c = start();
    expect(sharedColorRows(c, catalog.library).map((r) => r.key).sort()).toEqual(['eyes.left', 'eyes.right', 'hair.base', 'skin.base']);
    // 素体だけで始めて、後から髪を付けた場合：髪の色はまだ設定されていないが、一覧に出る（値は素材の既定色）
    const later = pick(start(false), 'dev.hair_back_01').character;
    expect(later.sharedColors).toEqual({ 'skin.base': '#F2D3BD' });
    expect(sharedColorRows(later, catalog.library)).toEqual([{ key: 'skin.base', color: '#F2D3BD' }, { key: 'hair.base', color: '#5A3E2B' }]);
    // 素材が知らないキーも、設定されていれば出す
    expect(sharedColorRows(setSharedColor(c, 'future.key', '#123456'), catalog.library).at(-1)).toEqual({ key: 'future.key', color: '#123456' });
  });
});

describe('表情と向き', () => {
  it('プリセットを選ぶと 3 つの状態が設定され、個別に変えると「カスタム」になる', () => {
    let c = applyExpressionPreset(start(), 'smile');
    expect(c.state.expression).toEqual({ eyes: 'smile', eyebrows: 'relaxed', mouth: 'smile_open' });
    expect(expressionPresetOf(c.state.expression)).toBe('smile');
    c = setExpression(c, { mouth: 'closed' });
    expect(expressionPresetOf(c.state.expression)).toBeUndefined();
    expect(applyExpressionPreset(c, 'nothing')).toBe(c);
    // 保存データに表情の名前は入らない
    expect(JSON.stringify(serializeCharacter(applyExpressionPreset(c, 'angry')))).not.toContain('"angry"}');
  });

  it('素材のない向きは選べない。読み込んだキャラクターの向きは、そのまま出す', () => {
    const c = start();
    expect(viewChoices(c, catalog).map((v) => [v.id, v.selected, v.available])).toEqual([
      ['front', true, true],
      ['diagonal_left', false, false],
      ['diagonal_right', false, false],
      ['side_left', false, false],
      ['side_right', false, false],
    ]);
    expect(viewChoices(setView(c, 'side_left'), catalog).find((v) => v.selected)).toEqual({ id: 'side_left', selected: true, available: false });
    expect(viewChoices(setView(c, 'back'), catalog).at(-1)).toEqual({ id: 'back', selected: true, available: false });
  });
});

describe('配置の調整と中心', () => {
  /** 画像の、透明でない画素の範囲（ブラウザ側の処理の代わり）。 */
  const bounds = (partId: string, file: string): Bounds | null => {
    const img = set.parts.find((p) => p.manifest.id === partId)!.images.get(file)!;
    let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] === 0) continue;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
  };
  const withGlasses = () => {
    const choice = pick(start(), 'dev.glasses_01');
    return { c: choice.character, id: choice.instanceId! };
  };
  const center = (c: Character, id: string) => partCenter(inspect(c, catalog).plan!, id, bounds);

  it('「パーツの中心」は、描画対象の Layer の、透明でない画素の外接矩形の中心', () => {
    const { c, id } = withGlasses();
    // メガネだけを描いた画像の、不透明な範囲の中心と一致する
    const only = image({ ...c, equipment: c.equipment.map((i) => ({ ...i, equipped: i.instanceId === id || i.instanceId === c.appearance.body })) });
    const bodyOnly = image({ ...c, equipment: c.equipment.map((i) => ({ ...i, equipped: i.instanceId === c.appearance.body })) });
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (let y = 0; y < only.height; y++) for (let x = 0; x < only.width; x++) {
      const k = (y * only.width + x) * 4;
      if (only.data[k] === bodyOnly.data[k] && only.data[k + 1] === bodyOnly.data[k + 1] && only.data[k + 2] === bodyOnly.data[k + 2] && only.data[k + 3] === bodyOnly.data[k + 3]) continue;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    expect(center(c, id)).toEqual([Math.round((x0 + x1 + 1) / 2), Math.round((y0 + y1 + 1) / 2)]);
    // キャンバスの中心（200, 300）ではない
    expect(center(c, id)![1]).toBeLessThan(150);
  });

  it('複数の Layer を持つパーツは、描画対象の Layer 全体の中心。ポーズで Layer が変われば中心も変わる', () => {
    const c = start();
    const shirt = instance(c, 'dev.shirt_01').instanceId;
    const down = center(c, shirt)!;
    const pocket = center(setPose(c, 'arm.right', 'pocket'), shirt)!;
    expect(down[0]).toBe(200);
    expect(pocket).not.toEqual(down);
    // 描画されていないパーツには中心がない
    expect(center(c, 'no-such-instance')).toBeNull();
  });

  it('調整を初めて作るときに、パーツの中心を pivot として保存する。その後は書き換えない', () => {
    const { c, id } = withGlasses();
    const first = editTransform(c, id, 'always', { rotation: 10 }, [200, 101]);
    expect(instance(first, 'dev.glasses_01').transform).toEqual({ rotation: 10, pivot: [200, 101] });
    const later = editTransform(first, id, 'always', { x: 5 }, [999, 999]);
    expect(instance(later, 'dev.glasses_01').transform).toEqual({ rotation: 10, x: 5, pivot: [200, 101] });
    expect(validateCharacterJson(serializeCharacter(later)).errors).toEqual([]);
  });

  it('条件つきの調整は、いまの調整を写して始める（pivot も写す）', () => {
    const { c, id } = withGlasses();
    let n = editTransform(c, id, 'always', { y: -40 }, [200, 101]);
    expect(storedTransform(instance(n, 'dev.glasses_01'), 'arm.right', n.state)).toBeUndefined();
    n = editTransform(n, id, 'arm.right', { x: 60 }, [1, 1]);
    expect(instance(n, 'dev.glasses_01').overrides!.transform).toEqual([{ when: { pose: { 'arm.right': 'down' } }, transform: { y: -40, x: 60, pivot: [200, 101] } }]);
    expect(storedTransform(instance(n, 'dev.glasses_01'), 'arm.right', n.state)).toEqual({ y: -40, x: 60, pivot: [200, 101] });
    // 「いまの向きとポーズのとき」は、向きと 3 領域すべてを条件にする
    const full = editTransform(n, id, 'full', { x: 1 }, null);
    expect(instance(full, 'dev.glasses_01').overrides!.transform!.at(-1)!.when).toEqual({ view: 'front', pose: { torso: 'stand', 'arm.left': 'down', 'arm.right': 'down' } });
  });

  it('中心の選び方は、保存されている値から求める', () => {
    expect(pivotMode(undefined, [200, 101])).toBe('canvas');
    expect(pivotMode({ x: 1 }, [200, 101])).toBe('canvas');
    expect(pivotMode({ pivot: [200, 101] }, [200, 101])).toBe('part');
    expect(pivotMode({ pivot: [10, 10] }, [200, 101])).toBe('custom');
  });

  it('「キャンバスの中心」では pivot を書かない。「元に戻す」で調整が消える', () => {
    const { c, id } = withGlasses();
    let n = editTransform(c, id, 'always', { rotation: 10 }, [200, 101]);
    n = setPivot(n, id, 'always', null);
    expect(instance(n, 'dev.glasses_01').transform).toEqual({ rotation: 10 });
    n = setPivot(n, id, 'always', [30, 40]);
    expect(instance(n, 'dev.glasses_01').transform).toEqual({ rotation: 10, pivot: [30, 40] });
    expect('transform' in instance(clearTransform(n, id, 'always'), 'dev.glasses_01')).toBe(false);
    // 何も調整がなく、キャンバスの中心を選んだだけなら、調整そのものを持たない
    expect('transform' in instance(setPivot(c, id, 'always', null), 'dev.glasses_01')).toBe(false);
  });

  it('パーツの中心を軸にすると、回転しても位置がずれない', () => {
    const { c, id } = withGlasses();
    const at = center(c, id)!;
    const rotated = editTransform(c, id, 'always', { rotation: 30 }, at);
    const moved = center({ ...rotated }, id);
    // 中心そのもの（素材の位置）は補正の前の座標で求めるので変わらない
    expect(moved).toEqual(at);
    expect(same(image(rotated), image(c))).toBe(false);
  });
});

describe('保存と読込', () => {
  it('保存していない変更の判定', () => {
    const c = start();
    expect(isDirty(c, null)).toBe(true);
    const saved = snapshotOf(c);
    expect(isDirty(c, saved)).toBe(false);
    expect(isDirty(setPose(c, 'arm.right', 'pocket'), saved)).toBe(true);
    expect(isDirty(setPose(setPose(c, 'arm.right', 'pocket'), 'arm.right', 'down'), saved)).toBe(false);
  });

  it('保存 → 読込で、キャラクターと画像が一致する', () => {
    let c = pick(start(), 'dev.shirt_02').character;
    const glasses = pick(c, 'dev.glasses_01');
    c = editTransform(glasses.character, glasses.instanceId!, 'always', { y: -10, rotation: 8 }, [200, 101]);
    c = applyExpressionPreset(setSharedColor(c, 'hair.base', '#202028'), 'smile');
    const outcome = loadCharacterText(stringifyCharacter(c));
    expect(outcome.loaded && outcome.character).toEqual(c);
    expect(outcome.loaded && same(image(outcome.character), image(c))).toBe(true);
    expect(outcome.loaded && isDirty(outcome.character, snapshotOf(c))).toBe(false);
  });

  it('読み込めないファイルは Character を返さない。理由は利用者向けの文にする', () => {
    const json = serializeCharacter(start()) as unknown as Record<string, unknown>;
    const cases: [string, string][] = [
      ['{ "format": ', '壊れているか'],
      ['null', '壊れているか'],
      [JSON.stringify({ ...json, format: 'OTHER' }), '壊れているか'],
      [JSON.stringify({ ...json, formatVersion: 2 }), '新しい版'],
      [JSON.stringify({ ...json, canvas: [2000, 3000] }), 'キャンバス'],
      [JSON.stringify({ ...json, equipment: 'x' }), '内容が正しくありません'],
    ];
    for (const [text, expected] of cases) {
      const outcome = loadCharacterText(text);
      expect(outcome.loaded).toBe(false);
      const message = loadErrorText(outcome.loaded ? [] : outcome.errors);
      expect(message.text).toContain(expected);
      expect(message.text).not.toMatch(INTERNAL);
      expect(message.detail.length).toBeGreaterThan(0);
    }
  });
});

describe('知らせることと、書き出しの可否', () => {
  const noticesOf = (c: Character, cat: Catalog = catalog) => buildNotices(c, cat, inspect(c, cat));

  it('見つからない素材：知らせ、外せるようにし、書き出しは止めない', () => {
    const json = serializeCharacter(start()) as unknown as { equipment: unknown[] };
    json.equipment.splice(2, 0, { instanceId: newId(), partId: 'author.special_coat', equipped: true, colors: { main: { color: '#7A1F2B' } } });
    const outcome = loadCharacterText(JSON.stringify(json));
    if (!outcome.loaded) throw new Error('読み込めない');
    const view = inspect(outcome.character, catalog);
    const notices = buildNotices(outcome.character, catalog, view);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ text: '見つからない素材があります：author.special_coat', action: { kind: 'unequip' } });
    expect(view.export.allowed).toBe(true);
    expect(exportBlockText(view)).toBeNull();
    expect(outcome.character.equipment[2]).toMatchObject({ partId: 'author.special_coat', colors: { main: { color: '#7A1F2B' } } });
  });

  it('表示できなくなったパーツ：知らせ、外せるようにする。なくせない分類には「外す」を出さない', () => {
    const c = setPose(pick(start(), 'dev.coat_01').character, 'arm.right', 'pocket');
    const notices = noticesOf(c);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ text: '仮・コート：いまの向き・ポーズでは表示できません。', action: { kind: 'unequip', instanceId: instance(c, 'dev.coat_01').instanceId } });
    expect(inspect(c, catalog).export.allowed).toBe(true);
  });

  it('何も表示できないとき：1 件にまとめ、直し方を示す。書き出せない', () => {
    const c = setView(start(), 'side_left');
    const view = inspect(c, catalog);
    const notices = buildNotices(c, catalog, view);
    expect(notices).toEqual([expect.objectContaining({ key: 'nothing-to-draw', text: '表示できる素材がありません。', action: { kind: 'reset-view', label: '向きを正面に戻す' } })]);
    expect(notices[0]!.note).toContain('「左」');
    expect(view.export).toEqual({ allowed: false, reason: 'nothing-to-draw' });
    expect(exportBlockText(view)).toContain('表示できる素材がない');
    // 素材が読み込まれていない環境：直し方は示せない
    const empty: Catalog = { ...catalog, library: new Map() };
    expect(noticesOf(start(), empty).find((n) => n.key === 'nothing-to-draw')!.action).toBeUndefined();
  });

  it('知らないポーズ：知らせる。書き出せない', () => {
    const c = setPose(start(), 'arm.right', 'crossed');
    const view = inspect(c, catalog);
    expect(buildNotices(c, catalog, view).map((n) => n.key)).toEqual(['pose-unknown']);
    expect(view.export).toEqual({ allowed: false, reason: 'pose-unknown' });
    expect(exportBlockText(view)).toContain('知らないポーズ');
  });

  it('分類の重複：知らせる。直さない', () => {
    const c = pick(start(), 'dev.shirt_02').character;
    const both = { ...c, equipment: c.equipment.map((i) => (i.partId === 'dev.shirt_01' ? { ...i, equipped: true } : i)) };
    const notices = noticesOf(both);
    expect(notices).toEqual([expect.objectContaining({ key: 'duplicate:outfit.top', text: '「トップス」に複数のパーツが付いています。' })]);
    expect(equipped(both)).toEqual(expect.arrayContaining(['dev.shirt_01', 'dev.shirt_02']));
  });

  it('利用者向けの文に、内部の語が出ない', () => {
    const cases = [
      setPose(pick(start(), 'dev.coat_01').character, 'arm.right', 'pocket'),
      setView(start(), 'side_left'),
      setView(start(), 'back'),
      setPose(start(), 'arm.right', 'crossed'),
      chooseNone(pick(start(), 'dev.coat_01').character, catalog, 'outfit.top'),
    ];
    for (const c of cases) {
      const view = inspect(c, catalog);
      const notices = buildNotices(c, catalog, view);
      expect(notices.length).toBeGreaterThan(0);
      for (const n of notices) {
        expect(`${n.text} ${n.note ?? ''} ${n.action?.label ?? ''}`).not.toMatch(INTERNAL);
      }
      expect(exportBlockText(view) ?? '').not.toMatch(INTERNAL);
    }
  });
});
