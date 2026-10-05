// Character を編集する純粋な関数。元のオブジェクトは変更せず、新しい Character を返す。
// 既存のオブジェクトを展開して作り直すので、未知のフィールドは保たれる。

import { MASTER_CANVAS } from '../ids.ts';
import type { ColorSlot, Transform } from '../manifest.ts';
import { resolveSlotColor } from '../color.ts';
import { conditionSize, conditionsOverlap, sameCondition } from './transform.ts';
import type { Character, EquipmentInstance, TransformCondition } from './types.ts';

function updateInstance(character: Character, instanceId: string, change: (inst: EquipmentInstance) => EquipmentInstance): Character {
  if (!character.equipment.some((i) => i.instanceId === instanceId)) throw new Error(`Equipment Instance がない: ${instanceId}`);
  return { ...character, equipment: character.equipment.map((i) => (i.instanceId === instanceId ? change(i) : i)) };
}

export interface NewCharacter {
  id: string;
  name: string;
  /** 素体の Part ID と、その Equipment Instance に付ける instanceId。 */
  bodyPartId: string;
  bodyInstanceId: string;
}

/** 素体だけを装備した新しいキャラクター。v1 の既定のポーズと表情（normal）で始める。 */
export function createCharacter(init: NewCharacter): Character {
  return {
    id: init.id,
    name: init.name,
    canvas: [MASTER_CANVAS[0], MASTER_CANVAS[1]],
    appearance: { body: init.bodyInstanceId, fit: {} },
    sharedColors: {},
    equipment: [{ instanceId: init.bodyInstanceId, partId: init.bodyPartId, equipped: true, colors: {} }],
    state: {
      view: 'front',
      pose: { torso: 'stand', 'arm.left': 'down', 'arm.right': 'down' },
      expression: { eyes: 'open', eyebrows: 'neutral', mouth: 'closed' },
    },
  };
}

/** 新しい Equipment Instance を末尾（最後に装備したもの）として追加する。同じ Part を複数持てる。 */
export function addInstance(character: Character, partId: string, instanceId: string): Character {
  if (character.equipment.some((i) => i.instanceId === instanceId)) throw new Error(`instanceId が重複: ${instanceId}`);
  return { ...character, equipment: [...character.equipment, { instanceId, partId, equipped: true, colors: {} }] };
}

/**
 * Part を装備する。外してある同じ Part の Instance があればそれを付け直し、なければ `newInstanceId` で新しく追加する。
 * 付け直した Instance は色などの設定を保ち、equipment の中の位置も変わらない（Character Schema §5.1）。
 */
export function equipPart(character: Character, partId: string, newInstanceId: string): Character {
  const kept = character.equipment.findLast((i) => i.partId === partId && !i.equipped);
  return kept ? setEquipped(character, kept.instanceId, true) : addInstance(character, partId, newInstanceId);
}

/** 着脱する。外しても Instance は残り、色などの設定を保つ。素体は外せない。 */
export function setEquipped(character: Character, instanceId: string, equipped: boolean): Character {
  if (!equipped && instanceId === character.appearance.body) throw new Error('素体は外せない');
  return updateInstance(character, instanceId, (i) => ({ ...i, equipped }));
}

/** Instance を完全に削除する（設定も失われる）。素体は削除できない。 */
export function removeInstance(character: Character, instanceId: string): Character {
  if (instanceId === character.appearance.body) throw new Error('素体は削除できない');
  return { ...character, equipment: character.equipment.filter((i) => i.instanceId !== instanceId) };
}

/** 装備順を変える。 */
export function moveInstance(character: Character, instanceId: string, toIndex: number): Character {
  const from = character.equipment.findIndex((i) => i.instanceId === instanceId);
  if (from < 0) throw new Error(`Equipment Instance がない: ${instanceId}`);
  const equipment = [...character.equipment];
  const [inst] = equipment.splice(from, 1);
  equipment.splice(Math.max(0, Math.min(toIndex, equipment.length)), 0, inst!);
  return { ...character, equipment };
}

export function setSharedColor(character: Character, key: string, color: string): Character {
  return { ...character, sharedColors: { ...character.sharedColors, [key]: color.toUpperCase() } };
}

/** 個別色を設定する。共有色とのリンク状態は変えない。 */
export function setInstanceColor(character: Character, instanceId: string, slotId: string, color: string): Character {
  return updateInstance(character, instanceId, (i) => ({
    ...i,
    colors: { ...i.colors, [slotId]: { ...i.colors[slotId], color: color.toUpperCase() } },
  }));
}

/**
 * 共有色とのリンクを解除する。その時点で表示されている色を個別色にコピーするので、解除した瞬間に見た目は変わらない。
 * どの共有色に従っているかは Part の ColorSlot が持つ情報なので、`slot` を渡す。
 */
export function unlinkColor(character: Character, instanceId: string, slot: ColorSlot): Character {
  return updateInstance(character, instanceId, (i) => {
    const current = resolveSlotColor(slot, i.colors[slot.id], character.sharedColors);
    return { ...i, colors: { ...i.colors, [slot.id]: { ...i.colors[slot.id], linked: false, color: current.toUpperCase() } } };
  });
}

/** 共有色に戻す。個別色は消さずに残す。 */
export function relinkColor(character: Character, instanceId: string, slotId: string): Character {
  return updateInstance(character, instanceId, (i) => ({
    ...i,
    colors: { ...i.colors, [slotId]: { ...i.colors[slotId], linked: true } },
  }));
}

export function setPose(character: Character, region: string, id: string): Character {
  return { ...character, state: { ...character.state, pose: { ...character.state.pose, [region]: id } } };
}

export function setExpression(character: Character, change: Partial<Character['state']['expression']>): Character {
  return { ...character, state: { ...character.state, expression: { ...character.state.expression, ...change } } };
}

/** fit の値を設定する。`undefined` でその次元の指定をなくす。 */
export function setFit(character: Character, dimension: string, value: string | undefined): Character {
  const { [dimension]: _old, ...rest } = character.appearance.fit;
  return { ...character, appearance: { ...character.appearance, fit: value === undefined ? rest : { ...rest, [dimension]: value } } };
}

export function rename(character: Character, name: string): Character {
  return { ...character, name };
}

export function setView(character: Character, view: string): Character {
  return { ...character, state: { ...character.state, view } };
}

/** 条件によらない基本の配置補正を設定する。`undefined` で消す。 */
export function setTransform(character: Character, instanceId: string, transform: Transform | undefined): Character {
  return updateInstance(character, instanceId, ({ transform: _old, ...rest }) => (transform ? { ...rest, transform } : rest));
}

/**
 * 条件ごとの配置補正を設定する。同じ条件の補正があれば置き換え、なければ追加する。`undefined` でその条件の補正を消す。
 * 追加した結果、どちらを使うか決まらない組み合わせができる場合は例外にする（保存しても読み込めない Character を作らない）。
 */
export function setTransformOverride(
  character: Character,
  instanceId: string,
  when: TransformCondition,
  transform: Transform | undefined,
): Character {
  if (conditionSize(when) === 0) throw new Error('条件を 1 つ以上指定する');
  return updateInstance(character, instanceId, (inst) => {
    const others = (inst.overrides?.transform ?? []).filter((e) => !sameCondition(e.when, when));
    const clash = transform && others.find((e) => conditionSize(e.when) === conditionSize(when) && conditionsOverlap(e.when, when));
    if (clash) throw new Error('同じ状態に同時に当てはまりうる補正が既にある');
    const list = transform ? [...others, { when, transform }] : others;
    const { transform: _old, ...restOverrides } = inst.overrides ?? {};
    const overrides = list.length > 0 ? { ...restOverrides, transform: list } : restOverrides;
    const { overrides: _o, ...rest } = inst;
    return Object.keys(overrides).length > 0 ? { ...rest, overrides } : rest;
  });
}
