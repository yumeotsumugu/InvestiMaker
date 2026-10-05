// Creator UI の操作（DOM 非依存）。
// 正本は Character 1 個だけである。ここにある関数は、Character から表示用の情報を求めるか、
// core の操作（operations.ts）を組み合わせて新しい Character を返すかのどちらかで、Character の写しを持たない。

import type { Body, Character, EquipmentInstance, Evaluation, Matrix, PartManifest, PartReport, RenderPlan, Transform, TransformCondition } from '../core/index.ts';
import {
  STANDARD_EXPRESSIONS,
  VIEWS,
  addInstance,
  bodyInstance,
  canRender,
  createCharacter,
  equipPart,
  evaluateCharacter,
  instanceColors,
  instanceMatrices,
  isMultiCategory,
  isNeutral,
  parseCharacter,
  planCharacter,
  sameCondition,
  serializeCharacter,
  setEquipped,
  setExpression,
  setTransform,
  setTransformOverride,
  stableStringify,
} from '../core/index.ts';
import type { Issue } from '../core/index.ts';
import { REQUIRED_CATEGORIES } from './catalog.ts';

/** 利用できる素材。 */
export interface Catalog {
  library: ReadonlyMap<string, PartManifest>;
  /** 素材セットの一覧の順（一覧に並べる順）。 */
  order: readonly string[];
  /** 新規キャラクターが最初に装備する Part。 */
  starter: readonly string[];
}

export type IdSource = () => string;

const partsOf = (catalog: Catalog): PartManifest[] => catalog.order.flatMap((id) => catalog.library.get(id) ?? []);

// ---------------------------------------------------------------- 新規作成

export function bodies(catalog: Catalog): Body[] {
  return partsOf(catalog).filter((p): p is Body => p.kind === 'body');
}

/**
 * 全体の色（共有色）の初期値を、装備している素材の既定色から作る。
 * 装備順にたどり、各 Part の ColorSlot を宣言の順に見て、キーごとに最初に見つかった既定色を採る。
 * 同じ装備なら、素材の読み込み順に関係なく同じ結果になる。UI は色の値を持たない。
 */
export function initialSharedColors(character: Character, library: ReadonlyMap<string, PartManifest>): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const inst of character.equipment) {
    if (!inst.equipped) continue;
    for (const slot of library.get(inst.partId)?.colorSlots ?? []) {
      if (slot.link !== undefined && colors[slot.link] === undefined && /^#[0-9a-fA-F]{6}$/.test(slot.default)) {
        colors[slot.link] = slot.default.toUpperCase();
      }
    }
  }
  return colors;
}

export interface SharedColorRow {
  key: string;
  /** いま使われている色（設定されていなければ、素材の既定色）。 */
  color: string;
}

/**
 * 「全体の色」として編集できる色の一覧：設定済みの共有色と、装備中のパーツが参照している共有色。
 * 後から装備したパーツが新しい共有色を参照していても、ここに出て編集できる（編集すると設定される）。
 */
export function sharedColorRows(character: Character, library: ReadonlyMap<string, PartManifest>): SharedColorRow[] {
  const defaults = initialSharedColors(character, library);
  const keys = [...new Set([...Object.keys(character.sharedColors), ...Object.keys(defaults)])];
  return keys.map((key) => ({ key, color: character.sharedColors[key] ?? defaults[key]! }));
}

export interface StartOptions {
  name: string;
  bodyId: string;
  /** 基本のパーツ（顔・髪・服）を付けて始めるか。 */
  withStarter: boolean;
}

/**
 * スタート画面で選ぶ「プリセット」。最初に装備するパーツの組であって、Character の属性ではない
 * （選んだセットは保存されない。保存されるのは、その結果として装備されたパーツだけである）。
 */
export interface Preset extends Omit<StartOptions, 'name'> {
  id: string;
}

/** 選べるセット：素体ごとに、基本のパーツを付けたものと、素体だけのもの。 */
export function presets(catalog: Catalog): Preset[] {
  const hasStarter = catalog.starter.some((id) => { const part = catalog.library.get(id); return part !== undefined && part.kind !== 'body'; });
  return bodies(catalog).flatMap((body) => [
    ...(hasStarter ? [{ id: `${body.id}:starter`, bodyId: body.id, withStarter: true }] : []),
    { id: `${body.id}:bare`, bodyId: body.id, withStarter: false },
  ]);
}

export function startCharacter(catalog: Catalog, newId: IdSource, options: StartOptions): Character {
  let character = createCharacter({ id: newId(), name: options.name, bodyPartId: options.bodyId, bodyInstanceId: newId() });
  if (options.withStarter) {
    for (const partId of catalog.starter) {
      const part = catalog.library.get(partId);
      if (part && part.kind !== 'body') character = addInstance(character, partId, newId());
    }
  }
  return { ...character, sharedColors: initialSharedColors(character, catalog.library) };
}

// ---------------------------------------------------------------- Part の選択

function equippedIn(character: Character, catalog: Catalog, category: string): EquipmentInstance[] {
  return character.equipment.filter((i) => i.equipped && catalog.library.get(i.partId)?.category === category);
}

export interface Choice {
  character: Character;
  /** 選んだ結果、装備中になった Instance（外した場合は null）。 */
  instanceId: string | null;
}

/**
 * カードを選ぶ。
 * - 1 つだけ選べる分類：同じ分類の装備中の Part を外してから装備する。選んであるカードを選び直しても外れない。
 * - 複数選べる分類：付ける／外すを切り替える。
 * 外した Part の Instance は残る（選び直すと、同じ Instance が同じ位置で戻る）。
 */
export function chooseCard(character: Character, catalog: Catalog, partId: string, newId: IdSource): Choice {
  const part = catalog.library.get(partId);
  if (!part) throw new Error(`Part が読み込まれていない: ${partId}`);
  if (part.kind === 'body') {
    // 素体の入れ替えは未対応。いまの素体を編集対象にするだけ。
    return { character, instanceId: bodyInstance(character).partId === partId ? character.appearance.body : null };
  }
  const mine = character.equipment.filter((i) => i.partId === partId && i.equipped);

  if (isMultiCategory(part.category)) {
    if (mine.length > 0) {
      for (const inst of mine) character = setEquipped(character, inst.instanceId, false);
      return { character, instanceId: null };
    }
  } else {
    for (const inst of equippedIn(character, catalog, part.category)) {
      if (inst.partId !== partId) character = setEquipped(character, inst.instanceId, false);
    }
    if (mine.length > 0) return { character, instanceId: mine.at(-1)!.instanceId };
  }
  character = equipPart(character, partId, newId());
  return { character, instanceId: character.equipment.findLast((i) => i.partId === partId && i.equipped)!.instanceId };
}

/** 「なし」を選ぶ。その分類の装備中の Part をすべて外す。なくせない分類では何もしない。 */
export function chooseNone(character: Character, catalog: Catalog, category: string): Character {
  if (REQUIRED_CATEGORIES.has(category)) return character;
  for (const inst of equippedIn(character, catalog, category)) character = setEquipped(character, inst.instanceId, false);
  return character;
}

export interface CardState {
  partId: string;
  name: string;
  /** 装備中か。 */
  selected: boolean;
  /** 装備中の Instance（編集対象にするときに使う）。 */
  instanceId: string | null;
  /** 選べるか。装備中のものは常に true。 */
  available: boolean;
  /** 選べない理由の種別と、必要な分類（あれば）。文にするのは messages.ts。 */
  problem?: { status: 'unsupported' | 'conflict'; requiresCategory?: string };
}

const CANDIDATE_ID = '00000000-0000-4000-8000-00000000c0de';

/**
 * 一覧のカードの状態。まだ装備していない Part は、「それを選んだと仮定した Character」を作り、
 * core の評価と描画計画で、対応・非対応・競合を判定する。UI 独自の互換性判定は持たない。
 * 現在の Character には一切触れない（副作用のない純粋な判定）。
 */
export function cardStates(character: Character, catalog: Catalog, category: string): CardState[] {
  return partsOf(catalog)
    .filter((p) => p.category === category)
    .map((part): CardState => {
      const mine = character.equipment.findLast((i) => i.partId === part.id && i.equipped);
      const base = { partId: part.id, name: part.name };
      if (mine) return { ...base, selected: true, instanceId: mine.instanceId, available: true };
      if (part.kind === 'body') return { ...base, selected: false, instanceId: null, available: false };

      const candidate = chooseCard(character, catalog, part.id, () => CANDIDATE_ID);
      const evaluation = evaluateCharacter(candidate.character, { library: catalog.library });
      // 描画順が決まらない状態（知らないポーズ）では判定できないので、選べるものとして扱う。
      if (!canRender(evaluation)) return { ...base, selected: false, instanceId: null, available: true };
      const report = planCharacter(candidate.character, catalog.library).parts.find((p) => p.instanceId === candidate.instanceId);
      if (!report || report.status === 'ok') return { ...base, selected: false, instanceId: null, available: true };
      const requires = part.requires?.find((c) => c.type === 'category' && !candidate.character.equipment.some((i) => i.equipped && i.partId !== part.id && catalog.library.get(i.partId)?.category === c.category));
      return {
        ...base,
        selected: false,
        instanceId: null,
        available: false,
        problem: { status: report.status === 'conflict' ? 'conflict' : 'unsupported', ...(requires?.type === 'category' ? { requiresCategory: requires.category } : {}) },
      };
    });
}

/** その分類で「なし」を選んでいる状態か。 */
export function noneSelected(character: Character, catalog: Catalog, category: string): boolean {
  return equippedIn(character, catalog, category).length === 0;
}

/** 外しているパーツの Instance（設定を保持しているもの）。詳細設定で一覧し、削除できる。 */
export function keptInstances(character: Character): EquipmentInstance[] {
  return character.equipment.filter((i) => !i.equipped);
}

// ---------------------------------------------------------------- 表情・向き

/** 標準表情を選ぶ。3 つの状態をまとめて設定する（保存されるのは状態だけ）。 */
export function applyExpressionPreset(character: Character, presetId: string): Character {
  const preset = STANDARD_EXPRESSIONS.find((e) => e.id === presetId);
  return preset ? setExpression(character, { eyes: preset.eyes, eyebrows: preset.eyebrows, mouth: preset.mouth }) : character;
}

export interface ViewChoice {
  id: string;
  selected: boolean;
  /** 素体がその向きの素材を持つか。 */
  available: boolean;
}

/** 向きの選択肢。素体の manifest の `views` にない向きは選べない。 */
export function viewChoices(character: Character, catalog: Catalog): ViewChoice[] {
  const body = catalog.library.get(bodyInstance(character).partId);
  const supported = body?.kind === 'body' ? body.views : [];
  const current = character.state.view;
  const ids: string[] = [...VIEWS];
  if (!ids.includes(current)) ids.push(current); // 読み込んだキャラクターが持つ、知らない向きも消さずに出す
  return ids.map((id) => ({ id, selected: id === current, available: supported.includes(id) }));
}

// ---------------------------------------------------------------- 配置補正

/** 配置補正を「いつ使うか」。 */
export type Scope = 'always' | 'arm.right' | 'full';

export function scopeCondition(scope: Scope, state: Character['state']): TransformCondition | null {
  if (scope === 'always') return null;
  if (scope === 'arm.right') return { pose: { 'arm.right': state.pose['arm.right']! } };
  return { view: state.view, pose: { ...state.pose } };
}

/** その範囲に保存されている補正（なければ undefined）。 */
export function storedTransform(inst: EquipmentInstance, scope: Scope, state: Character['state']): Transform | undefined {
  const when = scopeCondition(scope, state);
  if (!when) return inst.transform;
  return inst.overrides?.transform?.find((e) => sameCondition(e.when, when))?.transform;
}

export type Point = [number, number];

/**
 * 補正の値を変える。
 * - 条件つきの補正を初めて作るときは、基本の補正の値を写して始める（作った瞬間に見た目が変わらない）。
 * - 補正を初めて作るとき、中心（pivot）が決まっていなければ「パーツの中心」を書く。
 *   すでに pivot を持つ補正の pivot は、ここでは書き換えない。
 */
export function editTransform(character: Character, instanceId: string, scope: Scope, patch: Partial<Transform>, partCenter: Point | null): Character {
  const inst = character.equipment.find((i) => i.instanceId === instanceId);
  if (!inst) throw new Error(`Equipment Instance がない: ${instanceId}`);
  const when = scopeCondition(scope, character.state);
  const stored = storedTransform(inst, scope, character.state);
  const next: Transform = { ...(stored ?? (when ? inst.transform : undefined)), ...patch };
  if (!stored && next.pivot === undefined && partCenter) next.pivot = partCenter;
  return when ? setTransformOverride(character, instanceId, when, next) : setTransform(character, instanceId, next);
}

/** その範囲の補正を消す（「元に戻す」）。 */
export function clearTransform(character: Character, instanceId: string, scope: Scope): Character {
  const when = scopeCondition(scope, character.state);
  return when ? setTransformOverride(character, instanceId, when, undefined) : setTransform(character, instanceId, undefined);
}

export type PivotMode = 'part' | 'canvas' | 'custom';

/** 保存されている pivot が、どの選び方に当たるか（UI は選び方を別に記憶しない）。 */
export function pivotMode(transform: Transform | undefined, partCenter: Point | null): PivotMode {
  const pivot = transform?.pivot;
  if (!pivot) return 'canvas';
  return partCenter && pivot[0] === partCenter[0] && pivot[1] === partCenter[1] ? 'part' : 'custom';
}

/** 中心を選び直す。「キャンバスの中心」は pivot を書かないことで表す（Asset Specification §9 の既定値）。 */
export function setPivot(character: Character, instanceId: string, scope: Scope, pivot: Point | null): Character {
  const inst = character.equipment.find((i) => i.instanceId === instanceId);
  if (!inst) throw new Error(`Equipment Instance がない: ${instanceId}`);
  const when = scopeCondition(scope, character.state);
  const { pivot: _old, ...rest } = storedTransform(inst, scope, character.state) ?? (when ? inst.transform : undefined) ?? {};
  const next: Transform = pivot ? { ...rest, pivot } : rest;
  // 何も補正がなく pivot も書かないなら、補正そのものを持たない。
  const value = !pivot && isNeutral(next) ? undefined : next;
  return when ? setTransformOverride(character, instanceId, when, value) : setTransform(character, instanceId, value);
}

/** 画像の中の、透明でない画素の外接矩形（画像の左上が原点。x1・y1 は端の外側）。 */
export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * 「パーツの中心」：その Part について現在描画の対象になっている Layer 群の、
 * 透明でない画素の外接矩形の中心（キャンバスの座標、整数に丸める）。
 * `bounds` は、画像ごとの透明でない画素の範囲を返す（画素を調べるのはブラウザ側の仕事）。
 */
export function partCenter(plan: RenderPlan, instanceId: string, bounds: (partId: string, file: string) => Bounds | null): Point | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const entry of plan.entries) {
    if (entry.instanceId !== instanceId || entry.status !== 'draw' || !entry.asset) continue;
    const b = bounds(entry.partId, entry.asset.file);
    if (!b) continue;
    const [ox, oy] = entry.asset.offset ?? [0, 0];
    x0 = Math.min(x0, ox + b.x0);
    y0 = Math.min(y0, oy + b.y0);
    x1 = Math.max(x1, ox + b.x1);
    y1 = Math.max(y1, oy + b.y1);
  }
  return x1 > x0 ? [Math.round((x0 + x1) / 2), Math.round((y0 + y1) / 2)] : null;
}

// ---------------------------------------------------------------- 保存・読込

/** 保存していない変更があるかを調べるための、Character の写し（比較用の文字列）。 */
export function snapshotOf(character: Character): string {
  return stableStringify(serializeCharacter(character));
}

export function isDirty(character: Character, savedSnapshot: string | null): boolean {
  return savedSnapshot === null || snapshotOf(character) !== savedSnapshot;
}

export type LoadOutcome = { loaded: true; character: Character; warnings: Issue[] } | { loaded: false; errors: Issue[] };

/** 保存 JSON を読む。読み込めないときは Character を返さない（呼び出し側は現在の Character をそのまま使う）。 */
export function loadCharacterText(text: string): LoadOutcome {
  const result = parseCharacter(text);
  return result.ok ? { loaded: true, character: result.character, warnings: result.warnings } : { loaded: false, errors: result.errors };
}

// ---------------------------------------------------------------- 評価と描画

export interface Inspection {
  evaluation: Evaluation;
  /** 描画順が決まらないとき（実装が知らないポーズを含むとき）は null。 */
  plan: RenderPlan | null;
  colors: Record<string, Record<string, string>>;
  matrices: Record<string, Matrix>;
  /** 描画される Layer の枚数。 */
  drawn: number;
  /** 装備しているが、表示できない・一緒に使えない Part。 */
  problems: PartReport[];
  /** PNG を書き出せるか。書き出せないときは理由の種別。 */
  export: { allowed: true } | { allowed: false; reason: 'pose-unknown' | 'nothing-to-draw' };
}

export function inspect(character: Character, catalog: Catalog): Inspection {
  const evaluation = evaluateCharacter(character, { library: catalog.library });
  if (!canRender(evaluation)) {
    return { evaluation, plan: null, colors: {}, matrices: {}, drawn: 0, problems: [], export: { allowed: false, reason: 'pose-unknown' } };
  }
  const plan = planCharacter(character, catalog.library);
  const drawn = plan.entries.filter((e) => e.status === 'draw').length;
  return {
    evaluation,
    plan,
    colors: instanceColors(character, catalog.library),
    matrices: instanceMatrices(character, catalog.library),
    drawn,
    problems: plan.parts.filter((p) => p.status === 'unsupported' || p.status === 'conflict'),
    export: drawn > 0 ? { allowed: true } : { allowed: false, reason: 'nothing-to-draw' },
  };
}
