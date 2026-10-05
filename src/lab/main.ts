// 検証ページ。使い捨ての前提で、素の DOM だけで書く。

import './style.css';
import type { Body, LayerStatus, PartStatus } from '../core/index.ts';
import { STANDARD_EXPRESSIONS, STANDARD_STATES, resolveSlotColor } from '../core/index.ts';
import type { BenchResult } from './bench.ts';
import { runBench } from './bench.ts';
import type { RenderStats } from './composer.ts';
import { Composer } from './composer.ts';
import type { AssetSet } from './loader.ts';
import { loadSet } from './loader.ts';
import type { LabState, Planned } from './state.ts';
import { DEFAULT_SHARED, initialState, planOf } from './state.ts';

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false));
  return el;
}

const PART_STATUS: Record<PartStatus, string> = { ok: '対応', missing: '不足', unsupported: '非対応', conflict: '競合' };
const LAYER_STATUS: Record<LayerStatus, string> = {
  draw: '描画',
  omitted: '省略（optional）',
  unresolved: '未解決',
  hidden: '非表示（hides）',
  skipped: '描画しない',
};
const SHARED_LABEL: Record<string, string> = {
  'skin.base': '肌 skin.base',
  'hair.base': '髪 hair.base',
  'eyes.left': '左の瞳 eyes.left',
  'eyes.right': '右の瞳 eyes.right',
};

const ms = (v: number) => `${v.toFixed(1)} ms`;
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const mpx = (pixels: number) => `${(pixels / 1e6).toFixed(2)} Mpx`;

async function main() {
  const app = document.querySelector<HTMLDivElement>('#app')!;
  const params = new URLSearchParams(location.search);
  const setName = params.get('set') ?? 'development';

  let set: AssetSet;
  try {
    set = await loadSet(setName);
  } catch (e) {
    app.append(h('p', { className: 'error' }, `素材セット "${setName}" を読み込めない: ${String(e)}`));
    return;
  }

  const state: LabState = initialState(set);
  const canvas = h('canvas', { className: 'preview-canvas' });
  const composer = new Composer(set, canvas);

  let planned: Planned = planOf(set, state);
  let firstStats: RenderStats | null = null;
  let lastStats: RenderStats | null = null;
  let colorStats: RenderStats | null = null;
  let renderError: string | null = null;

  // ---------------------------------------------------------------- 合成

  let running = false;
  let pending: 'color' | 'other' | null = null;
  let idle: Promise<void> = Promise.resolve();

  /** 状態を反映して再合成する。合成中に呼ばれた分は 1 回にまとめる。 */
  function update(reason: 'color' | 'other' = 'other'): Promise<void> {
    pending = pending === 'other' ? 'other' : reason;
    if (!running) {
      running = true;
      idle = (async () => {
        while (pending) {
          const why = pending;
          pending = null;
          planned = planOf(set, state);
          try {
            const stats = await composer.render(planned.plan, planned.colors, state.multiply ? 'multiply' : undefined);
            firstStats ??= stats;
            lastStats = stats;
            if (why === 'color') colorStats = stats;
            renderError = null;
          } catch (e) {
            renderError = String(e);
          }
          renderResults();
          renderMetrics();
        }
        running = false;
      })();
    }
    return idle;
  }

  // ---------------------------------------------------------------- 操作

  const controls = h('section', { className: 'controls' });
  const partColors = h('div');
  const linkedInputs: { input: HTMLInputElement; partId: string; slotId: string }[] = [];

  function group(title: string, ...children: Child[]) {
    return h('fieldset', {}, h('legend', {}, title), ...children);
  }

  function checkbox(label: string, checked: boolean, onChange: (checked: boolean) => void, disabled = false) {
    const input = h('input', { type: 'checkbox', checked, disabled });
    input.addEventListener('change', () => onChange(input.checked));
    return h('label', { className: 'row' }, input, label);
  }

  function select(options: readonly string[], value: string, onChange: (value: string) => void) {
    const el = h('select', {}, ...options.map((o) => h('option', { value: o, selected: o === value }, o)));
    el.addEventListener('change', () => onChange(el.value));
    return el;
  }

  function colorInput(value: string, onInput: (value: string) => void) {
    const input = h('input', { type: 'color', value: value.toLowerCase() });
    input.addEventListener('input', () => onInput(input.value.toUpperCase()));
    return input;
  }

  function buildParts() {
    return group(
      'Part の着脱',
      ...set.order.map((id) => {
        const part = set.library.get(id);
        if (!part) return h('div', { className: 'row error' }, `${id}（検証で拒否）`);
        return checkbox(
          `${part.name}  [${part.category}]`,
          state.equipped.includes(id),
          (on) => {
            state.equipped = on ? [...state.equipped, id] : state.equipped.filter((e) => e !== id);
            buildPartColors();
            void update();
          },
          part.kind === 'body',
        );
      }),
    );
  }

  function buildExpression() {
    const MANUAL = '（手動）';
    const wrap = h('div');
    const rebuild = () => {
      const row = (label: string, key: 'eyes' | 'eyebrows' | 'mouth') =>
        h(
          'label',
          { className: 'row' },
          h('span', { className: 'label' }, label),
          select(STANDARD_STATES[key], state.expression[key], (v) => {
            const next = { ...state.expression, [key]: v };
            const preset = STANDARD_EXPRESSIONS.find((e) => e.eyes === next.eyes && e.eyebrows === next.eyebrows && e.mouth === next.mouth);
            state.expression = { ...next, id: preset?.id };
            rebuild();
            void update();
          }),
        );
      wrap.replaceChildren(
        h(
          'label',
          { className: 'row' },
          h('span', { className: 'label' }, '表情'),
          select([...STANDARD_EXPRESSIONS.map((e) => e.id), MANUAL], state.expression.id ?? MANUAL, (v) => {
            const preset = STANDARD_EXPRESSIONS.find((e) => e.id === v);
            if (preset) state.expression = { ...preset };
            rebuild();
            void update();
          }),
        ),
        row('目', 'eyes'),
        row('眉', 'eyebrows'),
        row('口', 'mouth'),
      );
    };
    rebuild();
    return group('表情（§6.3）', wrap);
  }

  function buildPose() {
    const body = set.library.get(set.body) as Body | undefined;
    const radios = ['down', 'pocket'].map((pose) => {
      const input = h('input', { type: 'radio', name: 'arm-right', checked: state.armRight === pose });
      input.addEventListener('change', () => {
        state.armRight = pose;
        void update();
      });
      return h('label', { className: 'row' }, input, pose);
    });
    return group(
      'ポーズと fit',
      h('div', { className: 'row' }, h('span', { className: 'label' }, '右腕'), ...radios),
      h(
        'label',
        { className: 'row' },
        h('span', { className: 'label' }, '胸部'),
        select(body?.fitDimensions?.chest ?? ['medium'], state.chest, (v) => {
          state.chest = v;
          void update();
        }),
      ),
    );
  }

  function syncLinkedInputs() {
    for (const { input, partId, slotId } of linkedInputs) {
      const slot = set.library.get(partId)?.colorSlots?.find((s) => s.id === slotId);
      if (!slot) continue;
      const override = state.overrides[partId]?.[slotId];
      input.value = resolveSlotColor(slot, override, state.shared).toLowerCase();
      input.disabled = slot.link !== undefined && override?.linked !== false;
    }
  }

  function buildShared() {
    return group(
      '共有カラー（§5.4）',
      ...Object.keys(DEFAULT_SHARED).map((key) =>
        h(
          'label',
          { className: 'row' },
          colorInput(state.shared[key]!, (v) => {
            state.shared[key] = v;
            syncLinkedInputs();
            void update('color');
          }),
          SHARED_LABEL[key] ?? key,
        ),
      ),
    );
  }

  function buildPartColors() {
    linkedInputs.length = 0;
    const blocks = state.equipped.flatMap((partId) => {
      const part = set.library.get(partId);
      const slots = (part?.colorSlots ?? []).filter((s) => s.mode !== 'fixed'); // fixed は UI に出さない（§5.3）
      if (!part || slots.length === 0) return [];
      const rows = slots.map((slot) => {
        const overrideOf = () => ((state.overrides[partId] ??= {})[slot.id] ??= {});
        const input = colorInput(resolveSlotColor(slot, state.overrides[partId]?.[slot.id], state.shared), (v) => {
          overrideOf().color = v;
          void update('color');
        });
        linkedInputs.push({ input, partId, slotId: slot.id });
        const link =
          slot.link !== undefined &&
          checkbox(`共有 ${slot.link}`, state.overrides[partId]?.[slot.id]?.linked !== false, (on) => {
            const override = overrideOf();
            override.linked = on;
            // 解除した瞬間は見た目を変えない（そのときの共有色を個別色の初期値にする）。
            if (!on) override.color ??= state.shared[slot.link!] ?? slot.default;
            syncLinkedInputs();
            void update('color');
          });
        return h('div', { className: 'row' }, input, h('span', { className: 'label' }, slot.name ?? slot.id), link);
      });
      return [h('div', { className: 'part-colors' }, h('div', { className: 'part-name' }, part.name), ...rows)];
    });
    partColors.replaceChildren(...blocks);
    syncLinkedInputs();
  }

  function buildCompare() {
    const toggle = (label: string, key: 'browsOver' | 'shoesOver' | 'multiply' | 'drawConflicted') =>
      checkbox(label, state[key], (on) => {
        state[key] = on;
        void update(key === 'multiply' ? 'color' : 'other');
      });
    return group(
      '比較用の切り替え',
      toggle('眉を前髪の前に置く（face.eyebrows.over）', 'browsOver'),
      toggle('靴をボトムスの上に置く（outfit.shoes.over）', 'shoesOver'),
      toggle('色合成を multiply にする（標準は tint）', 'multiply'),
      toggle('競合の Part も描画する', 'drawConflicted'),
    );
  }

  controls.append(buildParts(), buildExpression(), buildPose(), buildCompare(), buildShared(), group('Part ごとの色', partColors));
  buildPartColors();

  // ---------------------------------------------------------------- 結果

  const partList = h('div');
  const tableBody = h('tbody');
  const metrics = h('div', { className: 'metrics' });
  const benchOut = h('div');

  function renderResults() {
    const { plan } = planned;
    const rejected = [...set.validation].filter(([, v]) => !v.ok);
    const warned = [...set.validation].filter(([, v]) => v.warnings.length > 0);
    partList.replaceChildren(
      ...(renderError ? [h('p', { className: 'error' }, `合成エラー: ${renderError}`)] : []),
      ...rejected.map(([id, v]) =>
        h('p', { className: 'error' }, `${id}: 検証で拒否 — ${v.errors.map((e) => `${e.path}: ${e.message}`).join(' / ')}`),
      ),
      ...warned.map(([id, v]) => h('p', { className: 'warn' }, `${id}: 警告 — ${v.warnings.map((e) => `${e.path}: ${e.message}`).join(' / ')}`)),
      h(
        'ul',
        { className: 'part-list' },
        ...plan.parts.map((p) =>
          h(
            'li',
            { className: `status-${p.status}` },
            h('span', { className: 'badge' }, PART_STATUS[p.status]),
            ` ${set.library.get(p.partId)?.name ?? p.partId} `,
            h('code', {}, p.partId),
            p.reasons.length > 0 && h('div', { className: 'reason' }, p.reasons.join(' / ') + (p.status === 'conflict' && p.drawn ? '（描画はする）' : '')),
          ),
        ),
      ),
    );

    tableBody.replaceChildren(
      ...plan.entries.map((e, i) =>
        h(
          'tr',
          { className: `layer-${e.status}` },
          h('td', {}, String(i + 1)),
          h('td', {}, h('code', {}, e.slot), e.slot !== e.layer.slot && ` ← ${e.layer.slot}`),
          h('td', {}, e.partId),
          h('td', {}, e.layer.id),
          h('td', {}, e.asset ? e.asset.file.replace(/^.*\//, '') : '—'),
          h('td', {}, LAYER_STATUS[e.status]),
        ),
      ),
    );
  }

  function renderMetrics() {
    const line = (label: string, s: RenderStats | null) =>
      h(
        'tr',
        {},
        h('th', {}, label),
        h('td', {}, s ? ms(s.totalMs) : '—'),
        h('td', {}, s ? `読込 ${ms(s.loadMs)} ＋ 色変更 ${ms(s.recolorMs)}（${s.recolored} 枚、${mpx(s.recoloredPixels)}）＋ 描画 ${ms(s.drawMs)}（${s.drawn} 枚）` : ''),
      );
    const mem = composer.memory();
    const allPixels = set.index.parts.reduce((sum, p) => sum + p.pixels, 0);
    metrics.replaceChildren(
      h(
        'table',
        {},
        line('初回合成', firstStats),
        line('色変更後の再合成', colorStats),
        line('直近の合成', lastStats),
        h(
          'tr',
          {},
          h('th', {}, 'メモリ見積もり'),
          h('td', {}, mb(mem.bytes)),
          h('td', {}, `読み込んだ画像 ${mem.images} 枚 ${mpx(mem.sourcePixels)} ＋ 色変更キャッシュ ${mpx(mem.cachePixels)} ＋ キャンバス ${mpx(mem.canvasPixels)}、1 画素 4 バイト`),
        ),
        h('tr', {}, h('th', {}, '素材セット全体'), h('td', {}, mb(allPixels * 4)), h('td', {}, `全 Asset と Mask を読んだ場合 ${mpx(allPixels)}`)),
      ),
    );
  }

  function renderBench(result: BenchResult) {
    benchOut.replaceChildren(h('h3', {}, '計測結果'), h('pre', { id: 'bench-result' }, JSON.stringify(result, null, 2)));
  }

  // ---------------------------------------------------------------- 画面

  const exportButton = h('button', {}, 'PNG 書き出し（透過）');
  exportButton.addEventListener('click', () => {
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = h('a', { href: URL.createObjectURL(blob), download: `investimaker-lab-${set.width}x${set.height}.png` });
      a.click();
      URL.revokeObjectURL(a.href);
    }, 'image/png');
  });

  const benchButton = h('button', {}, '計測を実行');
  const doBench = async () => {
    benchButton.disabled = true;
    benchOut.replaceChildren(h('p', {}, '計測中…'));
    const result = await runBench(set);
    renderBench(result);
    benchButton.disabled = false;
    return result;
  };
  benchButton.addEventListener('click', () => void doBench());

  app.append(
    h(
      'header',
      {},
      h('h1', {}, 'InvestiMaker Lab'),
      h('span', {}, `Phase 0 検証ページ — 素材セット ${set.name}、キャンバス ${set.width}×${set.height}、Part ${set.library.size} 個`),
    ),
    h(
      'main',
      {},
      controls,
      h('section', { className: 'preview' }, h('div', { className: 'canvas-wrap' }, canvas), h('div', { className: 'buttons' }, exportButton, benchButton), metrics, benchOut),
      h(
        'section',
        { className: 'results' },
        h('h2', {}, 'Part の状態'),
        partList,
        h('h2', {}, '解決結果（描画順：奥 → 手前）'),
        h(
          'table',
          { className: 'layers' },
          h('thead', {}, h('tr', {}, ...['#', 'Layer Slot', 'Part', 'Layer', 'Asset', '状態'].map((t) => h('th', {}, t)))),
          tableBody,
        ),
      ),
    ),
  );

  await update();

  // 自動操作（tools/browser-bench.ts）用の入口。
  const lab = { set, state, update, bench: doBench, exportPng: () => canvas.toDataURL('image/png'), rebuildColors: buildPartColors };
  Object.assign(window, { __lab: lab });
  if (params.has('bench')) Object.assign(window, { __benchResult: await doBench() });
}

void main();
