import { describe, expect, it } from 'vitest';
import type { Body, Part } from '../../src/core/index.ts';
import { validateFitAgainstBody, validateImageGeometry, validateManifest } from '../../src/core/index.ts';
import { layer, minimalPart } from '../helpers.ts';

const codes = (input: unknown, options = {}) => validateManifest(input, options).errors.map((e) => e.code);
const warnings = (input: unknown) => validateManifest(input).warnings.map((e) => e.code);

function minimalBody(overrides: Partial<Body> = {}): Body {
  const { compatible: _, ...base } = minimalPart();
  return {
    ...base,
    id: 'dev.body_a',
    kind: 'body',
    category: 'body',
    views: ['front'],
    anchors: { front: { head_top: [800, 180] } },
    layers: [layer('base', 'body.base')],
    ...overrides,
  };
}

describe('必須フィールド（§11.1）', () => {
  it('最小の Part と Body は通る', () => {
    expect(validateManifest(minimalPart())).toMatchObject({ ok: true, errors: [] });
    expect(validateManifest(minimalBody())).toMatchObject({ ok: true, errors: [] });
  });

  it.each(['version', 'name', 'author', 'license', 'layers'] as const)('%s がなければ拒否', (key) => {
    const part: Partial<Part> = minimalPart();
    delete part[key];
    expect(codes(part)).toContain('required');
  });

  it('format / kind / category が不正なら拒否', () => {
    expect(codes({ ...minimalPart(), format: 'OTHER' })).toContain('format');
    expect(codes({ ...minimalPart(), kind: 'item' })).toContain('kind');
    expect(codes(minimalPart({ category: 'clothing.outer' }))).toContain('category');
  });

  it('Body 以外は compatible.body が必須', () => {
    const part: Partial<Part> = minimalPart();
    delete part.compatible;
    expect(codes(part)).toContain('compatible-body');
    expect(codes(minimalPart({ compatible: { body: [] } }))).toContain('compatible-body');
  });

  it('formatVersion が対応範囲より新しければ拒否', () => {
    expect(codes(minimalPart({ formatVersion: 2 }))).toEqual(['format-version-unsupported']);
  });

  it('未知のフィールドは無視する', () => {
    const part = { ...minimalPart(), futureField: { anything: true } };
    expect(validateManifest(part).ok).toBe(true);
  });

  it('Body は kind と category が組で、anchors が VIEW ごとに必要', () => {
    expect(codes({ ...minimalPart(), kind: 'body' })).toContain('kind-category');
    expect(codes(minimalBody({ anchors: {} }))).toContain('body-anchors');
    expect(codes(minimalBody({ views: ['front', 'side_left'] }))).toContain('body-anchors');
  });
});

describe('キャンバス（§4.1）', () => {
  it('canvas は必須で、マスターキャンバスと一致しなければ拒否', () => {
    const part: Partial<Part> = minimalPart();
    delete part.canvas;
    expect(codes(part)).toEqual(['canvas']);
    expect(codes(minimalPart({ canvas: [1200, 1800] }))).toEqual(['canvas-mismatch']);
    expect(codes(minimalPart({ canvas: [1200, 1800] }), { canvas: [1200, 1800] })).toEqual([]);
  });
});

describe('素体の fit との照合（§6.5）', () => {
  it('素体にない fit 次元・値を使っていたら警告', () => {
    const body = minimalBody({ fitDimensions: { chest: ['small', 'medium', 'large'] } });
    const l = layer('a', 'outfit.top');
    l.assets[0]!.when = { view: 'front', fit: { chest: ['large', 'huge'], waist: 'wide' } };
    expect(validateFitAgainstBody(minimalPart({ layers: [l] }), body).map((i) => i.code)).toEqual(['fit-value-unknown', 'fit-dimension-unknown']);
    l.assets[0]!.when = { view: 'front', fit: { chest: 'large' } };
    expect(validateFitAgainstBody(minimalPart({ layers: [l] }), body)).toEqual([]);
  });
});

describe('ID 規則（§3）', () => {
  it.each(['coat', 'Dev.coat', 'dev.coat-01', 'dev.', 'dev.a.b', 'dev.' + 'a'.repeat(96)])('Part ID "%s" は拒否', (id) => {
    expect(codes(minimalPart({ id }))).toContain('part-id');
  });

  it('namespace im はユーザー素材では拒否、公式素材では許可', () => {
    expect(codes(minimalPart({ id: 'im.coat_001' }))).toContain('namespace-reserved');
    expect(codes(minimalPart({ id: 'im.coat_001' }), { official: true })).toEqual([]);
  });

  it('ColorSlot ID と Layer ID は Part 内で一意', () => {
    const slot = { id: 'main', name: '本体', mode: 'tint' as const, default: '#000000' };
    expect(codes(minimalPart({ colorSlots: [slot, slot] }))).toContain('color-slot-duplicate');
    expect(codes(minimalPart({ layers: [layer('a', 'outfit.top'), layer('a', 'outfit.outer')] }))).toContain('layer-duplicate');
  });
});

describe('Layer と Asset（§12 の 3〜5）', () => {
  it('slot が §6.1 になければ拒否', () => {
    expect(codes(minimalPart({ layers: [layer('a', 'shirt')] }))).toContain('slot');
    expect(codes(minimalPart({ layers: [layer('a', 'arm.right.sleeve.top')] }))).toEqual([]);
  });

  it('when.view は省略不可', () => {
    const bad = layer('a', 'outfit.top');
    bad.assets[0]!.when = { pose: 'down' } as never;
    expect(codes(minimalPart({ layers: [bad] }))).toContain('when-view');
  });

  it('channels は宣言済みの ColorSlot を指す', () => {
    const l = layer('a', 'outfit.top');
    l.assets[0]!.mask = { file: 'assets/front/a.mask.png', channels: { r: 'main' } };
    expect(codes(minimalPart({ layers: [l] }))).toContain('mask-channel-slot');
    const slots = [{ id: 'main', name: '本体', mode: 'tint' as const, default: '#000000' }];
    expect(codes(minimalPart({ layers: [l], colorSlots: slots }))).toEqual([]);
  });

  it('channels に r / g / b 以外（A チャンネルなど）を書いたら拒否', () => {
    const slots = [{ id: 'main', name: '本体', mode: 'tint' as const, default: '#000000' }];
    const l = layer('a', 'outfit.top');
    l.assets[0]!.mask = { file: 'assets/front/a.mask.png', channels: { r: 'main', a: 'main' } as never };
    expect(codes(minimalPart({ layers: [l], colorSlots: slots }))).toEqual(['mask-channel-unknown']);
  });

  it('mask と masks を同時に書いたら拒否', () => {
    const slots = [{ id: 'main', name: '本体', mode: 'tint' as const, default: '#000000' }];
    const mask = { file: 'assets/front/a.mask.png', channels: { r: 'main' } };
    const l = layer('a', 'outfit.top');
    l.assets[0]!.masks = [mask, { ...mask, file: 'assets/front/a.mask2.png' }];
    expect(codes(minimalPart({ layers: [l], colorSlots: slots }))).toEqual([]);
    l.assets[0]!.mask = mask;
    expect(codes(minimalPart({ layers: [l], colorSlots: slots }))).toEqual(['mask-both']);
  });

  it('Pose Definition にないポーズを書いたら警告', () => {
    const sleeve = layer('a', 'arm.left.sleeve.top');
    sleeve.assets[0]!.when = { view: 'front', pose: ['down', 'wave'] };
    expect(warnings(minimalPart({ layers: [sleeve] }))).toEqual(['when-pose-unknown']);
    // down は腕の状態で、胴体の状態ではない
    const body = layer('b', 'outfit.top');
    body.assets[0]!.when = { view: 'front', pose: 'down' };
    expect(warnings(minimalPart({ layers: [body] }))).toEqual(['when-pose-unknown']);
    body.assets[0]!.when = { view: 'front', pose: 'stand' };
    expect(warnings(minimalPart({ layers: [body] }))).toEqual([]);
  });

  it('ColorSlot の mode と default を検査する', () => {
    expect(codes(minimalPart({ colorSlots: [{ id: 'a', mode: 'screen' as never, default: '#000000' }] }))).toContain('color-slot-mode');
    expect(codes(minimalPart({ colorSlots: [{ id: 'a', mode: 'tint', default: 'red' }] }))).toContain('color-slot-default');
  });

  it.each(['../x.png', '/abs/x.png', 'C:/x.png', 'assets\\x.png', 'https://example.com/x.png', 'assets/x.js'])(
    'ファイルパス "%s" は拒否',
    (file) => {
      const l = layer('a', 'outfit.top');
      l.assets[0]!.file = file;
      expect(validateManifest(minimalPart({ layers: [l] })).ok).toBe(false);
    },
  );

  it('zBias は −9〜9 の整数', () => {
    expect(codes(minimalPart({ layers: [layer('a', 'outfit.top', { zBias: 10 })] }))).toContain('z-bias');
    expect(codes(minimalPart({ layers: [layer('a', 'outfit.top', { zBias: -9 })] }))).toEqual([]);
  });

  it('同じ when を持つ Asset が 2 つあれば重複として拒否', () => {
    const l = layer('a', 'outfit.top');
    l.assets.push({ when: { view: 'front' }, file: 'assets/front/b.png' });
    expect(codes(minimalPart({ layers: [l] }))).toEqual(['when-overlap']);
  });

  it('view が交わらなければ重複ではない', () => {
    const l = layer('a', 'outfit.top');
    l.assets.push({ when: { view: 'side_left' }, file: 'assets/side/a.png' });
    expect(codes(minimalPart({ layers: [l] }))).toEqual([]);
  });

  it('腕領域の Layer が pose を省略していたら警告', () => {
    expect(warnings(minimalPart({ layers: [layer('a', 'arm.left.sleeve.top')] }))).toContain('when-pose-missing');
  });
});

describe('互換性の宣言（§8）', () => {
  it('requires / conflicts / hides を検査する', () => {
    expect(codes(minimalPart({ requires: [{ type: 'category', category: 'outfit.top' }] }))).toEqual([]);
    expect(codes(minimalPart({ requires: [{ type: 'category', category: 'shirt' }] }))).toContain('condition');
    expect(codes(minimalPart({ conflicts: [{ type: 'state', path: 'pose.right_hand', value: 'pocket' }] }))).toContain('condition');
    expect(codes(minimalPart({ conflicts: [{ type: 'state', path: 'pose.arm.right', value: 'pocket' }] }))).toEqual([]);
    expect(codes(minimalPart({ hides: ['hair.extra'] }))).toEqual([]);
    expect(codes(minimalPart({ hides: ['hair'] }))).toContain('hides');
  });
});

describe('画像の寸法（§4.2、§4.3）', () => {
  const l = layer('a', 'outfit.top');
  l.assets[0] = {
    when: { view: 'front' },
    file: 'assets/front/a.png',
    offset: [1500, 2300],
    mask: { file: 'assets/front/a.mask.png', channels: { r: 'main' } },
  };
  const part = minimalPart({ layers: [l] });
  const canvas = { width: 1600, height: 2400 };
  const geometry = (sizes: [string, number, number][]) =>
    validateImageGeometry(part, new Map(sizes.map(([f, width, height]) => [f, { width, height }])), canvas).map((i) => i.code);

  it('Mask と Asset のサイズが一致し、キャンバスに収まれば通る', () => {
    expect(geometry([['assets/front/a.png', 100, 100], ['assets/front/a.mask.png', 100, 100]])).toEqual([]);
  });

  it('Mask のサイズが違えば拒否', () => {
    expect(geometry([['assets/front/a.png', 100, 100], ['assets/front/a.mask.png', 100, 99]])).toEqual(['mask-size']);
  });

  it('配置後にキャンバスからはみ出せば拒否', () => {
    expect(geometry([['assets/front/a.png', 101, 100], ['assets/front/a.mask.png', 101, 100]])).toEqual(['out-of-canvas']);
  });

  it('参照されたファイルがなければ拒否', () => {
    expect(geometry([['assets/front/a.png', 100, 100]])).toEqual(['file-missing']);
  });
});
