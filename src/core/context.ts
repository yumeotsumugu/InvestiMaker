// 仕様書 §1 / §6.2 / §6.3：Context（描画時の状態）。

import type { ArmPlacement, ArmSide, PoseRegion } from './drawOrder.ts';
import { regionOfSlot } from './drawOrder.ts';

/** 表情（§6.3）。顔 Part の状態の組。`id` は標準表情名で、手動で組み替えたときは持たない。 */
export interface Expression {
  id?: string;
  eyes: string;
  eyebrows: string;
  mouth: string;
}

export interface Context {
  view: string;
  /** 素体の Part ID。 */
  body: string;
  pose: Record<PoseRegion, string>;
  expression: Expression;
  /** fit の次元 → 値（`chest: "large"`）。 */
  fit: Record<string, string>;
}

/** 1 つの Layer を解決するときの入力。`when` の各キーと 1 対 1 で照合する。 */
export interface LayerContext {
  view: string;
  body: string;
  /** その Layer の Slot が属する領域の状態（§6.2）。 */
  pose: string;
  /** その Part の状態。状態を持たない Part では undefined。 */
  state?: string;
  /** 装着位置。ITEM 用で、今回は常に undefined。 */
  attach?: string;
  fit: Record<string, string>;
}

type StateDomain = 'eyes' | 'eyebrows' | 'mouth';

/**
 * `when.state` をどの状態と照合するか（§6.5）。Part の category で決まり、
 * ここにない category の Part は状態を持たない。
 */
const STATE_DOMAIN_BY_CATEGORY: Readonly<Record<string, StateDomain>> = {
  'face.eyes': 'eyes',
  'face.eyebrows': 'eyebrows',
  'face.mouth': 'mouth',
};

export function layerContext(ctx: Context, category: string, slot: string): LayerContext {
  const domain = STATE_DOMAIN_BY_CATEGORY[category];
  return {
    view: ctx.view,
    body: ctx.body,
    pose: ctx.pose[regionOfSlot(slot)],
    state: domain ? ctx.expression[domain] : undefined,
    attach: undefined,
    fit: ctx.fit,
  };
}

/** `requires` / `conflicts` の `state` 条件が参照できる path（§8）。 */
export const CONTEXT_PATHS = ['view', 'pose.torso', 'pose.arm.left', 'pose.arm.right', 'expression'] as const;

export function contextValue(ctx: Context, path: string): string | undefined {
  switch (path) {
    case 'view':
      return ctx.view;
    case 'pose.torso':
      return ctx.pose.torso;
    case 'pose.arm.left':
      return ctx.pose['arm.left'];
    case 'pose.arm.right':
      return ctx.pose['arm.right'];
    case 'expression':
      return ctx.expression.id;
    default:
      return undefined;
  }
}

/**
 * Pose Definition（§6.2）。InvestiMaker 側の共通定義で、素材（.impart）は定義しない。
 * 腕の領域の定義は、腕グループの置き場所（placement）と、同じグループに両腕が入るときの順序（order）を持つ。
 */
export interface PoseDefinition {
  id: string;
  region: PoseRegion;
  /** 腕の領域だけが持つ。 */
  placement?: ArmPlacement;
  /** 腕の領域だけが持つ。小さい方が奥。 */
  order?: number;
}

export const POSE_DEFINITIONS: readonly PoseDefinition[] = [
  { id: 'stand', region: 'torso' },
  { id: 'down', region: 'arm.left', placement: 'back', order: 10 },
  { id: 'down', region: 'arm.right', placement: 'back', order: 20 },
  { id: 'pocket', region: 'arm.left', placement: 'front', order: 10 },
  { id: 'pocket', region: 'arm.right', placement: 'front', order: 20 },
];

export function findPose(region: PoseRegion, id: string): PoseDefinition | undefined {
  return POSE_DEFINITIONS.find((d) => d.region === region && d.id === id);
}

export interface ArmLayout {
  placement: Record<ArmSide, ArmPlacement>;
  order: Record<ArmSide, number>;
}

/** 現在のポーズから、両腕の腕グループの置き場所と順序を得る。未定義のポーズは例外。 */
export function armLayout(ctx: Context): ArmLayout {
  const of = (side: ArmSide) => {
    const def = findPose(`arm.${side}`, ctx.pose[`arm.${side}`]);
    if (!def?.placement || def.order === undefined) {
      throw new Error(`Pose Definition にない腕の状態: arm.${side} = ${ctx.pose[`arm.${side}`]}`);
    }
    return { placement: def.placement, order: def.order };
  };
  const left = of('left');
  const right = of('right');
  return { placement: { left: left.placement, right: right.placement }, order: { left: left.order, right: right.order } };
}

/** v1 の標準表情（§6.3）。 */
export const STANDARD_EXPRESSIONS: readonly Required<Expression>[] = [
  { id: 'normal', eyes: 'open', eyebrows: 'neutral', mouth: 'closed' },
  { id: 'smile', eyes: 'smile', eyebrows: 'relaxed', mouth: 'smile_open' },
  { id: 'angry', eyes: 'glare', eyebrows: 'angry', mouth: 'frown' },
  { id: 'sad', eyes: 'half', eyebrows: 'sad', mouth: 'frown' },
  { id: 'surprised', eyes: 'wide', eyebrows: 'raised', mouth: 'open' },
  { id: 'fear', eyes: 'wide', eyebrows: 'sad', mouth: 'shout' },
];

/** 標準状態名（§6.3）。 */
export const STANDARD_STATES = {
  eyes: ['open', 'half', 'closed', 'smile', 'wide', 'glare'],
  eyebrows: ['neutral', 'relaxed', 'angry', 'sad', 'raised'],
  mouth: ['closed', 'smile', 'smile_open', 'open', 'frown', 'shout'],
} as const;
