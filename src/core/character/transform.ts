// Equipment Instance の配置補正と、条件ごとの補正（`overrides.transform`）。
//
// 条件は Asset の `when` と同じ考え方で書く：書いたキーだけを照合し、書かないキーには依存しない。
// 複数の補正が当てはまるときは、条件に書いたキーの数が多い方を使う。
// キーの数が同じで同時に当てはまりうる 2 つの補正は、読み込み時に不正として拒否する。
// したがって、ある状態に適用される補正は必ず 1 つに決まる。

import type { PartManifest, Transform } from '../manifest.ts';
import type { Matrix } from '../transform.ts';
import { combineTransforms, isIdentity, transformMatrix } from '../transform.ts';
import type { Character, CharacterState, EquipmentInstance, TransformCondition } from './types.ts';

/** 条件に書いたキーの数（`view` が 1、`pose` の各領域が 1）。 */
export function conditionSize(when: TransformCondition): number {
  return (when.view === undefined ? 0 : 1) + Object.keys(when.pose ?? {}).length;
}

export function conditionMatches(when: TransformCondition, state: CharacterState): boolean {
  if (when.view !== undefined && when.view !== state.view) return false;
  return Object.entries(when.pose ?? {}).every(([region, id]) => state.pose[region] === id);
}

/**
 * 2 つの条件が、同じ状態に同時に当てはまりうるか。
 * 両方が書いているキーのどれかで値が違えば、同時には当てはまらない。
 */
export function conditionsOverlap(a: TransformCondition, b: TransformCondition): boolean {
  if (a.view !== undefined && b.view !== undefined && a.view !== b.view) return false;
  for (const [region, id] of Object.entries(a.pose ?? {})) {
    const other = b.pose?.[region];
    if (other !== undefined && other !== id) return false;
  }
  return true;
}

export function sameCondition(a: TransformCondition, b: TransformCondition): boolean {
  const key = (w: TransformCondition) => JSON.stringify([w.view ?? null, Object.entries(w.pose ?? {}).sort(([x], [y]) => (x < y ? -1 : 1))]);
  return key(a) === key(b);
}

/**
 * 現在の状態で使う配置補正。当てはまる条件別の補正があればそれが基本の `transform` を**置き換える**。
 * なければ基本の `transform`。
 */
export function effectiveTransform(inst: EquipmentInstance, state: CharacterState): Transform | undefined {
  let best: Transform | undefined;
  let bestSize = -1;
  for (const entry of inst.overrides?.transform ?? []) {
    const size = conditionSize(entry.when);
    if (size > bestSize && conditionMatches(entry.when, state)) {
      best = entry.transform;
      bestSize = size;
    }
  }
  return bestSize >= 0 ? best : inst.transform;
}

/**
 * 装備中の各 Instance に適用する行列（instanceId → 行列）。恒等変換は含めない。
 * Part 既定の補正に、Instance の補正を差分として合成する（Asset Specification §9）。
 */
export function instanceMatrices(
  character: Character,
  library: ReadonlyMap<string, PartManifest>,
  canvas: readonly [number, number] = character.canvas,
): Record<string, Matrix> {
  const matrices: Record<string, Matrix> = {};
  for (const inst of character.equipment) {
    const part = library.get(inst.partId);
    if (!inst.equipped || !part) continue;
    const matrix = transformMatrix(combineTransforms(part.transform, effectiveTransform(inst, character.state)), canvas);
    if (!isIdentity(matrix)) matrices[inst.instanceId] = matrix;
  }
  return matrices;
}
