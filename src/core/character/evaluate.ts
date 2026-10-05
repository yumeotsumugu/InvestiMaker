// Character を読み込み環境に照らして評価する。VALID / INVALID / UNRESOLVED の 3 状態と、描画への橋渡し。
//
// - INVALID：Character JSON そのものが仕様違反。JSON だけで決まる（validate.ts）。
// - UNRESOLVED：JSON は正しいが、環境が必要なものを提供できない（Part がない、ポーズを知らない等）。
// - VALID：JSON が正しく、必要なものが環境に揃っている。
//
// Part が解決できない「非対応」や「競合」は描画時の状態（plan.ts）であって、ここでの判定には含めない。

import { resolvePartColors } from '../color.ts';
import type { Context } from '../context.ts';
import { STANDARD_EXPRESSIONS } from '../context.ts';
import { isMultiCategory } from '../ids.ts';
import type { Body, PartManifest } from '../manifest.ts';
import type { PlanOptions, RenderPlan } from '../plan.ts';
import { planRender } from '../plan.ts';
import type { Issue } from '../validate.ts';
import { deserializeCharacter } from './deserialize.ts';
import type { Environment } from './requirements.ts';
import { deriveRequirements, unmetRequirements } from './requirements.ts';
import type { Character, EquipmentInstance } from './types.ts';

export type CharacterValidity = 'VALID' | 'INVALID' | 'UNRESOLVED';

export interface CharacterIssue {
  code: string;
  /** `unresolved` は UNRESOLVED の原因。`warning` は判定に影響しない注意。 */
  effect: 'unresolved' | 'warning';
  instanceId?: string;
  message: string;
}

export interface Evaluation {
  validity: 'VALID' | 'UNRESOLVED';
  issues: CharacterIssue[];
  /** Part が読み込まれていない Equipment Instance（外しているものを含む）。 */
  missing: EquipmentInstance[];
}

export function bodyInstance(character: Character): EquipmentInstance {
  const inst = character.equipment.find((i) => i.instanceId === character.appearance.body);
  if (!inst) throw new Error('appearance.body が equipment にない（検証されていない Character）');
  return inst;
}

function bodyManifest(character: Character, env: Environment): Body | undefined {
  const part = env.library.get(bodyInstance(character).partId);
  return part?.kind === 'body' ? part : undefined;
}

export function evaluateCharacter(character: Character, env: Environment): Evaluation {
  const issues: CharacterIssue[] = [];
  const body = bodyManifest(character, env);

  // 環境が満たせない Requirements。語彙は Asset 側と共通。
  for (const u of unmetRequirements(deriveRequirements(character), env, body)) {
    issues.push({ code: u.code, effect: 'unresolved', message: u.message });
  }

  const bodyPart = env.library.get(bodyInstance(character).partId);
  if (bodyPart && bodyPart.kind !== 'body') {
    issues.push({ code: 'body-kind', effect: 'unresolved', instanceId: character.appearance.body, message: `素体として参照された Part が Body ではない: ${bodyPart.id}` });
  }

  const missing: EquipmentInstance[] = [];
  const equippedByCategory = new Map<string, EquipmentInstance[]>();
  for (const inst of character.equipment) {
    const part = env.library.get(inst.partId);
    if (!part) {
      missing.push(inst);
      // 装備中の不足は Requirements（上）で挙がる。外している Part の不足は再現に影響しないので注意にとどめる。
      if (!inst.equipped) issues.push({ code: 'part-missing-unequipped', effect: 'warning', instanceId: inst.instanceId, message: `外している Part が読み込まれていない: ${inst.partId}` });
      continue;
    }
    const declared = new Set((part.colorSlots ?? []).map((s) => s.id));
    const unknown = Object.keys(inst.colors).filter((slotId) => !declared.has(slotId));
    if (unknown.length > 0) {
      issues.push({ code: 'color-slot-unknown', effect: 'warning', instanceId: inst.instanceId, message: `${part.id} が宣言していないスロットの色（保持する）: ${unknown.join(', ')}` });
    }
    if (inst.equipped) equippedByCategory.set(part.category, [...(equippedByCategory.get(part.category) ?? []), inst]);
  }
  for (const [category, instances] of equippedByCategory) {
    if (instances.length > 1 && !isMultiCategory(category)) {
      issues.push({ code: 'category-duplicate', effect: 'warning', message: `1 Part だけ装備できる category に複数装備している: ${category}（${instances.map((i) => i.partId).join(', ')}）` });
    }
  }

  return { validity: issues.some((i) => i.effect === 'unresolved') ? 'UNRESOLVED' : 'VALID', issues, missing };
}

export type CheckResult =
  | { validity: 'INVALID'; errors: Issue[] }
  | { validity: 'VALID' | 'UNRESOLVED'; character: Character; evaluation: Evaluation; warnings: Issue[] };

/** 保存 JSON を読み、環境に照らして 3 状態を判定する。 */
export function checkCharacter(input: unknown, env: Environment): CheckResult {
  const result = deserializeCharacter(input);
  if (!result.ok) return { validity: 'INVALID', errors: result.errors };
  const evaluation = evaluateCharacter(result.character, env);
  return { validity: evaluation.validity, character: result.character, evaluation, warnings: result.warnings };
}

// ---------------------------------------------------------------- 描画への橋渡し

/** 顔の状態の組が標準表情のどれかに当たれば、その ID。 */
export function expressionPresetOf(expression: Character['state']['expression']): string | undefined {
  return STANDARD_EXPRESSIONS.find((e) => e.eyes === expression.eyes && e.eyebrows === expression.eyebrows && e.mouth === expression.mouth)?.id;
}

/** Asset 解決の入力（Context）を作る。素体の Part ID は素体の Equipment Instance から取る。 */
export function toContext(character: Character): Context {
  const { pose, expression, view } = character.state;
  return {
    view,
    body: bodyInstance(character).partId,
    pose: { torso: pose.torso!, 'arm.left': pose['arm.left']!, 'arm.right': pose['arm.right']! },
    expression: { id: expressionPresetOf(expression), ...expression },
    fit: character.appearance.fit,
  };
}

/**
 * 描画計画を作る。装備順は `equipment` の並び。外している Instance は含めない。
 * 読み込まれていない Part は計画の中で「不足」になり、他の Part の描画は妨げない。
 * この実装が知らないポーズを含む Character では例外になる（先に evaluateCharacter で確かめる）。
 */
export function planCharacter(character: Character, library: ReadonlyMap<string, PartManifest>, options?: PlanOptions): RenderPlan {
  const refs = character.equipment.filter((i) => i.equipped).map(({ instanceId, partId }) => ({ instanceId, partId }));
  return planRender(library, refs, toContext(character), options);
}

/** 装備中の各 Instance の、スロットごとの色（instanceId → スロット ID → `#RRGGBB`）。 */
export function instanceColors(character: Character, library: ReadonlyMap<string, PartManifest>): Record<string, Record<string, string>> {
  const colors: Record<string, Record<string, string>> = {};
  for (const inst of character.equipment) {
    const part = library.get(inst.partId);
    if (inst.equipped && part) colors[inst.instanceId] = resolvePartColors(part, inst.colors, character.sharedColors);
  }
  return colors;
}
