import type { Context, Layer, Part } from '../src/core/index.ts';

/** 検証を通る最小の Part。テストで必要な部分だけ上書きして使う。 */
export function minimalPart(overrides: Partial<Part> = {}): Part {
  return {
    format: 'INVESTIMAKER_PART',
    formatVersion: 1,
    id: 'dev.test_part',
    version: '1.0.0',
    kind: 'part',
    name: 'テスト用 Part',
    author: 'test',
    category: 'outfit.top',
    license: { name: 'test' },
    compatible: { body: ['dev.body_a'] },
    layers: [layer('main', 'outfit.top')],
    ...overrides,
  };
}

export function layer(id: string, slot: string, extra: Partial<Layer> = {}): Layer {
  return { id, slot, assets: [{ when: { view: 'front' }, file: `assets/front/${id}.png` }], ...extra };
}

export function context(overrides: Partial<Context> = {}): Context {
  return {
    view: 'front',
    body: 'dev.body_a',
    pose: { torso: 'stand', 'arm.left': 'down', 'arm.right': 'down' },
    expression: { id: 'normal', eyes: 'open', eyebrows: 'neutral', mouth: 'closed' },
    fit: { chest: 'medium' },
    ...overrides,
  };
}
