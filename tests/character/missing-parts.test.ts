// 不足 Part（指示書 §6）。
// キャラクターは im.body_01 / im.hair_01 / author.special_coat を参照し、読み込み環境に author.special_coat がない。

import { beforeAll, describe, expect, it } from 'vitest';
import type { Character } from '../../src/core/index.ts';
import {
  addInstance,
  checkCharacter,
  createCharacter,
  deserializeCharacter,
  evaluateCharacter,
  instanceColors,
  parseCharacter,
  planCharacter,
  serializeCharacter,
  setEquipped,
  setInstanceColor,
  setSharedColor,
  stableStringify,
  stringifyCharacter,
} from '../../src/core/index.ts';
import { renderCharacterData } from '../../tools/character.ts';
import type { GeneratedSet } from '../../tools/dev-assets.ts';
import { generateDevAssets } from '../../tools/dev-assets.ts';
import { env, fixture, library, load, u } from './helpers.ts';

const COAT = 'author.special_coat';
const saved = () => fixture('valid/missing-part.json') as any;
const reload = (c: Character): Character => {
  const result = parseCharacter(stringifyCharacter(c));
  if (!result.ok) throw new Error('読み込めない');
  return result.character;
};

describe('読み込み環境に Part がない', () => {
  it('Character 自体は読み込める（INVALID にならない）', () => {
    const result = checkCharacter(saved(), env(COAT));
    expect(result.validity).toBe('UNRESOLVED');
  });

  it('読み込み結果は、環境に Part があってもなくても同じ', () => {
    // deserialize は manifest を一切見ない
    expect(deserializeCharacter(saved())).toEqual(deserializeCharacter(saved()));
    expect(load('valid/missing-part.json').equipment.map((i) => i.partId)).toEqual(['im.body_01', COAT, 'im.hair_01']);
  });

  it('不足 Part の Instance は、色・transform・overrides・装備順ごと保持される', () => {
    const c = load('valid/missing-part.json');
    expect(c.equipment[1]).toEqual({
      instanceId: u(21),
      partId: COAT,
      equipped: true,
      colors: { main: { color: '#7A1F2B' }, lapel: { color: '#101014' }, lining: { linked: false, color: '#C8A85A' } },
      transform: { x: 4, y: -12, scaleX: 1.02, scaleY: 1.02, rotation: 1.5, pivot: [800, 900] },
      overrides: { note: 'v1 は解釈しない' },
    });
  });

  it('「不足」と判定でき、他の Part の描画は妨げない', () => {
    const c = load('valid/missing-part.json');
    const evaluation = evaluateCharacter(c, env(COAT));
    expect(evaluation.missing.map((i) => i.instanceId)).toEqual([u(21)]);
    expect(evaluation.issues).toEqual([{ code: 'part-missing', effect: 'unresolved', message: expect.stringContaining(COAT) }]);

    const plan = planCharacter(c, library(COAT));
    expect(plan.parts.map((p) => [p.partId, p.status])).toEqual([
      ['im.body_01', 'ok'],
      [COAT, 'missing'],
      ['im.hair_01', 'ok'],
    ]);
    expect(plan.entries.filter((e) => e.status === 'draw').map((e) => e.partId)).toEqual(['im.hair_01', 'im.body_01']);
    // 不足 Part の色は解決できないので出さない（保存データには残っている）
    expect(Object.keys(instanceColors(c, library(COAT)))).toEqual([u(20), u(22)]);
  });

  it('そのまま再保存しても、情報が 1 つも失われない', () => {
    const c = load('valid/missing-part.json');
    expect(stableStringify(serializeCharacter(c))).toBe(stableStringify(saved()));
    // 必要な Part の一覧（requirements）にも、不足している Part が残る
    expect(serializeCharacter(c).requirements.parts).toContain(COAT);
  });

  it('不足したまま他の編集をして保存しても、不足 Part の Instance は変わらない', () => {
    let c = load('valid/missing-part.json');
    const before = c.equipment[1];
    c = setSharedColor(c, 'hair.base', '#E8D080');
    c = setInstanceColor(c, u(22), 'base', '#FFFFFF');
    c = addInstance(c, 'im.hat_01', u(23));
    c = reload(c);
    expect(c.equipment[1]).toEqual(before);
    expect(c.equipment.map((i) => i.partId)).toEqual(['im.body_01', COAT, 'im.hair_01', 'im.hat_01']);
  });

  it('不足 Part を外して付け直すこともできる', () => {
    let c = setEquipped(load('valid/missing-part.json'), u(21), false);
    expect(evaluateCharacter(c, env(COAT)).validity).toBe('VALID');
    c = setEquipped(reload(c), u(21), true);
    expect(stableStringify(serializeCharacter(c))).toBe(stableStringify(saved()));
  });

  it('後から Part を読み込めば、同じ Instance として復元される', () => {
    // 不足環境で読み、保存し、Part を入れた環境で読み直す
    const inMissingEnv = reload(load('valid/missing-part.json'));
    expect(evaluateCharacter(inMissingEnv, env(COAT)).validity).toBe('UNRESOLVED');

    const restored = reload(inMissingEnv);
    expect(evaluateCharacter(restored, env()).validity).toBe('VALID');
    const plan = planCharacter(restored, library());
    expect(plan.parts.find((p) => p.partId === COAT)).toMatchObject({ instanceId: u(21), status: 'ok' });
    // 装備順（同じ Slot なら equipment の並び）と色がそのまま使われる
    expect(restored.equipment.map((i) => i.instanceId)).toEqual([u(20), u(21), u(22)]);
    expect(instanceColors(restored, library())[u(21)]).toEqual({ main: '#7A1F2B', lapel: '#101014' });
  });

  it('素体が不足していても読み込め、保存し直せる', () => {
    const result = checkCharacter(saved(), env('im.body_01'));
    expect(result.validity).toBe('UNRESOLVED');
    expect(result.validity !== 'INVALID' && stableStringify(serializeCharacter(result.character))).toBe(stableStringify(saved()));
  });
});

describe('不足を挟んだ round-trip（仮素材で描いて画素を比べる）', () => {
  let set: GeneratedSet;
  let original: Character;
  beforeAll(() => {
    set = generateDevAssets(400, 600);
    let c = createCharacter({ id: u(1), name: '', bodyPartId: 'dev.body_adult_standard', bodyInstanceId: u(100) });
    set.parts.map((p) => p.manifest.id).filter((id) => id !== 'dev.body_adult_standard').forEach((id, i) => (c = addInstance(c, id, u(101 + i))));
    const coat = c.equipment.find((i) => i.partId === 'dev.coat_01')!.instanceId;
    c = setInstanceColor(c, coat, 'main', '#7A1F2B');
    c = setInstanceColor(c, coat, 'button', '#FFFFFF');
    original = c;
  }, 60_000);

  it('保存 → 不足環境で読込 → 保存 → Part を導入して再読込 で、元の画像に戻る', () => {
    const full = new Map(set.parts.map((p) => [p.manifest.id, p.manifest]));
    const withoutCoat = new Map([...full].filter(([id]) => id !== 'dev.coat_01'));
    const before = renderCharacterData(set, original, full);

    const inMissingEnv = reload(original);
    const partial = renderCharacterData(set, inMissingEnv, withoutCoat);
    expect(partial.plan.parts.filter((p) => p.status !== 'ok').map((p) => [p.partId, p.status])).toEqual([['dev.coat_01', 'missing']]);
    expect(Buffer.from(partial.bitmap.data).equals(Buffer.from(before.bitmap.data))).toBe(false);

    const restored = reload(inMissingEnv);
    const after = renderCharacterData(set, restored, full);
    expect(restored).toEqual(original);
    expect(Buffer.from(after.bitmap.data).equals(Buffer.from(before.bitmap.data))).toBe(true);
  });
});
