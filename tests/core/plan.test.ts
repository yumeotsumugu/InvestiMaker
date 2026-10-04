import { describe, expect, it } from 'vitest';
import type { PartManifest } from '../../src/core/index.ts';
import {
  LAYER_SLOTS,
  armGroupSlots,
  compositeOver,
  createBitmap,
  layerContext,
  planRender,
  regionOfSlot,
  standardSlotOrder,
} from '../../src/core/index.ts';
import { context, layer, minimalPart } from '../helpers.ts';

const library = (...parts: PartManifest[]) => new Map(parts.map((p) => [p.id, p]));
const drawn = (plan: ReturnType<typeof planRender>) =>
  plan.entries.filter((e) => e.status === 'draw').map((e) => `${e.partId}/${e.layer.id}`);

describe('標準描画順（§6.1）', () => {
  it('すべての Slot を 1 回ずつ含む', () => {
    for (const placement of [
      { left: 'back', right: 'back' },
      { left: 'back', right: 'front' },
      { left: 'front', right: 'front' },
    ] as const) {
      const order = standardSlotOrder(placement);
      expect(new Set(order).size).toBe(order.length);
      expect(new Set(order)).toEqual(LAYER_SLOTS);
    }
  });

  it('背面の腕グループは G1 と G3 の間、前面の腕グループは G5 と G7 の間に入る', () => {
    const order = standardSlotOrder({ left: 'back', right: 'front' });
    const at = (slot: string) => order.indexOf(slot);
    expect(at('outfit.outer.back')).toBeLessThan(at('arm.left.skin'));
    expect(at('arm.left.hand.front')).toBeLessThan(at('body.base'));
    expect(at('outfit.head')).toBeLessThan(at('arm.right.skin'));
    expect(at('arm.right.hand.front')).toBeLessThan(at('item.front'));
  });

  it('腕グループ内は skin → 袖（inner → top → outer）→ hand → glove の順', () => {
    expect(armGroupSlots('right')).toEqual([
      'arm.right.skin',
      'overlay.arm.right',
      'arm.right.sleeve.inner',
      'arm.right.sleeve.top',
      'arm.right.sleeve.outer',
      'arm.right.hand',
      'arm.right.glove',
      'item.hand.right',
      'arm.right.hand.front',
    ]);
  });

  it('仕様書が名指しする前後関係', () => {
    const order = standardSlotOrder({ left: 'back', right: 'back' });
    const before = (a: string, b: string) => expect(order.indexOf(a)).toBeLessThan(order.indexOf(b));
    before('outfit.shoes', 'outfit.bottom');
    before('outfit.bottom', 'outfit.shoes.over');
    before('hair.front', 'face.eyebrows');
    before('face.eyebrows', 'outfit.eyewear');
    before('outfit.head.back', 'hair.back');
    before('hair.extra', 'outfit.head');
  });
});

describe('ポーズ領域（§6.2）', () => {
  it('Slot から領域を決める', () => {
    expect(regionOfSlot('arm.left.sleeve.top')).toBe('arm.left');
    expect(regionOfSlot('overlay.arm.left')).toBe('arm.left');
    expect(regionOfSlot('item.hand.right')).toBe('arm.right');
    expect(regionOfSlot('outfit.top')).toBe('torso');
    expect(regionOfSlot('item.waist')).toBe('torso');
  });

  it('when.pose はその Layer の領域の状態と照合する', () => {
    const ctx = context({ pose: { torso: 'stand', 'arm.left': 'down', 'arm.right': 'pocket' } });
    expect(layerContext(ctx, 'outfit.top', 'arm.right.sleeve.top').pose).toBe('pocket');
    expect(layerContext(ctx, 'outfit.top', 'arm.left.sleeve.top').pose).toBe('down');
    expect(layerContext(ctx, 'outfit.top', 'outfit.top').pose).toBe('stand');
  });

  it('when.state は目・眉・口の Part だけが持つ', () => {
    const ctx = context({ expression: { eyes: 'wide', eyebrows: 'raised', mouth: 'open' } });
    expect(layerContext(ctx, 'face.eyes', 'face.eyes').state).toBe('wide');
    expect(layerContext(ctx, 'face.eyebrows', 'face.eyebrows').state).toBe('raised');
    expect(layerContext(ctx, 'face.mouth', 'face.mouth').state).toBe('open');
    expect(layerContext(ctx, 'outfit.top', 'outfit.top').state).toBeUndefined();
  });
});

describe('描画計画', () => {
  const sleeve = (id: string, slot: string, pose: string[]) =>
    layer(id, slot, { assets: pose.map((p) => ({ when: { view: 'front', pose: p }, file: `assets/front/${id}_${p}.png` })) });

  const shirt = minimalPart({
    id: 'dev.shirt',
    category: 'outfit.top',
    layers: [layer('body', 'outfit.top'), sleeve('sleeve_r', 'arm.right.sleeve.top', ['down', 'pocket'])],
  });
  const coat = minimalPart({
    id: 'dev.coat',
    category: 'outfit.outer',
    requires: [{ type: 'category', category: 'outfit.top' }],
    layers: [
      layer('back', 'outfit.outer.back'),
      layer('body', 'outfit.outer'),
      sleeve('sleeve_r', 'arm.right.sleeve.outer', ['down']),
    ],
  });

  it('Slot 順に並ぶ（装備順には依存しない）', () => {
    const plan = planRender(library(shirt, coat), ['dev.coat', 'dev.shirt'], context());
    expect(drawn(plan)).toEqual([
      'dev.coat/back',
      'dev.shirt/sleeve_r',
      'dev.coat/sleeve_r',
      'dev.shirt/body',
      'dev.coat/body',
    ]);
  });

  it('未解決の Layer があれば Part 全体が非対応で、1 枚も描画しない', () => {
    const ctx = context({ pose: { torso: 'stand', 'arm.left': 'down', 'arm.right': 'pocket' } });
    const plan = planRender(library(shirt, coat), ['dev.shirt', 'dev.coat'], ctx);
    expect(plan.parts.find((p) => p.partId === 'dev.coat')).toMatchObject({ status: 'unsupported', drawn: false });
    expect(drawn(plan)).toEqual(['dev.shirt/body', 'dev.shirt/sleeve_r']);
    expect(plan.entries.filter((e) => e.partId === 'dev.coat').map((e) => e.status)).toEqual(['skipped', 'skipped', 'unresolved']);
    expect(plan.entries.find((e) => e.partId === 'dev.shirt' && e.layer.id === 'sleeve_r')?.asset?.file).toBe('assets/front/sleeve_r_pocket.png');
  });

  it('見つからない Part は不足', () => {
    const plan = planRender(library(shirt), ['dev.shirt', 'dev.nothing'], context());
    expect(plan.parts.find((p) => p.partId === 'dev.nothing')).toMatchObject({ status: 'missing', drawn: false });
    expect(drawn(plan)).toHaveLength(2);
  });

  it('対応していない素体では非対応', () => {
    const plan = planRender(library(shirt), ['dev.shirt'], context({ body: 'dev.body_other' }));
    expect(plan.parts[0]).toMatchObject({ status: 'unsupported', drawn: false });
  });

  it('requires を満たさなければ競合。描画するかどうかは選べる', () => {
    const plan = planRender(library(coat), ['dev.coat'], context());
    expect(plan.parts[0]).toMatchObject({ status: 'conflict', drawn: true });
    expect(plan.parts[0]!.reasons[0]).toContain('outfit.top');
    const strict = planRender(library(coat), ['dev.coat'], context(), { drawConflicted: false });
    expect(strict.parts[0]).toMatchObject({ status: 'conflict', drawn: false });
    expect(drawn(strict)).toEqual([]);
  });

  it('conflicts の part / state 条件', () => {
    const bag = minimalPart({ id: 'dev.bag', category: 'item', layers: [layer('main', 'item.waist')] });
    const cape = minimalPart({
      id: 'dev.cape',
      category: 'outfit.outer',
      conflicts: [
        { type: 'part', id: 'dev.bag' },
        { type: 'state', path: 'pose.arm.right', value: 'pocket' },
        { type: 'state', path: 'expression', value: 'smile' },
      ],
    });
    const lib = library(bag, cape);
    expect(planRender(lib, ['dev.cape'], context()).parts[0]!.status).toBe('ok');
    expect(planRender(lib, ['dev.cape', 'dev.bag'], context()).parts[0]!.status).toBe('conflict');
    const pocket = context({ pose: { torso: 'stand', 'arm.left': 'down', 'arm.right': 'pocket' } });
    expect(planRender(lib, ['dev.cape'], pocket).parts[0]!.reasons).toEqual(['conflicts に該当: pose.arm.right = pocket']);
    const smile = context({ expression: { id: 'smile', eyes: 'smile', eyebrows: 'relaxed', mouth: 'smile_open' } });
    expect(planRender(lib, ['dev.cape'], smile).parts[0]!.status).toBe('conflict');
  });

  it('同一 Slot 内は zBias の昇順、同値なら装備順', () => {
    const acc = (id: string, zBias?: number) =>
      minimalPart({ id, category: 'outfit.accessory', layers: [layer('main', 'outfit.neck', { zBias })] });
    const lib = library(acc('dev.a', 2), acc('dev.b'), acc('dev.c', -1), acc('dev.d'));
    expect(drawn(planRender(lib, ['dev.a', 'dev.b', 'dev.c', 'dev.d'], context()))).toEqual([
      'dev.c/main',
      'dev.b/main',
      'dev.d/main',
      'dev.a/main',
    ]);
    expect(drawn(planRender(lib, ['dev.d', 'dev.b', 'dev.a', 'dev.c'], context())).slice(1, 3)).toEqual(['dev.d/main', 'dev.b/main']);
  });

  it('hides は指定した Slot を非表示にする。描画されない Part の hides は効かない', () => {
    const ahoge = minimalPart({ id: 'dev.ahoge', category: 'hair.extra', layers: [layer('main', 'hair.extra')] });
    const hat = minimalPart({
      id: 'dev.hat',
      category: 'outfit.head',
      hides: ['hair.extra'],
      layers: [layer('back', 'outfit.head.back'), sleeve('never', 'outfit.head', ['stand'])],
    });
    const lib = library(ahoge, hat);
    const plan = planRender(lib, ['dev.ahoge', 'dev.hat'], context());
    expect(plan.entries.find((e) => e.partId === 'dev.ahoge')?.status).toBe('hidden');

    const sitting = context({ pose: { torso: 'sit', 'arm.left': 'down', 'arm.right': 'down' } });
    const unsupported = planRender(lib, ['dev.ahoge', 'dev.hat'], sitting);
    expect(unsupported.parts.find((p) => p.partId === 'dev.hat')?.status).toBe('unsupported');
    expect(unsupported.entries.find((e) => e.partId === 'dev.ahoge')?.status).toBe('draw');
  });

  it('optional な Layer が未解決なら省くだけで、Part は対応のまま', () => {
    const body = minimalPart({
      id: 'dev.arms',
      layers: [layer('skin', 'arm.right.skin'), { ...sleeve('hand', 'arm.right.hand', ['down']), optional: true }],
    });
    const ctx = context({ pose: { torso: 'stand', 'arm.left': 'down', 'arm.right': 'pocket' } });
    const plan = planRender(library(body), ['dev.arms'], ctx);
    expect(plan.parts[0]!.status).toBe('ok');
    expect(plan.entries.map((e) => e.status)).toEqual(['draw', 'omitted']);
  });

  it('比較用に Slot 順と Layer の Slot を差し替えられる', () => {
    const brow = minimalPart({ id: 'dev.brow', category: 'face.eyebrows', layers: [layer('main', 'face.eyebrows')] });
    const bangs = minimalPart({ id: 'dev.bangs', category: 'hair.front', layers: [layer('main', 'hair.front')] });
    const lib = library(brow, bangs);
    expect(drawn(planRender(lib, ['dev.brow', 'dev.bangs'], context()))).toEqual(['dev.bangs/main', 'dev.brow/main']);

    const order = standardSlotOrder({ left: 'back', right: 'back' }).filter((s) => s !== 'face.eyebrows');
    order.splice(order.indexOf('hair.front'), 0, 'face.eyebrows');
    expect(drawn(planRender(lib, ['dev.brow', 'dev.bangs'], context(), { slotOrder: order }))).toEqual(['dev.brow/main', 'dev.bangs/main']);

    const shoes = minimalPart({ id: 'dev.shoes', category: 'outfit.shoes', layers: [layer('main', 'outfit.shoes')] });
    const pants = minimalPart({ id: 'dev.pants', category: 'outfit.bottom', layers: [layer('main', 'outfit.bottom')] });
    const lib2 = library(shoes, pants);
    expect(drawn(planRender(lib2, ['dev.shoes', 'dev.pants'], context()))).toEqual(['dev.shoes/main', 'dev.pants/main']);
    const over = planRender(lib2, ['dev.shoes', 'dev.pants'], context(), {
      slotOf: (_, l) => (l.slot === 'outfit.shoes' ? 'outfit.shoes.over' : l.slot),
    });
    expect(drawn(over)).toEqual(['dev.pants/main', 'dev.shoes/main']);
  });
});

describe('ソフトウェア合成', () => {
  it('不透明な画素は上書き、半透明は通常合成', () => {
    const dst = createBitmap(2, 1);
    dst.data.set([200, 0, 0, 255, 0, 0, 0, 0]);
    const src = createBitmap(2, 1);
    src.data.set([0, 0, 100, 128, 10, 20, 30, 64]);
    compositeOver(dst, src, 0, 0);
    // 左：赤の上に 128/255 の青。右：透明の上なのでそのまま。
    expect([...dst.data]).toEqual([100, 0, 50, 255, 10, 20, 30, 64]);
  });

  it('オフセット付きで置き、はみ出した部分は切り捨てる', () => {
    const dst = createBitmap(2, 2);
    const src = createBitmap(2, 2);
    src.data.fill(255);
    compositeOver(dst, src, 1, 1);
    expect([...dst.data.subarray(0, 12)]).toEqual(new Array(12).fill(0));
    expect([...dst.data.subarray(12)]).toEqual([255, 255, 255, 255]);
  });
});
