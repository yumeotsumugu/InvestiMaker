// InvestiMaker の Creator UI（Phase 1-C-2）。素の DOM だけで書く。
//
// 正本は Character 1 個。画面は Character と、下の `ui`（保存しない表示上の状態）から描く。
// DOM event → Character の操作（core/operations、app/session）→ 評価 → 描画計画 → 描画 の一方向で動かす。
// 入力中の部品（色の選択など）を壊さないよう、領域ごとに描き直す。

import './style.css';
import type { Character, EquipmentInstance, PartManifest, Transform } from '../core/index.ts';
import {
  POSE_DEFINITIONS,
  STANDARD_EXPRESSIONS,
  STANDARD_STATES,
  bodyInstance,
  expressionPresetOf,
  isMultiCategory,
  relinkColor,
  removeInstance,
  rename,
  resolveSlotColor,
  setEquipped,
  setExpression,
  setFit,
  setInstanceColor,
  setPose,
  setSharedColor,
  setView,
  stringifyCharacter,
  unlinkColor,
} from '../core/index.ts';
import { Composer } from '../web/composer.ts';
import type { AssetSet } from '../web/loader.ts';
import { loadSet } from '../web/loader.ts';
import type { MajorView } from './catalog.ts';
import { REQUIRED_CATEGORIES, visibleMajors } from './catalog.ts';
import { label } from './labels.ts';
import type { Notice } from './messages.ts';
import { buildNotices, cardProblemText, exportBlockText, loadErrorText, multiHint } from './messages.ts';
import type { Inspection, Point, Scope } from './session.ts';
import {
  applyExpressionPreset,
  bodies,
  cardStates,
  chooseCard,
  chooseNone,
  clearTransform,
  editTransform,
  inspect,
  isDirty,
  keptInstances,
  loadCharacterText,
  noneSelected,
  partCenter,
  pivotMode,
  setPivot,
  sharedColorRows,
  snapshotOf,
  startCharacter,
  storedTransform,
  viewChoices,
} from './session.ts';

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(tagName: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = Object.assign(document.createElement(tagName), props);
  el.append(...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false));
  return el;
}
function fill(el: HTMLElement, ...children: Child[]) {
  el.replaceChildren(...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false));
}
/** 自動操作（スモークテスト）が要素を特定するための属性を付ける。 */
function mark<T extends HTMLElement>(el: T, data: Record<string, string>): T {
  // 名前に「.」や「-」を含むもの（pose-arm.right など）があるので、dataset ではなく属性として付ける。
  for (const [key, value] of Object.entries(data)) el.setAttribute(`data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, value);
  return el;
}
function download(blob: Blob, name: string) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  a.click();
  URL.revokeObjectURL(a.href);
}
const newId = () => crypto.randomUUID();

type Step = 'create' | 'customize' | 'export';
type Target = { kind: 'instance'; instanceId: string } | { kind: 'expression' } | { kind: 'pose' } | null;

/** 保存しない表示上の状態（設計書 §14）。Character に入るものはここに置かない。 */
interface UiState {
  step: Step;
  major: string;
  /** 大分類ごとに、開いている小分類。 */
  sub: Record<string, string>;
  target: Target;
  advancedOpen: boolean;
  scope: Scope;
  /** 最後に保存・読込した時点の Character（比較用）。null は一度も保存していない。 */
  savedSnapshot: string | null;
  recentColors: string[];
  message: { kind: 'info' | 'error'; text: string; detail?: string } | null;
  /** CREATE の入力中の値。 */
  draft: { name: string; bodyId: string; withStarter: boolean };
  /** 「設定」で選ぶ：詳細設定を常に開く。 */
  alwaysAdvanced: boolean;
  /** 【検証用】「注意 n 件」から開く方式で、一覧を開いているか。 */
  noticesOpen: boolean;
}

async function main() {
  const root = document.querySelector<HTMLDivElement>('#app')!;
  let set: AssetSet;
  try {
    set = await loadSet('development');
  } catch (e) {
    root.append(h('p', { className: 'fatal' }, `素材を読み込めません: ${String(e)}`));
    return;
  }
  const majors: MajorView[] = visibleMajors(set.library);
  const firstBody = bodies(set)[0]?.id ?? set.body;
  const thumbUrl = (partId: string) => `${set.baseUrl}${partId}/preview.png`;

  // 【Phase 1-C-3 の検証用】通知の置き場所を URL で切り替える。置き場所が決まったら、採用した案だけを残して消す。
  //   ?notices=under（現状：プレビューの下）／ side（右ペインの上）／ overlay（プレビューに重ねる）／ chip（「注意 n 件」から開く）
  type NoticeMode = 'under' | 'side' | 'overlay' | 'chip';
  const requested = new URLSearchParams(location.search).get('notices');
  const noticeMode: NoticeMode = requested === 'side' || requested === 'overlay' || requested === 'chip' ? requested : 'under';

  /** 編集中のキャラクター。CREATE で始めるまでは null。 */
  let character: Character | null = null;
  let view: Inspection | null = null;
  let notices: Notice[] = [];
  const ui: UiState = {
    step: 'create',
    major: majors.some((m) => m.major.id === 'hair') ? 'hair' : majors[0]!.major.id,
    sub: {},
    target: null,
    advancedOpen: false,
    scope: 'always',
    savedSnapshot: null,
    recentColors: [],
    message: null,
    draft: { name: '', bodyId: firstBody, withStarter: true },
    alwaysAdvanced: false,
    noticesOpen: false,
  };
  const hooks = { lastSaved: null as string | null, lastPng: null as string | null };

  const canvas = mark(h('canvas', { className: 'canvas' }), { role: 'preview' });
  const composer = new Composer(set, canvas);
  const header = h('header', { className: 'hd' });
  const body = h('div', { className: 'body' });
  const stepBar = h('nav', { className: 'steps' });
  const modalHost = h('div');
  root.append(h('div', { className: 'frame' }, header, body, stepBar), modalHost);

  // 段ごとに並べ替える領域。中身は領域ごとに描き直す。
  const railEl = h('div', { className: 'pane rail' });
  const pickerEl = h('div', { className: 'pane picker' });
  const emptyEl = mark(h('div', { className: 'canvas-empty' }), { role: 'empty' });
  const underEl = h('div', { className: 'under' });
  const overlayEl = mark(h('div', { className: 'notice-overlay' }), { role: 'notice-overlay' });
  const previewEl = h('div', { className: 'pane preview' }, h('div', { className: 'canvas-wrap' }, canvas, emptyEl, overlayEl), underEl);
  const popoverEl = mark(h('div', { className: 'notice-popover' }), { role: 'notice-popover' });
  root.dataset.notices = noticeMode;
  const editEl = h('div', { className: 'pane edit' });
  const sideEl = h('div', { className: 'pane side' });

  // ---------------------------------------------------------------- 描画（プレビュー）

  let running = false;
  let pending = false;
  let idle: Promise<void> = Promise.resolve();
  function paint(): Promise<void> {
    pending = true;
    if (!running) {
      running = true;
      idle = (async () => {
        while (pending) {
          pending = false;
          const current = view;
          try {
            await composer.render(current?.plan ?? { parts: [], entries: [] }, current?.colors ?? {}, undefined, current?.matrices ?? {});
          } catch (e) {
            ui.message = { kind: 'error', text: '表示中に問題が起きました。', detail: String(e) };
          }
        }
        running = false;
      })();
    }
    return idle;
  }

  // ---------------------------------------------------------------- 更新

  /** 作り直す範囲。入力中の部品を壊さないよう、必要な範囲だけにする。 */
  type Region = 'all' | 'picker' | 'edit' | 'status';

  function commit(next: Character, redraw: Region = 'all') {
    character = next;
    view = inspect(next, set);
    notices = buildNotices(next, set, view);
    render(redraw);
    void paint();
  }

  function apply(operation: (c: Character) => Character, redraw: Region = 'all') {
    if (!character) return;
    try {
      commit(operation(character), redraw);
    } catch (e) {
      ui.message = { kind: 'error', text: 'その操作はできません。', detail: String(e instanceof Error ? e.message : e) };
      render('all');
    }
  }

  function go(step: Step) {
    ui.step = step;
    ui.message = null;
    render('all');
  }

  function render(region: Region) {
    renderHeader();
    renderSteps();
    if (region === 'all') renderBody();
    else if (ui.step === 'customize') {
      if (region === 'picker') renderPicker();
      if (region === 'edit' || region === 'picker') renderEdit();
    } else if (ui.step === 'export') renderExportSide();
    renderUnder();
  }

  // ---------------------------------------------------------------- 部品

  function button(text: string, onClick: () => void, data: Record<string, string> = {}, options: { primary?: boolean; disabled?: boolean } = {}) {
    const el = mark(h('button', { type: 'button', className: `btn${options.primary ? ' primary' : ''}`, disabled: options.disabled ?? false }, text), data);
    el.addEventListener('click', onClick);
    return el;
  }

  /** 名前のボタンの並び（1 つを選ぶ）。 */
  function choices(options: readonly (readonly [value: string, text: string])[], value: string | null, onPick: (value: string) => void, dataKey: string) {
    return h('div', { className: 'tabs' }, ...options.map(([v, text]) => {
      const el = mark(h('button', { type: 'button', className: `tab${v === value ? ' on' : ''}` }, text), { [dataKey]: v, selected: String(v === value) });
      el.addEventListener('click', () => onPick(v));
      return el;
    }));
  }

  /** 色の入力。ドラッグ中は画面を作り直さずに反映し、確定したときに描き直す。 */
  function colorField(value: string, onColor: (color: string, done: boolean) => void, data: Record<string, string>) {
    const picker = mark(h('input', { type: 'color', value: value.toLowerCase(), className: 'swatch' }), data);
    const text = h('input', { type: 'text', value: value.toUpperCase(), className: 'hex', maxLength: 7 });
    picker.addEventListener('input', () => {
      text.value = picker.value.toUpperCase();
      onColor(picker.value, false);
    });
    picker.addEventListener('change', () => {
      remember(picker.value);
      onColor(picker.value, true);
    });
    text.addEventListener('change', () => {
      if (!/^#[0-9a-fA-F]{6}$/.test(text.value)) {
        text.value = picker.value.toUpperCase();
        return;
      }
      remember(text.value);
      onColor(text.value, true);
    });
    return h('span', { className: 'color-field' }, picker, text);
  }

  /** 最近使った色。押すと、その欄の色として適用する（新しい色の管理は持たない。UI の一時的な記憶を使うだけ）。 */
  function recentChips(current: string, onColor: (color: string, done: boolean) => void, slotKey: string) {
    const others = ui.recentColors.filter((color) => color !== current.toUpperCase());
    if (others.length === 0) return null;
    return h('div', { className: 'row recent' }, h('span', { className: 'muted small' }, '最近使った色'), ...others.map((color) => {
      const chip = mark(h('button', { type: 'button', className: 'recent-color', title: color }), { recent: color, recentFor: slotKey });
      chip.style.background = color;
      chip.addEventListener('click', () => {
        remember(color);
        onColor(color, true);
      });
      return chip;
    }));
  }
  function remember(color: string) {
    ui.recentColors = [color.toUpperCase(), ...ui.recentColors.filter((c) => c !== color.toUpperCase())].slice(0, 6);
  }

  function modal(title: string, content: Child[], actions: HTMLButtonElement[]) {
    fill(modalHost, mark(h('div', { className: 'modal-back' }, h('div', { className: 'modal' }, h('h3', {}, title), ...content, h('div', { className: 'modal-actions' }, ...actions))), { role: 'modal' }));
  }
  const closeModal = () => fill(modalHost);

  /** 保存していない変更があれば確認してから続ける。 */
  function confirmDiscard(then: () => void) {
    if (!character || !isDirty(character, ui.savedSnapshot)) return then();
    modal('保存していない変更があります', [h('p', {}, 'いまのキャラクターの変更は保存されていません。続けると失われます。')], [
      button('やめる', closeModal, { action: 'confirm-cancel' }),
      button('保存せずに続ける', () => {
        closeModal();
        then();
      }, { action: 'confirm-discard' }, { primary: true }),
    ]);
  }

  // ---------------------------------------------------------------- ヘッダーと段

  const fileInput = mark(h('input', { type: 'file', accept: '.json,application/json', hidden: true }), { role: 'load-file' });
  fileInput.addEventListener('change', async () => {
    const chosen = fileInput.files?.[0];
    fileInput.value = '';
    if (!chosen) return;
    const outcome = loadCharacterText(await chosen.text());
    if (!outcome.loaded) {
      // 読み込めないファイル：いまのキャラクターはそのまま。
      ui.message = { kind: 'error', ...loadErrorText(outcome.errors) };
      render('all');
      return;
    }
    ui.savedSnapshot = snapshotOf(outcome.character);
    ui.target = null;
    ui.scope = 'always';
    ui.step = 'customize';
    ui.message = { kind: 'info', text: `「${outcome.character.name || '名前のないキャラクター'}」を読み込みました。` };
    commit(outcome.character);
  });

  function save() {
    if (!character) return;
    const text = stringifyCharacter(character);
    hooks.lastSaved = text;
    download(new Blob([text], { type: 'application/json' }), `${character.name || 'character'}.json`);
    ui.savedSnapshot = snapshotOf(character);
    ui.message = { kind: 'info', text: 'キャラクターを保存しました。' };
    render('status');
  }

  function openSettings() {
    const always = mark(h('input', { type: 'checkbox', checked: ui.alwaysAdvanced }), { setting: 'always-advanced' });
    always.addEventListener('change', () => {
      ui.alwaysAdvanced = always.checked;
      if (always.checked) ui.advancedOpen = true;
      render('all');
    });
    const kept = character ? keptInstances(character) : [];
    modal('設定', [
      h('label', { className: 'row' }, always, '詳細設定を常に開く'),
      mark(h('div', {},
        h('h4', {}, '外したパーツの設定'),
        kept.length === 0
          ? h('p', { className: 'muted small' }, '外したパーツの色や位置を覚えておき、選び直すと元に戻します。いま覚えている設定はありません。')
          : h('p', { className: 'muted small' }, '外したパーツの色や位置を覚えています。選び直すと元に戻ります。不要なら削除できます。'),
        ...kept.map((k) => h('div', { className: 'row' }, h('span', {}, set.library.get(k.partId)?.name ?? k.partId), h('span', { className: 'spacer' }),
          button('削除', () => {
            apply((x) => removeInstance(x, k.instanceId));
            openSettings();
          }, { action: 'forget', part: k.partId })))), { role: 'kept' }),
      h('p', { className: 'muted small' }, 'InvestiMaker Phase 1-C ／ Asset Specification v1 RC1 ／ Character Schema v1 RC1'),
      h('p', { className: 'muted small' }, 'この版で使えるのは、新規作成・カスタマイズ・1 枚の PNG の書き出しです。'),
    ], [button('閉じる', closeModal, { action: 'settings-close' }, { primary: true })]);
  }

  // 名前の欄は作り直さない（入力中に作り直すと、文字の入力が途切れるため）。
  const nameEl = mark(h('input', { type: 'text', className: 'name', maxLength: 200, placeholder: '（名前を入力）' }), { role: 'name' });
  nameEl.addEventListener('input', () => {
    if (!character) return;
    character = rename(character, nameEl.value);
    view = inspect(character, set);
  });

  function noticeChip(count: number) {
    const className = `chip${view && !view.export.allowed ? ' bad' : ''}`;
    if (noticeMode !== 'chip') return mark(h('span', { className }, `注意 ${count} 件`), { role: 'chip' });
    const el = mark(h('button', { type: 'button', className: `${className} chip-button` }, `注意 ${count} 件 ${ui.noticesOpen ? '▴' : '▾'}`), { role: 'chip' });
    el.addEventListener('click', () => {
      ui.noticesOpen = !ui.noticesOpen;
      render('status');
    });
    return el;
  }

  function renderHeader() {
    if (document.activeElement !== nameEl) nameEl.value = character?.name ?? '';
    nameEl.hidden = character === null;
    const count = notices.length;
    fill(header,
      h('span', { className: 'brand' }, 'InvestiMaker'),
      nameEl,
      count > 0 && noticeChip(count),
      h('span', { className: 'spacer' }),
      button('保存', save, { action: 'save' }, { disabled: !character }),
      button('読込', () => confirmDiscard(() => fileInput.click()), { action: 'load' }),
      button('設定', openSettings, { action: 'settings' }),
      fileInput,
      noticeMode === 'chip' && popoverEl,
    );
  }

  function renderSteps() {
    const item = (step: string, enabled: boolean, soon = false) => {
      const el = mark(h('button', { type: 'button', className: `step${ui.step === step ? ' on' : ''}`, disabled: !enabled }, label('step', step), soon && h('small', {}, '準備中')), { step });
      if (enabled) el.addEventListener('click', () => go(step as Step));
      return el;
    };
    fill(stepBar, item('create', true), item('customize', character !== null), item('variant', false, true), item('portrait', false, true), item('export', character !== null));
  }

  // ---------------------------------------------------------------- 本体

  function renderBody() {
    if (ui.alwaysAdvanced) ui.advancedOpen = true;
    body.className = `body step-${ui.step}`;
    if (ui.step === 'create') {
      fill(body, renderCreate(), previewEl);
    } else if (ui.step === 'customize') {
      fill(body, railEl, pickerEl, previewEl, editEl);
      renderRail();
      renderPicker();
      renderEdit();
    } else {
      fill(body, previewEl, sideEl);
      renderExportSide();
    }
  }

  /** プレビューの上の「何もない」表示と、下の通知・知らせること。 */
  function renderUnder() {
    emptyEl.hidden = !!view && view.drawn > 0;
    emptyEl.textContent = character ? '表示できる素材がありません' : 'ここにキャラクターが表示されます';
    // 通知は CUSTOMIZE の段で出す（EXPORT の段は、右側に常に並べる）。
    const shown = ui.step === 'customize' ? notices : [];
    if (shown.length === 0) ui.noticesOpen = false;
    fill(underEl,
      // 1 行分の高さを常に確保する（「保存しました」などが出ても、プレビューの大きさが変わらないようにする）。
      h('div', { className: 'message-line' },
        ui.message && mark(h('p', { className: `message ${ui.message.kind}` }, ui.message.text, ui.message.detail && ui.advancedOpen && h('span', { className: 'detail' }, ui.message.detail)), { role: 'message' })),
      ...(noticeMode === 'under' ? shown.map((n) => noticeBox(n)) : []),
    );
    fill(overlayEl, ...(noticeMode === 'overlay' ? shown.map((n) => noticeBox(n)) : []));
    overlayEl.hidden = noticeMode !== 'overlay' || shown.length === 0;
    fill(popoverEl, ...(noticeMode === 'chip' && ui.noticesOpen ? shown.map((n) => noticeBox(n)) : []));
    popoverEl.hidden = !(noticeMode === 'chip' && ui.noticesOpen && shown.length > 0);
  }

  /** 【検証用】右ペインの上に通知を出す方式のときだけ、通知を返す。 */
  const sideNotices = (): Child[] => (noticeMode === 'side' ? notices.map((n) => noticeBox(n)) : []);

  function noticeBox(n: Notice) {
    return mark(
      h('div', { className: 'notice' },
        h('div', { className: 'notice-text' }, n.text),
        n.note && h('div', { className: 'small muted' }, n.note),
        n.detail && ui.advancedOpen && h('div', { className: 'detail' }, n.detail),
        n.action && button(n.action.label, () => {
          const action = n.action!;
          if (action.kind === 'unequip') apply((c) => setEquipped(c, action.instanceId, false));
          else apply((c) => setView(c, 'front'));
        }, { noticeAction: n.action.kind })),
      { notice: n.key },
    );
  }

  // ---------------------------------------------------------------- CREATE

  function renderCreate() {
    const nameInput = mark(h('input', { type: 'text', className: 'field wide', maxLength: 200, value: ui.draft.name, placeholder: 'キャラクターの名前' }), { create: 'name' });
    nameInput.addEventListener('input', () => (ui.draft.name = nameInput.value));
    const starter = mark(h('input', { type: 'checkbox', checked: ui.draft.withStarter }), { create: 'starter' });
    starter.addEventListener('change', () => (ui.draft.withStarter = starter.checked));

    const start = () =>
      confirmDiscard(() => {
        const created = startCharacter(set, newId, { name: ui.draft.name.trim(), bodyId: ui.draft.bodyId, withStarter: ui.draft.withStarter });
        ui.savedSnapshot = null;
        ui.target = null;
        ui.scope = 'always';
        ui.step = 'customize';
        ui.message = null;
        ui.draft.name = '';
        commit(created);
      });

    return h('div', { className: 'pane create' },
      h('h2', {}, '新しいキャラクターを作る'),
      h('label', { className: 'row' }, h('span', { className: 'lbl' }, '名前'), nameInput),
      h('h4', {}, '素体を選ぶ'),
      h('div', { className: 'grid bodies' }, ...bodies(set).map((b) => card(b.name, thumbUrl(b.id), { on: b.id === ui.draft.bodyId, data: { createBody: b.id }, onPick: () => {
        ui.draft.bodyId = b.id;
        render('all');
      } }))),
      h('label', { className: 'row' }, starter, '基本のパーツ（顔・髪・服）を付けて始める'),
      h('div', { className: 'row actions' },
        button('この内容で始める', start, { action: 'start' }, { primary: true }),
        button('保存したキャラクターを読み込む', () => confirmDiscard(() => fileInput.click()), { action: 'create-load' })),
      character && h('p', { className: 'muted small' }, '編集中のキャラクターがあります。新しく始めると、保存していない変更は失われます。'),
    );
  }

  // ---------------------------------------------------------------- CUSTOMIZE：左（選ぶ）

  /**
   * カード。サムネイルがあれば画像と名前、なければ名前だけにする（同じ名前を 2 回出さない）。
   * `placeholder` は、画像のカードと並べるときに絵の位置へ文字を置く（「なし」のカード）。
   */
  function card(text: string, image: string | null, options: { on?: boolean; off?: boolean; why?: string; placeholder?: boolean; data: Record<string, string>; onPick?: () => void }) {
    const textOnly = !image && !options.placeholder;
    const el = mark(
      h('button', { type: 'button', className: `card${options.on ? ' on' : ''}${options.off ? ' off' : ''}${textOnly ? ' text-only' : ''}`, disabled: options.off ?? false },
        image && h('span', { className: 'thumb' }, h('img', { src: image, alt: '', loading: 'lazy' })),
        options.placeholder && h('span', { className: 'thumb' }, h('span', { className: 'thumb-text' }, text)),
        !options.placeholder && h('span', { className: 'card-name' }, text),
        options.why && h('span', { className: 'why' }, options.why)),
      { ...options.data, selected: String(!!options.on), available: String(!options.off) },
    );
    if (options.onPick && !options.off) el.addEventListener('click', options.onPick);
    return el;
  }

  function renderRail() {
    fill(railEl, ...majors.map(({ major }) => {
      const el = mark(h('button', { type: 'button', className: `rail-item${ui.major === major.id ? ' on' : ''}` }, label('major', major.id)), { major: major.id });
      el.addEventListener('click', () => {
        ui.major = major.id;
        if (major.kind === 'expression') ui.target = { kind: 'expression' };
        else if (major.kind === 'pose') ui.target = { kind: 'pose' };
        else if (major.id === 'body' && character) ui.target = { kind: 'instance', instanceId: character.appearance.body };
        render('all');
      });
      return el;
    }));
  }

  function currentMajor(): MajorView {
    return majors.find((m) => m.major.id === ui.major) ?? majors[0]!;
  }

  function renderPicker() {
    if (!character) return;
    const c = character;
    const { major, subs } = currentMajor();
    for (const el of railEl.querySelectorAll<HTMLElement>('[data-major]')) el.classList.toggle('on', el.dataset.major === major.id);

    if (major.kind === 'expression') {
      const preset = expressionPresetOf(c.state.expression);
      fill(pickerEl, h('h3', {}, '表情'),
        h('div', { className: 'grid' },
          ...STANDARD_EXPRESSIONS.map((e) => card(label('expression', e.id), null, { on: e.id === preset, data: { preset: e.id }, onPick: () => {
            ui.target = { kind: 'expression' };
            apply((x) => applyExpressionPreset(x, e.id), 'picker');
          } })),
          // 目・眉・口を個別に変えて、どの表情にも当たらなくなった状態を示す（押すものではない）。
          card('カスタム', null, { on: preset === undefined, off: preset !== undefined, data: { preset: 'custom' } })),
        h('p', { className: 'muted small' }, '右で、目・眉・口を個別に変えられます。'));
      return;
    }
    if (major.kind === 'pose') {
      fill(pickerEl, h('h3', {}, 'ポーズ'),
        ...['torso', 'arm.right', 'arm.left'].flatMap((region) => [
          h('h4', {}, label('region', region)),
          choices(POSE_DEFINITIONS.filter((d) => d.region === region).map((d) => [d.id, label('pose', d.id)] as const), c.state.pose[region] ?? null, (id) => {
            ui.target = { kind: 'pose' };
            apply((x) => setPose(x, region, id), 'picker');
          }, `pose-${region}`),
        ]),
        h('h3', { className: 'gap' }, '向き'),
        h('div', { className: 'grid' }, ...viewChoices(c, set).map((v) => card(label('view', v.id), null, {
          on: v.selected,
          off: !v.available && !v.selected,
          why: v.available ? undefined : '素材なし',
          data: { view: v.id },
          onPick: () => {
            ui.target = { kind: 'pose' };
            apply((x) => setView(x, v.id), 'picker');
          },
        }))));
      return;
    }

    const sub = subs.find((s) => s.category === ui.sub[major.id]) ?? subs[0]!;
    const cards = cardStates(c, set, sub.category);
    const canBeNone = !REQUIRED_CATEGORIES.has(sub.category) && !isMultiCategory(sub.category);
    const hint = multiHint(sub.category);
    fill(pickerEl,
      subs.length > 1 && choices(subs.map((s) => [s.category, label('category', s.category)] as const), sub.category, (category) => {
        ui.sub[major.id] = category;
        render('picker');
      }, 'sub'),
      h('div', { className: 'grid' },
        canBeNone && card('なし', null, { on: noneSelected(c, set, sub.category), placeholder: true, data: { card: 'none' }, onPick: () => {
          ui.target = null;
          apply((x) => chooseNone(x, set, sub.category), 'picker');
        } }),
        ...cards.map((state) => card(state.name, thumbUrl(state.partId), {
          on: state.selected,
          off: !state.available,
          why: cardProblemText(state),
          data: { card: state.partId },
          onPick: () => {
            const choice = chooseCard(c, set, state.partId, newId);
            // カードを選ぶと、装備と編集対象の選択を同時に行う。
            ui.target = choice.instanceId ? { kind: 'instance', instanceId: choice.instanceId } : null;
            commit(choice.character, 'picker');
          },
        }))),
      hint && h('p', { className: 'muted small' }, hint),
    );
  }

  // ---------------------------------------------------------------- CUSTOMIZE：右（調整する）

  function renderEdit() {
    if (!character) return;
    const c = character;
    const target = ui.target;
    if (target?.kind === 'expression') return fill(editEl, ...sideNotices(), ...expressionPanel(c));
    if (target?.kind === 'pose') return fill(editEl, ...sideNotices(), ...posePanel(c));
    const inst = target ? c.equipment.find((i) => i.instanceId === target.instanceId && i.equipped) : undefined;
    if (!inst) return fill(editEl, ...sideNotices(), h('p', { className: 'muted' }, '左でパーツを選ぶと、ここで色などを調整できます。'));
    const part = set.library.get(inst.partId);
    fill(editEl,
      ...sideNotices(),
      mark(h('h3', {}, part?.name ?? '見つからない素材'), { role: 'edit-title' }),
      ...(inst.instanceId === c.appearance.body ? bodyPanel(c) : colorPanel(c, inst, part)),
      advancedBox(c, inst),
    );
  }

  function expressionPanel(c: Character): Child[] {
    const preset = expressionPresetOf(c.state.expression);
    const row = (key: 'eyes' | 'eyebrows' | 'mouth', title: string) => [
      h('h4', {}, title),
      choices(STANDARD_STATES[key].map((s) => [s, label(key, s)] as const), c.state.expression[key], (value) => apply((x) => setExpression(x, { [key]: value }), 'picker'), key),
    ];
    return [mark(h('h3', {}, `表情：${preset ? label('expression', preset) : 'カスタム'}`), { role: 'edit-title' }), ...row('eyes', '目'), ...row('eyebrows', '眉'), ...row('mouth', '口')];
  }

  function posePanel(c: Character): Child[] {
    const { pose, view: v } = c.state;
    return [
      mark(h('h3', {}, 'ポーズ・向き'), { role: 'edit-title' }),
      h('p', {}, `${label('region', 'torso')}：${label('pose', pose.torso!)} ／ ${label('region', 'arm.right')}：${label('pose', pose['arm.right']!)} ／ ${label('region', 'arm.left')}：${label('pose', pose['arm.left']!)}`),
      h('p', {}, `向き：${label('view', v)}`),
      h('p', { className: 'muted small' }, 'ポーズや向きを変えて表示できなくなったパーツがあれば、注意としてお知らせします。'),
    ];
  }

  /** 素体：全体の色（共有色）と体型。 */
  function bodyPanel(c: Character): Child[] {
    const bodyPart = set.library.get(bodyInstance(c).partId);
    const dims = bodyPart?.kind === 'body' ? Object.entries(bodyPart.fitDimensions ?? {}) : [];
    const NONE = '';
    return [
      h('h4', {}, '全体の色'),
      ...sharedColorRows(c, set.library).map(({ key, color: current }) => {
        const onColor = (color: string, done: boolean) => apply((x) => setSharedColor(x, key, color), done ? 'edit' : 'status');
        return h('div', { className: 'color-row' },
          h('div', { className: 'row' }, colorField(current, onColor, { shared: key }), h('span', {}, label('shared', key))),
          recentChips(current, onColor, key));
      }),
      h('p', { className: 'muted small' }, 'この色を使っているパーツが、まとめて変わります。'),
      dims.length > 0 && h('h4', {}, '体型'),
      ...dims.map(([dim, values]) => h('div', { className: 'row' }, h('span', { className: 'lbl' }, label('fitDimension', dim)),
        choices([[NONE, '指定なし'] as const, ...values.map((v) => [v, label('fitValue', v)] as const)], c.appearance.fit[dim] ?? NONE, (value) => apply((x) => setFit(x, dim, value === NONE ? undefined : value), 'edit'), `fit-${dim}`))),
    ];
  }

  /** パーツの色。全体の色に従っているスロットは、その場で全体の色を編集する。 */
  function colorPanel(c: Character, inst: EquipmentInstance, part: PartManifest | undefined): Child[] {
    const slots = (part?.colorSlots ?? []).filter((s) => s.mode !== 'fixed');
    if (slots.length === 0) return [h('p', { className: 'muted' }, 'このパーツには、変えられる色がありません。')];
    const rows = slots.map((slot) => {
      const override = inst.colors[slot.id];
      const linked = slot.link !== undefined && override?.linked !== false;
      const shown = resolveSlotColor(slot, override, c.sharedColors);
      const onColor = linked
        ? (color: string, done: boolean) => apply((x) => setSharedColor(x, slot.link!, color), done ? 'edit' : 'status')
        : (color: string, done: boolean) => apply((x) => setInstanceColor(x, inst.instanceId, slot.id, color), done ? 'edit' : 'status');
      const field = colorField(shown, onColor, { slot: slot.id });
      const own = slot.link !== undefined && mark(h('input', { type: 'checkbox', checked: !linked }), { own: slot.id });
      // リンクの解除と復帰は core の操作を使う（解除時に、見えている色を写すのは core の仕事）。
      if (own) own.addEventListener('change', () => apply((x) => (own.checked ? unlinkColor(x, inst.instanceId, slot) : relinkColor(x, inst.instanceId, slot.id)), 'edit'));
      return h('div', { className: 'color-row' },
        h('div', { className: 'row' }, field, h('span', {}, linked ? `${label('shared', slot.link!)}の色（全体）` : (slot.name ?? slot.id))),
        own && h('label', { className: 'row own' }, own, 'このパーツだけ色を変える'),
        recentChips(shown, onColor, slot.id));
    });
    return [
      h('h4', {}, '色'),
      ...rows,
      slots.some((s) => s.link !== undefined) && h('p', { className: 'muted small' }, '「全体」の色は、同じ色を使うすべてのパーツが一緒に変わります。'),
    ];
  }

  // ---------------------------------------------------------------- 詳細設定（Advanced）

  /** その Instance の「パーツの中心」。画素を調べるので非同期。 */
  async function centerOf(instanceId: string): Promise<Point | null> {
    const plan = view?.plan;
    if (!plan) return null;
    const entries = plan.entries.filter((e) => e.instanceId === instanceId && e.status === 'draw' && e.asset);
    const all = await Promise.all(entries.map(async (e) => [`${e.partId}/${e.asset!.file}`, await composer.opaqueBounds(e.partId, e.asset!.file)] as const));
    const bounds = new Map(all);
    return partCenter(plan, instanceId, (partId, file) => bounds.get(`${partId}/${file}`) ?? null);
  }

  function advancedBox(c: Character, inst: EquipmentInstance | null) {
    const toggle = mark(h('button', { type: 'button', className: 'adv-toggle' }, `${ui.advancedOpen ? '▾' : '▸'} 詳細設定`), { action: 'advanced' });
    toggle.addEventListener('click', () => {
      ui.advancedOpen = !ui.advancedOpen;
      render('edit');
    });
    if (!ui.advancedOpen) return h('div', { className: 'box adv' }, toggle);

    if (!inst) return h('div', { className: 'box adv' }, toggle);

    const part = set.library.get(inst.partId);
    const stored = storedTransform(inst, ui.scope, c.state);
    // 条件つきの調整がまだないときは、写して始める元（いつもの調整）の値を見せる。
    const shown: Transform | undefined = stored ?? (ui.scope === 'always' ? undefined : inst.transform);
    const armRight = label('pose', c.state.pose['arm.right']!);

    const scope = mark(h('select', { className: 'field wide' },
      h('option', { value: 'always', selected: ui.scope === 'always' }, 'いつも'),
      h('option', { value: 'arm.right', selected: ui.scope === 'arm.right' }, `右腕が「${armRight}」のとき`),
      h('option', { value: 'full', selected: ui.scope === 'full' }, 'いまの向きとポーズのとき')), { tf: 'scope' });
    scope.addEventListener('change', () => {
      ui.scope = scope.value as Scope;
      render('edit');
    });

    const number = (key: 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation', text: string, fallback: number, step: string) => {
      const input = mark(h('input', { type: 'number', className: 'num', step, value: String(shown?.[key] ?? fallback) }), { tf: key });
      input.addEventListener('change', async () => {
        const value = Number(input.value);
        if (!Number.isFinite(value)) return;
        // 調整を初めて作るときは「パーツの中心」を中心として保存する。
        const center = stored ? null : await centerOf(inst.instanceId);
        apply((x) => editTransform(x, inst.instanceId, ui.scope, { [key]: value }, center), 'edit');
      });
      return h('label', { className: 'num-field' }, text, input);
    };

    const pivotSelect = mark(h('select', { className: 'field wide' },
      h('option', { value: 'part' }, 'パーツの中心'),
      h('option', { value: 'canvas' }, 'キャンバスの中心'),
      h('option', { value: 'custom' }, '数値で指定')), { tf: 'pivot-mode' });
    const pivotInputs = h('div', { className: 'row' });
    // どの選び方に当たるかは、保存されている値から求める（UI では覚えない）。
    void centerOf(inst.instanceId).then((center) => {
      // まだ調整がないときは、最初に作るときの既定（パーツの中心）を示す。
      const mode = shown ? pivotMode(shown, center) : 'part';
      pivotSelect.value = mode;
      pivotSelect.dataset.ready = 'true';
      const writePivot = (pivot: Point | null) => apply((x) => setPivot(x, inst.instanceId, ui.scope, pivot), 'edit');
      pivotSelect.addEventListener('change', () => {
        if (pivotSelect.value === 'part') writePivot(center);
        else if (pivotSelect.value === 'canvas') writePivot(null);
        else writePivot(shown?.pivot ?? center ?? [c.canvas[0] / 2, c.canvas[1] / 2]);
      });
      if (mode === 'custom' && shown?.pivot) {
        const pivot = shown.pivot;
        const axis = (index: 0 | 1, text: string) => {
          const input = mark(h('input', { type: 'number', className: 'num', step: '1', value: String(pivot[index]) }), { tf: index === 0 ? 'pivot-x' : 'pivot-y' });
          input.addEventListener('change', () => {
            const next: Point = [pivot[0], pivot[1]];
            next[index] = Number(input.value);
            if (Number.isFinite(next[index])) writePivot(next);
          });
          return h('label', { className: 'num-field' }, text, input);
        };
        pivotInputs.append(h('span', { className: 'lbl' }), axis(0, 'X'), axis(1, 'Y'));
      }
    });

    return h('div', { className: 'box adv' }, toggle,
      h('h4', {}, '位置・大きさ・回転'),
      h('div', { className: 'row' }, h('span', { className: 'lbl' }, 'いつ使うか'), scope),
      ui.scope !== 'always' && !stored && h('p', { className: 'muted small' }, 'この条件の調整はまだありません。値を変えると、いまの調整を写して作ります。'),
      h('div', { className: 'row' }, h('span', { className: 'lbl' }, '位置'), number('x', 'X', 0, '1'), number('y', 'Y', 0, '1')),
      h('div', { className: 'row' }, h('span', { className: 'lbl' }, '大きさ'), number('scaleX', '横', 1, '0.01'), number('scaleY', '縦', 1, '0.01')),
      h('div', { className: 'row' }, h('span', { className: 'lbl' }, '回転'), number('rotation', '度', 0, '1'), h('span', { className: 'spacer' }),
        button('元に戻す', () => apply((x) => clearTransform(x, inst.instanceId, ui.scope), 'edit'), { action: 'tf-clear' }, { disabled: !stored })),
      h('div', { className: 'row' }, h('span', { className: 'lbl' }, '中心'), pivotSelect),
      pivotInputs,
      h('h4', {}, '内部情報'),
      mark(h('p', { className: 'muted small internal' }, `${inst.partId} ／ ${part?.category ?? '（不明）'}`, h('br'), inst.instanceId), { role: 'internal' }),
    );
  }

  // ---------------------------------------------------------------- EXPORT

  function renderExportSide() {
    if (!character || !view) return;
    const c = character;
    const blocked = exportBlockText(view);
    const exportButton = button('PNG を保存', () => {
      void idle.then(() => {
        hooks.lastPng = canvas.toDataURL('image/png');
        canvas.toBlob((blob) => blob && download(blob, `${c.name || 'character'}.png`), 'image/png');
        ui.message = { kind: 'info', text: '画像を書き出しました。' };
        render('status');
      });
    }, { action: 'export' }, { primary: true, disabled: blocked !== null });
    fill(sideEl,
      h('h2', {}, '画像を書き出す'),
      h('div', { className: 'row' }, h('span', { className: 'lbl' }, '大きさ'), `${c.canvas[0]} × ${c.canvas[1]}`),
      h('div', { className: 'row' }, h('span', { className: 'lbl' }, '背景'), '透明'),
      h('div', { className: 'row' }, h('span', { className: 'lbl' }, '形式'), 'PNG'),
      h('div', { className: 'row actions' }, exportButton),
      blocked && mark(h('p', { className: 'message error' }, blocked), { role: 'export-blocked' }),
      !blocked && notices.length > 0 && h('p', { className: 'muted small' }, '下の内容は画像にも反映されます（表示されていないパーツは、画像に含まれません）。'),
      ...notices.map((n) => noticeBox(n)),
      h('p', { className: 'muted small gap' }, '全身以外の構図、背景色、まとめての書き出しは、今後の版で対応します。'),
    );
  }

  render('all');
  await paint();

  // 自動操作（tools/creator-smoke.ts）用の入口。画面の操作を置き換えるものではなく、結果の確認に使う。
  Object.assign(window, {
    __creator: {
      get character() {
        return character;
      },
      get inspection() {
        return view;
      },
      get ui() {
        return ui;
      },
      idle: () => idle,
      hooks,
    },
  });
}

void main();
