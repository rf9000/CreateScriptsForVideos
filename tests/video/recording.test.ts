import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { lintRecording, loadVideoInputs } from '../../src/video/recording.ts';
import type { Recording } from '../../src/video/recording.ts';

const good: Recording = {
  description: 'IBAN autofill',
  start: { profile: 'BUSINESS MANAGER' },
  steps: [
    { type: 'navigate', target: [{ page: 'Business Manager Role Center' }, { action: 'Bank Accounts' }] },
    { type: 'page-shown', source: { page: 'Bank Account List' }, runtimeId: 'bca' },
    { type: 'invoke', target: [{ page: 'Bank Account List', runtimeRef: 'bca' }, { action: 'Control_New' }], invokeType: 'New' },
    { type: 'page-shown', source: { page: 'Bank Account Card' }, runtimeId: 'bhi' },
    { type: 'input', target: [{ page: 'Bank Account Card', runtimeRef: 'bhi' }, { field: 'IBAN' }], value: 'NL85RABO0347427693' },
    { type: 'validate', target: [{ page: 'Bank Account Card', runtimeRef: 'bhi' }, { field: 'City' }], operation: '=', value: 'UTRECHT' },
  ],
};

describe('lintRecording', () => {
  test('accepts a recording in BC format', () => {
    expect(lintRecording(good)).toEqual([]);
  });

  test('rejects unknown step types and caption-only actions (V1 format)', () => {
    const v1: Recording = {
      description: 'x',
      steps: [{ type: 'action', caption: 'All Direct', target: [{ page: 'X' }] }, good.steps[5]!],
    };
    expect(lintRecording(v1)).toContain('step 0: unknown step type "action"');
  });

  test('requires a validate step', () => {
    expect(lintRecording({ ...good, steps: good.steps.slice(0, 5) })).toContain(
      'no validate step: the recording must prove the demo outcome',
    );
  });

  test('requires runtimeRef to match an earlier page-shown runtimeId', () => {
    const bad: Recording = {
      ...good,
      steps: [
        { type: 'input', target: [{ page: 'Bank Account Card', runtimeRef: 'zzz' }, { field: 'IBAN' }], value: 'x' },
        good.steps[5]!,
      ],
    };
    expect(lintRecording(bad)).toContain('step 0: runtimeRef "zzz" has no earlier page-shown runtimeId');
  });

  test('requires a value on input and validate steps', () => {
    const bad: Recording = {
      ...good,
      steps: [...good.steps.slice(0, 4), { type: 'input', target: [{ page: 'Bank Account Card', runtimeRef: 'bhi' }, { field: 'IBAN' }] }, good.steps[5]!],
    };
    expect(lintRecording(bad)).toContain('step 4: input step has no value');
  });
});

describe('loadVideoInputs', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'video-in-'));
    writeFileSync(join(dir, 'recording.yml'), 'description: d\nsteps:\n  - type: wait\n    time: 10\n');
    writeFileSync(join(dir, 'narration.yml'), 'steps:\n  0: Hello there.\n  "x": ignored\n');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test('loads recording and narration, hints default to empty', () => {
    const inputs = loadVideoInputs(dir);
    expect(inputs.recording.steps).toHaveLength(1);
    expect(inputs.narration).toEqual({ 0: 'Hello there.' });
    expect(inputs.hints).toEqual({});
  });

  test('throws when recording.yml is missing', () => {
    expect(() => loadVideoInputs(join(dir, 'nope'))).toThrow('recording.yml');
  });
});
