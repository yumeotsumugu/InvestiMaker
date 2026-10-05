// character.schema.json と実装の検証器が、fixtures に対して同じ判定をすること。

import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { serializeCharacter, validateCharacterJson } from '../../src/core/index.ts';
import { fixture, load } from './helpers.ts';

interface Cases {
  valid: string[];
  invalid: { file: string; code: string; schema: boolean }[];
}

const cases = fixture('cases.json') as unknown as Cases;
const schema = JSON.parse(readFileSync(new URL('../../schemas/character.schema.json', import.meta.url), 'utf8')) as object;
const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

describe('character.schema.json', () => {
  it('JSON Schema（draft 2020-12）として正しい', () => {
    expect(typeof validateSchema).toBe('function');
  });

  it.each(cases.valid)('%s は Schema と検証器の両方を通る', (file) => {
    const json = fixture(file);
    expect(validateSchema(json), JSON.stringify(validateSchema.errors)).toBe(true);
    expect(validateCharacterJson(json).errors).toEqual([]);
  });

  it.each(cases.invalid)('$file は検証器が $code で拒否する', ({ file, code }) => {
    const result = validateCharacterJson(fixture(file));
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain(code);
  });

  it.each(cases.invalid.filter((c) => c.schema))('$file は Schema でも拒否される', ({ file }) => {
    expect(validateSchema(fixture(file))).toBe(false);
  });

  it('Schema で表せない規則（instanceId の重複、appearance.body の参照先、条件別の補正の重複）は検証器だけが拒否する', () => {
    const beyond = cases.invalid.filter((c) => !c.schema);
    expect(beyond.map((c) => c.code).sort()).toEqual(['appearance-body-ref', 'appearance-body-ref', 'instance-id-duplicate', 'override-overlap', 'override-overlap']);
    for (const { file } of beyond) expect(validateSchema(fixture(file)), file).toBe(true);
  });

  it('保存した JSON は必ず Schema を通る', () => {
    for (const file of cases.valid) {
      const json = JSON.parse(JSON.stringify(serializeCharacter(load(file)))) as unknown;
      expect(validateSchema(json), `${file}: ${JSON.stringify(validateSchema.errors)}`).toBe(true);
    }
  });

  it('未知のフィールドは Schema でも検証器でも許可される', () => {
    const json = fixture('valid/full.json');
    expect(json.futureTopLevelField).toBeDefined();
    expect(validateSchema(json)).toBe(true);
    expect(validateCharacterJson(json).ok).toBe(true);
  });

  it('JSON として壊れた値も例外にせず拒否する', () => {
    for (const input of [null, 42, 'text', [], undefined]) {
      expect(validateCharacterJson(input).errors.map((e) => e.code)).toEqual(['not-object']);
    }
  });
});
