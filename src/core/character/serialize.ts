// Character → 保存 JSON。

import { deriveRequirements } from './requirements.ts';
import type { Character, CharacterJson } from './types.ts';
import { CHARACTER_FORMAT, SUPPORTED_CHARACTER_FORMAT_VERSION } from './types.ts';

const KNOWN_ORDER = ['id', 'name', 'appearance', 'sharedColors', 'equipment', 'state', 'composition'] as const;

/**
 * 保存 JSON を作る。`requirements` は必ず現在の内容から作り直す。
 * 未知のフィールドはそのまま書き出す（読み込んだ値を失わないため）。
 */
export function serializeCharacter(character: Character): CharacterJson {
  const source = structuredClone(character) as Character & Record<string, unknown>;
  const out: Record<string, unknown> = { format: CHARACTER_FORMAT, formatVersion: SUPPORTED_CHARACTER_FORMAT_VERSION };
  for (const key of KNOWN_ORDER) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  for (const [key, value] of Object.entries(source)) {
    if (!(key in out) && key !== 'requirements') out[key] = value;
  }
  out.requirements = deriveRequirements(character);
  return out as unknown as CharacterJson;
}

export function stringifyCharacter(character: Character): string {
  return JSON.stringify(serializeCharacter(character), null, 2) + '\n';
}

/** キーの順序に依存しない比較用の文字列。 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/** 2 つの Character が意味的に同じか（キーの順序と `requirements` の有無は問わない）。 */
export function sameCharacter(a: Character, b: Character): boolean {
  return stableStringify(serializeCharacter(a)) === stableStringify(serializeCharacter(b));
}
