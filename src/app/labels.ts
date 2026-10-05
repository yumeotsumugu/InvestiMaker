// 表示名の辞書。Asset Specification は category・状態・ポーズ・向きの表示名を持たないので、UI 側で持つ。
// 将来の多言語化はこの辞書を差し替えて行う。辞書にない値は、内部の値をそのまま表示する。

export type LabelKind = 'step' | 'major' | 'category' | 'eyes' | 'eyebrows' | 'mouth' | 'expression' | 'region' | 'pose' | 'view' | 'shared' | 'fitDimension' | 'fitValue';

const JA: Record<LabelKind, Record<string, string>> = {
  step: { create: 'CREATE', customize: 'CUSTOMIZE', variant: 'VARIANT', portrait: 'PORTRAIT', export: 'EXPORT' },
  major: { body: '素体', face: '顔', hair: '髪', outfit: '服', accessory: '装飾', expression: '表情', pose: 'ポーズ・向き', other: 'その他' },
  category: {
    body: '素体',
    'face.head': '輪郭',
    'face.eyes': '目',
    'face.eyebrows': '眉',
    'face.nose': '鼻',
    'face.mouth': '口',
    'face.ears': '耳',
    detail: 'ほくろ等',
    'hair.front': '前髪',
    'hair.side': '横髪',
    'hair.back': '後髪',
    'hair.extra': '追加',
    'outfit.top': 'トップス',
    'outfit.bottom': 'ボトムス',
    'outfit.outer': 'アウター',
    'outfit.inner': 'インナー',
    'outfit.vest': 'ベスト',
    'outfit.socks': '靴下',
    'outfit.shoes': '靴',
    'outfit.glove': '手袋',
    'outfit.neck': '首元',
    'outfit.eyewear': '眼鏡',
    'outfit.head': '帽子',
    'outfit.ear': '耳飾り',
    'outfit.accessory': 'アクセサリー',
    item: '持ち物',
    overlay: '効果',
  },
  eyes: { open: '開く', half: '半目', closed: '閉じる', smile: '笑い目', wide: '見開く', glare: 'にらむ' },
  eyebrows: { neutral: '普通', relaxed: 'ゆるむ', angry: '怒り', sad: '困り', raised: '上げる' },
  mouth: { closed: '閉じる', smile: 'ほほえむ', smile_open: '笑う', open: '開く', frown: 'への字', shout: '叫ぶ' },
  expression: { normal: '通常', smile: '笑顔', angry: '怒り', sad: '悲しみ', surprised: '驚き', fear: '恐怖' },
  region: { torso: '胴体・脚', 'arm.left': '左腕', 'arm.right': '右腕' },
  pose: { stand: '立つ', down: '下ろす', pocket: 'ポケット' },
  view: { front: '正面', diagonal_left: '斜め左', diagonal_right: '斜め右', side_left: '左', side_right: '右' },
  shared: { 'skin.base': '肌', 'hair.base': '髪', 'hair.sub': '髪（毛先）', 'eyes.left': '左目', 'eyes.right': '右目' },
  fitDimension: { chest: '胸' },
  fitValue: { small: '小', medium: '中', large: '大' },
};

/** 表示名。辞書にない値は、そのまま返す。 */
export function label(kind: LabelKind, value: string): string {
  return JA[kind][value] ?? value;
}

/** 辞書に表示名があるか（テストで、標準の値がすべて載っていることを確かめる）。 */
export function hasLabel(kind: LabelKind, value: string): boolean {
  return value in JA[kind];
}
