// 仕様書 §8：`requires` / `conflicts` の判定。

import type { Context } from './context.ts';
import { contextValue } from './context.ts';
import type { Condition, PartManifest } from './manifest.ts';

function describe(c: Condition): string {
  switch (c.type) {
    case 'part':
      return `Part ${c.id}`;
    case 'category':
      return `category ${c.category}`;
    case 'state':
      return `${c.path} = ${c.value}`;
  }
}

function holds(c: Condition, self: PartManifest, equipped: readonly PartManifest[], ctx: Context): boolean {
  switch (c.type) {
    case 'part':
      return equipped.some((p) => p !== self && p.id === c.id);
    case 'category':
      return equipped.some((p) => p !== self && p.category === c.category);
    case 'state':
      return contextValue(ctx, c.path) === c.value;
  }
}

/**
 * 競合の理由を返す（空なら競合なし）。
 * `equipped` は装備中で見つかった Part すべて。相手が非対応で描画されないかどうかは問わない。
 */
export function conflictReasons(
  part: PartManifest,
  equipped: readonly PartManifest[],
  ctx: Context,
): string[] {
  const reasons: string[] = [];
  for (const c of part.requires ?? []) {
    if (!holds(c, part, equipped, ctx)) reasons.push(`requires を満たさない: ${describe(c)}`);
  }
  for (const c of part.conflicts ?? []) {
    if (holds(c, part, equipped, ctx)) reasons.push(`conflicts に該当: ${describe(c)}`);
  }
  return reasons;
}
