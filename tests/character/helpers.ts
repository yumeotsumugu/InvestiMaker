import { readFileSync } from 'node:fs';
import type { Body, Character, ColorSlot, Environment, PartManifest } from '../../src/core/index.ts';
import { deserializeCharacter } from '../../src/core/index.ts';
import { layer, minimalPart } from '../helpers.ts';

const FIXTURES = new URL('./fixtures/', import.meta.url);

/** テスト用の固定 UUID。 */
export const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function fixture(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(path, FIXTURES), 'utf8')) as Record<string, unknown>;
}

export function load(path: string): Character {
  const result = deserializeCharacter(fixture(path));
  if (!result.ok) throw new Error(`${path}: ${result.errors.map((e) => e.message).join(' / ')}`);
  return result.character;
}

const slot = (id: string, link?: string): ColorSlot => ({ id, name: id, mode: 'tint', default: '#808080', ...(link ? { link } : {}) });

const body: Body = {
  ...(({ compatible: _, ...rest }) => rest)(minimalPart()),
  id: 'im.body_01',
  kind: 'body',
  category: 'body',
  views: ['front'],
  fitDimensions: { chest: ['small', 'medium', 'large'] },
  anchors: { front: { head_top: [800, 180] } },
  colorSlots: [slot('skin', 'skin.base')],
  layers: [layer('base', 'body.base')],
};

const part = (id: string, category: string, slotName: string, colorSlots: ColorSlot[]): PartManifest =>
  minimalPart({ id, category, compatible: { body: ['im.body_01'] }, colorSlots, layers: [layer('main', slotName)] });

/** fixtures が参照する Part 一式。`without` に挙げた Part は「読み込まれていない」ことにする。 */
export function library(...without: string[]): Map<string, PartManifest> {
  const parts = [
    body,
    part('im.hair_01', 'hair.back', 'hair.back', [slot('base', 'hair.base')]),
    part('author.special_coat', 'outfit.outer', 'outfit.outer', [slot('main'), slot('lapel')]),
    part('im.hat_01', 'outfit.head', 'outfit.head', [slot('main')]),
    part('im.overlay_01', 'overlay', 'overlay.face', [slot('color')]),
  ];
  return new Map(parts.filter((p) => !without.includes(p.id)).map((p) => [p.id, p]));
}

export const env = (...without: string[]): Environment => ({ library: library(...without) });
