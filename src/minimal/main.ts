// Phase 1-B の最小 UI。Character 操作のリファレンスとして残してある（製品 UI は src/app/）。素の DOM だけで書く。
//
// DOM event → Character の操作（core/operations）→ 評価（core/evaluate）→ 描画計画（core/plan）→ 描画
// の一方向で動かす。画面は Character から毎回作り直し、DOM 側に状態を持たない
// （例外は「どの Instance を選択しているか」と「配置補正の適用範囲」という表示上の選択だけ）。

import './style.css';
import type { Body, Character, EquipmentInstance, PartManifest, PartStatus, Transform, TransformCondition } from '../core/index.ts';
import {
  POSE_DEFINITIONS,
  STANDARD_EXPRESSIONS,
  STANDARD_STATES,
  VIEWS,
  bodyInstance,
  conditionMatches,
  conditionSize,
  expressionPresetOf,
  isMultiCategory,
  relinkColor,
  rename,
  resolveSlotColor,
  sameCondition,
  setEquipped,
  setExpression,
  setFit,
  setInstanceColor,
  setPose,
  setSharedColor,
  setTransform,
  setTransformOverride,
  setView,
  stringifyCharacter,
  unlinkColor,
} from '../core/index.ts';
import { Composer } from '../web/composer.ts';
import type { AssetSet } from '../web/loader.ts';
import { loadSet } from '../web/loader.ts';
import type { Inspection, Session } from './session.ts';
import { choosePart, deleteInstance, edit, inspect, loadCharacterText, newSession, unequip } from './session.ts';

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false));
  return el;
}

/** 中身を入れ替える。偽の値は読み飛ばす。 */
function fill(el: HTMLElement, ...children: Child[]) {
  el.replaceChildren(...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false));
}

/** 自動操作（スモークテスト）が要素を特定するための属性を付ける。 */
function tag<T extends HTMLElement>(el: T, data: Record<string, string>): T {
  Object.assign(el.dataset, data);
  return el;
}

const PART_STATUS: Record<PartStatus, string> = { ok: '対応', missing: '不足', unsupported: '非対応', conflict: '競合' };
const SHARED_KEYS = ['skin.base', 'hair.base', 'hair.sub', 'eyes.left', 'eyes.right'];
const REGION_LABEL: Record<string, string> = { torso: '胴体・脚', 'arm.left': '左腕', 'arm.right': '右腕' };
const newId = () => crypto.randomUUID();

function download(blob: Blob, name: string) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  a.click();
  URL.revokeObjectURL(a.href);
}

async function main() {
  const root = document.querySelector<HTMLDivElement>('#app')!;
  let set: AssetSet;
  try {
    set = await loadSet('development');
  } catch (e) {
    root.append(h('p', { className: 'error' }, `素材を読み込めない: ${String(e)}`));
    return;
  }

  let session: Session = newSession(set, newId);
  let view: Inspection = inspect(session.character, set);
  /** 配置補正をどの範囲に適用するか（表示上の選択）。 */
  let scope: 'base' | 'arm.right' | 'full' = 'base';
  let notice: { kind: 'info' | 'error'; text: string } | null = null;

  const canvas = tag(h('canvas', { className: 'preview-canvas' }), { role: 'preview' });
  const composer = new Composer(set, canvas);
  const header = h('header');
  const partsPanel = h('section', { className: 'panel parts' });
  const statusPanel = h('div', { className: 'status' });
  const sidePanel = h('section', { className: 'panel side' });
  const hooks = { lastSaved: null as string | null, lastPng: null as string | null };

  // ---------------------------------------------------------------- 更新と描画

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
            // 描画できないときは、何も描かれていないキャンバスにする。
            await composer.render(current.plan ?? { parts: [], entries: [] }, current.colors, undefined, current.matrices);
          } catch (e) {
            notice = { kind: 'error', text: `描画エラー: ${String(e)}` };
            renderStatus();
          }
        }
        running = false;
      })();
    }
    return idle;
  }

  /**
   * Character を更新する。`rebuild: false` は、入力中の部品（カラーピッカーなど）を作り直さずに
   * プレビューと状態表示だけを更新する。
   */
  function update(next: Session, options: { rebuild?: boolean } = {}) {
    session = next;
    view = inspect(session.character, set);
    if (options.rebuild ?? true) renderAll();
    else renderStatus();
    void paint();
  }

  const apply = (operation: (c: Character) => Character, options?: { rebuild?: boolean }) => {
    try {
      update(edit(session, operation), options);
    } catch (e) {
      notice = { kind: 'error', text: String(e instanceof Error ? e.message : e) };
      renderAll();
    }
  };

  // ---------------------------------------------------------------- 部品

  function button(label: string, onClick: () => void, data: Record<string, string> = {}, disabled = false) {
    const el = tag(h('button', { type: 'button', disabled }, label), data);
    el.addEventListener('click', onClick);
    return el;
  }

  function select(options: readonly (string | [value: string, label: string])[], value: string, onChange: (value: string) => void, data: Record<string, string> = {}) {
    const pairs = options.map((o) => (typeof o === 'string' ? ([o, o] as const) : o));
    // 現在の値が選択肢にない場合（実装が知らないポーズなど）も、そのまま表示して消さない。
    const all = pairs.some(([v]) => v === value) ? pairs : [...pairs, [value, `${value}（未知）`] as const];
    const el = tag(h('select', {}, ...all.map(([v, label]) => h('option', { value: v, selected: v === value }, label))), data);
    el.addEventListener('change', () => onChange(el.value));
    return el;
  }

  /** 色の入力。ドラッグ中は作り直さずに反映し、確定したときに画面を作り直す。 */
  function colorInput(value: string, onColor: (color: string, done: boolean) => void, data: Record<string, string> = {}, disabled = false) {
    const el = tag(h('input', { type: 'color', value: value.toLowerCase(), disabled }), data);
    el.addEventListener('input', () => onColor(el.value, false));
    el.addEventListener('change', () => onColor(el.value, true));
    return el;
  }

  const row = (label: string, ...children: Child[]) => h('label', { className: 'row' }, h('span', { className: 'label' }, label), ...children);
  const group = (title: string, ...children: Child[]) => h('fieldset', {}, h('legend', {}, title), ...children);

  // ---------------------------------------------------------------- Character

  function renderHeader() {
    const name = tag(h('input', { type: 'text', value: session.character.name, maxLength: 200, className: 'name' }), { role: 'name' });
    name.addEventListener('input', () => update(edit(session, (c) => rename(c, name.value)), { rebuild: false }));

    const file = tag(h('input', { type: 'file', accept: '.json,application/json', hidden: true }), { role: 'load-file' });
    file.addEventListener('change', async () => {
      const chosen = file.files?.[0];
      if (!chosen) return;
      const outcome = loadCharacterText(session, await chosen.text());
      if (outcome.loaded) {
        notice = { kind: 'info', text: `${chosen.name} を読み込んだ${outcome.warnings.length > 0 ? `（${outcome.warnings.map((w) => w.message).join(' / ')}）` : ''}` };
        scope = 'base';
        update(outcome.session);
      } else {
        // INVALID：現在のキャラクターは置き換えない。
        notice = { kind: 'error', text: `${chosen.name} は読み込めない（現在のキャラクターはそのまま）: ${outcome.errors.map((e) => `${e.path || '全体'}: ${e.message}`).join(' / ')}` };
        renderAll();
      }
    });

    fill(header, 
      h('h1', {}, 'InvestiMaker Minimal'),
      name,
      button('新規作成', () => {
        notice = { kind: 'info', text: '新しいキャラクターを作った' };
        scope = 'base';
        update(newSession(set, newId));
      }, { action: 'new' }),
      button('JSON 保存', () => {
        const text = stringifyCharacter(session.character);
        hooks.lastSaved = text;
        download(new Blob([text], { type: 'application/json' }), `${session.character.name || 'character'}.json`);
        notice = { kind: 'info', text: 'JSON を保存した' };
        renderStatus();
      }, { action: 'save' }),
      button('JSON 読込', () => file.click(), { action: 'load' }),
      file,
      button('PNG 出力', () => {
        void idle.then(() => {
          hooks.lastPng = canvas.toDataURL('image/png');
          canvas.toBlob((blob) => blob && download(blob, `${session.character.name || 'character'}.png`), 'image/png');
          notice = { kind: 'info', text: view.export.warnings.length > 0 ? 'PNG を出力した（下の注意を確認）' : 'PNG を出力した' };
          renderStatus();
        });
      }, { action: 'export' }, !view.export.allowed),
    );
  }

  function renderStatus() {
    const { evaluation } = view;
    const exportButton = header.querySelector<HTMLButtonElement>('[data-action="export"]');
    if (exportButton) exportButton.disabled = !view.export.allowed;
    fill(statusPanel, 
      tag(h('span', { className: `validity ${evaluation.validity}` }, evaluation.validity), { role: 'validity' }),
      notice && tag(h('p', { className: notice.kind }, notice.text), { role: 'notice' }),
      !view.export.allowed && tag(h('p', { className: 'error' }, `PNG 出力ができない: ${view.export.reason}`), { role: 'export-blocked' }),
      h(
        'ul',
        { className: 'issues' },
        ...evaluation.issues.map((i) => h('li', { className: i.effect }, `${i.effect === 'unresolved' ? '未解決' : '注意'}: ${i.message}`)),
        ...view.export.warnings.map((w) => h('li', { className: 'warning' }, w)),
      ),
    );
  }

  // ---------------------------------------------------------------- Parts

  function renderParts() {
    const { character } = session;
    const byPart = new Map<string, EquipmentInstance[]>();
    for (const inst of character.equipment) byPart.set(inst.partId, [...(byPart.get(inst.partId) ?? []), inst]);
    const statusOf = new Map(view.plan?.parts.map((p) => [p.instanceId, p]) ?? []);
    const duplicated = new Set(view.evaluation.issues.flatMap((i) => (i.code === 'category-duplicate' && i.category ? [i.category] : [])));

    const instanceRow = (inst: EquipmentInstance, part: PartManifest | undefined) => {
      const report = statusOf.get(inst.instanceId);
      const state = !inst.equipped ? '外している' : report ? PART_STATUS[report.status] : part ? '装備中' : '不足';
      const cls = !inst.equipped ? 'off' : (report?.status ?? (part ? 'ok' : 'missing'));
      const isBody = inst.instanceId === character.appearance.body;
      return tag(
        h(
          'div',
          { className: `instance ${cls}${session.selected === inst.instanceId ? ' selected' : ''}` },
          h('span', { className: 'badge' }, state),
          button('選択', () => update({ ...session, selected: inst.instanceId }), { action: 'select', instance: inst.instanceId }),
          !isBody && inst.equipped && button('外す', () => update(unequip(session, inst.instanceId)), { action: 'unequip', instance: inst.instanceId }),
          !isBody && !inst.equipped && button('付ける', () => {
            // 1 Part だけの category では、付け直すときも同じ category の装備中の Part を外す。
            if (part && !isMultiCategory(part.category)) update(choosePart(session, set, part.id, newId));
            else update(edit(session, (c) => setEquipped(c, inst.instanceId, true)));
          }, { action: 'reequip', instance: inst.instanceId }),
          !isBody && button('削除', () => update(deleteInstance(session, inst.instanceId)), { action: 'delete', instance: inst.instanceId }),
          report && report.reasons.length > 0 && h('div', { className: 'reason' }, report.reasons.join(' / ')),
        ),
        { instance: inst.instanceId, part: inst.partId, state: cls },
      );
    };

    const categories = new Map<string, PartManifest[]>();
    for (const id of set.order) {
      const part = set.library.get(id);
      if (part) categories.set(part.category, [...(categories.get(part.category) ?? []), part]);
    }

    const blocks = [...categories].map(([category, parts]) =>
      tag(
        h(
          'div',
          { className: 'category' },
          h('h3', {}, category, isMultiCategory(category) && h('span', { className: 'hint' }, '（複数可）')),
          duplicated.has(category) && tag(h('p', { className: 'warning' }, '注意：1 Part だけの category に複数装備されている（両方描画する）'), { role: 'duplicate', category }),
          ...parts.map((part) => {
            const instances = byPart.get(part.id) ?? [];
            const multi = isMultiCategory(category);
            const canAdd = part.kind !== 'body' && (multi || instances.length === 0);
            return h(
              'div',
              { className: 'part' },
              h('div', { className: 'part-head' }, h('span', { className: 'part-name' }, part.name), h('code', {}, part.id),
                canAdd && button(multi ? '追加' : '装備', () => update(choosePart(session, set, part.id, newId)), { action: 'equip', part: part.id })),
              ...instances.map((inst) => instanceRow(inst, part)),
            );
          }),
        ),
        { category },
      ),
    );

    // 読み込まれていない Part の Instance。情報は保持したまま、ここに並べる。
    const missing = view.evaluation.missing;
    fill(partsPanel, 
      h('h2', {}, 'Parts'),
      missing.length > 0 &&
        tag(
          h('div', { className: 'category' }, h('h3', {}, '不足している Part'),
            ...missing.map((inst) => h('div', { className: 'part' }, h('div', { className: 'part-head' }, h('code', {}, inst.partId)), instanceRow(inst, undefined)))),
          { category: 'missing' },
        ),
      ...blocks,
    );
  }

  // ---------------------------------------------------------------- State・Colors・Transform

  function renderState() {
    const { character } = session;
    const { state } = character;
    const body = set.library.get(bodyInstance(character).partId) as Body | undefined;
    const NONE = '';
    const MANUAL = '（個別に選択）';
    return group(
      'State',
      row('VIEW', select(VIEWS, state.view, (v) => apply((c) => setView(c, v)), { state: 'view' })),
      ...Object.keys(REGION_LABEL).map((region) =>
        row(REGION_LABEL[region]!, select(POSE_DEFINITIONS.filter((d) => d.region === region).map((d) => d.id), state.pose[region]!, (v) => apply((c) => setPose(c, region, v)), { state: `pose.${region}` })),
      ),
      row('表情', select([...STANDARD_EXPRESSIONS.map((e) => e.id), [NONE, MANUAL]], expressionPresetOf(state.expression) ?? NONE, (v) => {
        const preset = STANDARD_EXPRESSIONS.find((e) => e.id === v);
        if (preset) apply((c) => setExpression(c, { eyes: preset.eyes, eyebrows: preset.eyebrows, mouth: preset.mouth }));
      }, { state: 'expression' })),
      row('目', select(STANDARD_STATES.eyes, state.expression.eyes, (v) => apply((c) => setExpression(c, { eyes: v })), { state: 'eyes' })),
      row('眉', select(STANDARD_STATES.eyebrows, state.expression.eyebrows, (v) => apply((c) => setExpression(c, { eyebrows: v })), { state: 'eyebrows' })),
      row('口', select(STANDARD_STATES.mouth, state.expression.mouth, (v) => apply((c) => setExpression(c, { mouth: v })), { state: 'mouth' })),
      ...Object.entries(body?.fitDimensions ?? {}).map(([dim, values]) =>
        row(`fit: ${dim}`, select([[NONE, '（指定なし）'], ...values], character.appearance.fit[dim] ?? NONE, (v) =>
          apply((c) => setFit(c, dim, v === NONE ? undefined : v)), { state: `fit.${dim}` })),
      ),
    );
  }

  function renderSharedColors() {
    const { sharedColors } = session.character;
    const keys = [...new Set([...SHARED_KEYS, ...Object.keys(sharedColors)])];
    return group(
      '共有色',
      ...keys.map((key) =>
        h('div', { className: 'row' },
          colorInput(sharedColors[key] ?? '#808080', (color, done) => apply((c) => setSharedColor(c, key, color), { rebuild: done }), { shared: key }),
          h('span', {}, key),
          sharedColors[key] === undefined && h('span', { className: 'hint' }, '（未設定：Part の既定色）')),
      ),
    );
  }

  function renderColors(inst: EquipmentInstance, part: PartManifest | undefined) {
    if (!part) return group('Colors', h('p', { className: 'hint' }, `Part が読み込まれていないため編集できない（保存されている色は保持する: ${Object.keys(inst.colors).join(', ') || 'なし'}）`));
    const slots = (part.colorSlots ?? []).filter((s) => s.mode !== 'fixed');
    if (slots.length === 0) return group('Colors', h('p', { className: 'hint' }, '色を変えられるスロットがない'));
    return group(
      'Colors',
      ...slots.map((slot) => {
        const override = inst.colors[slot.id];
        const linked = slot.link !== undefined && override?.linked !== false;
        const shown = resolveSlotColor(slot, override, session.character.sharedColors);
        const link = slot.link !== undefined && h('input', { type: 'checkbox', checked: linked });
        if (link) {
          tag(link, { link: slot.id });
          // リンクの解除と復帰は、必ず core の操作を使う（解除時に表示色を個別色へコピーするのは core の仕事）。
          link.addEventListener('change', () => apply((c) => (link.checked ? relinkColor(c, inst.instanceId, slot.id) : unlinkColor(c, inst.instanceId, slot))));
        }
        return h('div', { className: 'row' },
          colorInput(shown, (color, done) => apply((c) => setInstanceColor(c, inst.instanceId, slot.id, color), { rebuild: done }), { slot: slot.id }, linked),
          h('span', {}, slot.name ?? slot.id),
          link && h('label', { className: 'link' }, link, `共有色 ${slot.link}`));
      }),
    );
  }

  function renderTransform(inst: EquipmentInstance) {
    const { state } = session.character;
    const conditionOf = (s: typeof scope): TransformCondition | null =>
      s === 'base' ? null : s === 'arm.right' ? { pose: { 'arm.right': state.pose['arm.right']! } } : { view: state.view, pose: { ...state.pose } };
    const when = conditionOf(scope);
    const entry = when ? inst.overrides?.transform?.find((e) => sameCondition(e.when, when)) : undefined;
    const stored: Transform | undefined = when ? entry?.transform : inst.transform;

    // 現在の状態で実際に使われている補正を示す。
    const active = [...(inst.overrides?.transform ?? [])].filter((e) => conditionMatches(e.when, state)).sort((a, b) => conditionSize(b.when) - conditionSize(a.when))[0];
    const activeLabel = active ? `条件別（${JSON.stringify(active.when)}）` : inst.transform ? '基本' : 'なし';

    const field = (label: string, key: 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation', fallback: number, step: string) => {
      const input = tag(h('input', { type: 'number', step, value: String((stored ?? inst.transform)?.[key] ?? fallback) }), { transform: key });
      input.addEventListener('change', () => {
        const value = Number(input.value);
        if (!Number.isFinite(value)) return;
        // 条件別の補正は基本の補正を置き換えるので、初めて作るときは基本の値から始める。
        const next: Transform = { ...(stored ?? inst.transform), [key]: value };
        apply((c) => (when ? setTransformOverride(c, inst.instanceId, when, next) : setTransform(c, inst.instanceId, next)));
      });
      return row(label, input);
    };

    return group(
      'Transform',
      row('適用範囲', select(
        [['base', '基本（すべての状態）'], ['arm.right', `右腕が ${state.pose['arm.right']} のとき`], ['full', '現在の VIEW とポーズすべて']],
        scope,
        (v) => {
          scope = v as typeof scope;
          renderAll();
        },
        { transform: 'scope' },
      )),
      field('X', 'x', 0, '1'),
      field('Y', 'y', 0, '1'),
      field('Scale X', 'scaleX', 1, '0.01'),
      field('Scale Y', 'scaleY', 1, '0.01'),
      field('Rotation（度）', 'rotation', 0, '1'),
      h('div', { className: 'row' },
        button(when ? 'この条件の補正を削除' : '基本の補正を削除', () => apply((c) => (when ? setTransformOverride(c, inst.instanceId, when, undefined) : setTransform(c, inst.instanceId, undefined))), { action: 'transform-clear' }, !stored)),
      tag(h('p', { className: 'hint' }, `現在の状態で使われている補正: ${activeLabel}${when && !entry ? '／この条件の補正は未設定' : ''}`), { role: 'transform-active' }),
    );
  }

  function renderSide() {
    const inst = session.character.equipment.find((i) => i.instanceId === session.selected);
    const part = inst ? set.library.get(inst.partId) : undefined;
    fill(sidePanel, 
      renderState(),
      renderSharedColors(),
      inst
        ? h('div', {}, h('h2', {}, `選択中: ${part?.name ?? inst.partId}`), h('code', {}, inst.instanceId), renderColors(inst, part), renderTransform(inst))
        : h('p', { className: 'hint' }, 'Parts の「選択」で、色と配置補正を編集する Part を選ぶ'),
    );
  }

  function renderAll() {
    renderHeader();
    renderStatus();
    renderParts();
    renderSide();
  }

  root.append(header, h('main', {}, partsPanel, h('section', { className: 'panel preview' }, h('div', { className: 'canvas-wrap' }, canvas), statusPanel), sidePanel));
  renderAll();
  await paint();

  // 自動操作（tools/browser-smoke.ts）用の入口。画面の操作を置き換えるものではなく、結果の確認に使う。
  Object.assign(window, {
    __app: {
      get character() {
        return session.character;
      },
      get inspection() {
        return view;
      },
      idle: () => idle,
      hooks,
    },
  });
}

void main();
