// 条件ごとの配置補正（overrides.transform）。どの状態でも、適用される補正が 1 つに決まること。

import { describe, expect, it } from 'vitest';
import type { Character, CharacterState, TransformOverride } from '../../src/core/index.ts';
import {
  conditionsOverlap,
  effectiveTransform,
  instanceMatrices,
  parseCharacter,
  serializeCharacter,
  setTransform,
  setTransformOverride,
  stringifyCharacter,
  validateCharacterJson,
} from '../../src/core/index.ts';
import { fixture, library, load, u } from './helpers.ts';

const HAT = u(11);
const state = (view: string, left: string, right: string): CharacterState => ({
  view,
  pose: { torso: 'stand', 'arm.left': left, 'arm.right': right },
  expression: { eyes: 'open', eyebrows: 'neutral', mouth: 'closed' },
});
const hat = (c: Character) => c.equipment.find((i) => i.instanceId === HAT)!;
const reload = (c: Character): Character => {
  const r = parseCharacter(stringifyCharacter(c));
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join(' / '));
  return r.character;
};

describe('適用される補正の決定', () => {
  const c = load('valid/transform-overrides.json');

  it('当てはまる条件がなければ、基本の transform', () => {
    expect(effectiveTransform(hat(c), state('front', 'down', 'down'))).toEqual({ x: 10, y: -20 });
  });

  it('条件が当てはまれば、その補正が基本の transform を置き換える（値を混ぜない）', () => {
    // 右腕が pocket、左腕は別の状態：1 つ目の条件だけが当てはまる
    expect(effectiveTransform(hat(c), state('front', 'pocket', 'pocket'))).toEqual({ x: 30 });
  });

  it('複数当てはまるときは、条件のキーが多い方', () => {
    expect(effectiveTransform(hat(c), state('front', 'down', 'pocket'))).toEqual({ x: 50, rotation: 5 });
  });

  it('VIEW を含む条件', () => {
    expect(effectiveTransform(hat(c), state('side_left', 'down', 'down'))).toEqual({ scaleX: 0.9, pivot: [800, 300] });
    expect(effectiveTransform(hat(c), state('side_left', 'down', 'pocket'))).toEqual({ x: 30 });
  });

  it('補正の並び順を変えても結果は同じ', () => {
    const states = [state('front', 'down', 'down'), state('front', 'down', 'pocket'), state('front', 'pocket', 'pocket'), state('side_left', 'down', 'down'), state('side_left', 'down', 'pocket')];
    const reversed = { ...hat(c), overrides: { transform: [...(hat(c).overrides!.transform as TransformOverride[])].reverse() } };
    for (const s of states) expect(effectiveTransform(reversed, s)).toEqual(effectiveTransform(hat(c), s));
  });

  it('条件別の補正も基本の補正もなければ、補正なし', () => {
    expect(effectiveTransform(c.equipment[0]!, state('front', 'down', 'down'))).toBeUndefined();
  });

  it('行列は、状態に応じた補正から作る。補正のない Instance は含めない', () => {
    const down = instanceMatrices(c, library());
    expect(Object.keys(down)).toEqual([HAT]);
    expect(down[HAT]).toEqual([1, 0, 0, 1, 10, -20]);
    const pocket = instanceMatrices({ ...c, state: state('front', 'pocket', 'pocket') }, library());
    expect(pocket[HAT]).toEqual([1, 0, 0, 1, 30, 0]);
  });
});

describe('一意に決まらない組み合わせの禁止', () => {
  it('両方が書いているキーで値が違えば、同時には当てはまらない', () => {
    expect(conditionsOverlap({ pose: { 'arm.right': 'down' } }, { pose: { 'arm.right': 'pocket' } })).toBe(false);
    expect(conditionsOverlap({ view: 'front' }, { view: 'side_left' })).toBe(false);
    // 書いているキーが違うだけなら、同時に当てはまりうる
    expect(conditionsOverlap({ view: 'front' }, { pose: { 'arm.right': 'pocket' } })).toBe(true);
    expect(conditionsOverlap({ pose: { 'arm.left': 'down' } }, { pose: { 'arm.right': 'pocket' } })).toBe(true);
  });

  it('キーの数が同じで同時に当てはまりうる補正の組は INVALID（JSON だけで決まる）', () => {
    for (const file of ['invalid/override-overlap.json', 'invalid/override-same-condition.json']) {
      expect(validateCharacterJson(fixture(file)).errors.map((e) => e.code), file).toEqual(['override-overlap']);
    }
  });

  it('キーの数が違えば、同時に当てはまっても多い方に決まるので有効', () => {
    expect(validateCharacterJson(fixture('valid/transform-overrides.json')).ok).toBe(true);
  });

  it('条件なしの補正、知らないキーを持つ条件は INVALID', () => {
    expect(validateCharacterJson(fixture('invalid/override-when-empty.json')).errors.map((e) => e.code)).toEqual(['override-when-empty']);
    expect(validateCharacterJson(fixture('invalid/override-when-unknown-key.json')).errors.map((e) => e.code)).toEqual(['override-when-key']);
  });
});

describe('編集', () => {
  const c = load('valid/transform-overrides.json');

  it('基本の補正を設定・削除できる', () => {
    expect(hat(setTransform(c, HAT, { x: 1 })).transform).toEqual({ x: 1 });
    expect('transform' in hat(setTransform(c, HAT, undefined))).toBe(false);
  });

  it('同じ条件の補正は置き換え、新しい条件は追加する', () => {
    const replaced = setTransformOverride(c, HAT, { pose: { 'arm.right': 'pocket' } }, { y: 99 });
    expect(hat(replaced).overrides!.transform).toHaveLength(3);
    expect(effectiveTransform(hat(replaced), state('front', 'pocket', 'pocket'))).toEqual({ y: 99 });
    // キーの書き順が違っても同じ条件として扱う
    const sameKeys = setTransformOverride(c, HAT, { pose: { 'arm.left': 'down', 'arm.right': 'pocket' }, view: 'front' }, { y: 1 });
    expect(hat(sameKeys).overrides!.transform).toHaveLength(3);
    const added = setTransformOverride(c, HAT, { pose: { 'arm.right': 'down', 'arm.left': 'pocket', torso: 'stand' } }, { y: 5 });
    expect(hat(added).overrides!.transform).toHaveLength(4);
    expect(validateCharacterJson(serializeCharacter(added)).ok).toBe(true);
  });

  it('一意に決まらなくなる補正は追加できない（読み込めない Character を作らない）', () => {
    expect(() => setTransformOverride(c, HAT, { view: 'front' }, { x: 1 })).toThrow();
    expect(() => setTransformOverride(c, HAT, {}, { x: 1 })).toThrow();
  });

  it('補正を消しても、overrides の知らないキーは残る。すべて消えたら overrides ごとなくなる', () => {
    let cleared = c;
    for (const entry of hat(c).overrides!.transform as TransformOverride[]) cleared = setTransformOverride(cleared, HAT, entry.when, undefined);
    expect(hat(cleared).overrides).toEqual({ futureOverride: { kept: true } });
    const plain = setTransformOverride(setTransformOverride(load('valid/minimal.json'), u(10), { view: 'front' }, { x: 1 }), u(10), { view: 'front' }, undefined);
    expect('overrides' in plain.equipment[0]!).toBe(false);
  });

  it('保存して読み直しても、補正と知らないキーが変わらない', () => {
    const again = reload(c);
    expect(again).toEqual(c);
    expect(hat(again).overrides!.futureOverride).toEqual({ kept: true });
  });
});
