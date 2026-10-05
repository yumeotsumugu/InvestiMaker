// 保存 JSON → Character。

import type { Issue } from '../validate.ts';
import { deriveRequirements } from './requirements.ts';
import { stableStringify } from './serialize.ts';
import type { Character, EquipmentInstance } from './types.ts';
import { validateCharacterJson } from './validate.ts';

export type DeserializeResult =
  | { ok: true; character: Character; warnings: Issue[] }
  | { ok: false; errors: Issue[]; warnings: Issue[] };

/**
 * 構造を検証し、既定値を埋めた Character を返す。
 * Part の manifest は参照しない。読み込み環境に Part がなくても結果は変わらない。
 */
export function deserializeCharacter(input: unknown): DeserializeResult {
  const validation = validateCharacterJson(input);
  if (!validation.ok) return { ok: false, errors: validation.errors, warnings: validation.warnings };

  const { format: _format, formatVersion: _version, requirements: stored, ...rest } = structuredClone(input) as Record<string, unknown>;
  const character = rest as unknown as Character;
  const warnings = [...validation.warnings];

  // --- 既定値と正規化（同じ意味の JSON が同じ Character になるようにする）
  character.appearance.fit ??= {};
  for (const [key, value] of Object.entries(character.sharedColors)) character.sharedColors[key] = value.toUpperCase();
  character.equipment = character.equipment.map((inst): EquipmentInstance => {
    const colors = inst.colors ?? {};
    for (const override of Object.values(colors)) {
      if (override.color !== undefined) override.color = override.color.toUpperCase();
    }
    return { ...inst, colors };
  });

  // requirements はキャッシュ。内容が古くても Character には影響しない（知らせるだけ）。
  if (stored !== undefined && typeof stored === 'object' && !Array.isArray(stored)) {
    if (stableStringify(stored) !== stableStringify(deriveRequirements(character))) {
      warnings.push({ level: 'warning', code: 'requirements-stale', path: 'requirements', message: 'requirements が現在の内容と一致しない（保存時に作り直す）' });
    }
  }

  return { ok: true, character, warnings };
}

/** JSON 文字列から読む。JSON として壊れている場合も `ok: false` で返す。 */
export function parseCharacter(text: string): DeserializeResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [{ level: 'error', code: 'json-syntax', path: '', message: `JSON として読めない: ${String(e)}` }], warnings: [] };
  }
  return deserializeCharacter(json);
}
