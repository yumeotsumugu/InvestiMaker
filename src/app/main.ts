// InvestiMaker の Creator UI（Phase 1-C-2）。素の DOM だけで書く。
//
// 正本は Character 1 個。画面は Character と、下の `ui`（保存しない表示上の状態）から描く。
// DOM event → Character の操作（core/operations、app/session）→ 評価 → 描画計画 → 描画 の一方向で動かす。
// 入力中の部品（色の選択など）を壊さないよう、領域ごとに描き直す。
//
// ページは 3 つに分かれている：index.html（スタート画面。CREATE の段を兼ねる）→ customize.html（CUSTOMIZE）→ export.html（EXPORT）。
// どのページもこのファイルを読み、<body data-page="…"> で自分の段を知る。
// 編集中の Character は、ページを移るときにセッションストレージで運ぶ（store.ts）。

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
  serializeCharacter,
  stringifyCharacter,
  unlinkColor,
} from '../core/index.ts';
import { Composer } from '../web/composer.ts';
import { assetUrl } from '../web/embedded.ts';
import type { AssetSet } from '../web/loader.ts';
import { loadSet } from '../web/loader.ts';
import type { MajorView } from './catalog.ts';
import { REQUIRED_CATEGORIES, visibleMajors } from './catalog.ts';
import { label } from './labels.ts';
import { readStore, writeStore } from './store.ts';
import type { Notice } from './messages.ts';
import { buildNotices, cardProblemText, exportBlockText, loadErrorText, multiHint } from './messages.ts';
import type { Inspection, Point, Preset, Scope } from './session.ts';
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
  presets,
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
/** 段ごとのページ。相対パスなので、ファイルを直接開いても、Web に置いても同じように移れる。 */
const PAGES: Record<Step, string> = { create: 'index.html', customize: 'customize.html', export: 'export.html' };
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
  /** スタート画面で入力中の値。`preset` は、プリセットの ID。 */
  draft: { name: string; preset: string };
  /** 詳細設定の中の「内部情報」を開いているか。 */
  internalOpen: boolean;
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
  const presetList = presets(set);
  const thumbUrl = (partId: string) => assetUrl(`${set.baseUrl}${partId}/preview.png`);

  // 【Phase 1-C-3 の検証用】通知の置き場所を URL で切り替える。置き場所が決まったら、採用した案だけを残して消す。
  //   ?notices=side（既定：右ペインの上）／ under（プレビューの下。プレビューが縮む）／ overlay（プレビューに重ねる）／ chip（「注意 n 件」から開く）
  type NoticeMode = 'under' | 'side' | 'overlay' | 'chip';
  // 指定はページを移っても引き継ぐ（?notices=under で現状に戻す）。
  const stored = readStore();
  const requested = new URLSearchParams(location.search).get('notices') ?? stored.ui.notices ?? 'side';
  const noticeMode: NoticeMode = requested === 'under' || requested === 'overlay' || requested === 'chip' ? requested : 'side';
  const dataPage = document.body.dataset.page;
  const pageStep: Step = dataPage === 'customize' || dataPage === 'export' ? dataPage : 'create';

  /** 編集中のキャラクター。CREATE で始めるまでは null。 */
  let character: Character | null = null;
  let view: Inspection | null = null;
  let notices: Notice[] = [];
  const ui: UiState = {
    step: pageStep,
    major: stored.ui.major && majors.some((m) => m.major.id === stored.ui.major) ? stored.ui.major : majors.some((m) => m.major.id === 'hair') ? 'hair' : majors[0]!.major.id,
    sub: stored.ui.sub ?? {},
    target: stored.ui.target === 'expression' ? { kind: 'expression' } : stored.ui.target === 'pose' ? { kind: 'pose' } : stored.ui.target ? { kind: 'instance', instanceId: stored.ui.target } : null,
    // 詳細設定は、最初から開いておく（要らなければ閉じられる。閉じたことは覚える）。
    advancedOpen: stored.ui.advancedOpen ?? true,
    scope: 'always',
    savedSnapshot: stored.savedSnapshot,
    recentColors: stored.ui.recentColors ?? [],
    message: stored.flash ? { kind: 'info', text: stored.flash } : null,
    draft: { name: '', preset: presetList[0]?.id ?? '' },
    internalOpen: false,
    noticesOpen: false,
  };

  // 前のページから運ばれてきたキャラクターを読む。保存 JSON と同じ検証を通す。
  if (stored.character) {
    const carried = loadCharacterText(stored.character);
    if (carried.loaded) character = carried.character;
  }
  // キャラクターがまだないのに作成画面・書き出し画面を開いた場合は、最初のページへ戻る。
  if (!character && pageStep !== 'create') {
    location.replace(PAGES.create);
    return;
  }

  /** 編集中の内容をセッションストレージへ書く（ページを移っても続きから編集できるようにする）。 */
  let flash: string | null = null;
  function persist() {
    writeStore({
      character: character ? JSON.stringify(serializeCharacter(character)) : null,
      savedSnapshot: ui.savedSnapshot,
      flash,
      ui: {
        major: ui.major,
        sub: ui.sub,
        target: ui.target === null ? null : ui.target.kind === 'instance' ? ui.target.instanceId : ui.target.kind,
        advancedOpen: ui.advancedOpen,
        recentColors: ui.recentColors,
        notices: noticeMode,
      },
    });
  }

  /** 別の段（ページ）へ移る。 */
  function go(step: Step, message: string | null = null) {
    if (step === pageStep) return;
    flash = message;
    persist();
    location.href = PAGES[step];
  }
  const hooks = { lastSaved: null as string | null, lastPng: null as string | null };

  const canvas = mark(h('canvas', { className: 'canvas' }), { role: 'preview' });
  const composer = new Composer(set, canvas);
  const header = h('header', { className: 'hd' });
  const body = h('div', { className: 'body' });
  const modalHost = h('div');
  root.append(h('div', { className: 'frame' }, header, body), modalHost);

  // 段ごとに並べ替える領域。中身は領域ごとに描き直す。
  const railEl = h('div', { className: 'pane rail' });
  const pickerEl = h('div', { className: 'pane picker' });
  const emptyEl = mark(h('div', { className: 'canvas-empty' }), { role: 'empty' });
  const underEl = h('div', { className: 'under' });
  const overlayEl = mark(h('div', { className: 'notice-overlay' }), { role: 'notice-overlay' });
  const previewEl = h('div', { className: 'pane preview' }, h('div', { className: 'stage' }, h('div', { className: 'canvas-wrap' }, canvas, emptyEl, overlayEl)), underEl);
  const popoverEl = mark(h('div', { className: 'notice-popover' }), { role: 'notice-popover' });
  root.dataset.notices = noticeMode;
  root.dataset.page = pageStep;
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

  function render(region: Region) {
    renderHeader();
    if (region === 'all') renderBody();
    else if (ui.step === 'customize') {
      if (region === 'picker') renderPicker();
      if (region === 'edit' || region === 'picker') renderEdit();
    } else if (ui.step === 'export') renderExportSide();
    renderUnder();
    persist();
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
    const loaded = `「${outcome.character.name || '名前のないキャラクター'}」を読み込みました。`;
    if (pageStep === 'create') {
      // 最初のページで読み込んだら、作成画面へ移る。
      character = outcome.character;
      go('customize', loaded);
      return;
    }
    ui.message = { kind: 'info', text: loaded };
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
    const kept = character ? keptInstances(character) : [];
    modal('設定', [
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
    persist();
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
    // ページの移動は、ヘッダーのボタンで行う。次に進む先（画像の書き出し）は、右端に目立つ色で置く。
    const toExport = button('画像を書き出す →', () => go('export'), { step: 'export' }, { primary: true });
    toExport.classList.add('accent');
    fill(header,
      h('span', { className: 'brand' }, 'InvestiMaker'),
      ui.step === 'export' && button('← 編集に戻る', () => go('customize'), { step: 'customize' }),
      nameEl,
      count > 0 && noticeChip(count),
      h('span', { className: 'spacer' }),
      button('スタート画面', () => go('create'), { step: 'create' }),
      button('キャラクターを保存', save, { action: 'save' }, { disabled: !character }),
      button('読み込む', () => confirmDiscard(() => fileInput.click()), { action: 'load' }),
      button('設定', openSettings, { action: 'settings' }),
      ui.step === 'customize' && toExport,
      fileInput,
      noticeMode === 'chip' && popoverEl,
    );
  }

  // ---------------------------------------------------------------- 本体

  function renderBody() {
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
    emptyEl.textContent = '表示できる素材がありません';
    // 通知は CUSTOMIZE の段で出す（EXPORT の段は、右側に常に並べる）。
    const shown = ui.step === 'customize' ? notices : [];
    if (shown.length === 0) ui.noticesOpen = false;
    fill(underEl,
      // 1 行分の高さを常に確保する（「保存しました」などが出ても、プレビューの大きさが変わらないようにする）。
      h('div', { className: 'message-line' },
        ui.step !== 'create' && ui.message && mark(h('p', { className: `message ${ui.message.kind}` }, ui.message.text, ui.message.detail && ui.internalOpen && h('span', { className: 'detail' }, ui.message.detail)), { role: 'message' })),
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
        n.detail && ui.internalOpen && h('div', { className: 'detail' }, n.detail),
        n.action && button(n.action.label, () => {
          const action = n.action!;
          if (action.kind === 'unequip') apply((c) => setEquipped(c, action.instanceId, false));
          else apply((c) => setView(c, 'front'));
        }, { noticeAction: n.action.kind })),
      { notice: n.key },
    );
  }

  // ---------------------------------------------------------------- CREATE

  /** 選んでいる「プリセット」から、これから作るキャラクターを組み立てる。 */
  function draftCharacter(): Character | null {
    const preset = presetList.find((p) => p.id === ui.draft.preset);
    return preset ? startCharacter(set, newId, { name: ui.draft.name.trim(), bodyId: preset.bodyId, withStarter: preset.withStarter }) : null;
  }

  /** スタート画面のプレビュー：選んでいるセットで始めたときの見た目を出す（編集中のキャラクターは変えない）。 */
  function showDraft() {
    const draft = draftCharacter();
    view = draft ? inspect(draft, set) : null;
    renderUnder();
    void paint();
  }

  function renderCreate() {
    const nameInput = mark(h('input', { type: 'text', className: 'field wide', maxLength: 200, value: ui.draft.name, placeholder: 'あとから変えられます' }), { create: 'name' });
    nameInput.addEventListener('input', () => (ui.draft.name = nameInput.value));

    const start = () =>
      confirmDiscard(() => {
        // 新しいキャラクターを作り、作成画面（別のページ）へ移る。
        const created = draftCharacter();
        if (!created) return;
        character = created;
        ui.savedSnapshot = null;
        ui.target = null;
        go('customize');
      });
    nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) start();
    });

    const manyBodies = bodies(set).length > 1;
    const presetButton = (preset: Preset) => {
      const title = preset.withStarter ? '基本のセット' : '素体だけ';
      const note = preset.withStarter ? '顔・髪・服を付けた状態から始めます。' : '何も付けていない状態から始めます。';
      const on = preset.id === ui.draft.preset;
      const el = mark(h('button', { type: 'button', className: `preset${on ? ' on' : ''}` },
        h('span', { className: 'preset-name' }, manyBodies ? `${set.library.get(preset.bodyId)?.name ?? ''} ／ ${title}` : title),
        h('span', { className: 'muted small' }, note)), { preset: preset.id, selected: String(on) });
      el.addEventListener('click', () => {
        ui.draft.preset = preset.id;
        render('all');
        showDraft();
      });
      return el;
    };

    return h('div', { className: 'pane start' },
      h('div', { className: 'start-card' },
        h('h1', { className: 'start-brand' }, 'InvestiMaker'),
        h('p', { className: 'muted' }, 'パーツを組み合わせて、TRPG のキャラクターの立ち絵を作ります。'),
        character && mark(h('div', { className: 'box resume' },
          h('p', {}, `編集中のキャラクターがあります：${character.name || '（名前なし）'}`),
          button('続きから編集する', () => go('customize'), { action: 'resume' })), { role: 'resume' }),
        h('h2', {}, '新しいキャラクターを作る'),
        h('label', { className: 'start-label' }, 'キャラクターの名前', nameInput),
        h('div', { className: 'start-label' }, 'プリセット'),
        h('div', { className: 'presets' }, ...presetList.map(presetButton)),
        h('p', { className: 'muted small' }, 'どのプリセットで始めても、あとからすべて変えられます。'),
        h('div', { className: 'start-actions' },
          button('作成を開始', start, { action: 'start' }, { primary: true }),
          button('保存データを読み込む', () => confirmDiscard(() => fileInput.click()), { action: 'create-load' })),
        ui.message && mark(h('p', { className: `message ${ui.message.kind}` }, ui.message.text), { role: 'message' }),
        h('p', { className: 'muted small start-foot' }, 'このブラウザの中だけで動きます。キャラクターや画像を外部へ送信しません。'),
      ),
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
        targetCurrent();
        render('all');
      });
      return el;
    }));
  }

  function currentMajor(): MajorView {
    return majors.find((m) => m.major.id === ui.major) ?? majors[0]!;
  }

  /**
   * 開いている分類で装備中のパーツを、編集対象にする（装備がなければ、何も選んでいない状態にする）。
   * 分類を切り替えたのに、右側が前の分類のパーツを指したままにならないようにする。
   */
  function targetCurrent() {
    if (!character) return;
    const { major, subs } = currentMajor();
    if (major.kind === 'expression') ui.target = { kind: 'expression' };
    else if (major.kind === 'pose') ui.target = { kind: 'pose' };
    else if (major.id === 'body') ui.target = { kind: 'instance', instanceId: character.appearance.body };
    else {
      const category = (subs.find((sub) => sub.category === ui.sub[major.id]) ?? subs[0])?.category;
      const inst = character.equipment.findLast((i) => i.equipped && set.library.get(i.partId)?.category === category);
      ui.target = inst ? { kind: 'instance', instanceId: inst.instanceId } : null;
    }
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
        targetCurrent();
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
    // 内部の ID などは、開いたときだけ見せる（通常の画面には出さない）。
    const internalToggle = mark(h('button', { type: 'button', className: 'adv-toggle sub' }, `${ui.internalOpen ? '▾' : '▸'} 内部情報`), { action: 'internal' });
    internalToggle.addEventListener('click', () => {
      ui.internalOpen = !ui.internalOpen;
      render('all');
    });
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
      internalToggle,
      ui.internalOpen && mark(h('p', { className: 'muted small internal' }, `${inst.partId} ／ ${part?.category ?? '（不明）'}`, h('br'), inst.instanceId), { role: 'internal' }),
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
    exportButton.classList.add('accent');
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

  // 一度出した知らせは、次のページへ持ち越さない。
  if (character) commit(character);
  else render('all');
  if (pageStep === 'create') showDraft();
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
