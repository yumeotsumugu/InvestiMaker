// 生成した仮素材が規格に適合し、指示書 §8 の完了条件を満たすことを確かめる。

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Bitmap, Body, PartManifest } from '../../src/core/index.ts';
import {
  STANDARD_EXPRESSIONS,
  STANDARD_STATES,
  masksOf,
  recolor,
  validateFitAgainstBodies,
  validateImageGeometry,
  validateManifest,
} from '../../src/core/index.ts';
import type { CharacterState } from '../../tools/character.ts';
import { defaultState, renderCharacter } from '../../tools/character.ts';
import type { GeneratedSet } from '../../tools/dev-assets.ts';
import { PREVIEW_SIZE, generateDevAssets, serializeSet } from '../../tools/dev-assets.ts';
import { decodePng } from '../../tools/png.ts';

const ASSET_DIR = new URL('../../assets/development/', import.meta.url);

let set: GeneratedSet;
let state: CharacterState;
beforeAll(() => {
  set = generateDevAssets();
  state = defaultState(set);
}, 120_000);

const part = (id: string) => set.parts.find((p) => p.manifest.id === id)!;
const withContext = (patch: Partial<CharacterState['context']>): CharacterState => ({
  ...state,
  context: { ...state.context, ...patch },
});
const pocket = () => withContext({ pose: { torso: 'stand', 'arm.left': 'down', 'arm.right': 'pocket' } });
const files = (plan: ReturnType<typeof renderCharacter>['plan'], partId: string) =>
  plan.entries.filter((e) => e.partId === partId && e.status === 'draw').map((e) => e.asset!.file);

describe('再生成', () => {
  it('assets/development はスクリプトの出力と 1 バイトも違わない', () => {
    const expected = serializeSet(set);
    for (const [path, data] of expected) {
      const url = new URL(path, ASSET_DIR);
      expect(existsSync(url), `${path} がない（npm run gen:assets を実行）`).toBe(true);
      expect(readFileSync(url).equals(data), `${path} が生成結果と違う（npm run gen:assets を実行）`).toBe(true);
    }
    const onDisk = readdirSync(ASSET_DIR, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).length;
    expect(onDisk).toBe(expected.size);
  });

  it('同じ入力なら同じ出力', () => {
    const a = serializeSet(generateDevAssets(300, 450));
    const b = serializeSet(generateDevAssets(300, 450));
    expect([...a.keys()]).toEqual([...b.keys()]);
    for (const [path, data] of a) expect(b.get(path)!.equals(data), path).toBe(true);
  });

  it('書き出した PNG は読み戻すと元の画素に戻る', () => {
    const { images } = part('dev.coat_01');
    const file = 'dev.coat_01/assets/front/body.mask.png';
    const decoded = decodePng(serializeSet(set).get(file)!);
    expect(decoded.data).toEqual(images.get('assets/front/body.mask.png')!.data);
  });
});

describe('規格への適合', () => {
  it('すべての manifest が検証を通り、警告もない', () => {
    for (const { manifest } of set.parts) {
      expect(validateManifest(manifest), manifest.id).toEqual({ ok: true, errors: [], warnings: [] });
    }
  });

  it('when.fit は素体の fitDimensions にある次元と値だけを使う', () => {
    const bodies = new Map(set.parts.flatMap((p) => (p.manifest.kind === 'body' ? [[p.manifest.id, p.manifest as Body] as const] : [])));
    for (const { manifest } of set.parts) {
      expect(validateFitAgainstBodies(manifest, bodies), manifest.id).toEqual([]);
    }
  });

  it('namespace は dev', () => {
    expect(set.parts.every((p) => p.manifest.id.startsWith('dev.'))).toBe(true);
  });

  it('Mask と Asset のサイズが一致し、キャンバスに収まる', () => {
    for (const { manifest, images } of set.parts) {
      expect(validateImageGeometry(manifest, images, set), manifest.id).toEqual([]);
    }
  });

  it('プレビューは 256×256', () => {
    for (const p of set.parts) {
      expect([p.preview.width, p.preview.height]).toEqual([PREVIEW_SIZE, PREVIEW_SIZE]);
      expect(p.preview.data.some((v) => v !== 0), p.manifest.id).toBe(true);
    }
  });

  it('余白がトリミングされ、offset が付いている', () => {
    const hasOpaque = (img: Bitmap, pick: (x: number, y: number) => boolean) => {
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          if (pick(x, y) && img.data[(y * img.width + x) * 4 + 3]! > 0) return true;
        }
      }
      return false;
    };
    for (const { manifest, images } of set.parts) {
      for (const asset of manifest.layers.flatMap((l) => l.assets)) {
        const img = images.get(asset.file)!;
        expect(asset.offset, asset.file).toBeDefined();
        expect(img.width * img.height).toBeLessThan(set.width * set.height / 2);
        expect(hasOpaque(img, (x) => x === 0) && hasOpaque(img, (x) => x === img.width - 1), asset.file).toBe(true);
        expect(hasOpaque(img, (_, y) => y === 0) && hasOpaque(img, (_, y) => y === img.height - 1), asset.file).toBe(true);
      }
    }
  });

  it('目・眉・口は標準状態をすべて持つ（§6.3）', () => {
    const states = (id: string) => part(id).manifest.layers[0]!.assets.map((a) => a.when.state);
    expect(states('dev.eyes_01')).toEqual([...STANDARD_STATES.eyes]);
    expect(states('dev.eyebrows_01')).toEqual([...STANDARD_STATES.eyebrows]);
    expect(states('dev.mouth_01')).toEqual([...STANDARD_STATES.mouth]);
  });
});

describe('検証に必要な絵の性質', () => {
  const shirt = () => {
    const { images } = part('dev.shirt_01');
    return { image: images.get('assets/front/body.png')!, mask: images.get('assets/front/body.mask.png')! };
  };

  it('色変更領域は 50% グレー基準の無彩色で、影とハイライトを含む', () => {
    const { image, mask } = shirt();
    const grays = new Set<number>();
    for (let i = 0; i < image.data.length; i += 4) {
      if (mask.data[i] !== 255) continue;
      expect(image.data[i]).toBe(image.data[i + 1]);
      expect(image.data[i]).toBe(image.data[i + 2]);
      grays.add(image.data[i]!);
    }
    expect(grays.has(128)).toBe(true);
    expect(Math.min(...grays)).toBeLessThan(80);
    expect(Math.max(...grays)).toBeGreaterThan(180);
  });

  it('暗色の輪郭線があり、線の上の Mask 値は 0', () => {
    const { image, mask } = shirt();
    let line = 0;
    for (let i = 0; i < image.data.length; i += 4) {
      const opaque = image.data[i + 3] === 255;
      const unmasked = mask.data[i] === 0 && mask.data[i + 1] === 0 && mask.data[i + 2] === 0;
      if (opaque && unmasked) {
        line++;
        expect(image.data[i]).toBeLessThan(60);
      }
    }
    expect(line).toBeGreaterThan(1000);
  });

  it('Mask の境界はアンチエイリアスされている（適用率が中間値の画素がある）', () => {
    const { mask } = shirt();
    let partial = 0;
    for (let i = 0; i < mask.data.length; i += 4) {
      if (mask.data[i]! > 0 && mask.data[i]! < 255) partial++;
      expect(mask.data[i]! + mask.data[i + 1]! + mask.data[i + 2]!).toBeLessThanOrEqual(255);
      expect(mask.data[i + 3]).toBe(255);
    }
    expect(partial).toBeGreaterThan(1000);
  });
});

describe('完了条件（指示書 §8）', () => {
  it('既定の状態では全 Part が対応し、キャラクターが合成される', () => {
    const { bitmap, plan } = renderCharacter(set, state);
    expect(plan.parts.every((p) => p.status === 'ok')).toBe(true);
    let opaque = 0;
    for (let i = 3; i < bitmap.data.length; i += 4) if (bitmap.data[i] === 255) opaque++;
    expect(opaque).toBeGreaterThan(500_000);
  });

  it('右腕を pocket にするとコートが非対応になり、コートの Layer は 1 枚も描画されない', () => {
    const { plan } = renderCharacter(set, pocket());
    const coat = plan.parts.find((p) => p.partId === 'dev.coat_01')!;
    expect(coat).toMatchObject({ status: 'unsupported', drawn: false, reasons: ['Layer が未解決: sleeve_r'] });
    expect(files(plan, 'dev.coat_01')).toEqual([]);
    expect(plan.parts.filter((p) => p.status !== 'ok').map((p) => p.partId)).toEqual(['dev.coat_01']);
  });

  it('シャツは pocket 用の袖で描画される', () => {
    const { plan } = renderCharacter(set, pocket());
    expect(files(plan, 'dev.shirt_01').sort()).toEqual([
      'assets/front/body.png',
      'assets/front/sleeve_l_down.png',
      'assets/front/sleeve_r_pocket.png',
    ]);
  });

  it('pocket では右腕の腕グループが胴体の前に出て、右手（optional）は省かれる', () => {
    const { plan } = renderCharacter(set, pocket());
    const slots = plan.entries.map((e) => e.slot);
    expect(slots.indexOf('arm.left.skin')).toBeLessThan(slots.indexOf('body.base'));
    expect(slots.indexOf('arm.right.skin')).toBeGreaterThan(slots.indexOf('outfit.head'));
    expect(plan.entries.find((e) => e.slot === 'arm.right.hand')?.status).toBe('omitted');
  });

  it('色を変えても線画の色は変わらない', () => {
    const colors = ['#FF0040', '#101014', '#F4F4F0'];
    for (const { manifest, images } of set.parts) {
      for (const asset of manifest.layers.flatMap((l) => l.assets)) {
        const masks = masksOf(asset);
        if (masks.length === 0) continue;
        const base = images.get(asset.file)!.data;
        const maskData = masks.map((m) => images.get(m.file)!.data);
        for (const color of colors) {
          const tint = { mode: 'tint' as const, color: [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)] as const };
          const out = recolor(base, maskData.map((data) => ({ data, channels: [tint, tint, tint] as const })), new Uint8ClampedArray(base.length));
          for (let i = 0; i < base.length; i += 4) {
            const unmasked = maskData.every((d) => d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 0);
            if (unmasked && (out[i] !== base[i] || out[i + 1] !== base[i + 1] || out[i + 2] !== base[i + 2])) {
              throw new Error(`${manifest.id} ${asset.file}: Mask 0 の画素の色が変わった`);
            }
            if (out[i + 3] !== base[i + 3]) throw new Error(`${manifest.id} ${asset.file}: アルファが変わった`);
          }
        }
      }
    }
  });

  it('合成結果でも、線画の画素は色を変える前後で同じ', () => {
    // 全スロットを明色にして比べる。暗色だと、線の縁の半透明画素が下の塗りと混ざって
    // 偶然線画色になり、線画そのものと区別できないため。
    const paintAll = (color: string): CharacterState => ({
      ...state,
      overrides: Object.fromEntries(
        set.parts.map((p) => [
          p.manifest.id,
          Object.fromEntries((p.manifest.colorSlots ?? []).map((s) => [s.id, { linked: false, color }])),
        ]),
      ),
    });
    const before = renderCharacter(set, paintAll('#FFD0E0')).bitmap;
    const after = renderCharacter(set, paintAll('#B0E8FF')).bitmap;
    let line = 0;
    let changed = 0;
    for (let i = 0; i < before.data.length; i += 4) {
      const isLine = before.data[i] === 42 && before.data[i + 1] === 38 && before.data[i + 2] === 48 && before.data[i + 3] === 255;
      if (isLine) {
        line++;
        if (after.data[i] !== 42 || after.data[i + 1] !== 38 || after.data[i + 2] !== 48) {
          throw new Error(`線画の画素の色が変わった（画素 ${i / 4}）`);
        }
      } else if (before.data[i] !== after.data[i]) changed++;
    }
    expect(line).toBeGreaterThan(10_000);
    expect(changed).toBeGreaterThan(100_000);
  });
});

describe('Asset 解決の確認', () => {
  it('表情を変えると目・眉・口の Asset が state で切り替わる', () => {
    for (const expression of STANDARD_EXPRESSIONS) {
      const { plan } = renderCharacter(set, withContext({ expression }));
      expect(plan.parts.every((p) => p.status === 'ok'), expression.id).toBe(true);
      expect(files(plan, 'dev.eyes_01')).toEqual([`assets/front/eyes_${expression.eyes}.png`]);
      expect(files(plan, 'dev.eyebrows_01')).toEqual([`assets/front/eyebrows_${expression.eyebrows}.png`]);
      expect(files(plan, 'dev.mouth_01')).toEqual([`assets/front/mouth_${expression.mouth}.png`]);
    }
  });

  it('胸部 large では専用画像を持つ Layer だけが切り替わり、他は fit 非依存の画像に落ちる', () => {
    const { plan } = renderCharacter(set, withContext({ fit: { chest: 'large' } }));
    expect(plan.parts.every((p) => p.status === 'ok')).toBe(true);
    expect(files(plan, 'dev.shirt_01')).toContain('assets/front/body_chest_l.png');
    expect(files(plan, 'dev.body_adult_standard')).toContain('assets/front/base_chest_l.png');
    expect(files(plan, 'dev.coat_01')).toContain('assets/front/body.png');
  });

  it('帽子の hides で追加髪が非表示になり、帽子を外すと戻る', () => {
    const on = renderCharacter(set, state).plan;
    expect(on.entries.find((e) => e.partId === 'dev.hair_extra_01')?.status).toBe('hidden');
    const off = renderCharacter(set, { ...state, equipped: state.equipped.filter((id) => id !== 'dev.hat_01') }).plan;
    expect(off.entries.find((e) => e.partId === 'dev.hair_extra_01')?.status).toBe('draw');
  });

  it('シャツを外すとコートは競合（requires を満たさない）', () => {
    const { plan } = renderCharacter(set, { ...state, equipped: state.equipped.filter((id) => id !== 'dev.shirt_01') });
    expect(plan.parts.find((p) => p.partId === 'dev.coat_01')?.status).toBe('conflict');
  });

  it('共有カラーは link を持つスロットすべてに及ぶ', () => {
    const linked = (key: string) =>
      set.parts.filter((p) => p.manifest.colorSlots?.some((s) => s.link === key)).map((p: { manifest: PartManifest }) => p.manifest.id);
    expect(linked('skin.base')).toEqual(['dev.body_adult_standard', 'dev.face_head_01', 'dev.face_ears_01']);
    expect(linked('hair.base')).toEqual(['dev.eyebrows_01', 'dev.hair_back_01', 'dev.hair_front_01', 'dev.hair_front_02', 'dev.hair_extra_01']);
  });
});
