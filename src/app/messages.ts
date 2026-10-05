// 内部の状態やコードを、利用者向けの文にする。
// 「UNRESOLVED」「INVALID」「Layer」「Instance」などの内部の語は、ここで作る文には出さない。
// 対応する文のないコードは、内部の文をそのまま出す（情報を隠さない）。

import type { Character, Issue } from '../core/index.ts';
import { bodyInstance, isMultiCategory } from '../core/index.ts';
import { REQUIRED_CATEGORIES } from './catalog.ts';
import { label } from './labels.ts';
import type { CardState, Catalog, Inspection } from './session.ts';

export type NoticeAction = { kind: 'unequip'; label: string; instanceId: string } | { kind: 'reset-view'; label: string };

export interface Notice {
  key: string;
  text: string;
  /** 補足（小さく表示する）。 */
  note?: string;
  /** その場でできる直し方。 */
  action?: NoticeAction;
  /** 検証器などの細かい内容。詳細設定を開いているときだけ見せる。 */
  detail?: string;
}

/** 一覧のカードが選べない理由。 */
export function cardProblemText(card: CardState): string | undefined {
  if (!card.problem) return undefined;
  if (card.problem.requiresCategory) return `「${label('category', card.problem.requiresCategory)}」が必要`;
  return card.problem.status === 'conflict' ? '一緒に使えない組み合わせ' : 'いまの向き・ポーズには未対応';
}

/** いまのキャラクターについて、利用者に知らせること。何もなければ空。 */
export function buildNotices(character: Character, catalog: Catalog, view: Inspection): Notice[] {
  const notices: Notice[] = [];
  const nameOf = (partId: string) => catalog.library.get(partId)?.name ?? partId;
  const bodyId = character.appearance.body;
  // 「外す」を出せるのは、なくせる分類のパーツだけ。
  const removable = (instanceId: string, partId: string) => {
    const category = catalog.library.get(partId)?.category;
    return instanceId !== bodyId && !(category !== undefined && REQUIRED_CATEGORIES.has(category));
  };
  const nothingToDraw = view.export.allowed === false && view.export.reason === 'nothing-to-draw';

  if (view.export.allowed === false && view.export.reason === 'pose-unknown') {
    notices.push({
      key: 'pose-unknown',
      text: 'このキャラクターは、この版の InvestiMaker が知らないポーズを使っています。',
      note: 'この版では表示と画像の書き出しができません。編集と保存はできます。',
      detail: view.evaluation.issues.filter((i) => i.code === 'pose-unknown').map((i) => i.message).join(' / '),
    });
  }

  // 見つからない素材。名前が分からないので、この場面でだけ素材の ID を出す。
  for (const inst of view.evaluation.missing) {
    if (!inst.equipped) continue;
    notices.push({
      key: `missing:${inst.instanceId}`,
      text: `見つからない素材があります：${inst.partId}`,
      note: 'この素材は表示されません。色や位置の設定は保存データに残り、素材を入れると元に戻ります。',
      ...(inst.instanceId === bodyId ? {} : { action: { kind: 'unequip' as const, label: '外す', instanceId: inst.instanceId } }),
    });
  }

  for (const issue of view.evaluation.issues) {
    if (issue.code === 'view-unknown') notices.push({ key: issue.code, text: 'この版の InvestiMaker が知らない向きが選ばれています。', detail: issue.message });
    else if (issue.code === 'fit-unknown') notices.push({ key: `${issue.code}:${issue.message}`, text: 'この素体にない体型が指定されています。', detail: issue.message });
    else if (issue.code === 'body-kind') notices.push({ key: issue.code, text: '素体として使えない素材が、素体に指定されています。', detail: issue.message });
    else if (issue.code === 'category-duplicate' && issue.category) {
      notices.push({ key: `duplicate:${issue.category}`, text: `「${label('category', issue.category)}」に複数のパーツが付いています。`, note: 'どちらも表示しています。別のパーツを選び直すと 1 つになります。', detail: issue.message });
    }
  }

  // 装備しているが、いまの状態では表示できない・一緒に使えないパーツ。勝手には外さない。
  // 何も表示できないときは、パーツごとに並べず、下の 1 件にまとめる。
  for (const problem of nothingToDraw ? [] : view.problems) {
    const text = problem.status === 'conflict' ? `${nameOf(problem.partId)}：一緒に使えない組み合わせがあります。` : `${nameOf(problem.partId)}：いまの向き・ポーズでは表示できません。`;
    notices.push({
      key: `problem:${problem.instanceId}`,
      text,
      note: problem.drawn ? '表示はしています。' : '向きやポーズを変えると表示されます。',
      detail: problem.reasons.join(' / '),
      ...(removable(problem.instanceId, problem.partId) ? { action: { kind: 'unequip' as const, label: '外す', instanceId: problem.instanceId } } : {}),
    });
  }

  if (nothingToDraw) {
    const body = catalog.library.get(bodyInstance(character).partId);
    const canReset = body?.kind === 'body' && body.views.includes('front') && character.state.view !== 'front';
    notices.push({
      key: 'nothing-to-draw',
      text: '表示できる素材がありません。',
      note: canReset ? `選んでいる向き「${label('view', character.state.view)}」に対応した素材がありません。` : '表示できるパーツを選んでください。',
      ...(canReset ? { action: { kind: 'reset-view' as const, label: '向きを正面に戻す' } } : {}),
    });
  }
  return notices;
}

/** 画像を書き出せない理由（書き出せるなら null）。 */
export function exportBlockText(view: Inspection): string | null {
  if (view.export.allowed) return null;
  return view.export.reason === 'pose-unknown' ? 'この版の InvestiMaker が知らないポーズを使っているため、画像を書き出せません。' : '表示できる素材がないため、画像を書き出せません。';
}

/** 読み込めなかったファイルについての文。細かい内容は `detail` に分ける。 */
export function loadErrorText(errors: readonly Issue[]): { text: string; detail: string } {
  const codes = new Set(errors.map((e) => e.code));
  const detail = errors.map((e) => `${e.path || '全体'}: ${e.message}`).join(' / ');
  if (codes.has('json-syntax') || codes.has('not-object') || codes.has('format')) {
    return { text: 'このファイルは読み込めません。壊れているか、InvestiMaker のキャラクターファイルではありません。', detail };
  }
  if (codes.has('format-version-unsupported')) return { text: 'このファイルは、新しい版の InvestiMaker で作られています。この版では読み込めません。', detail };
  if (codes.has('canvas') || codes.has('canvas-mismatch')) return { text: 'このファイルは、対応していない大きさのキャンバスで作られています。', detail };
  return { text: 'このファイルは読み込めません。内容が正しくありません。', detail };
}

/** 複数選べる分類の一覧に添える説明。 */
export function multiHint(category: string): string | null {
  return isMultiCategory(category) ? 'いくつでも付けられます。もう一度押すと外れます。' : null;
}
