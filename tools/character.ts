// 生成した仮素材でキャラクター 1 体を描く（テストとレポート用画像で共用）。

import type { Bitmap, Character, ColorMode, Context, PartManifest, PlanOptions, RenderPlan, SlotColorOverride } from '../src/core/index.ts';
import { instanceColors, instanceMatrices, planCharacter, planRender, resolvePartColors } from '../src/core/index.ts';
import type { GeneratedSet } from './dev-assets.ts';
import { defaultContext } from './dev-assets.ts';
import { ALTERNATE_IDS } from './dev-parts.ts';
import { renderPlan } from './render.ts';

export interface CharacterState {
  /** 装備中の Part ID（素体を含む）。 */
  equipped: string[];
  context: Context;
  /** 共有カラー（§5.4）。 */
  shared: Record<string, string>;
  /** Part ID → スロット ID → 個別の色指定。 */
  overrides: Record<string, Record<string, SlotColorOverride>>;
}

/** 既定の状態。同じ category の選択肢として足した Part 以外をすべて装備する。 */
export function defaultState(set: GeneratedSet): CharacterState {
  return {
    equipped: set.parts.map((p) => p.manifest.id).filter((id) => !ALTERNATE_IDS.includes(id)),
    context: defaultContext(),
    shared: {},
    overrides: {},
  };
}

export interface RenderOptions extends PlanOptions {
  modeOverride?: ColorMode;
}

export function renderCharacter(
  set: GeneratedSet,
  state: CharacterState,
  options: RenderOptions = {},
): { bitmap: Bitmap; plan: RenderPlan } {
  const byId = new Map(set.parts.map((p) => [p.manifest.id, p]));
  const library = new Map(set.parts.map((p) => [p.manifest.id, p.manifest]));
  const plan = planRender(library, state.equipped, state.context, options);
  const colors = Object.fromEntries(
    set.parts.map((p) => [p.manifest.id, resolvePartColors(p.manifest, state.overrides[p.manifest.id], state.shared)]),
  );
  const bitmap = renderPlan({
    plan,
    library,
    image: (partId, file) => byId.get(partId)!.images.get(file)!,
    colors,
    width: set.width,
    height: set.height,
    modeOverride: options.modeOverride,
  });
  return { bitmap, plan };
}

/** 保存形式の Character（Character Schema v1）を、生成した仮素材で描く。 */
export function renderCharacterData(
  set: GeneratedSet,
  character: Character,
  library: ReadonlyMap<string, PartManifest> = new Map(set.parts.map((p) => [p.manifest.id, p.manifest])),
): { bitmap: Bitmap; plan: RenderPlan } {
  const byId = new Map(set.parts.map((p) => [p.manifest.id, p]));
  const plan = planCharacter(character, library);
  const bitmap = renderPlan({
    plan,
    library,
    image: (partId, file) => byId.get(partId)!.images.get(file)!,
    colors: instanceColors(character, library),
    // 仮素材を縮小して生成した場合も、その大きさを座標系として扱う。
    matrices: instanceMatrices(character, library, [set.width, set.height]),
    width: set.width,
    height: set.height,
  });
  return { bitmap, plan };
}
