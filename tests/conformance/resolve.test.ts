// 仕様書 §6.6 の T1〜T12。入力は fixtures/resolve/*.json。

import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Layer, LayerContext } from '../../src/core/index.ts';
import { resolveAsset, resolvePart, validateManifest } from '../../src/core/index.ts';
import { context, minimalPart } from '../helpers.ts';

interface Fixture {
  id: string;
  description: string;
  compatibleBody: string[];
  layer: Layer;
  context: LayerContext | null;
  expect: 'x' | 'y' | 'unresolved' | 'invalid';
}

const dir = new URL('./fixtures/resolve/', import.meta.url);
const fixtures = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as Fixture);

const partOf = (fx: Fixture, layer: Layer = fx.layer) =>
  minimalPart({ compatible: { body: fx.compatibleBody }, layers: [layer] });

describe('§6.6 解決のテストケース', () => {
  it('T1〜T12 がすべて揃っている', () => {
    expect(fixtures.map((f) => f.id)).toEqual(Array.from({ length: 12 }, (_, i) => `T${i + 1}`));
  });

  for (const fx of fixtures) {
    it(`${fx.id}: ${fx.expect} — ${fx.description}`, () => {
      const validation = validateManifest(partOf(fx));

      if (fx.expect === 'invalid') {
        expect(validation.ok).toBe(false);
        expect(validation.errors.map((e) => e.code)).toEqual(['when-overlap']);
        return;
      }

      expect(validation.errors).toEqual([]);
      const asset = resolveAsset(fx.layer.assets, fx.context!, fx.compatibleBody);
      if (fx.expect === 'unresolved') expect(asset).toBeNull();
      else expect(asset?.file).toBe(`assets/front/${fx.expect}.png`);
    });
  }

  it('T11: 未解決の Layer が optional でなければ Part 全体が非対応、optional なら省くだけ', () => {
    const fx = fixtures.find((f) => f.id === 'T11')!;
    const ctx = context({ pose: { torso: 'stand', 'arm.left': 'down', 'arm.right': 'pocket' } });

    const required = resolvePart(partOf(fx), ctx);
    expect(required.supported).toBe(false);
    expect(required.unresolved).toEqual(['target']);

    const optional = resolvePart(partOf(fx, { ...fx.layer, optional: true }), ctx);
    expect(optional.supported).toBe(true);
    expect(optional.layers[0]!.asset).toBeNull();
  });

  it('同じ入力に対して結果は常に同じ（Asset の並び順に依存しない）', () => {
    for (const fx of fixtures) {
      if (fx.expect === 'invalid') continue;
      const forward = resolveAsset(fx.layer.assets, fx.context!, fx.compatibleBody);
      const reversed = resolveAsset([...fx.layer.assets].reverse(), fx.context!, fx.compatibleBody);
      expect(reversed).toBe(forward);
    }
  });
});
