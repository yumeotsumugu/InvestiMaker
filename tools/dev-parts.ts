// 仮素材の定義。絵としての品質は求めず、仕様書 §13 の検証に必要な性質だけを持たせる。
// 座標は設計座標（1600×2400 基準）。左右はキャラクター自身から見た向き（§3.1）なので、
// 正面では「左腕」が画面の右側（x > 800）に来る。

import type { ColorSlot, Condition, Mask, Point, When } from '../src/core/index.ts';
import type { Art, RGB, Region } from './paint.ts';
import type { Pt, Shape } from './sdf.ts';
import {
  above,
  below,
  capsule,
  ellipse,
  halfPlane,
  intersect,
  mirrorPts,
  mirrorX,
  polygon,
  polyline,
  ring,
  roundRect,
  subtract,
  union,
} from './sdf.ts';

export interface AssetDef {
  /** ファイル名（拡張子なし）。`assets/front/<name>.png` になる。 */
  name: string;
  when?: Omit<When, 'view'>;
  art: Art;
  channels?: Mask['channels'];
}

export interface LayerDef {
  id: string;
  slot: string;
  optional?: boolean;
  zBias?: number;
  assets: AssetDef[];
}

export interface PartDef {
  id: string;
  name: string;
  category: string;
  tags?: string[];
  colorSlots?: ColorSlot[];
  requires?: Condition[];
  conflicts?: Condition[];
  hides?: string[];
  layers: LayerDef[];
  /** 素体だけが持つ。anchors は設計座標。 */
  body?: { views: string[]; fitDimensions: Record<string, string[]>; anchors: Record<string, Record<string, Point>> };
}

export const BODY_ID = 'dev.body_adult_standard';

const paint = (shape: Shape, channel: 0 | 1 | 2, extra: Partial<Region> = {}): Region => ({ shape, channel, ...extra });
const solid = (shape: Shape, color: RGB, extra: Partial<Region> = {}): Region => ({ shape, color, ...extra });
/** 線だけの図形（線画の色で塗る）。 */
const stroke = (shape: Shape): Region => ({ shape, outline: false });
/** 左右対称に 2 つ並べる。 */
const both = (s: Shape): Shape[] => [s, mirrorX(s)];

const SKIN: ColorSlot = { id: 'skin', name: '肌', mode: 'tint', default: '#F2D3BD', link: 'skin.base' };
const HAIR: ColorSlot = { id: 'base', name: '髪', mode: 'tint', default: '#5A3E2B', link: 'hair.base' };

// ---------------------------------------------------------------- 素体

const torsoPts: Pt[] = [[666, 664], [934, 664], [950, 724], [916, 1180], [938, 1320], [662, 1320], [684, 1180], [650, 724]];
const leg = capsule(728, 1320, 735, 2290, 62);
const foot = ellipse(725, 2330, 70, 36);
const bodyBase = union(roundRect(762, 530, 838, 700, 10), polygon(torsoPts, 16), ...both(leg), ...both(foot));
const bodyBaseChestL = union(bodyBase, ...both(ellipse(732, 895, 104, 84)));

// 左腕（画面右）。右腕は反転して作る。
const armDown = capsule(968, 700, 1012, 1240, 46);
const handDown = ellipse(1016, 1300, 44, 58);
// 右腕をポケットに入れた形（画面左）。肘を外に張り、前腕が腰へ戻る。
const armPocketPts: Pt[] = [[632, 700], [560, 990], [668, 1235]];

const body: PartDef = {
  id: BODY_ID,
  name: '仮素体（成人・標準）',
  category: 'body',
  colorSlots: [SKIN],
  body: {
    views: ['front'],
    fitDimensions: { chest: ['small', 'medium', 'large'] },
    anchors: {
      front: {
        head_top: [800, 188],
        eye_line: [800, 405],
        chin: [800, 572],
        bust: [800, 895],
        waist: [800, 1180],
        knee: [800, 1800],
        foot: [800, 2340],
      },
    },
  },
  layers: [
    {
      id: 'base',
      slot: 'body.base',
      assets: [
        { name: 'base', art: { regions: [paint(bodyBase, 0)] }, channels: { r: 'skin' } },
        { name: 'base_chest_l', when: { fit: { chest: 'large' } }, art: { regions: [paint(bodyBaseChestL, 0)] }, channels: { r: 'skin' } },
      ],
    },
    {
      id: 'arm_l',
      slot: 'arm.left.skin',
      assets: [{ name: 'arm_l_down', when: { pose: 'down' }, art: { regions: [paint(armDown, 0)] }, channels: { r: 'skin' } }],
    },
    {
      id: 'hand_l',
      slot: 'arm.left.hand',
      assets: [{ name: 'hand_l_down', when: { pose: 'down' }, art: { regions: [paint(handDown, 0)] }, channels: { r: 'skin' } }],
    },
    {
      id: 'arm_r',
      slot: 'arm.right.skin',
      assets: [
        { name: 'arm_r_down', when: { pose: 'down' }, art: { regions: [paint(mirrorX(armDown), 0)] }, channels: { r: 'skin' } },
        { name: 'arm_r_pocket', when: { pose: 'pocket' }, art: { regions: [paint(polyline(armPocketPts, 46), 0)] }, channels: { r: 'skin' } },
      ],
    },
    {
      // ポケットの中の手は見えないので画像を持たない。optional の確認用。
      id: 'hand_r',
      slot: 'arm.right.hand',
      optional: true,
      assets: [{ name: 'hand_r_down', when: { pose: 'down' }, art: { regions: [paint(mirrorX(handDown), 0)] }, channels: { r: 'skin' } }],
    },
  ],
};

// ---------------------------------------------------------------- 顔

const headShape = ellipse(800, 380, 150, 192);

const faceHead: PartDef = {
  id: 'dev.face_head_01',
  name: '仮・輪郭',
  category: 'face.head',
  colorSlots: [SKIN],
  layers: [{ id: 'head', slot: 'face.head', assets: [{ name: 'head', art: { regions: [paint(headShape, 0)] }, channels: { r: 'skin' } }] }],
};

const faceEars: PartDef = {
  id: 'dev.face_ears_01',
  name: '仮・耳',
  category: 'face.ears',
  colorSlots: [SKIN],
  layers: [
    {
      id: 'ears',
      slot: 'face.ears',
      assets: [{ name: 'ears', art: { regions: both(ellipse(948, 410, 24, 42)).map((s) => paint(s, 0)) }, channels: { r: 'skin' } }],
    },
  ],
};

const faceNose: PartDef = {
  id: 'dev.face_nose_01',
  name: '仮・鼻',
  category: 'face.nose',
  layers: [{ id: 'nose', slot: 'face.nose', assets: [{ name: 'nose', art: { regions: [stroke(polyline([[802, 430], [792, 466], [806, 470]], 3))] } }] }],
};

// 目。左目（画面右、x = 865）を作り、右目は反転する。Mask は R = 左の瞳、G = 右の瞳。
const EYE_X = 865;
const EYE_Y = 405;
const WHITE: RGB = [250, 250, 250];
const PUPIL: RGB = [30, 26, 36];

function eyePair(white: Shape, irisR: number, pupilR: number): Region[] {
  const iris = intersect(ellipse(EYE_X, EYE_Y, irisR, irisR + 2), white);
  const pupil = intersect(ellipse(EYE_X, EYE_Y, pupilR, pupilR), white);
  return [
    solid(white, WHITE),
    paint(iris, 0, { outline: false }),
    solid(pupil, PUPIL, { outline: false }),
    solid(mirrorX(white), WHITE),
    paint(mirrorX(iris), 1, { outline: false }),
    solid(mirrorX(pupil), PUPIL, { outline: false }),
  ];
}

const eyeOpen = ellipse(EYE_X, EYE_Y, 36, 24);
const eyeArc = (dy: readonly number[]): Region[] => {
  const pts: Pt[] = [-34, -17, 0, 17, 34].map((dx, i) => [EYE_X + dx, EYE_Y + dy[i]!]);
  return [stroke(polyline(pts, 3.5)), stroke(polyline(mirrorPts(pts), 3.5))];
};

const eyeStates: Record<string, Region[]> = {
  open: eyePair(eyeOpen, 17, 8),
  half: eyePair(intersect(eyeOpen, below(EYE_Y - 4)), 17, 8),
  closed: eyeArc([0, 8, 10, 8, 0]),
  smile: eyeArc([6, -6, -10, -6, 6]),
  wide: eyePair(ellipse(EYE_X, EYE_Y, 40, 32), 14, 6),
  // 上まぶたが内側（顔の中心側）へ下がる。
  glare: eyePair(intersect(eyeOpen, halfPlane(EYE_X, EYE_Y - 6, -20, -70)), 17, 8),
};

const eyes: PartDef = {
  id: 'dev.eyes_01',
  name: '仮・目',
  category: 'face.eyes',
  colorSlots: [
    { id: 'iris_l', name: '左の瞳', mode: 'tint', default: '#4A6FA5', link: 'eyes.left' },
    { id: 'iris_r', name: '右の瞳', mode: 'tint', default: '#4A6FA5', link: 'eyes.right' },
  ],
  layers: [
    {
      id: 'eyes',
      slot: 'face.eyes',
      assets: Object.entries(eyeStates).map(([state, regions]) => {
        const colored = regions.some((r) => r.channel !== undefined);
        return {
          name: `eyes_${state}`,
          when: { state },
          art: { regions },
          ...(colored ? { channels: { r: 'iris_l', g: 'iris_r' } } : {}),
        };
      }),
    },
  ],
};

// 眉。内側の端が x = 835、外側の端が x = 900。前髪の房と重なる位置に置く。
const browStates: Record<string, Pt[]> = {
  neutral: [[835, 352], [900, 348]],
  relaxed: [[835, 350], [868, 342], [900, 348]],
  angry: [[835, 362], [900, 340]],
  sad: [[835, 340], [900, 356]],
  raised: [[835, 338], [868, 326], [900, 334]],
};

const eyebrows: PartDef = {
  id: 'dev.eyebrows_01',
  name: '仮・眉',
  category: 'face.eyebrows',
  colorSlots: [{ id: 'color', name: '眉', mode: 'tint', default: '#5A3E2B', link: 'hair.base' }],
  layers: [
    {
      id: 'eyebrows',
      slot: 'face.eyebrows',
      assets: Object.entries(browStates).map(([state, pts]) => ({
        name: `eyebrows_${state}`,
        when: { state },
        art: {
          regions: [polyline(pts, 7), polyline(mirrorPts(pts), 7)].map((s) => paint(s, 0, { outline: false, shade: false })),
        },
        channels: { r: 'color' },
      })),
    },
  ],
};

const MOUTH_FILL: RGB = [150, 60, 64];
const mouthStates: Record<string, Region[]> = {
  closed: [stroke(capsule(782, 505, 818, 505, 3))],
  smile: [stroke(polyline([[776, 500], [788, 508], [800, 510], [812, 508], [824, 500]], 3))],
  smile_open: [solid(intersect(ellipse(800, 498, 30, 28), below(498)), MOUTH_FILL)],
  open: [solid(ellipse(800, 508, 16, 18), MOUTH_FILL)],
  frown: [stroke(polyline([[776, 512], [788, 504], [800, 502], [812, 504], [824, 512]], 3))],
  shout: [solid(ellipse(800, 512, 30, 34), MOUTH_FILL)],
};

const mouth: PartDef = {
  id: 'dev.mouth_01',
  name: '仮・口',
  category: 'face.mouth',
  layers: [
    {
      id: 'mouth',
      slot: 'face.mouth',
      assets: Object.entries(mouthStates).map(([state, regions]) => ({ name: `mouth_${state}`, when: { state }, art: { regions } })),
    },
  ],
};

// ---------------------------------------------------------------- 髪

const hairBack: PartDef = {
  id: 'dev.hair_back_01',
  name: '仮・後髪',
  category: 'hair.back',
  colorSlots: [HAIR],
  layers: [
    {
      id: 'back',
      slot: 'hair.back',
      assets: [{ name: 'back', art: { regions: [paint(union(ellipse(800, 390, 196, 232), roundRect(612, 390, 988, 780, 60)), 0)] }, channels: { r: 'base' } }],
    },
  ],
};

// 前髪。頭頂を覆う部分と、眉・メガネに掛かる 3 本の房。
const bangs = union(
  intersect(ellipse(800, 372, 164, 204), above(338)),
  polygon([[660, 330], [740, 330], [690, 395]], 4),
  polygon([[735, 330], [830, 330], [790, 388]], 4),
  polygon([[825, 330], [940, 330], [905, 398]], 4),
);

const hairFront: PartDef = {
  id: 'dev.hair_front_01',
  name: '仮・前髪',
  category: 'hair.front',
  colorSlots: [HAIR],
  layers: [{ id: 'front', slot: 'hair.front', assets: [{ name: 'front', art: { regions: [paint(bangs, 0)] }, channels: { r: 'base' } }] }],
};

// 頭頂から立つ毛。帽子の hides で消えることの確認用。
const hairExtra: PartDef = {
  id: 'dev.hair_extra_01',
  name: '仮・追加髪（アホ毛）',
  category: 'hair.extra',
  colorSlots: [HAIR],
  layers: [
    {
      id: 'ahoge',
      slot: 'hair.extra',
      assets: [{ name: 'ahoge', art: { regions: [paint(polygon([[788, 186], [814, 186], [862, 96], [822, 124]], 5), 0)] }, channels: { r: 'base' } }],
    },
  ],
};

// ---------------------------------------------------------------- 衣装

const shirtPts: Pt[] = [[660, 656], [940, 656], [960, 724], [926, 1180], [944, 1262], [656, 1262], [674, 1180], [640, 724]];
const neckHole = ellipse(800, 640, 58, 44);
const shirtBody = subtract(polygon(shirtPts, 16), neckHole);
const shirtBodyChestL = subtract(union(polygon(shirtPts, 16), ...both(ellipse(730, 895, 114, 92))), neckHole);
const shirtButtons = [0, 1, 2, 3, 4].map((i) => paint(ellipse(800, 760 + 105 * i, 9, 9), 1, { outline: false, shade: false }));
const shirtSleeve = capsule(968, 700, 1008, 1196, 56);
const SHIRT_CHANNELS = { r: 'main', g: 'button' };

const shirt: PartDef = {
  id: 'dev.shirt_01',
  name: '仮・シャツ',
  category: 'outfit.top',
  colorSlots: [
    { id: 'main', name: '本体', mode: 'tint', default: '#E9EDF2' },
    { id: 'button', name: 'ボタン', mode: 'tint', default: '#8A93A6' },
  ],
  layers: [
    {
      id: 'body',
      slot: 'outfit.top',
      assets: [
        { name: 'body', art: { regions: [paint(shirtBody, 0), ...shirtButtons] }, channels: SHIRT_CHANNELS },
        { name: 'body_chest_l', when: { fit: { chest: 'large' } }, art: { regions: [paint(shirtBodyChestL, 0), ...shirtButtons] }, channels: SHIRT_CHANNELS },
      ],
    },
    {
      id: 'sleeve_l',
      slot: 'arm.left.sleeve.top',
      assets: [{ name: 'sleeve_l_down', when: { pose: 'down' }, art: { regions: [paint(shirtSleeve, 0)] }, channels: { r: 'main' } }],
    },
    {
      id: 'sleeve_r',
      slot: 'arm.right.sleeve.top',
      assets: [
        { name: 'sleeve_r_down', when: { pose: 'down' }, art: { regions: [paint(mirrorX(shirtSleeve), 0)] }, channels: { r: 'main' } },
        { name: 'sleeve_r_pocket', when: { pose: 'pocket' }, art: { regions: [paint(polyline([[632, 700], [560, 990], [660, 1212]], 56), 0)] }, channels: { r: 'main' } },
      ],
    },
  ],
};

const pantsShape = intersect(
  union(polygon([[670, 1172], [930, 1172], [950, 1330], [650, 1330]], 12), ...both(capsule(726, 1330, 733, 2250, 72))),
  above(2290),
);

const pants: PartDef = {
  id: 'dev.pants_01',
  name: '仮・ボトムス',
  category: 'outfit.bottom',
  colorSlots: [{ id: 'main', name: '本体', mode: 'tint', default: '#2E3440' }],
  layers: [{ id: 'pants', slot: 'outfit.bottom', assets: [{ name: 'pants', art: { regions: [paint(pantsShape, 0)] }, channels: { r: 'main' } }] }],
};

const sock = union(intersect(capsule(733, 2100, 735, 2300, 66), below(2120)), ellipse(725, 2330, 74, 40));

const socks: PartDef = {
  id: 'dev.socks_01',
  name: '仮・靴下',
  category: 'outfit.socks',
  colorSlots: [{ id: 'main', name: '本体', mode: 'tint', default: '#F5F5F5' }],
  layers: [{ id: 'socks', slot: 'outfit.socks', assets: [{ name: 'socks', art: { regions: both(sock).map((s) => paint(s, 0)) }, channels: { r: 'main' } }] }],
};

// 足首まで覆う靴。筒の上端（y = 2215）が裾（y = 2290）より上にあり、裾との前後で見た目が変わる。
const shoe = union(roundRect(664, 2215, 798, 2340, 20), ellipse(718, 2340, 88, 42));

const shoes: PartDef = {
  id: 'dev.shoes_01',
  name: '仮・靴',
  category: 'outfit.shoes',
  colorSlots: [{ id: 'main', name: '本体', mode: 'tint', default: '#5B3A29' }],
  layers: [{ id: 'shoes', slot: 'outfit.shoes', assets: [{ name: 'shoes', art: { regions: both(shoe).map((s) => paint(s, 0)) }, channels: { r: 'main' } }] }],
};

const coatPanel = polygon([[640, 648], [772, 648], [744, 1688], [604, 1688], [624, 730]], 14);
const coatLapel = intersect(polygon([[772, 648], [730, 648], [698, 800], [762, 930]], 14), coatPanel);
const coatButtons = [0, 1, 2].map((i) => paint(ellipse(722, 1010 + 130 * i, 13, 13), 2, { outline: false, shade: false }));
const coatSleeve = capsule(968, 700, 1010, 1206, 66);
const coatCuffButton = ellipse(1026, 1230, 9, 9);
const coatSleeveArt = (flip: boolean): Art => {
  const f = (s: Shape) => (flip ? mirrorX(s) : s);
  return { regions: [paint(f(coatSleeve), 0), paint(f(coatCuffButton), 2, { outline: false, shade: false })] };
};

const coat: PartDef = {
  id: 'dev.coat_01',
  name: '仮・コート',
  category: 'outfit.outer',
  tags: ['冬'],
  // 仕様書 §8 の例と同じ条件。シャツを外すと「競合」になることの確認用。
  requires: [{ type: 'category', category: 'outfit.top' }],
  colorSlots: [
    { id: 'main', name: '本体', mode: 'tint', default: '#3A3F4B' },
    { id: 'lapel', name: '襟', mode: 'tint', default: '#2B2F38' },
    { id: 'button', name: 'ボタン', mode: 'tint', default: '#C8A85A' },
  ],
  layers: [
    {
      id: 'back',
      slot: 'outfit.outer.back',
      assets: [{ name: 'back', art: { regions: [paint(polygon([[640, 650], [960, 650], [996, 1690], [604, 1690]], 16), 0)] }, channels: { r: 'main' } }],
    },
    {
      id: 'body',
      slot: 'outfit.outer',
      assets: [
        {
          name: 'body',
          art: {
            regions: [...both(coatPanel).map((s) => paint(s, 0)), ...both(coatLapel).map((s) => paint(s, 1)), ...coatButtons],
          },
          channels: { r: 'main', g: 'lapel', b: 'button' },
        },
      ],
    },
    // 袖は down のみ。右腕が pocket のとき未解決になり、コート全体が非対応になる。
    {
      id: 'sleeve_l',
      slot: 'arm.left.sleeve.outer',
      assets: [{ name: 'sleeve_l_down', when: { pose: 'down' }, art: coatSleeveArt(false), channels: { r: 'main', b: 'button' } }],
    },
    {
      id: 'sleeve_r',
      slot: 'arm.right.sleeve.outer',
      assets: [{ name: 'sleeve_r_down', when: { pose: 'down' }, art: coatSleeveArt(true), channels: { r: 'main', b: 'button' } }],
    },
  ],
};

const hatCrown = intersect(ellipse(800, 262, 182, 150), above(300));

const hat: PartDef = {
  id: 'dev.hat_01',
  name: '仮・帽子',
  category: 'outfit.head',
  hides: ['hair.extra'],
  colorSlots: [
    { id: 'main', name: '本体', mode: 'tint', default: '#6B4F3A' },
    { id: 'band', name: 'リボン', mode: 'tint', default: '#2B2F38' },
  ],
  layers: [
    // つばの奥側。後髪より後ろに回る。
    { id: 'back', slot: 'outfit.head.back', assets: [{ name: 'back', art: { regions: [paint(ellipse(800, 292, 250, 34), 0)] }, channels: { r: 'main' } }] },
    {
      id: 'front',
      slot: 'outfit.head',
      assets: [
        {
          name: 'front',
          art: {
            regions: [
              paint(hatCrown, 0),
              paint(intersect(hatCrown, below(262)), 1, { shade: false }),
              paint(intersect(ellipse(800, 296, 250, 30), below(296)), 0),
            ],
          },
          channels: { r: 'main', g: 'band' },
        },
      ],
    },
  ],
};

const lens = roundRect(EYE_X - 48, EYE_Y - 32, EYE_X + 48, EYE_Y + 32, 18);
const glassesFrame = union(
  ...both(ring(lens, 4)),
  capsule(783, 400, 817, 400, 4),
  ...both(capsule(913, 398, 944, 390, 4)),
);

const glasses: PartDef = {
  id: 'dev.glasses_01',
  name: '仮・メガネ',
  category: 'outfit.eyewear',
  colorSlots: [{ id: 'frame', name: 'フレーム', mode: 'tint', default: '#30343C' }],
  layers: [
    {
      id: 'glasses',
      slot: 'outfit.eyewear',
      assets: [
        {
          name: 'glasses',
          art: {
            regions: [
              ...both(lens).map((s) => solid(s, [207, 232, 255], { outline: false, opacity: 0.25 })),
              paint(glassesFrame, 0, { outline: false, shade: false }),
            ],
          },
          channels: { r: 'frame' },
        },
      ],
    },
  ],
};

const blush: PartDef = {
  id: 'dev.blush_01',
  name: '仮・赤面',
  category: 'overlay',
  colorSlots: [{ id: 'color', name: '色', mode: 'tint', default: '#F08A8A' }],
  layers: [
    {
      id: 'blush',
      slot: 'overlay.face',
      assets: [
        {
          name: 'blush',
          art: { regions: both(ellipse(888, 462, 44, 24)).map((s) => paint(s, 0, { outline: false, shade: false, soft: 16, opacity: 0.7 })) },
          channels: { r: 'color' },
        },
      ],
    },
  ],
};

/** 仮素材の一覧。並びは検証ページでの既定の装備順になる。 */
export const DEV_PARTS: readonly PartDef[] = [
  body,
  faceHead,
  faceEars,
  faceNose,
  eyes,
  eyebrows,
  mouth,
  hairBack,
  hairFront,
  hairExtra,
  socks,
  shoes,
  pants,
  shirt,
  coat,
  glasses,
  hat,
  blush,
];
