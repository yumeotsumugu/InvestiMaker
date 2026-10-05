// Character Schema v1（docs/specifications/InvestiMaker_Character_Schema_v1.md）の型。
//
// メモリ上の Character は保存 JSON とほぼ同じ形で、違いは次の 3 点だけ。
// - `format` / `formatVersion` を持たない（serialize が付ける）
// - `requirements` を持たない（State と Equipment から導出するキャッシュ。serialize が作り直す）
// - 省略可能な項目が既定値で埋まっている（`fit`、`colors`、色の大文字化）
//
// 未知のフィールドは、読み込んだオブジェクトにそのまま残る（型には現れない）。
// 編集する関数は必ず既存のオブジェクトを展開して作り直すので、保存し直しても失われない。

import type { SlotColorOverride } from '../color.ts';
import type { Transform } from '../manifest.ts';

export const CHARACTER_FORMAT = 'INVESTIMAKER_CHARACTER';
export const SUPPORTED_CHARACTER_FORMAT_VERSION = 1;

/** ポーズの領域（Asset Specification §6.2）。 */
export const POSE_REGIONS = ['torso', 'arm.left', 'arm.right'] as const;
/** 表情を構成する状態（Asset Specification §6.3）。 */
export const EXPRESSION_KEYS = ['eyes', 'eyebrows', 'mouth'] as const;

/**
 * Equipment Instance。「このキャラクターがその Part をどう使っているか」を表す。
 * Part の manifest がなくても意味が完結するよう、manifest の内容には依存しない。
 */
export interface EquipmentInstance {
  /** UUID。キャラクター内で一意。 */
  instanceId: string;
  partId: string;
  /** false は「外しているが、色などの設定は残している」。 */
  equipped: boolean;
  /** スロット ID → 色の指定。Part が宣言していないスロット ID も捨てずに持つ。 */
  colors: Record<string, SlotColorOverride>;
  /** Part 既定の配置補正に対する差分（Asset Specification §9）。条件によらない基本の値。 */
  transform?: Transform;
  /** 状態ごとの上書き。知らないキーは解釈せず、そのまま保持する。 */
  overrides?: InstanceOverrides;
}

/** 補正を適用する条件。書いたキーだけを照合する。少なくとも 1 つのキーを書く。 */
export interface TransformCondition {
  view?: string;
  /** 領域 → 状態。Pose Definition の (region, id) に対応する。 */
  pose?: Record<string, string>;
}

export interface TransformOverride {
  when: TransformCondition;
  /** この条件のとき、基本の `transform` を置き換える値。 */
  transform: Transform;
}

export interface InstanceOverrides {
  /** 条件ごとの配置補正。 */
  transform?: TransformOverride[];
  [key: string]: unknown;
}

export interface CharacterState {
  view: string;
  /** 領域 → 状態。Pose Definition の (region, id) に対応する。 */
  pose: Record<string, string>;
  /** 顔の状態そのもの。名前付き表情（smile 等）は保存しない。 */
  expression: { eyes: string; eyebrows: string; mouth: string };
}

export interface Character {
  /** UUID。 */
  id: string;
  name: string;
  /** 座標系の基準になるキャンバスサイズ。v1 はマスターキャンバス（1600×2400）だけ。 */
  canvas: [number, number];
  appearance: {
    /** 素体の Equipment Instance の instanceId。 */
    body: string;
    /** fit の次元 → 値。 */
    fit: Record<string, string>;
  };
  /** 共有カラーキー → `#RRGGBB`。 */
  sharedColors: Record<string, string>;
  /** 並びが装備順の正本。 */
  equipment: EquipmentInstance[];
  state: CharacterState;
  /** 予約。v1 は中身を解釈せず、そのまま保持する。 */
  composition?: Record<string, unknown>;
}

/**
 * このキャラクターを完全に再現するために環境側に必要なもの。
 * State と Equipment から導出するキャッシュで、正本ではない。
 */
export interface Requirements {
  /** 装備中（`equipped: true`）の Part ID。重複なし、昇順。 */
  parts: string[];
  view: string[];
  pose: Record<string, string[]>;
  fit: Record<string, string[]>;
  state: Record<string, string[]>;
}

/** 保存 JSON の形。 */
export interface CharacterJson extends Character {
  format: typeof CHARACTER_FORMAT;
  formatVersion: number;
  requirements: Requirements;
}
