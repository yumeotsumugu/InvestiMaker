// 検証レポート用の比較画像を生成する（ブラウザ不要、同じ入力なら同じ出力）。
//
//   node tools/render-report-images.ts
//
// 出力: docs/reports/images/*.png と docs/reports/data/tint-samples.json

import { mkdirSync, writeFileSync } from 'node:fs';
import type { Bitmap, ColorMode, Expression } from '../src/core/index.ts';
import { STANDARD_EXPRESSIONS, compositeOver, createBitmap, parseHex, recolor, toHex } from '../src/core/index.ts';
import type { CharacterState, RenderOptions } from './character.ts';
import { defaultState, renderCharacter } from './character.ts';
import type { GeneratedSet } from './dev-assets.ts';
import { generateDevAssets } from './dev-assets.ts';
import { LINE_COLOR } from './paint.ts';
import { encodePng } from './png.ts';

const OUT = 'docs/reports/images';
const DATA = 'docs/reports/data';
mkdirSync(OUT, { recursive: true });
mkdirSync(DATA, { recursive: true });

/** タイルの背景。白い服も黒い服も見分けられる中間の明るさにする。 */
const BACKGROUND = [200, 205, 214] as const;
const GAP = 8;

function crop(src: Bitmap, x: number, y: number, width: number, height: number): Bitmap {
  const out = createBitmap(width, height);
  compositeOver(out, src, -x, -y);
  return out;
}

/** タイルを背景色の上に並べて 1 枚にする。 */
function sheet(tiles: Bitmap[], columns: number): Bitmap {
  const tw = tiles[0]!.width;
  const th = tiles[0]!.height;
  const rows = Math.ceil(tiles.length / columns);
  const out = createBitmap(columns * tw + (columns + 1) * GAP, rows * th + (rows + 1) * GAP);
  for (let i = 0; i < out.data.length; i += 4) out.data.set([255, 255, 255, 255], i);
  tiles.forEach((tile, i) => {
    const bg = createBitmap(tw, th);
    for (let j = 0; j < bg.data.length; j += 4) bg.data.set([...BACKGROUND, 255], j);
    compositeOver(bg, tile, 0, 0);
    compositeOver(out, bg, GAP + (i % columns) * (tw + GAP), GAP + Math.floor(i / columns) * (th + GAP));
  });
  return out;
}

function save(name: string, bitmap: Bitmap) {
  writeFileSync(`${OUT}/${name}.png`, encodePng(bitmap.width, bitmap.height, bitmap.data));
  console.log(`${OUT}/${name}.png  ${bitmap.width}×${bitmap.height}`);
}

const without = (state: CharacterState, ...ids: string[]): CharacterState => ({
  ...state,
  equipped: state.equipped.filter((id) => !ids.includes(id)),
});
const color = (c: string) => ({ color: c });
const unlinked = (c: string) => ({ linked: false, color: c });

// 全身は小さいキャンバスで、部分の拡大は基準サイズで描く。
const small = generateDevAssets(400, 600);
const full = generateDevAssets(1600, 2400);
const draw = (set: GeneratedSet, state: CharacterState, options?: RenderOptions) => renderCharacter(set, state, options).bitmap;

// ---------------------------------------------------------------- §13-2 tint の基準下地

const CLOTH_COLORS = ['#3A3F4B', '#F4F4F0', '#FFFFFF', '#101014', '#000000', '#E60033', '#FFE000', '#0050FF'];
const SKIN_COLORS = ['#FFE8D6', '#F2D3BD', '#D9A066', '#A0673C', '#5C3A21', '#2E1A0E'];
const HAIR_COLORS = ['#0A0A0A', '#5A3E2B', '#E8D080', '#F8F8F8', '#FF70A0', '#2040C0'];

function clothes(mode?: ColorMode): Bitmap {
  const base = without(defaultState(small), 'dev.glasses_01', 'dev.blush_01');
  return sheet(
    CLOTH_COLORS.map((c) =>
      draw(
        small,
        {
          ...base,
          overrides: {
            'dev.coat_01': { main: color(c), lapel: color(c) },
            'dev.pants_01': { main: color(c) },
            'dev.hat_01': { main: color(c) },
            'dev.shoes_01': { main: color(c) },
          },
        },
        { modeOverride: mode },
      ),
    ),
    4,
  );
}
save('tint_clothes', clothes());
save('tint_clothes_multiply', clothes('multiply'));

{
  const base = without(defaultState(small), 'dev.coat_01', 'dev.shirt_01', 'dev.hat_01', 'dev.glasses_01', 'dev.blush_01', 'dev.socks_01', 'dev.shoes_01');
  save('tint_skin', sheet(SKIN_COLORS.map((c) => draw(small, { ...base, shared: { 'skin.base': c } })), 6));
  save('tint_skin_multiply', sheet(SKIN_COLORS.map((c) => draw(small, { ...base, shared: { 'skin.base': c } }, { modeOverride: 'multiply' })), 6));
}
{
  const base = without(defaultState(full), 'dev.coat_01', 'dev.hat_01', 'dev.glasses_01', 'dev.blush_01');
  save('tint_hair', sheet(HAIR_COLORS.map((c) => crop(draw(full, { ...base, shared: { 'hair.base': c } }), 520, 60, 560, 760)), 6));
}

// 数値：下地の影（64）・基準（128）・ハイライト（198）に各色を指定した結果。
{
  const luminance = (rgb: readonly number[]) => (0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!) / 255;
  const lineL = luminance(LINE_COLOR);
  const sample = (hex: string, gray: number, mode: ColorMode) => {
    const out = recolor([gray, gray, gray, 255], [{ data: [255, 0, 0, 255], channels: [{ mode, color: parseHex(hex) }, null, null] }], new Uint8ClampedArray(4));
    const rgb = [out[0]!, out[1]!, out[2]!] as const;
    return { hex: toHex(rgb), contrastToLine: Number(Math.abs(luminance(rgb) - lineL).toFixed(3)) };
  };
  const rows = [...new Set([...CLOTH_COLORS, ...SKIN_COLORS, ...HAIR_COLORS])].map((hex) => ({
    color: hex,
    tint: { shadow64: sample(hex, 64, 'tint'), base128: sample(hex, 128, 'tint'), highlight198: sample(hex, 198, 'tint') },
    multiply: { shadow64: sample(hex, 64, 'multiply'), base128: sample(hex, 128, 'multiply'), highlight198: sample(hex, 198, 'multiply') },
  }));
  writeFileSync(`${DATA}/tint-samples.json`, JSON.stringify({ lineColor: toHex(LINE_COLOR), lineLuminance: Number(lineL.toFixed(3)), rows }, null, 2) + '\n');
  console.log(`${DATA}/tint-samples.json`);
}

// ---------------------------------------------------------------- §13-4 標準描画順

const FACE = [540, 100, 520, 520] as const;
const face = (b: Bitmap) => crop(b, ...FACE);

{
  // 眉は既定だと髪と同じ色で見分けにくいので、リンクを解除して黒にする。
  const base: CharacterState = {
    ...without(defaultState(full), 'dev.hat_01', 'dev.glasses_01', 'dev.blush_01'),
    overrides: { 'dev.eyebrows_01': { color: unlinked('#101014') } },
    shared: { 'hair.base': '#C08A4A' },
  };
  const over: RenderOptions = { slotOf: (_, layer) => (layer.slot === 'face.eyebrows' ? 'face.eyebrows.over' : layer.slot) };
  save('order_eyebrows', sheet([face(draw(full, base)), face(draw(full, base, over))], 2));
}
{
  const base = without(defaultState(full), 'dev.coat_01');
  const feet = (b: Bitmap) => crop(b, 540, 2040, 520, 360);
  const over: RenderOptions = { slotOf: (_, layer) => (layer.slot === 'outfit.shoes' ? 'outfit.shoes.over' : layer.slot) };
  save('order_shoes', sheet([feet(draw(full, base)), feet(draw(full, base, over))], 2));
}
{
  const base = without(defaultState(full), 'dev.glasses_01', 'dev.blush_01');
  // hides がなかった場合を見るため、帽子の hides を外した素材セットも作る。
  const noHides: GeneratedSet = {
    ...full,
    parts: full.parts.map((p) => (p.manifest.id === 'dev.hat_01' ? { ...p, manifest: { ...p.manifest, hides: [] } } : p)),
  };
  const head = (b: Bitmap) => crop(b, 500, 40, 600, 560);
  save('order_hat_hair', sheet([head(draw(full, without(base, 'dev.hat_01'))), head(draw(full, base)), head(draw(noHides, base))], 3));
}
{
  const base = { ...without(defaultState(full), 'dev.hat_01', 'dev.blush_01'), shared: { 'hair.base': '#C08A4A' } };
  save('order_glasses', sheet([face(draw(full, without(base, 'dev.glasses_01'))), face(draw(full, base))], 2));
}
{
  const base = { ...without(defaultState(full), 'dev.hat_01', 'dev.glasses_01'), overrides: { 'dev.blush_01': { color: color('#E0304A') } } };
  save('order_blush', sheet([face(draw(full, without(base, 'dev.blush_01'))), face(draw(full, base))], 2));
}

// ---------------------------------------------------------------- ポーズ・fit・表情

{
  const base = without(defaultState(small), 'dev.hat_01', 'dev.glasses_01', 'dev.blush_01');
  const pocket = { ...base, context: { ...base.context, pose: { ...base.context.pose, 'arm.right': 'pocket' } } };
  save('pose_pocket', sheet([draw(small, base), draw(small, pocket), draw(small, without(base, 'dev.coat_01')), draw(small, without(pocket, 'dev.coat_01'))], 4));
}
{
  const base = without(defaultState(full), 'dev.hat_01', 'dev.glasses_01', 'dev.blush_01');
  const large = { ...base, context: { ...base.context, fit: { chest: 'large' } } };
  const torso = (b: Bitmap) => crop(b, 480, 560, 640, 800);
  save(
    'fit_chest',
    sheet(
      [
        torso(draw(full, without(base, 'dev.coat_01', 'dev.shirt_01'))),
        torso(draw(full, without(large, 'dev.coat_01', 'dev.shirt_01'))),
        torso(draw(full, without(base, 'dev.coat_01'))),
        torso(draw(full, without(large, 'dev.coat_01'))),
        torso(draw(full, base)),
        torso(draw(full, large)),
      ],
      6,
    ),
  );
}
{
  const base = { ...without(defaultState(full), 'dev.hat_01', 'dev.glasses_01', 'dev.blush_01'), overrides: { 'dev.eyebrows_01': { color: unlinked('#101014') } } };
  const withExpression = (expression: Expression) => ({ ...base, context: { ...base.context, expression } });
  save('expressions', sheet(STANDARD_EXPRESSIONS.map((e) => crop(draw(full, withExpression(e)), 600, 280, 400, 300)), 6));
}

// 既定の全身（基準サイズ）。
save('default_1600x2400', draw(full, defaultState(full)));
