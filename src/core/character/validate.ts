// Character JSON の構造の検証。JSON だけで判定できることだけを扱う。
// Part の有無など環境に依存する判定は evaluate.ts が行い、ここでは決して INVALID にしない。

import { MASTER_CANVAS, isValidId, isValidPartId } from '../ids.ts';
import type { Issue } from '../validate.ts';
import { CHARACTER_FORMAT, EXPRESSION_KEYS, POSE_REGIONS, SUPPORTED_CHARACTER_FORMAT_VERSION } from './types.ts';

export interface CharacterValidation {
  ok: boolean;
  errors: Issue[];
  /** 読み込みは続けるが、知らせる価値のあること。 */
  warnings: Issue[];
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
export const MAX_NAME_LENGTH = 200;

export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
export const isColor = (v: unknown): v is string => typeof v === 'string' && COLOR.test(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 値がすべて ID 書式の文字列であるオブジェクトか。キーも ID 書式であること。 */
function isIdMap(v: unknown): v is Record<string, string> {
  return isObject(v) && Object.entries(v).every(([k, x]) => isValidId(k) && isValidId(x));
}

export function validateCharacterJson(input: unknown): CharacterValidation {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const error = (code: string, path: string, message: string) => errors.push({ level: 'error', code, path, message });
  const done = (): CharacterValidation => ({ ok: errors.length === 0, errors, warnings });

  if (!isObject(input)) {
    error('not-object', '', 'Character がオブジェクトではない');
    return done();
  }
  const c = input;

  if (c.format !== CHARACTER_FORMAT) error('format', 'format', `format は "${CHARACTER_FORMAT}" でなければならない`);
  if (typeof c.formatVersion !== 'number' || !Number.isInteger(c.formatVersion) || c.formatVersion < 1) {
    error('format-version', 'formatVersion', 'formatVersion は 1 以上の整数でなければならない');
  } else if (c.formatVersion > SUPPORTED_CHARACTER_FORMAT_VERSION) {
    // 新しい形式は中身を解釈しない。機能（ポーズ等）の不足とは別の理由として区別できるようにする。
    error('format-version-unsupported', 'formatVersion', `formatVersion ${c.formatVersion} は未対応（対応は ${SUPPORTED_CHARACTER_FORMAT_VERSION} まで）`);
    return done();
  }

  if (!isUuid(c.id)) error('id', 'id', 'id は UUID（小文字）');
  if (typeof c.name !== 'string' || c.name.length > MAX_NAME_LENGTH) error('name', 'name', `name は ${MAX_NAME_LENGTH} 文字以内の文字列`);

  // transform の値は画素なので、座標系を Character 単体で確定させる。v1 はマスターキャンバスだけを認める。
  const canvas = c.canvas;
  if (!Array.isArray(canvas) || canvas.length !== 2 || !canvas.every((v) => Number.isInteger(v) && v > 0)) {
    error('canvas', 'canvas', 'canvas は [幅, 高さ]（正の整数）で必須');
  } else if (canvas[0] !== MASTER_CANVAS[0] || canvas[1] !== MASTER_CANVAS[1]) {
    error('canvas-mismatch', 'canvas', `canvas は [${MASTER_CANVAS[0]}, ${MASTER_CANVAS[1]}] でなければならない: [${canvas[0]}, ${canvas[1]}]`);
  }

  // --- sharedColors
  if (!isObject(c.sharedColors)) error('shared-colors', 'sharedColors', 'sharedColors は必須');
  else {
    for (const [key, value] of Object.entries(c.sharedColors)) {
      if (!isValidId(key)) error('shared-color-key', `sharedColors.${key}`, '共有カラーキーが ID 書式に合わない');
      if (!isColor(value)) error('color-value', `sharedColors.${key}`, '色は #RRGGBB');
    }
  }

  // --- equipment
  const instanceIds = new Map<string, Json>();
  if (!Array.isArray(c.equipment)) error('equipment', 'equipment', 'equipment は配列で必須');
  else {
    c.equipment.forEach((inst: unknown, i) => {
      const path = `equipment[${i}]`;
      if (!isObject(inst)) return error('instance', path, 'Equipment Instance がオブジェクトではない');
      if (!isUuid(inst.instanceId)) error('instance-id', `${path}.instanceId`, 'instanceId は UUID（小文字）');
      else if (instanceIds.has(inst.instanceId)) error('instance-id-duplicate', `${path}.instanceId`, `instanceId が重複: ${inst.instanceId}`);
      else instanceIds.set(inst.instanceId, inst);
      if (!isValidPartId(inst.partId)) error('part-id', `${path}.partId`, 'partId は <namespace>.<name> の形式');
      if (typeof inst.equipped !== 'boolean') error('equipped', `${path}.equipped`, 'equipped は真偽値で必須');

      if (inst.colors !== undefined) {
        if (!isObject(inst.colors)) error('colors', `${path}.colors`, 'colors はオブジェクト');
        else {
          for (const [slotId, value] of Object.entries(inst.colors)) {
            const cpath = `${path}.colors.${slotId}`;
            if (!isValidId(slotId)) error('color-slot', cpath, 'スロット ID が ID 書式に合わない');
            if (!isObject(value)) {
              error('color', cpath, '色の指定はオブジェクト');
              continue;
            }
            if (value.linked !== undefined && typeof value.linked !== 'boolean') error('linked', `${cpath}.linked`, 'linked は真偽値');
            if (value.color !== undefined && !isColor(value.color)) error('color-value', `${cpath}.color`, '色は #RRGGBB');
          }
        }
      }

      if (inst.transform !== undefined) {
        const t = inst.transform;
        if (!isObject(t)) error('transform', `${path}.transform`, 'transform はオブジェクト');
        else {
          for (const key of ['x', 'y', 'scaleX', 'scaleY', 'rotation'] as const) {
            if (t[key] !== undefined && !isFiniteNumber(t[key])) error('transform', `${path}.transform.${key}`, `${key} は数値`);
          }
          if (t.pivot !== undefined && !(Array.isArray(t.pivot) && t.pivot.length === 2 && t.pivot.every(isFiniteNumber))) {
            error('transform', `${path}.transform.pivot`, 'pivot は [x, y]');
          }
        }
      }
      if (inst.overrides !== undefined && !isObject(inst.overrides)) error('overrides', `${path}.overrides`, 'overrides はオブジェクト');
    });
  }

  // --- appearance
  if (!isObject(c.appearance)) error('appearance', 'appearance', 'appearance は必須');
  else {
    const body = c.appearance.body;
    if (!isUuid(body)) error('appearance-body', 'appearance.body', 'appearance.body は素体の instanceId（UUID）');
    else if (Array.isArray(c.equipment)) {
      const inst = instanceIds.get(body);
      if (!inst) error('appearance-body-ref', 'appearance.body', `equipment にない instanceId: ${body}`);
      else if (inst.equipped !== true) error('appearance-body-ref', 'appearance.body', '素体の Equipment Instance は equipped: true でなければならない');
    }
    if (c.appearance.fit !== undefined && !isIdMap(c.appearance.fit)) error('fit', 'appearance.fit', 'fit は {次元: 値}');
  }

  // --- state
  if (!isObject(c.state)) error('state', 'state', 'state は必須');
  else {
    if (!isValidId(c.state.view)) error('view', 'state.view', 'view は必須');
    if (!isIdMap(c.state.pose)) error('pose', 'state.pose', 'pose は {領域: 状態}');
    else {
      for (const region of POSE_REGIONS) {
        if (c.state.pose[region] === undefined) error('pose', `state.pose.${region}`, `pose.${region} は必須`);
      }
    }
    const expr = c.state.expression;
    if (!isObject(expr)) error('expression', 'state.expression', 'expression は必須');
    else {
      for (const key of EXPRESSION_KEYS) {
        if (!isValidId(expr[key])) error('expression', `state.expression.${key}`, `expression.${key} は必須`);
      }
    }
  }

  if (c.composition !== undefined && !isObject(c.composition)) error('composition', 'composition', 'composition はオブジェクト');

  // requirements は導出できるキャッシュなので、形が崩れていても Character を不正にはしない。
  if (c.requirements !== undefined && !isObject(c.requirements)) {
    warnings.push({ level: 'warning', code: 'requirements-malformed', path: 'requirements', message: 'requirements がオブジェクトではない（無視して作り直す）' });
  }

  return done();
}
