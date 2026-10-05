// VALID / INVALID / UNRESOLVED の 3 状態。
// INVALID は JSON だけで決まり、環境（読み込まれている Part など）には左右されない。

import { describe, expect, it } from 'vitest';
import type { CheckResult } from '../../src/core/index.ts';
import { POSE_DEFINITIONS, checkCharacter, deriveRequirements, parseCharacter, unmetRequirements } from '../../src/core/index.ts';
import { env, fixture, library, load, u } from './helpers.ts';

const unresolved = (result: CheckResult) =>
  result.validity === 'INVALID' ? [] : result.evaluation.issues.filter((i) => i.effect === 'unresolved').map((i) => i.code);
const warnings = (result: CheckResult) =>
  result.validity === 'INVALID' ? [] : result.evaluation.issues.filter((i) => i.effect === 'warning').map((i) => i.code);
const patched = (path: string, patch: (json: any) => void) => {
  const json = fixture(path);
  patch(json);
  return json;
};

describe('3 状態', () => {
  it('VALID：JSON が正しく、必要な Part が揃っている', () => {
    const result = checkCharacter(fixture('valid/missing-part.json'), env());
    expect(result.validity).toBe('VALID');
    expect(unresolved(result)).toEqual([]);
  });

  it('UNRESOLVED：JSON は正しいが、Part が読み込まれていない', () => {
    const result = checkCharacter(fixture('valid/missing-part.json'), env('author.special_coat'));
    expect(result.validity).toBe('UNRESOLVED');
    expect(unresolved(result)).toEqual(['part-missing']);
  });

  it('INVALID：JSON そのものが仕様違反。環境に Part が揃っていても変わらない', () => {
    const json = fixture('invalid/instance-id-duplicate.json');
    expect(checkCharacter(json, env()).validity).toBe('INVALID');
    expect(checkCharacter(json, { library: new Map() }).validity).toBe('INVALID');
  });

  it('missing Part ≠ INVALID：Part が 1 つもない環境でも、正しい JSON は INVALID にならない', () => {
    for (const file of ['valid/minimal.json', 'valid/missing-part.json', 'valid/full.json']) {
      expect(checkCharacter(fixture(file), { library: new Map() }).validity, file).toBe('UNRESOLVED');
    }
  });

  it('同じ JSON は、読み込む順序や環境が変わっても INVALID と VALID を行き来しない', () => {
    const json = fixture('valid/missing-part.json');
    const order = [env('author.special_coat'), env(), env('im.hair_01'), env()].map((e) => checkCharacter(json, e).validity);
    expect(order).toEqual(['UNRESOLVED', 'VALID', 'UNRESOLVED', 'VALID']);
  });
});

describe('canvas', () => {
  it('1600×2400 以外は INVALID。環境には左右されない', () => {
    const other = patched('valid/missing-part.json', (c) => (c.canvas = [2000, 3000]));
    for (const e of [env(), { library: new Map() }]) {
      const result = checkCharacter(other, e);
      expect(result.validity).toBe('INVALID');
      expect(result.validity === 'INVALID' && result.errors.map((x) => x.code)).toEqual(['canvas-mismatch']);
    }
    expect(checkCharacter(patched('valid/missing-part.json', (c) => delete c.canvas), env()).validity).toBe('INVALID');
  });
});

describe('UNRESOLVED の原因', () => {
  it('この実装が知らないポーズ（Capability の不足）', () => {
    const json = patched('valid/missing-part.json', (c) => (c.state.pose['arm.right'] = 'crossed'));
    const result = checkCharacter(json, env());
    expect(result.validity).toBe('UNRESOLVED');
    expect(unresolved(result)).toEqual(['pose-unknown']);

    // crossed を知っている実装なら VALID になる
    const newer = { ...env(), poses: [...POSE_DEFINITIONS, { id: 'crossed', region: 'arm.right' as const, placement: 'front' as const, order: 20 }] };
    expect(checkCharacter(json, newer).validity).toBe('VALID');
  });

  it('formatVersion の不一致は INVALID で、Capability の不足（UNRESOLVED）とは区別できる', () => {
    const future = checkCharacter(fixture('invalid/format-version-future.json'), env());
    expect(future.validity).toBe('INVALID');
    expect(future.validity === 'INVALID' && future.errors.map((e) => e.code)).toEqual(['format-version-unsupported']);
  });

  it('この実装が知らない VIEW', () => {
    const result = checkCharacter(patched('valid/missing-part.json', (c) => (c.state.view = 'back')), env());
    expect(unresolved(result)).toEqual(['view-unknown']);
  });

  it('素体が持たない fit の値', () => {
    const result = checkCharacter(patched('valid/missing-part.json', (c) => (c.appearance.fit = { chest: 'huge', waist: 'wide' })), env());
    expect(unresolved(result)).toEqual(['fit-unknown', 'fit-unknown']);
  });

  it('素体が読み込まれていないときは、fit を判定しない（Part の不足だけが挙がる）', () => {
    const result = checkCharacter(patched('valid/missing-part.json', (c) => (c.appearance.fit = { chest: 'huge' })), env('im.body_01'));
    expect(unresolved(result)).toEqual(['part-missing']);
  });

  it('素体として参照された Part が Body ではない', () => {
    const json = patched('valid/minimal.json', (c) => (c.equipment[0].partId = 'im.hair_01'));
    expect(unresolved(checkCharacter(json, env()))).toEqual(['body-kind']);
  });
});

describe('判定に影響しない注意', () => {
  it('外している Part が読み込まれていなくても VALID', () => {
    const result = checkCharacter(fixture('valid/full.json'), env('im.hat_01'));
    expect(result.validity).toBe('VALID');
    expect(warnings(result)).toContain('part-missing-unequipped');
  });

  it('Part が宣言していないスロットの色は保持し、注意だけ出す', () => {
    const result = checkCharacter(fixture('valid/missing-part.json'), env());
    expect(warnings(result)).toEqual(['color-slot-unknown']);
    expect(result.validity !== 'INVALID' && result.character.equipment[1]!.colors.lining).toEqual({ linked: false, color: '#C8A85A' });
  });

  it('1 Part だけの category に複数装備している', () => {
    const json = patched('valid/missing-part.json', (c) => c.equipment.push({ instanceId: u(77), partId: 'im.hair_01', equipped: true }));
    const result = checkCharacter(json, env());
    expect(result.validity).toBe('VALID');
    expect(warnings(result)).toContain('category-duplicate');
    // overlay は複数装備できる category
    expect(warnings(checkCharacter(fixture('valid/full.json'), env()))).not.toContain('category-duplicate');
  });
});

describe('requirements（導出できるキャッシュ）', () => {
  it('State と Equipment から導出する。外している Part は含めない', () => {
    expect(deriveRequirements(load('valid/full.json'))).toEqual({
      parts: ['im.body_01', 'im.hair_01', 'im.overlay_01'],
      view: ['front'],
      pose: { 'arm.left': ['down'], 'arm.right': ['pocket'], torso: ['stand'] },
      fit: { chest: ['large'] },
      state: { eyebrows: ['sad'], eyes: ['wide'], mouth: ['closed'] },
    });
  });

  it('保存された requirements が古くても、Character は壊れない（注意だけ出す）', () => {
    const stale = patched('valid/missing-part.json', (c) => (c.requirements.parts = ['im.nothing']));
    const result = checkCharacter(stale, env());
    expect(result.validity).toBe('VALID');
    expect(result.validity !== 'INVALID' && result.warnings.map((w) => w.code)).toEqual(['requirements-stale']);
  });

  it('requirements の形が崩れていても、なくても読める', () => {
    const broken = checkCharacter(patched('valid/missing-part.json', (c) => (c.requirements = 'broken')), env());
    expect(broken.validity).toBe('VALID');
    expect(broken.validity !== 'INVALID' && broken.warnings.map((w) => w.code)).toEqual(['requirements-malformed']);
    const none = checkCharacter(patched('valid/missing-part.json', (c) => delete c.requirements), env());
    expect(none.validity !== 'INVALID' && none.warnings).toEqual([]);
  });

  it('環境が満たせないものを、種類ごとに列挙できる', () => {
    const req = deriveRequirements(load('valid/missing-part.json'));
    req.pose['arm.left'] = ['crossed'];
    const unmet = unmetRequirements(req, { library: library('author.special_coat', 'im.hair_01') });
    expect(unmet.map((x) => `${x.kind}:${x.what}`)).toEqual(['part:author.special_coat', 'part:im.hair_01', 'pose:arm.left=crossed']);
  });
});

describe('読み込み', () => {
  it('JSON として壊れている文字列は INVALID 相当で返す', () => {
    const result = parseCharacter('{ "format": ');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]!.code).toBe('json-syntax');
  });
});
