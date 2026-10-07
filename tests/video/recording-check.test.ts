import { describe, test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parse } from 'yaml';
import { checkRecording, symbolDirsFor } from '../../src/video/recording-check.ts';
import { buildIndex } from '../../src/video/symbols.ts';

const index = buildIndex([{
  Pages: [{
    Id: 370, Name: 'Bank Account Card',
    Controls: [{ Kind: 1, Name: 'Transfer', Properties: [], Controls: [{ Kind: 8, Name: 'IBAN', Properties: [] }] }],
    Actions: [],
  }],
}]);

function itemDir(recording: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'check-'));
  writeFileSync(join(dir, 'recording.yml'), recording);
  return dir;
}

const good = `description: d
start: { profile: BUSINESS MANAGER, pageId: 370 }
steps:
  - type: input
    target: [{ page: Bank Account Card }, { field: IBAN }]
    value: NL85RABO0347427693
  - type: validate
    target: [{ page: Bank Account Card }, { field: IBAN }]
    operation: "="
    value: NL85RABO0347427693
`;

describe('checkRecording', () => {
  test('clean recording: no problems, FastTab hints written next to it', () => {
    const dir = itemDir(good);
    expect(checkRecording(dir, index)).toEqual([]);
    expect(parse(readFileSync(join(dir, 'recording.staging.yml'), 'utf-8'))).toEqual({ fieldGroups: { IBAN: 'Transfer' } });
  });

  test('reports structure and name problems together, writes no hints', () => {
    const dir = itemDir(good.replace('field: IBAN }]\n    value: NL85RABO0347427693\n  - type: validate', 'field: IBANN }]\n    value: NL85RABO0347427693\n  - type: validat'));
    const problems = checkRecording(dir, index);
    expect(problems).toContain('step 1: unknown step type "validat"');
    expect(problems).toContain('step 0: field "IBANN" is not on page "Bank Account Card" (did you mean "IBAN"?)');
    expect(existsSync(join(dir, 'recording.staging.yml'))).toBe(false);
  });

  test('missing recording.yml is a problem, not a crash', () => {
    expect(checkRecording(mkdtempSync(join(tmpdir(), 'empty-')), index)[0]).toContain('recording.yml not found');
  });
});

describe('symbolDirsFor', () => {
  test('the PTE folder (its own pages) and its .alpackages (everything it builds against)', () => {
    expect(symbolDirsFor('/out/42/pte')).toEqual([join('/out/42/pte', '.alpackages'), '/out/42/pte']);
  });
});
