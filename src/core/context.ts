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
 * `when.state` をどの状態と照合するか。仕様書は「目・眉・口の Part」としか書いていないため、
 * Part の category で決める解釈を採った（レポートの変更提案を参照）。
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
 * 腕の状態 → 腕グループの置き場所。仕様書は「ポーズ定義が腕ごとに指定する」とするが、
 * ポーズ定義のデータ形式は未定義のため、実装側の表として持つ（レポートの変更提案を参照）。
 * `pocket` は検証用に追加した状態で、v1 の規定にはない。
 */
export const ARM_STATE_PLACEMENT: Readonly<Record<string, ArmPlacement>> = {
  down: 'back',
  pocket: 'front',
};

export function armPlacements(
  ctx: Context,
  table: Readonly<Record<string, ArmPlacement>> = ARM_STATE_PLACEMENT,
): Record<ArmSide, ArmPlacement> {
  const of = (side: ArmSide): ArmPlacement => {
    const state = ctx.pose[`arm.${side}`];
    const placement = table[state];
    if (!placement) throw new Error(`腕の状態 "${state}" の置き場所が定義されていない`);
    return placement;
  };
  return { left: of('left'), right: of('right') };
}

/**
 * v1 の標準表情（§6.3）。仕様書が状態の組を示しているのは smile だけで、
 * 他の 5 つは実装側で仮に決めた（レポートの変更提案を参照）。
 */
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
