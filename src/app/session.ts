// 本体 UI の状態と操作（DOM 非依存）。
// 正本は Character 1 個だけで、ここにあるのは「どの Instance を選択しているか」という表示上の状態だけである。
// Character の編集は core の operations.ts を通し、評価と描画計画も core に任せる。

import type { Character, Evaluation, Matrix, PartManifest, RenderPlan } from '../core/index.ts';
import {
  addInstance,
  canRender,
  createCharacter,
  equipPart,
  evaluateCharacter,
  instanceColors,
  instanceMatrices,
  isMultiCategory,
  parseCharacter,
  planCharacter,
  removeInstance,
  setEquipped,
} from '../core/index.ts';
import type { Issue } from '../core/index.ts';

/** 利用できる素材。 */
export interface Catalog {
  library: ReadonlyMap<string, PartManifest>;
  /** 新規キャラクターの素体。 */
  body: string;
  /** 新規キャラクターが最初に装備する Part。 */
  starter: readonly string[];
}

export interface Session {
  character: Character;
  /** 色と配置補正の編集対象にしている Equipment Instance。 */
  selected: string | null;
}

export type IdSource = () => string;

/** 新規作成。素体と、素材セットが指定する最初の Part を装備する。 */
export function newSession(catalog: Catalog, newId: IdSource, name = '新しいキャラクター'): Session {
  let character = createCharacter({ id: newId(), name, bodyPartId: catalog.body, bodyInstanceId: newId() });
  for (const partId of catalog.starter) {
    if (partId !== catalog.body) character = addInstance(character, partId, newId());
  }
  return { character, selected: null };
}

export function edit(session: Session, operation: (character: Character) => Character): Session {
  return { ...session, character: operation(session.character) };
}

/**
 * Part を選ぶ。
 * - 複数装備できる category：新しい Instance を追加する。
 * - 1 Part だけの category：同じ category の装備中の Part を外してから装備する。
 *   外した Part の Instance は残る（色などの設定を保つ）。
 */
export function choosePart(session: Session, catalog: Catalog, partId: string, newId: IdSource): Session {
  const part = catalog.library.get(partId);
  if (!part) throw new Error(`Part が読み込まれていない: ${partId}`);
  if (part.kind === 'body') throw new Error('素体の入れ替えは未対応');

  let character = session.character;
  if (isMultiCategory(part.category)) {
    const instanceId = newId();
    return { character: addInstance(character, partId, instanceId), selected: instanceId };
  }

  for (const inst of character.equipment) {
    const other = catalog.library.get(inst.partId);
    if (inst.equipped && inst.partId !== partId && other?.category === part.category) {
      character = setEquipped(character, inst.instanceId, false);
    }
  }
  if (!character.equipment.some((i) => i.partId === partId && i.equipped)) {
    character = equipPart(character, partId, newId());
  }
  const selected = character.equipment.findLast((i) => i.partId === partId && i.equipped)!.instanceId;
  return { character, selected };
}

/** 外す。Instance は残る。 */
export function unequip(session: Session, instanceId: string): Session {
  return edit(session, (c) => setEquipped(c, instanceId, false));
}

/** Instance を完全に削除する（設定も失われる）。 */
export function deleteInstance(session: Session, instanceId: string): Session {
  return { character: removeInstance(session.character, instanceId), selected: session.selected === instanceId ? null : session.selected };
}

export type LoadOutcome =
  | { loaded: true; session: Session; warnings: Issue[] }
  | { loaded: false; session: Session; errors: Issue[] };

/**
 * 保存 JSON を読み込む。INVALID なら現在のキャラクターをそのまま返す（置き換えない）。
 * Part が不足していても読み込む（UNRESOLVED は読み込める）。
 */
export function loadCharacterText(session: Session, text: string): LoadOutcome {
  const result = parseCharacter(text);
  if (!result.ok) return { loaded: false, session, errors: result.errors };
  return { loaded: true, session: { character: result.character, selected: null }, warnings: result.warnings };
}

export interface Inspection {
  evaluation: Evaluation;
  /** 描画順が決まらないとき（実装が知らないポーズを含むとき）は null。 */
  plan: RenderPlan | null;
  colors: Record<string, Record<string, string>>;
  matrices: Record<string, Matrix>;
  export: {
    /** PNG を書き出せるか。 */
    allowed: boolean;
    /** 書き出せない理由。 */
    reason?: string;
    /** 書き出せるが、知らせておくこと（不足・非対応・競合の Part など）。 */
    warnings: string[];
  };
}

/** 現在のキャラクターを評価し、描画に必要なものを揃える。 */
export function inspect(character: Character, catalog: Catalog): Inspection {
  const evaluation = evaluateCharacter(character, { library: catalog.library });
  if (!canRender(evaluation)) {
    const reason = evaluation.issues.filter((i) => i.code === 'pose-unknown').map((i) => i.message).join(' / ');
    return { evaluation, plan: null, colors: {}, matrices: {}, export: { allowed: false, reason, warnings: [] } };
  }
  const plan = planCharacter(character, catalog.library);
  // 書き出しの事前条件：描画される Layer が 1 枚以上あること（Character の評価とは別の条件）。
  const drawn = plan.entries.filter((e) => e.status === 'draw').length;
  const warnings = [
    ...evaluation.issues.filter((i) => i.effect === 'unresolved' && i.code !== 'part-missing').map((i) => i.message),
    ...plan.parts.filter((p) => p.status !== 'ok').map((p) => `${p.partId}: ${p.reasons.join(' / ')}${p.drawn ? '（描画はする）' : '（描画されない）'}`),
  ];
  return {
    evaluation,
    plan,
    colors: instanceColors(character, catalog.library),
    matrices: instanceMatrices(character, catalog.library),
    export: drawn > 0 ? { allowed: true, warnings } : { allowed: false, reason: '描画できる Layer がありません', warnings },
  };
}
