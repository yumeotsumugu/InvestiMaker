// 仕様書 §1 / §5 / §6.4 / §7 / §8 / §9 / §11：manifest の型。
// 検証を通った manifest がこの形であることを前提にする（検証は validate.ts）。

export type ColorMode = 'tint' | 'multiply' | 'fixed';

export interface ColorSlot {
  id: string;
  name?: string;
  mode: ColorMode;
  /** `#RRGGBB` */
  default: string;
  /** 共有カラーキー（§5.4）。 */
  link?: string;
}

export type OneOrMany = string | string[];

/** §6.4。キーの省略は「この条件に依存しない」という作者の宣言。 */
export interface When {
  view: OneOrMany;
  body?: OneOrMany;
  pose?: OneOrMany;
  state?: OneOrMany;
  attach?: OneOrMany;
  fit?: Record<string, OneOrMany>;
}

export type MaskChannel = 'r' | 'g' | 'b';

export interface Mask {
  file: string;
  /** チャンネル → ColorSlot ID。 */
  channels: Partial<Record<MaskChannel, string>>;
}

export interface Asset {
  when: When;
  file: string;
  /** 省略時は [0, 0]（キャンバス全体サイズの画像）。 */
  offset?: [number, number];
  mask?: Mask;
  /** 4 スロット以上を使う Asset（§5.2）。 */
  masks?: Mask[];
}

export interface Layer {
  id: string;
  slot: string;
  assets: Asset[];
  /** 未解決のとき描画を省く（§6.5）。既定 false。 */
  optional?: boolean;
  /** 同一 Slot 内の順序。−9〜9、既定 0（§6.1）。 */
  zBias?: number;
}

export type Condition =
  | { type: 'part'; id: string }
  | { type: 'category'; category: string }
  | { type: 'state'; path: string; value: string };

/** §9。今回は型のみで、適用は未実装。 */
export interface Transform {
  x?: number;
  y?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
  pivot?: [number, number];
}

export interface License {
  name: string;
  url?: string;
  commercial?: boolean;
  modify?: boolean;
  redistributable?: boolean;
  creditRequired?: boolean;
  creditText?: string;
}

interface PartCommon {
  format: 'INVESTIMAKER_PART';
  formatVersion: number;
  id: string;
  version: string;
  name: string;
  author: string;
  category: string;
  tags?: string[];
  license: License;
  requires?: Condition[];
  conflicts?: Condition[];
  /** 装備中に非表示にする Layer Slot（§8）。 */
  hides?: string[];
  /** 左右反転での代用を許可（§6.5 手順 3）。今回は型のみで、反転は未実装。 */
  mirrorable?: boolean;
  colorSlots?: ColorSlot[];
  transform?: Transform;
  layers: Layer[];
}

export interface Part extends PartCommon {
  kind: 'part';
  compatible: { body: string[] };
}

export type Point = [number, number];

/** §7。 */
export interface Body extends PartCommon {
  kind: 'body';
  category: 'body';
  views: string[];
  fitDimensions?: Record<string, string[]>;
  /** VIEW → 基準点名 → 座標。 */
  anchors: Record<string, Record<string, Point>>;
  compatible?: { body: string[] };
}

export type PartManifest = Part | Body;

export function toArray(v: OneOrMany): string[] {
  return typeof v === 'string' ? [v] : v;
}

/** Asset が持つ Mask の一覧（`mask` と `masks` をまとめる）。 */
export function masksOf(asset: Asset): Mask[] {
  return [...(asset.mask ? [asset.mask] : []), ...(asset.masks ?? [])];
}

/** `when.body` 省略時に有効な Body の集合（§6.4）。Body 自身は自分だけ。 */
export function compatibleBodies(part: PartManifest): string[] {
  return part.kind === 'body' ? [part.id] : part.compatible.body;
}
