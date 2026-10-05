// Character を編集する純粋な関数。元のオブジェクトは変更せず、新しい Character を返す。
// 既存のオブジェクトを展開して作り直すので、未知のフィールドは保たれる。

import type { ColorSlot } from '../manifest.ts';
import { resolveSlotColor } from '../color.ts';
import type { Character, EquipmentInstance } from './types.ts';

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
 * Part を装備する。外してある同じ Part の Instance があればそれを付け直し（色などの設定と並び順が戻る）、
 * なければ `newInstanceId` で新しく追加する。
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

export function setFit(character: Character, dimension: string, value: string): Character {
  return { ...character, appearance: { ...character.appearance, fit: { ...character.appearance.fit, [dimension]: value } } };
}
