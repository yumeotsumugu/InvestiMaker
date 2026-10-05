// 本体 UI の操作（src/app/session.ts）を、DOM なしで確かめる。指示書 §13 の項目に対応する。
// 画面からの操作そのものは tools/browser-smoke.ts がヘッドレスのブラウザで確かめる。

import { beforeAll, describe, expect, it } from 'vitest';
import type { Catalog, Session } from '../../src/app/session.ts';
import { choosePart, deleteInstance, edit, inspect, loadCharacterText, newSession, unequip } from '../../src/app/session.ts';
import type { Bitmap, Character } from '../../src/core/index.ts';
import {
  resolveSlotColor,
  serializeCharacter,
  setExpression,
  setFit,
  setInstanceColor,
  setPose,
  setSharedColor,
  setTransform,
  setTransformOverride,
  setView,
  stableStringify,
  stringifyCharacter,
  unlinkColor,
  validateCharacterJson,
} from '../../src/core/index.ts';
import { renderCharacterData } from '../../tools/character.ts';
import type { GeneratedSet } from '../../tools/dev-assets.ts';
import { generateDevAssets } from '../../tools/dev-assets.ts';
import { STARTER_IDS } from '../../tools/dev-parts.ts';

let set: GeneratedSet;
let catalog: Catalog;
let counter = 0;
const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

beforeAll(() => {
  set = generateDevAssets(400, 600);
  catalog = { library: new Map(set.parts.map((p) => [p.manifest.id, p.manifest])), body: 'dev.body_adult_standard', starter: STARTER_IDS };
}, 60_000);

const fresh = (): Session => newSession(catalog, newId);
const instance = (c: Character, partId: string) => c.equipment.findLast((i) => i.partId === partId)!;
const equipped = (c: Character) => c.equipment.filter((i) => i.equipped).map((i) => i.partId);
const image = (c: Character): Bitmap => renderCharacterData(set, c, catalog.library).bitmap;
const same = (a: Bitmap, b: Bitmap) => Buffer.from(a.data).equals(Buffer.from(b.data));
/** 不透明な画素の外接矩形。 */
function bounds(b: Bitmap, partOnly?: (x: number, y: number) => boolean) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < b.height; y++) {
    for (let x = 0; x < b.width; x++) {
      if (b.data[(y * b.width + x) * 4 + 3]! === 0 || (partOnly && !partOnly(x, y))) continue;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  return [x0, y0, x1, y1];
}
const reloadVia = (session: Session): Session => {
  const outcome = loadCharacterText(fresh(), stringifyCharacter(session.character));
  if (!outcome.loaded) throw new Error('読み込めない');
  return outcome.session;
};

describe('新規作成', () => {
  it('素体と最初の Part を装備した、保存できるキャラクターができる', () => {
    const { character } = fresh();
    expect(equipped(character)).toEqual([...STARTER_IDS]);
    expect(character.canvas).toEqual([1600, 2400]);
    expect(character.equipment.find((i) => i.instanceId === character.appearance.body)!.partId).toBe('dev.body_adult_standard');
    expect(validateCharacterJson(serializeCharacter(character)).errors).toEqual([]);
    const view = inspect(character, catalog);
    expect(view.evaluation.validity).toBe('VALID');
    expect(view.evaluation.issues).toEqual([]);
    expect(view.export).toEqual({ allowed: true, warnings: [] });
  });

  it('作るたびに別の id を持つ', () => {
    const a = fresh().character;
    const b = fresh().character;
    expect(a.id).not.toBe(b.id);
    expect(new Set([...a.equipment, ...b.equipment].map((i) => i.instanceId)).size).toBe(a.equipment.length + b.equipment.length);
  });
});

describe('Part の選択', () => {
  it('Part A → Part B：同じ category の Part を外してから装備する。外した Instance は残る', () => {
    const before = fresh();
    const after = choosePart(before, catalog, 'dev.shirt_02', newId);
    expect(equipped(after.character)).toContain('dev.shirt_02');
    expect(equipped(after.character)).not.toContain('dev.shirt_01');
    expect(instance(after.character, 'dev.shirt_01')).toMatchObject({ equipped: false });
    expect(after.selected).toBe(instance(after.character, 'dev.shirt_02').instanceId);
    expect(inspect(after.character, catalog).evaluation.issues).toEqual([]);
    expect(same(image(before.character), image(after.character))).toBe(false);
  });

  it('B → A に戻すと、元の Instance が同じ位置で戻り、設定も残っている', () => {
    let s = fresh();
    const shirt = instance(s.character, 'dev.shirt_01');
    const index = s.character.equipment.indexOf(shirt);
    s = edit(s, (c) => setInstanceColor(c, shirt.instanceId, 'main', '#E60033'));
    const original = image(s.character);
    s = choosePart(s, catalog, 'dev.shirt_02', newId);
    s = choosePart(s, catalog, 'dev.shirt_01', newId);
    expect(s.character.equipment[index]).toEqual({ ...shirt, colors: { main: { color: '#E60033' } } });
    expect(instance(s.character, 'dev.shirt_02').equipped).toBe(false);
    expect(same(image(s.character), original)).toBe(true);
  });

  it('unequip → equip で Instance と順序が保たれる', () => {
    let s = fresh();
    const order = s.character.equipment.map((i) => i.instanceId);
    const hair = instance(s.character, 'dev.hair_front_01').instanceId;
    s = unequip(s, hair);
    expect(equipped(s.character)).not.toContain('dev.hair_front_01');
    s = choosePart(s, catalog, 'dev.hair_front_01', newId);
    expect(s.character.equipment.map((i) => i.instanceId)).toEqual(order);
    expect(s.selected).toBe(hair);
  });

  it('複数装備できる category は、選ぶたびに Instance が増える', () => {
    let s = choosePart(fresh(), catalog, 'dev.blush_01', newId);
    s = choosePart(s, catalog, 'dev.blush_01', newId);
    expect(s.character.equipment.filter((i) => i.partId === 'dev.blush_01')).toHaveLength(2);
    expect(inspect(s.character, catalog).evaluation.issues).toEqual([]);
  });

  it('削除すると Instance がなくなる。選択も外れる', () => {
    let s = choosePart(fresh(), catalog, 'dev.hat_01', newId);
    const hat = s.selected!;
    s = deleteInstance(s, hat);
    expect(s.character.equipment.some((i) => i.instanceId === hat)).toBe(false);
    expect(s.selected).toBeNull();
  });
});

describe('色', () => {
  it('個別色と共有色の変更が描画に反映される', () => {
    const s = fresh();
    const base = image(s.character);
    const shirt = instance(s.character, 'dev.shirt_01').instanceId;
    expect(same(base, image(setInstanceColor(s.character, shirt, 'main', '#E60033')))).toBe(false);
    expect(same(base, image(setSharedColor(s.character, 'skin.base', '#8D5524')))).toBe(false);
  });

  it('link → unlink：解除した瞬間は画像が変わらず、その後は共有色に追従しない', () => {
    let s = edit(fresh(), (c) => setSharedColor(c, 'hair.base', '#E8D080'));
    const brows = instance(s.character, 'dev.eyebrows_01');
    const slot = catalog.library.get('dev.eyebrows_01')!.colorSlots![0]!;
    const linked = image(s.character);
    s = edit(s, (c) => unlinkColor(c, brows.instanceId, slot));
    expect(instance(s.character, 'dev.eyebrows_01').colors.color).toEqual({ linked: false, color: '#E8D080' });
    expect(same(image(s.character), linked)).toBe(true);
    s = edit(s, (c) => setSharedColor(c, 'hair.base', '#101014'));
    expect(resolveSlotColor(slot, instance(s.character, 'dev.eyebrows_01').colors.color, s.character.sharedColors)).toBe('#E8D080');
  });
});

describe('State', () => {
  it('ポーズ・表情・fit の変更で、解決される Asset が変わる', () => {
    let c = fresh().character;
    c = setPose(c, 'arm.right', 'pocket');
    c = setExpression(c, { eyes: 'smile', mouth: 'smile_open' });
    c = setFit(c, 'chest', 'large');
    const files = inspect(c, catalog).plan!.entries.filter((e) => e.status === 'draw').map((e) => e.asset!.file.replace(/^.*\//, ''));
    expect(files).toEqual(expect.arrayContaining(['arm_r_pocket.png', 'sleeve_r_pocket.png', 'eyes_smile.png', 'mouth_smile_open.png', 'base_chest_l.png', 'body_chest_l.png']));
    expect(inspect(c, catalog).evaluation.validity).toBe('VALID');
  });
});

describe('Transform', () => {
  // メガネだけを見るため、メガネの画素だけが変わる範囲（顔の高さ）で外接矩形を取る。
  const withGlasses = () => choosePart(fresh(), catalog, 'dev.glasses_01', newId);
  const glassesOnly = (c: Character) => {
    const others = image({ ...c, equipment: c.equipment.map((i) => (i.partId === 'dev.glasses_01' ? { ...i, equipped: false } : i)) });
    const all = image(c);
    return bounds(all, (x, y) => {
      const k = (y * all.width + x) * 4;
      return all.data[k] !== others.data[k] || all.data[k + 1] !== others.data[k + 1] || all.data[k + 2] !== others.data[k + 2] || all.data[k + 3] !== others.data[k + 3];
    });
  };

  it('基本の補正が描画に反映される（整数の平行移動は、その分だけ画素が動く）', () => {
    const s = withGlasses();
    const id = s.selected!;
    const [x0, y0, x1, y1] = glassesOnly(s.character);
    const moved = setTransform(s.character, id, { x: 12, y: -30 });
    expect(glassesOnly(moved)).toEqual([x0! + 12, y0! - 30, x1! + 12, y1! - 30]);
    expect(inspect(moved, catalog).matrices[id]).toEqual([1, 0, 0, 1, 12, -30]);
  });

  it('拡大と回転も反映される', () => {
    const s = withGlasses();
    const id = s.selected!;
    const [x0, , x1] = glassesOnly(s.character);
    const [sx0, , sx1] = glassesOnly(setTransform(s.character, id, { scaleX: 2, pivot: [(x0! + x1! + 1) / 2, 0] }));
    expect(sx1! - sx0!).toBeGreaterThan((x1! - x0!) * 1.9);
    expect(same(image(s.character), image(setTransform(s.character, id, { rotation: 15 })))).toBe(false);
  });

  it('条件別の補正：条件に当てはまる状態でだけ使われ、基本の補正を置き換える', () => {
    const s = withGlasses();
    const id = s.selected!;
    let c = setTransform(s.character, id, { x: 10 });
    c = setTransformOverride(c, id, { pose: { 'arm.right': 'pocket' } }, { y: 20 });
    expect(inspect(c, catalog).matrices[id]).toEqual([1, 0, 0, 1, 10, 0]);
    const pocket = setPose(c, 'arm.right', 'pocket');
    expect(inspect(pocket, catalog).matrices[id]).toEqual([1, 0, 0, 1, 0, 20]);
    expect(inspect(setPose(pocket, 'arm.right', 'down'), catalog).matrices[id]).toEqual([1, 0, 0, 1, 10, 0]);
  });
});

describe('JSON 保存 → 読込', () => {
  const edited = (): Session => {
    let s = choosePart(fresh(), catalog, 'dev.shirt_02', newId);
    s = choosePart(s, catalog, 'dev.glasses_01', newId);
    const glasses = s.selected!;
    return edit(s, (c) => {
      let n = setSharedColor(c, 'hair.base', '#202028');
      n = setInstanceColor(n, instance(n, 'dev.shirt_02').instanceId, 'main', '#E60033');
      n = setTransform(n, glasses, { x: 6, y: -14, rotation: 4 });
      n = setTransformOverride(n, glasses, { pose: { 'arm.right': 'pocket' } }, { x: 20, scaleX: 1.1 });
      n = setExpression(n, { eyes: 'wide' });
      return setFit(n, 'chest', 'large');
    });
  };

  it('読み込んだ Character は保存前と意味的に同じ', () => {
    const before = edited();
    const after = reloadVia(before);
    expect(after.character).toEqual(before.character);
    expect(after.selected).toBeNull();
  });

  it('読み込み後の画像が保存前と一致する（条件別の補正が使われる状態でも）', () => {
    const before = edited();
    const after = reloadVia(before);
    expect(same(image(after.character), image(before.character))).toBe(true);
    const pocket = (c: Character) => setPose(c, 'arm.right', 'pocket');
    expect(same(image(pocket(after.character)), image(pocket(before.character)))).toBe(true);
    expect(same(image(pocket(before.character)), image(before.character))).toBe(false);
  });
});

describe('不足 Part と UNRESOLVED', () => {
  const withMissing = (): string => {
    const json = serializeCharacter(fresh().character) as unknown as { equipment: unknown[] };
    json.equipment.splice(2, 0, { instanceId: newId(), partId: 'author.special_coat', equipped: true, colors: { main: { color: '#7A1F2B' } }, transform: { x: 4 } });
    return JSON.stringify(json);
  };

  it('missing Part を含む JSON を読み込める。Instance は位置・色・transform ごと残る', () => {
    const text = withMissing();
    const outcome = loadCharacterText(fresh(), text);
    expect(outcome.loaded).toBe(true);
    const { character } = outcome.session;
    expect(character.equipment[2]).toMatchObject({ partId: 'author.special_coat', colors: { main: { color: '#7A1F2B' } }, transform: { x: 4 } });
    expect(stableStringify(JSON.parse(stringifyCharacter(character)).equipment)).toBe(stableStringify(JSON.parse(text).equipment));
  });

  it('missing Part があっても PNG を出力できる（注意つき）', () => {
    const outcome = loadCharacterText(fresh(), withMissing());
    const view = inspect(outcome.session.character, catalog);
    expect(view.evaluation.validity).toBe('UNRESOLVED');
    expect(view.export.allowed).toBe(true);
    expect(view.export.warnings).toEqual([expect.stringContaining('author.special_coat')]);
    expect(view.plan!.parts.filter((p) => p.status !== 'ok').map((p) => p.status)).toEqual(['missing']);
    // 不足 Part 以外は、不足のないキャラクターと同じように描かれる
    const without = { ...outcome.session.character, equipment: outcome.session.character.equipment.filter((i) => i.partId !== 'author.special_coat') };
    expect(same(image(outcome.session.character), image(without))).toBe(true);
  });

  it('実装が知らないポーズでは PNG を出力できない。値は保持する', () => {
    const c = setPose(fresh().character, 'arm.right', 'crossed');
    const view = inspect(c, catalog);
    expect(view.evaluation.validity).toBe('UNRESOLVED');
    expect(view.plan).toBeNull();
    expect(view.export.allowed).toBe(false);
    expect(view.export.reason).toContain('crossed');
    const again = loadCharacterText(fresh(), stringifyCharacter(c));
    expect(again.loaded && again.session.character.state.pose['arm.right']).toBe('crossed');
  });
});

describe('書き出しの事前条件', () => {
  it('描画される Layer が 0 件なら PNG を出力できない。Character の評価は変わらない', () => {
    // 素材のない VIEW：全 Part が非対応になり、何も描かれない
    const side = setView(fresh().character, 'side_left');
    const view = inspect(side, catalog);
    expect(view.evaluation.validity).toBe('VALID');
    expect(view.plan!.parts.every((p) => p.status === 'unsupported')).toBe(true);
    expect(view.export).toMatchObject({ allowed: false, reason: '描画できる Layer がありません' });
    // 1 枚でも描画されるなら出力できる
    expect(inspect(setView(side, 'front'), catalog).export.allowed).toBe(true);
  });

  it('描画できる Part が 1 つもない環境（素材が読み込まれていない）でも同じ', () => {
    const view = inspect(fresh().character, { ...catalog, library: new Map() });
    expect(view.evaluation.validity).toBe('UNRESOLVED');
    expect(view.export).toMatchObject({ allowed: false, reason: '描画できる Layer がありません' });
  });
});

describe('category の重複', () => {
  it('外部の JSON で重複していても、直さずに保持し、両方描画して注意を出す', () => {
    const s = choosePart(fresh(), catalog, 'dev.shirt_02', newId);
    const both = { ...s.character, equipment: s.character.equipment.map((i) => (i.partId === 'dev.shirt_01' ? { ...i, equipped: true } : i)) };
    const outcome = loadCharacterText(fresh(), stringifyCharacter(both));
    expect(outcome.loaded).toBe(true);
    const { character } = outcome.session;
    expect(equipped(character)).toEqual(expect.arrayContaining(['dev.shirt_01', 'dev.shirt_02']));
    const view = inspect(character, catalog);
    expect(view.evaluation.validity).toBe('VALID');
    expect(view.evaluation.issues).toEqual([expect.objectContaining({ code: 'category-duplicate', category: 'outfit.top', effect: 'warning' })]);
    const drawnParts = new Set(view.plan!.entries.filter((e) => e.status === 'draw').map((e) => e.partId));
    expect(drawnParts.has('dev.shirt_01') && drawnParts.has('dev.shirt_02')).toBe(true);
    expect(stableStringify(serializeCharacter(character))).toBe(stableStringify(serializeCharacter(both)));
  });

  it('通常の操作で次の Part を選べば、重複は解消される', () => {
    const s = choosePart(fresh(), catalog, 'dev.shirt_02', newId);
    const both: Session = { ...s, character: { ...s.character, equipment: s.character.equipment.map((i) => (i.partId === 'dev.shirt_01' ? { ...i, equipped: true } : i)) } };
    const fixed = choosePart(both, catalog, 'dev.shirt_02', newId);
    expect(equipped(fixed.character).filter((id) => id.startsWith('dev.shirt'))).toEqual(['dev.shirt_02']);
  });
});

describe('INVALID の読込', () => {
  it('現在のキャラクターを置き換えない', () => {
    const current = choosePart(fresh(), catalog, 'dev.hat_01', newId);
    const invalid = serializeCharacter(current.character) as unknown as Record<string, unknown>;
    for (const broken of [JSON.stringify({ ...invalid, canvas: [2000, 3000] }), JSON.stringify({ ...invalid, formatVersion: 2 }), '{ "format": ', 'null']) {
      const outcome = loadCharacterText(current, broken);
      expect(outcome.loaded).toBe(false);
      expect(outcome.session).toBe(current);
      expect(!outcome.loaded && outcome.errors.length).toBeGreaterThan(0);
    }
  });
});
