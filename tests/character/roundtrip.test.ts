// 保存 → 読込で、キャラクターが意味的に同じまま戻ること。

import { beforeAll, describe, expect, it } from 'vitest';
import type { Character, ColorSlot } from '../../src/core/index.ts';
import {
  addInstance,
  createCharacter,
  deserializeCharacter,
  equipPart,
  moveInstance,
  parseCharacter,
  planCharacter,
  relinkColor,
  removeInstance,
  rename,
  resolveSlotColor,
  sameCharacter,
  serializeCharacter,
  setEquipped,
  setExpression,
  setFit,
  setInstanceColor,
  setPose,
  setSharedColor,
  setView,
  stableStringify,
  stringifyCharacter,
  unlinkColor,
} from '../../src/core/index.ts';
import { renderCharacterData } from '../../tools/character.ts';
import type { GeneratedSet } from '../../tools/dev-assets.ts';
import { generateDevAssets } from '../../tools/dev-assets.ts';
import { fixture, library, load, u } from './helpers.ts';

const VALID = ['valid/minimal.json', 'valid/missing-part.json', 'valid/full.json'];

/** 保存して読み直す（アプリを閉じて開き直すことに相当）。 */
function reload(character: Character): Character {
  const result = parseCharacter(stringifyCharacter(character));
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join(' / '));
  return result.character;
}

describe('round-trip', () => {
  it.each(VALID)('%s：serialize → stringify → parse → deserialize → serialize で同じになる', (file) => {
    const a = load(file);
    const b = reload(a);
    expect(b).toEqual(a);
    expect(sameCharacter(a, b)).toBe(true);
    expect(serializeCharacter(b)).toEqual(serializeCharacter(a));
    // 何度繰り返しても変わらない
    expect(stringifyCharacter(reload(b))).toBe(stringifyCharacter(a));
  });

  it('キーの順序や空白が違っても同じキャラクターとして読める', () => {
    const json = fixture('valid/missing-part.json');
    const shuffled = Object.fromEntries(Object.entries(json).reverse());
    const a = deserializeCharacter(json);
    const b = parseCharacter(JSON.stringify(shuffled));
    expect(a.ok && b.ok && sameCharacter(a.character, b.character)).toBe(true);
  });

  it('省略された項目は既定値で埋まり、色は大文字に揃う', () => {
    const c = load('valid/full.json');
    expect(c.equipment[1]!.colors).toEqual({});
    expect(c.sharedColors['skin.base']).toBe('#C68642');
    expect(c.equipment[2]!.colors.main).toEqual({ color: '#FF0040' });
    expect(load('valid/minimal.json').appearance.fit).toEqual({});
  });

  it('未知のフィールドは全階層で保持され、編集しても失われない', () => {
    let c = load('valid/full.json');
    c = setSharedColor(c, 'hair.base', '#000000');
    c = setInstanceColor(c, u(34), 'color', '#111111');
    c = setEquipped(c, u(32), true);
    c = setPose(c, 'arm.right', 'down');
    c = setFit(c, 'chest', 'small');
    const saved = serializeCharacter(reload(c)) as unknown as Record<string, any>;
    expect(saved.futureTopLevelField).toEqual({ nested: true });
    expect(saved.appearance.futureAppearanceField).toEqual({ age: 'unknown' });
    expect(saved.state.futureStateField).toEqual([1, 2, 3]);
    expect(saved.equipment[2].futureInstanceField).toBe(7);
    expect(saved.equipment[4].colors.color).toEqual({ color: '#111111', futureColorField: 'x' });
    expect(saved.sharedColors['future.key']).toBe('#123456');
    expect(saved.composition).toEqual({ crop: 'bust', zoom: 1.5 });
  });

  it('requirements は保存のたびに現在の内容から作り直す', () => {
    const json = fixture('valid/missing-part.json') as any;
    json.requirements = { parts: ['im.stale'] };
    const result = deserializeCharacter(json);
    expect(result.ok && serializeCharacter(result.character).requirements.parts).toEqual(['author.special_coat', 'im.body_01', 'im.hair_01']);
    expect(stableStringify(result.ok && serializeCharacter(result.character))).toBe(stableStringify(fixture('valid/missing-part.json')));
  });

  it('canvas は必須で、新規作成したキャラクターはマスターキャンバスを持つ', () => {
    const c = createCharacter({ id: u(1), name: '', bodyPartId: 'im.body_01', bodyInstanceId: u(10) });
    expect(c.canvas).toEqual([1600, 2400]);
    expect(serializeCharacter(reload(c)).canvas).toEqual([1600, 2400]);
  });

  it('保存 JSON の先頭に format と formatVersion、末尾に requirements を書く', () => {
    const keys = Object.keys(serializeCharacter(load('valid/full.json')));
    expect(keys.slice(0, 2)).toEqual(['format', 'formatVersion']);
    expect(keys.at(-1)).toBe('requirements');
  });
});

describe('Equipment Instance', () => {
  const base = () => createCharacter({ id: u(1), name: 'テスト', bodyPartId: 'im.body_01', bodyInstanceId: u(10) });
  const order = (c: Character) => c.equipment.map((i) => i.partId);

  it('equipment の並びが装備順の正本で、保存しても変わらない', () => {
    let c = base();
    c = addInstance(c, 'im.overlay_01', u(11));
    c = addInstance(c, 'im.hair_01', u(12));
    c = addInstance(c, 'im.overlay_01', u(13));
    expect(order(reload(c))).toEqual(['im.body_01', 'im.overlay_01', 'im.hair_01', 'im.overlay_01']);
    c = moveInstance(c, u(13), 1);
    expect(reload(c).equipment.map((i) => i.instanceId)).toEqual([u(10), u(13), u(11), u(12)]);
  });

  it('同じ Part の複数 Instance は別々の色を持ち、描画計画でも区別される', () => {
    let c = base();
    c = addInstance(c, 'im.overlay_01', u(11));
    c = addInstance(c, 'im.overlay_01', u(12));
    c = setInstanceColor(c, u(11), 'color', '#FF0000');
    c = setInstanceColor(c, u(12), 'color', '#0000FF');
    const plan = planCharacter(reload(c), library());
    const overlays = plan.entries.filter((e) => e.partId === 'im.overlay_01');
    // 同じ Slot・同じ zBias なので、装備順（equipment の並び）で描く
    expect(overlays.map((e) => e.instanceId)).toEqual([u(11), u(12)]);
    expect(planCharacter(moveInstance(c, u(12), 1), library()).entries.filter((e) => e.partId === 'im.overlay_01').map((e) => e.instanceId)).toEqual([u(12), u(11)]);
  });

  it('外した Instance は残り、描画計画には入らない。素体は外せない', () => {
    let c = addInstance(base(), 'im.hat_01', u(11));
    c = setEquipped(c, u(11), false);
    expect(reload(c).equipment[1]).toMatchObject({ partId: 'im.hat_01', equipped: false });
    expect(planCharacter(c, library()).parts.map((p) => p.partId)).toEqual(['im.body_01']);
    expect(() => setEquipped(c, u(10), false)).toThrow();
    expect(() => removeInstance(c, u(10))).toThrow();
    expect(removeInstance(c, u(11)).equipment).toHaveLength(1);
  });
});

describe('色', () => {
  const skin: ColorSlot = { id: 'skin', mode: 'tint', default: '#808080', link: 'skin.base' };
  const main: ColorSlot = { id: 'main', mode: 'tint', default: '#808080' };
  const shown = (c: Character, instanceId: string, slot: ColorSlot) =>
    resolveSlotColor(slot, c.equipment.find((i) => i.instanceId === instanceId)!.colors[slot.id], c.sharedColors);

  it('リンク解除 → 色変更 → Part を外す → 保存 → 読込 → 再装備 で個別色が戻る', () => {
    const hatSlot: ColorSlot = { id: 'main', mode: 'tint', default: '#808080', link: 'hair.base' };
    let c = createCharacter({ id: u(1), name: '', bodyPartId: 'im.body_01', bodyInstanceId: u(10) });
    c = setSharedColor(c, 'hair.base', '#202028');
    c = equipPart(c, 'im.hat_01', u(11));
    c = unlinkColor(c, u(11), hatSlot);
    c = setInstanceColor(c, u(11), 'main', '#FF0040');
    c = setEquipped(c, u(11), false);

    c = reload(c);
    expect(c.equipment[1]).toEqual({ instanceId: u(11), partId: 'im.hat_01', equipped: false, colors: { main: { linked: false, color: '#FF0040' } } });

    c = equipPart(c, 'im.hat_01', u(99));
    // 新しい Instance は作られず、同じ Instance が同じ位置で戻る
    expect(c.equipment).toHaveLength(2);
    // 後から別の Part を装備していても、付け直した Instance の位置は変わらない
    const later = equipPart(addInstance(setEquipped(c, u(11), false), 'im.overlay_01', u(12)), 'im.hat_01', u(98));
    expect(later.equipment.map((i) => i.instanceId)).toEqual([u(10), u(11), u(12)]);
    expect(c.equipment[1]).toMatchObject({ instanceId: u(11), equipped: true });
    expect(shown(c, u(11), hatSlot)).toBe('#FF0040');
  });

  it('共有色からリンクを解除した瞬間は、その時点の共有色が個別色にコピーされ、見た目が変わらない', () => {
    let c = createCharacter({ id: u(1), name: '', bodyPartId: 'im.body_01', bodyInstanceId: u(10) });
    c = setSharedColor(c, 'skin.base', '#C68642');
    expect(shown(c, u(10), skin)).toBe('#C68642');
    c = unlinkColor(c, u(10), skin);
    expect(c.equipment[0]!.colors.skin).toEqual({ linked: false, color: '#C68642' });
    expect(shown(c, u(10), skin)).toBe('#C68642');
    // 解除後は共有色を変えても追従しない
    c = setSharedColor(c, 'skin.base', '#000000');
    expect(shown(c, u(10), skin)).toBe('#C68642');
  });

  it('リンクを戻すと共有色に従い、もう一度解除しても見た目は変わらない', () => {
    let c = createCharacter({ id: u(1), name: '', bodyPartId: 'im.body_01', bodyInstanceId: u(10) });
    c = setSharedColor(c, 'skin.base', '#C68642');
    c = setInstanceColor(unlinkColor(c, u(10), skin), u(10), 'skin', '#FF0000');
    c = relinkColor(c, u(10), 'skin');
    expect(shown(c, u(10), skin)).toBe('#C68642');
    // 個別色は消さずに残っているが、解除時には「今見えている色」で上書きする
    expect(reload(c).equipment[0]!.colors.skin).toEqual({ linked: true, color: '#FF0000' });
    c = unlinkColor(reload(c), u(10), skin);
    expect(shown(c, u(10), skin)).toBe('#C68642');
  });

  it('共有色を参照しないスロットは個別色だけで決まり、未設定なら Part の既定色', () => {
    let c = addInstance(createCharacter({ id: u(1), name: '', bodyPartId: 'im.body_01', bodyInstanceId: u(10) }), 'im.hat_01', u(11));
    expect(shown(c, u(11), main)).toBe('#808080');
    c = setInstanceColor(c, u(11), 'main', '#3a3f4b');
    expect(shown(reload(c), u(11), main)).toBe('#3A3F4B');
  });
});

describe('完全復元（仮素材で描いて画素を比べる）', () => {
  let set: GeneratedSet;
  let original: Character;
  beforeAll(() => {
    set = generateDevAssets(400, 600);
    const ids = set.parts.map((p) => p.manifest.id).filter((id) => id !== 'dev.body_adult_standard');
    let c = createCharacter({ id: u(1), name: '夢生ツムグ', bodyPartId: 'dev.body_adult_standard', bodyInstanceId: u(100) });
    ids.forEach((id, i) => (c = addInstance(c, id, u(101 + i))));
    const inst = (partId: string) => c.equipment.find((i) => i.partId === partId)!.instanceId;
    c = setSharedColor(c, 'skin.base', '#C68642');
    c = setSharedColor(c, 'hair.base', '#202028');
    c = setSharedColor(c, 'eyes.left', '#405070');
    c = setInstanceColor(c, inst('dev.shirt_01'), 'main', '#FFE8D6');
    c = unlinkColor(c, inst('dev.eyebrows_01'), { id: 'color', mode: 'tint', default: '#5A3E2B', link: 'hair.base' });
    c = setInstanceColor(c, inst('dev.eyebrows_01'), 'color', '#E60033');
    c = setEquipped(c, inst('dev.coat_01'), false);
    c = setPose(c, 'arm.right', 'pocket');
    c = setExpression(c, { eyes: 'wide', mouth: 'smile_open' });
    c = setFit(c, 'chest', 'large');
    original = c;
  }, 60_000);

  it('保存して読み直したキャラクターは、同じ画像になる', () => {
    const before = renderCharacterData(set, original);
    const after = renderCharacterData(set, reload(original));
    expect(after.plan).toEqual(before.plan);
    expect(Buffer.from(after.bitmap.data).equals(Buffer.from(before.bitmap.data))).toBe(true);
    expect(before.plan.parts.every((p) => p.status === 'ok')).toBe(true);
    expect(before.plan.entries.some((e) => e.asset?.file.endsWith('sleeve_r_pocket.png'))).toBe(true);
  });

  it('状態を変えれば画像も変わる（比較が空振りしていないことの確認）', () => {
    const before = renderCharacterData(set, original).bitmap.data;
    const changed = renderCharacterData(set, setSharedColor(original, 'skin.base', '#F2D3BD')).bitmap.data;
    expect(Buffer.from(changed).equals(Buffer.from(before))).toBe(false);
  });
});

describe('State の編集', () => {
  it('fit は次元ごとに設定・解除でき、名前と VIEW も操作で変える', () => {
    let c = createCharacter({ id: u(1), name: '', bodyPartId: 'im.body_01', bodyInstanceId: u(10) });
    c = setFit(setFit(c, 'chest', 'large'), 'waist', 'wide');
    expect(c.appearance.fit).toEqual({ chest: 'large', waist: 'wide' });
    expect(setFit(c, 'chest', undefined).appearance.fit).toEqual({ waist: 'wide' });
    expect(reload(setView(rename(c, 'ツムグ'), 'side_left'))).toMatchObject({ name: 'ツムグ', state: { view: 'side_left' } });
  });
});
