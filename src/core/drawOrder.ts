// 仕様書 §6.1：Layer Slot と標準描画順（奥 → 手前）。

export type ArmSide = 'left' | 'right';
export const ARM_SIDES: readonly ArmSide[] = ['left', 'right'];

/** 腕グループを胴体の後ろ（G2）/ 前（G6）のどちらに置くか。 */
export type ArmPlacement = 'back' | 'front';

export type PoseRegion = 'torso' | 'arm.left' | 'arm.right';

const G0_BACKGROUND = ['background', 'effect.back'];
const G1_BACK = ['outfit.head.back', 'hair.back', 'item.back', 'outfit.outer.back'];
const G3_TORSO = [
  'body.base',
  'overlay.body',
  'outfit.socks',
  'outfit.shoes',
  'outfit.bottom',
  'outfit.inner',
  'outfit.top',
  'outfit.shoes.over',
  'outfit.vest',
  'outfit.outer',
  'item.waist',
];
const G4_NECK = ['outfit.neck'];
const G5_HEAD = [
  'face.head',
  'face.detail',
  'overlay.face',
  'face.mouth',
  'face.nose',
  'face.eyes',
  'hair.side',
  'face.ears',
  'outfit.ear',
  'face.eyebrows',
  'hair.front',
  'face.eyebrows.over',
  'outfit.eyewear',
  'overlay.face.front',
  'hair.extra',
  'outfit.head',
];
const G7_FRONT = ['item.front', 'overlay.front', 'effect.front'];

/** 腕グループの Slot（奥 → 手前）。 */
export function armGroupSlots(side: ArmSide): string[] {
  return [
    `arm.${side}.skin`,
    `overlay.arm.${side}`,
    `arm.${side}.sleeve.inner`,
    `arm.${side}.sleeve.top`,
    `arm.${side}.sleeve.outer`,
    `arm.${side}.hand`,
    `arm.${side}.glove`,
    `item.hand.${side}`,
    `arm.${side}.hand.front`,
  ];
}

/** §6.1 に存在するすべての Layer Slot。 */
export const LAYER_SLOTS: ReadonlySet<string> = new Set([
  ...G0_BACKGROUND,
  ...G1_BACK,
  ...G3_TORSO,
  ...G4_NECK,
  ...G5_HEAD,
  ...G7_FRONT,
  ...ARM_SIDES.flatMap(armGroupSlots),
]);

/**
 * 標準描画順。腕グループは腕ごとに G2（背面）か G6（前面）へ入る。
 * 同じグループに両腕が入るときは Pose Definition の `order` の昇順、同値なら left → right（§6.2）。
 */
export function standardSlotOrder(
  placement: Record<ArmSide, ArmPlacement>,
  order: Record<ArmSide, number> = { left: 10, right: 20 },
): string[] {
  const armsAt = (p: ArmPlacement) =>
    ARM_SIDES.filter((side) => placement[side] === p)
      .sort((a, b) => order[a] - order[b])
      .flatMap(armGroupSlots);
  return [
    ...G0_BACKGROUND,
    ...G1_BACK,
    ...armsAt('back'),
    ...G3_TORSO,
    ...G4_NECK,
    ...G5_HEAD,
    ...armsAt('front'),
    ...G7_FRONT,
  ];
}

/** Slot が属するポーズ領域（§6.2）。 */
export function regionOfSlot(slot: string): PoseRegion {
  for (const side of ARM_SIDES) {
    if (slot.startsWith(`arm.${side}.`) || slot === `overlay.arm.${side}` || slot === `item.hand.${side}`) {
      return `arm.${side}`;
    }
  }
  return 'torso';
}
