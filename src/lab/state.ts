// 検証ページの状態と、そこから描画計画を作る処理（DOM 非依存）。

import type { Context, Expression, RenderPlan, SlotColorOverride } from '../core/index.ts';
import { planRender, resolvePartColors } from '../core/index.ts';
import type { AssetSet } from '../web/loader.ts';

export interface LabState {
  /** 装備中の Part ID（素体を含む）。並びが装備順。 */
  equipped: string[];
  armRight: string;
  chest: string;
  expression: Expression;
  /** 共有カラー（§5.4）。 */
  shared: Record<string, string>;
  /** Part ID → スロット ID → 個別の色指定。 */
  overrides: Record<string, Record<string, SlotColorOverride>>;
  // --- 比較用の切り替え
  /** 眉を前髪の前（face.eyebrows.over）に置く（仮素材の宣言は face.eyebrows）。 */
  browsOver: boolean;
  /** 靴をボトムスの上（outfit.shoes.over）に置く（仮素材の宣言は outfit.shoes）。 */
  shoesOver: boolean;
  /** 色合成モードを multiply に差し替える。 */
  multiply: boolean;
  /** 競合の Part も描画する。 */
  drawConflicted: boolean;
}

export const DEFAULT_SHARED: Readonly<Record<string, string>> = {
  'skin.base': '#F2D3BD',
  'hair.base': '#5A3E2B',
  'eyes.left': '#4A6FA5',
  'eyes.right': '#4A6FA5',
};

export function initialState(set: AssetSet): LabState {
  return {
    equipped: set.defaults.filter((id) => set.library.has(id)),
    armRight: 'down',
    chest: 'medium',
    expression: { id: 'normal', eyes: 'open', eyebrows: 'neutral', mouth: 'closed' },
    shared: { ...DEFAULT_SHARED },
    overrides: {},
    browsOver: false,
    shoesOver: false,
    multiply: false,
    drawConflicted: true,
  };
}

export function contextOf(set: AssetSet, state: LabState): Context {
  return {
    view: 'front',
    body: set.body,
    pose: { torso: 'stand', 'arm.left': 'down', 'arm.right': state.armRight },
    expression: state.expression,
    fit: { chest: state.chest },
  };
}

export interface Planned {
  plan: RenderPlan;
  colors: Record<string, Record<string, string>>;
}

export function planOf(set: AssetSet, state: LabState): Planned {
  const ctx = contextOf(set, state);
  const plan = planRender(set.library, state.equipped, ctx, {
    slotOf: (_, layer) => {
      if (state.shoesOver && layer.slot === 'outfit.shoes') return 'outfit.shoes.over';
      if (state.browsOver && layer.slot === 'face.eyebrows') return 'face.eyebrows.over';
      return layer.slot;
    },
    drawConflicted: state.drawConflicted,
  });
  const colors: Planned['colors'] = {};
  for (const id of state.equipped) {
    const part = set.library.get(id);
    if (part) colors[id] = resolvePartColors(part, state.overrides[id], state.shared);
  }
  return { plan, colors };
}
