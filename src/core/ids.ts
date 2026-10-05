// 仕様書 §2 / §3：軸・category・ID 規則。

export const FORMAT = 'INVESTIMAKER_PART';
export const SUPPORTED_FORMAT_VERSION = 1;

/** 公式素材専用の namespace（§3）。 */
export const OFFICIAL_NAMESPACE = 'im';

export const MAX_ID_LENGTH = 96;

/** マスターキャンバス（§4.1）。 */
export const MASTER_CANVAS: readonly [number, number] = [1600, 2400];

export const VIEWS = ['front', 'diagonal_left', 'diagonal_right', 'side_left', 'side_right'] as const;

/** §2 の表。値は `[category, 同時に複数装備できるか]`。 */
const CATEGORY_TABLE: ReadonlyArray<readonly [axis: string, category: string, multi: boolean]> = [
  ['APPEARANCE', 'body', false],
  ['APPEARANCE', 'face.head', false],
  ['APPEARANCE', 'face.ears', false],
  ['APPEARANCE', 'face.eyes', false],
  ['APPEARANCE', 'face.eyebrows', false],
  ['APPEARANCE', 'face.nose', false],
  ['APPEARANCE', 'face.mouth', false],
  ['APPEARANCE', 'hair.front', false],
  ['APPEARANCE', 'hair.side', false],
  ['APPEARANCE', 'hair.back', false],
  ['APPEARANCE', 'hair.extra', true],
  ['APPEARANCE', 'detail', true],
  ['OUTFIT', 'outfit.inner', false],
  ['OUTFIT', 'outfit.top', false],
  ['OUTFIT', 'outfit.vest', false],
  ['OUTFIT', 'outfit.outer', false],
  ['OUTFIT', 'outfit.bottom', false],
  ['OUTFIT', 'outfit.socks', false],
  ['OUTFIT', 'outfit.shoes', false],
  ['OUTFIT', 'outfit.glove', false],
  ['OUTFIT', 'outfit.neck', false],
  ['OUTFIT', 'outfit.eyewear', false],
  ['OUTFIT', 'outfit.head', false],
  ['OUTFIT', 'outfit.ear', true],
  ['OUTFIT', 'outfit.accessory', true],
  ['ITEM', 'item', true],
  ['OVERLAY', 'overlay', true],
];

export const CATEGORIES: ReadonlySet<string> = new Set(CATEGORY_TABLE.map(([, c]) => c));

const MULTI_CATEGORIES: ReadonlySet<string> = new Set(
  CATEGORY_TABLE.filter(([, , multi]) => multi).map(([, c]) => c),
);

/** 同一 category に複数の Part を同時装備できるか（§2 の * 印）。 */
export function isMultiCategory(category: string): boolean {
  return MULTI_CATEGORIES.has(category);
}

export function axisOfCategory(category: string): string | undefined {
  return CATEGORY_TABLE.find(([, c]) => c === category)?.[0];
}

/** §5.4 の共有カラーキー。 */
export const SHARED_COLOR_KEYS = ['skin.base', 'hair.base', 'hair.sub', 'eyes.left', 'eyes.right'] as const;

const SEGMENT = /^[a-z0-9_]+$/;

/** `[a-z0-9_]` のセグメントを `.` で連結した文字列で、96 文字以内（§3）。 */
export function isValidId(id: unknown): id is string {
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID_LENGTH) return false;
  return id.split('.').every((s) => SEGMENT.test(s));
}

/** Part ID は `<namespace>.<name>`（§3）。セグメントはちょうど 2 個。 */
export function isValidPartId(id: unknown): id is string {
  return isValidId(id) && id.split('.').length === 2;
}

export function namespaceOf(partId: string): string {
  return partId.split('.')[0] ?? '';
}
