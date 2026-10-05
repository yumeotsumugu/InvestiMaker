// 分類の構成。Asset Specification の category を、利用者が選ぶ大分類・小分類にまとめる。
// これは UI 側の定義であり、Asset Specification には含まれない（設計書 §20.2）。

import type { PartManifest } from '../core/index.ts';

export interface Sub {
  /** 小分類の ID。Asset Specification の category と同じ。 */
  category: string;
}

export interface Major {
  id: string;
  /** Part を選ぶ大分類なら小分類の並び。Part ではないもの（表情、ポーズ・向き）は kind で区別する。 */
  kind: 'parts' | 'expression' | 'pose';
  subs: Sub[];
}

const parts = (id: string, ...categories: string[]): Major => ({ id, kind: 'parts', subs: categories.map((category) => ({ category })) });

/** 大分類と小分類の並び（ワイヤーフレーム §3）。 */
export const MAJORS: readonly Major[] = [
  parts('body', 'body'),
  parts('face', 'face.head', 'face.eyes', 'face.eyebrows', 'face.nose', 'face.mouth', 'face.ears', 'detail'),
  parts('hair', 'hair.front', 'hair.side', 'hair.back', 'hair.extra'),
  parts('outfit', 'outfit.top', 'outfit.bottom', 'outfit.outer', 'outfit.inner', 'outfit.vest', 'outfit.socks', 'outfit.shoes', 'outfit.glove', 'outfit.neck'),
  parts('accessory', 'outfit.eyewear', 'outfit.head', 'outfit.ear', 'outfit.accessory'),
  { id: 'expression', kind: 'expression', subs: [] },
  { id: 'pose', kind: 'pose', subs: [] },
  parts('other', 'item', 'overlay'),
];

/** 「なし」を選べない分類。これらの Part は外せない。 */
export const REQUIRED_CATEGORIES: ReadonlySet<string> = new Set(['body', 'face.head', 'face.eyes', 'face.eyebrows', 'face.mouth']);

export interface MajorView {
  major: Major;
  /** 素材が 1 つ以上ある小分類。 */
  subs: Sub[];
}

/** 表示する大分類と小分類。素材のない小分類と、中身が空になった Part の大分類は出さない。 */
export function visibleMajors(library: ReadonlyMap<string, PartManifest>): MajorView[] {
  const used = new Set([...library.values()].map((p) => p.category));
  return MAJORS.map((major) => ({ major, subs: major.subs.filter((s) => used.has(s.category)) })).filter(
    (v) => v.major.kind !== 'parts' || v.subs.length > 0,
  );
}
