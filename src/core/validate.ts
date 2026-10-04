// 仕様書 §12：読み込み時の検証（manifest の範囲）。
// ZIP の安全性（項目 1）と SVG のサニタイズ（項目 6）、version 比較（項目 7）は今回の対象外。

import { CONTEXT_PATHS } from './context.ts';
import { LAYER_SLOTS, regionOfSlot } from './drawOrder.ts';
import {
  CATEGORIES,
  FORMAT,
  OFFICIAL_NAMESPACE,
  SUPPORTED_FORMAT_VERSION,
  isValidId,
  isValidPartId,
  namespaceOf,
} from './ids.ts';
import type { Asset, PartManifest, When } from './manifest.ts';
import { masksOf } from './manifest.ts';
import { whenOverlaps } from './resolve.ts';

export interface Issue {
  /** `error` は MUST 違反（読み込みを拒否）、`warning` は SHOULD 違反。 */
  level: 'error' | 'warning';
  /** 機械判定用の種別。 */
  code: string;
  /** manifest 内の位置（`layers[1].assets[0].when`）。 */
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
}

export interface ValidateOptions {
  /** 公式素材として読むか。既定 false（ユーザー素材。namespace `im` を拒否する）。 */
  official?: boolean;
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isStringOrStrings = (v: unknown): boolean =>
  isNonEmptyString(v) || (Array.isArray(v) && v.length > 0 && v.every(isNonEmptyString));

const ALLOWED_IMAGE_EXT = /\.(png|svg)$/;

/** 相対パスのみ。`..`、絶対パス、バックスラッシュは不可（§10）。 */
function isSafePath(file: string): boolean {
  if (file.startsWith('/') || file.includes('\\') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(file)) return false;
  return file.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

/**
 * manifest を検証する。`ok` が true なら `PartManifest` として扱ってよい。
 * 未知のフィールドは無視する（§11.1）。
 */
export function validateManifest(input: unknown, options: ValidateOptions = {}): ValidationResult {
  const issues: Issue[] = [];
  const error = (code: string, path: string, message: string) =>
    issues.push({ level: 'error', code, path, message });
  const warn = (code: string, path: string, message: string) =>
    issues.push({ level: 'warning', code, path, message });
  const done = (): ValidationResult => {
    const errors = issues.filter((i) => i.level === 'error');
    return { ok: errors.length === 0, errors, warnings: issues.filter((i) => i.level === 'warning') };
  };

  if (!isObject(input)) {
    error('not-object', '', 'manifest がオブジェクトではない');
    return done();
  }
  const m = input;

  // --- 必須フィールド（§11.1）
  if (m.format !== FORMAT) error('format', 'format', `format は "${FORMAT}" でなければならない`);
  if (typeof m.formatVersion !== 'number' || !Number.isInteger(m.formatVersion) || m.formatVersion < 1) {
    error('format-version', 'formatVersion', 'formatVersion は 1 以上の整数でなければならない');
  } else if (m.formatVersion > SUPPORTED_FORMAT_VERSION) {
    error('format-version-unsupported', 'formatVersion', `formatVersion ${m.formatVersion} は未対応（対応は ${SUPPORTED_FORMAT_VERSION} まで）`);
    return done(); // 新しい形式は中身を解釈しない
  }
  for (const key of ['version', 'name', 'author'] as const) {
    if (!isNonEmptyString(m[key])) error('required', key, `${key} は必須`);
  }
  if (!isObject(m.license)) error('required', 'license', 'license は必須');
  else if (!isNonEmptyString(m.license.name)) warn('license-name', 'license.name', 'license.name がない');

  // --- ID（§3）
  if (!isValidPartId(m.id)) {
    error('part-id', 'id', 'id は <namespace>.<name> の形式（各セグメントは [a-z0-9_]、全体で 96 文字以内）');
  } else if (!options.official && namespaceOf(m.id) === OFFICIAL_NAMESPACE) {
    error('namespace-reserved', 'id', `namespace "${OFFICIAL_NAMESPACE}" は公式素材専用`);
  }

  // --- kind / category（§2、§7）
  const isBody = m.kind === 'body';
  if (m.kind !== 'part' && m.kind !== 'body') error('kind', 'kind', 'kind は "part" または "body"');
  if (!isNonEmptyString(m.category) || !CATEGORIES.has(m.category)) {
    error('category', 'category', `category が §2 に存在しない: ${String(m.category)}`);
  } else if (isBody !== (m.category === 'body')) {
    error('kind-category', 'category', 'kind "body" と category "body" は必ず組で使う');
  }

  // --- compatible（§8）/ Body（§7）
  const compatBody = isObject(m.compatible) ? m.compatible.body : undefined;
  if (!isBody) {
    if (!Array.isArray(compatBody) || compatBody.length === 0 || !compatBody.every(isValidPartId)) {
      error('compatible-body', 'compatible.body', 'compatible.body は Body ID の配列（1 個以上）');
    }
  } else {
    const views = m.views;
    if (!Array.isArray(views) || views.length === 0 || !views.every(isNonEmptyString)) {
      error('body-views', 'views', 'Body は views（1 個以上）を持つ');
    } else {
      for (const view of views) {
        const anchors = isObject(m.anchors) ? m.anchors[view] : undefined;
        if (!isObject(anchors)) error('body-anchors', `anchors.${view}`, `anchors は VIEW ごとに必須: ${view}`);
      }
    }
    if (m.fitDimensions !== undefined) {
      const dims = m.fitDimensions;
      if (!isObject(dims) || !Object.values(dims).every((v) => Array.isArray(v) && v.length > 0 && v.every(isNonEmptyString))) {
        error('body-fit', 'fitDimensions', 'fitDimensions は {次元: 値の配列}');
      }
    }
  }

  // --- colorSlots（§5.1）
  const slotIds = new Set<string>();
  if (m.colorSlots !== undefined && !Array.isArray(m.colorSlots)) {
    error('color-slots', 'colorSlots', 'colorSlots は配列');
  }
  (Array.isArray(m.colorSlots) ? m.colorSlots : []).forEach((slot: unknown, i) => {
    const path = `colorSlots[${i}]`;
    if (!isObject(slot)) return error('color-slot', path, 'ColorSlot がオブジェクトではない');
    if (!isValidId(slot.id)) error('color-slot-id', `${path}.id`, 'ColorSlot の id が ID 書式に合わない');
    else if (slotIds.has(slot.id)) error('color-slot-duplicate', `${path}.id`, `ColorSlot の id が重複: ${slot.id}`);
    else slotIds.add(slot.id);
    if (slot.mode !== 'tint' && slot.mode !== 'multiply' && slot.mode !== 'fixed') {
      error('color-slot-mode', `${path}.mode`, 'mode は tint / multiply / fixed');
    }
    if (typeof slot.default !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(slot.default)) {
      error('color-slot-default', `${path}.default`, 'default は #RRGGBB');
    }
    if (!isNonEmptyString(slot.name)) warn('color-slot-name', `${path}.name`, 'name（UI 表示名）がない');
    if (slot.link !== undefined && !isValidId(slot.link)) {
      error('color-slot-link', `${path}.link`, 'link が ID 書式に合わない');
    }
  });

  // --- requires / conflicts / hides（§8）
  for (const key of ['requires', 'conflicts'] as const) {
    const list = m[key];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      error('condition', key, `${key} は配列`);
      continue;
    }
    list.forEach((c: unknown, i) => {
      const path = `${key}[${i}]`;
      if (!isObject(c)) return error('condition', path, '条件がオブジェクトではない');
      if (c.type === 'part') {
        if (!isValidPartId(c.id)) error('condition', `${path}.id`, 'Part ID の書式に合わない');
      } else if (c.type === 'category') {
        if (!isNonEmptyString(c.category) || !CATEGORIES.has(c.category)) {
          error('condition', `${path}.category`, `category が §2 に存在しない: ${String(c.category)}`);
        }
      } else if (c.type === 'state') {
        if (!(CONTEXT_PATHS as readonly unknown[]).includes(c.path)) {
          error('condition', `${path}.path`, `path は ${CONTEXT_PATHS.join(' / ')} のいずれか`);
        }
        if (!isNonEmptyString(c.value)) error('condition', `${path}.value`, 'value は必須');
      } else {
        error('condition', `${path}.type`, 'type は part / category / state');
      }
    });
  }
  if (m.hides !== undefined) {
    if (!Array.isArray(m.hides)) error('hides', 'hides', 'hides は配列');
    else {
      m.hides.forEach((slot: unknown, i) => {
        if (!isNonEmptyString(slot) || !LAYER_SLOTS.has(slot)) {
          error('hides', `hides[${i}]`, `Layer Slot が §6.1 に存在しない: ${String(slot)}`);
        }
      });
    }
  }

  // --- layers（§6、§12 の 3〜5）
  if (!Array.isArray(m.layers) || m.layers.length === 0) {
    error('required', 'layers', 'layers は 1 個以上必須');
    return done();
  }
  const layerIds = new Set<string>();
  m.layers.forEach((layer: unknown, li) => {
    const lpath = `layers[${li}]`;
    if (!isObject(layer)) return error('layer', lpath, 'Layer がオブジェクトではない');
    if (!isValidId(layer.id)) error('layer-id', `${lpath}.id`, 'Layer の id が ID 書式に合わない');
    else if (layerIds.has(layer.id)) error('layer-duplicate', `${lpath}.id`, `Layer の id が重複: ${layer.id}`);
    else layerIds.add(layer.id);

    const slotOk = isNonEmptyString(layer.slot) && LAYER_SLOTS.has(layer.slot);
    if (!slotOk) error('slot', `${lpath}.slot`, `Layer Slot が §6.1 に存在しない: ${String(layer.slot)}`);
    if (layer.zBias !== undefined && (typeof layer.zBias !== 'number' || !Number.isInteger(layer.zBias) || layer.zBias < -9 || layer.zBias > 9)) {
      error('z-bias', `${lpath}.zBias`, 'zBias は −9〜9 の整数');
    }
    if (layer.optional !== undefined && typeof layer.optional !== 'boolean') {
      error('optional', `${lpath}.optional`, 'optional は真偽値');
    }
    if (!Array.isArray(layer.assets) || layer.assets.length === 0) {
      return error('assets', `${lpath}.assets`, 'assets は 1 個以上必須');
    }

    const validWhens: { index: number; when: When }[] = [];
    layer.assets.forEach((asset: unknown, ai) => {
      const apath = `${lpath}.assets[${ai}]`;
      if (!isObject(asset)) return error('asset', apath, 'Asset がオブジェクトではない');

      if (validateWhen(asset.when, `${apath}.when`, error)) {
        const when = asset.when as When;
        validWhens.push({ index: ai, when });
        if (Array.isArray(compatBody) && when.body !== undefined) {
          const outside = (typeof when.body === 'string' ? [when.body] : when.body).filter((b) => !compatBody.includes(b));
          if (outside.length > 0) warn('when-body-outside', `${apath}.when.body`, `compatible.body にない Body: ${outside.join(', ')}`);
        }
        // ポーズで形が変わる Layer（袖など）は pose を明示する（§6.4 SHOULD）。
        if (slotOk && regionOfSlot(layer.slot as string) !== 'torso' && when.pose === undefined) {
          warn('when-pose-missing', `${apath}.when`, '腕領域の Layer は pose を明示することを推奨');
        }
      }

      validateFile(asset.file, `${apath}.file`, error);
      if (asset.offset !== undefined) {
        const o = asset.offset;
        if (!Array.isArray(o) || o.length !== 2 || !o.every((v) => Number.isInteger(v) && v >= 0)) {
          error('offset', `${apath}.offset`, 'offset は [x, y]（0 以上の整数）');
        }
      }

      const masks: [unknown, string][] = [];
      if (asset.mask !== undefined) masks.push([asset.mask, `${apath}.mask`]);
      if (asset.masks !== undefined) {
        if (!Array.isArray(asset.masks)) error('mask', `${apath}.masks`, 'masks は配列');
        else asset.masks.forEach((mk: unknown, mi) => masks.push([mk, `${apath}.masks[${mi}]`]));
      }
      for (const [mask, mpath] of masks) {
        if (!isObject(mask)) {
          error('mask', mpath, 'Mask がオブジェクトではない');
          continue;
        }
        validateFile(mask.file, `${mpath}.file`, error);
        if (!isObject(mask.channels)) {
          error('mask-channels', `${mpath}.channels`, 'channels は必須');
          continue;
        }
        for (const [channel, slotId] of Object.entries(mask.channels)) {
          if (channel !== 'r' && channel !== 'g' && channel !== 'b') {
            // A チャンネルは v1 では使用しない（§4.3）。未知のキーとして無視し、警告だけ出す。
            warn('mask-channel-unknown', `${mpath}.channels.${channel}`, `v1 で使えるチャンネルは r / g / b のみ（${channel} は無視）`);
          } else if (typeof slotId !== 'string' || !slotIds.has(slotId)) {
            error('mask-channel-slot', `${mpath}.channels.${channel}`, `宣言されていない ColorSlot: ${String(slotId)}`);
          }
        }
      }
    });

    // 重複の禁止（§6.5、T7・T8・T10）
    for (let i = 0; i < validWhens.length; i++) {
      for (let j = i + 1; j < validWhens.length; j++) {
        const a = validWhens[i]!;
        const b = validWhens[j]!;
        if (whenOverlaps(a.when, b.when)) {
          error('when-overlap', `${lpath}.assets[${b.index}].when`, `assets[${a.index}] と具体度が等しく、同じ Context に同時に一致しうる`);
        }
      }
    }
  });

  return done();
}

type Report = (code: string, path: string, message: string) => void;

function validateWhen(when: unknown, path: string, error: Report): boolean {
  if (!isObject(when)) {
    error('when', path, 'when は必須');
    return false;
  }
  let ok = true;
  if (when.view === undefined) {
    error('when-view', `${path}.view`, 'when.view は省略不可');
    ok = false;
  }
  for (const key of ['view', 'body', 'pose', 'state', 'attach'] as const) {
    if (when[key] !== undefined && !isStringOrStrings(when[key])) {
      error('when-value', `${path}.${key}`, `${key} は文字列または文字列の配列（1 個以上）`);
      ok = false;
    }
  }
  if (when.fit !== undefined) {
    if (!isObject(when.fit) || !Object.values(when.fit).every(isStringOrStrings)) {
      error('when-value', `${path}.fit`, 'fit は {次元: 値または配列}');
      ok = false;
    }
  }
  return ok;
}

function validateFile(file: unknown, path: string, error: Report): void {
  if (!isNonEmptyString(file)) error('file', path, 'file は必須');
  else if (!isSafePath(file)) error('file-path', path, `相対パス以外、または ".." を含むパスは不可: ${file}`);
  else if (!ALLOWED_IMAGE_EXT.test(file)) error('file-ext', path, `画像は .png または .svg: ${file}`);
}

export interface ImageSize {
  width: number;
  height: number;
}

/**
 * 画像の寸法に関する検証（§4.2、§4.3、§12 の 4）。
 * 画像を読まないと分からないので、manifest の検証とは分けてある。
 * `sizes` は manifest が参照するファイル → 寸法。
 */
export function validateImageGeometry(
  part: PartManifest,
  sizes: ReadonlyMap<string, ImageSize>,
  canvas: ImageSize,
): Issue[] {
  const issues: Issue[] = [];
  const error = (code: string, path: string, message: string) =>
    issues.push({ level: 'error', code, path, message });

  part.layers.forEach((layer, li) => {
    layer.assets.forEach((asset: Asset, ai) => {
      const path = `layers[${li}].assets[${ai}]`;
      const size = sizes.get(asset.file);
      if (!size) return error('file-missing', `${path}.file`, `参照されたファイルがない: ${asset.file}`);
      const [ox, oy] = asset.offset ?? [0, 0];
      if (ox + size.width > canvas.width || oy + size.height > canvas.height) {
        error('out-of-canvas', path, `配置後にキャンバスからはみ出す: ${asset.file}`);
      }
      for (const mask of masksOf(asset)) {
        const msize = sizes.get(mask.file);
        if (!msize) error('file-missing', `${path}.mask`, `参照されたファイルがない: ${mask.file}`);
        else if (msize.width !== size.width || msize.height !== size.height) {
          error('mask-size', `${path}.mask`, `Mask と Asset のサイズが一致しない: ${mask.file}`);
        }
      }
    });
  });
  return issues;
}
