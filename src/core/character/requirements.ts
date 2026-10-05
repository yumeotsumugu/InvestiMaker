// Requirements：このキャラクターを完全に再現するために環境側に必要なもの。
// State と Equipment から導出するキャッシュであり、正本ではない。
// 語彙は Asset Specification と共通（Part ID、VIEW、Pose Definition の (region, id)、fit の次元と値、状態名）。

import type { PoseDefinition } from '../context.ts';
import { POSE_DEFINITIONS } from '../context.ts';
import { VIEWS } from '../ids.ts';
import type { Body, PartManifest } from '../manifest.ts';
import type { Character, Requirements } from './types.ts';

const sortedKeys = <T>(record: Record<string, T>): [string, T][] =>
  Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

export function deriveRequirements(character: Character): Requirements {
  const wrap = (record: Record<string, string>) => Object.fromEntries(sortedKeys(record).map(([k, v]) => [k, [v]]));
  const { eyes, eyebrows, mouth } = character.state.expression;
  return {
    parts: [...new Set(character.equipment.filter((i) => i.equipped).map((i) => i.partId))].sort(),
    view: [character.state.view],
    pose: wrap(character.state.pose),
    fit: wrap(character.appearance.fit),
    state: { eyebrows: [eyebrows], eyes: [eyes], mouth: [mouth] },
  };
}

/** 読み込み環境が提供できるもの。 */
export interface Environment {
  /** 読み込み済みの Part（ID → manifest）。 */
  library: ReadonlyMap<string, PartManifest>;
  /** 実装が知っている Pose Definition。既定は core の表。 */
  poses?: readonly PoseDefinition[];
  /** 実装が知っている VIEW。既定は Asset Specification §3.1 の一覧。 */
  views?: readonly string[];
}

export interface UnmetRequirement {
  kind: 'part' | 'view' | 'pose' | 'fit';
  /** 機械判定用（`part-missing` など）。 */
  code: string;
  /** 足りないもの（Part ID、`arm.right=crossed`、`chest=huge` など）。 */
  what: string;
  message: string;
}

/**
 * Requirements のうち、環境が満たせないものを返す。
 * `body` は fit の照合に使う素体。素体が分からないときは fit を判定しない（Part の不足として別に挙がる）。
 */
export function unmetRequirements(req: Requirements, env: Environment, body?: Body): UnmetRequirement[] {
  const unmet: UnmetRequirement[] = [];
  const poses = env.poses ?? POSE_DEFINITIONS;
  const views: readonly string[] = env.views ?? VIEWS;

  for (const partId of req.parts) {
    if (!env.library.has(partId)) unmet.push({ kind: 'part', code: 'part-missing', what: partId, message: `Part が読み込まれていない: ${partId}` });
  }
  for (const view of req.view) {
    if (!views.includes(view)) unmet.push({ kind: 'view', code: 'view-unknown', what: view, message: `この実装が知らない VIEW: ${view}` });
  }
  for (const [region, ids] of Object.entries(req.pose)) {
    for (const id of ids) {
      if (!poses.some((d) => d.region === region && d.id === id)) {
        unmet.push({ kind: 'pose', code: 'pose-unknown', what: `${region}=${id}`, message: `この実装の Pose Definition にないポーズ: ${region} = ${id}` });
      }
    }
  }
  if (body) {
    for (const [dim, values] of Object.entries(req.fit)) {
      for (const value of values) {
        if (!body.fitDimensions?.[dim]?.includes(value)) {
          unmet.push({ kind: 'fit', code: 'fit-unknown', what: `${dim}=${value}`, message: `素体 ${body.id} が持たない fit: ${dim} = ${value}` });
        }
      }
    }
  }
  return unmet;
}
