import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { appendRun, capError, itemSpend, summarizeError } from '../../src/services/cost-ledger.ts';
import type { RunRecord } from '../../src/services/cost-ledger.ts';

const run = (overrides: Partial<RunRecord> = {}): RunRecord => ({
  at: '2026-10-13T10:00:00.000Z',
  workItemId: 42,
  title: 'Demo merge rules',
  outcome: 'completed',
  mode: 'script',
  runCostUsd: 1.5,
  stages: [],
  ...overrides,
});

describe('cost ledger', () => {
  let dir: string;
  let path: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ledger-'));
    path = join(dir, 'state', 'cost-ledger.jsonl');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const lines = () => readFileSync(path, 'utf-8').trim().split('\n').map((l) => JSON.parse(l));

  test('creates the file and writes one JSON line per run', () => {
    appendRun(path, run());
    expect(lines()).toEqual([{ ...run(), costUsd: 1.5 }]);
  });

  test('costUsd is the item spend so far, across retagged runs', () => {
    appendRun(path, run({ runCostUsd: 1.5 }));
    appendRun(path, run({ workItemId: 7, runCostUsd: 9 }));
    appendRun(path, run({ at: '2026-10-13T12:00:00.000Z', runCostUsd: 0.25 }));
    expect(lines().map((l) => l.costUsd)).toEqual([1.5, 9, 1.75]);
  });

  test('itemSpend skips lines it cannot read', () => {
    writeFileSync(join(dir, 'l.jsonl'), 'not json\n{"workItemId":42,"at":"2026-10-01T00:00:00Z","costUsd":2}\n\n');
    expect(itemSpend(join(dir, 'l.jsonl'), 42)).toBe(2);
    expect(itemSpend(join(dir, 'missing.jsonl'), 42)).toBe(0);
  });

  test('summarizeError takes the first non-empty line, capped', () => {
    expect(summarizeError('\n  boom  \nstack')).toBe('boom');
    expect(summarizeError('x'.repeat(500))).toHaveLength(200);
  });

  test('capError keeps short errors and truncates long ones', () => {
    expect(capError('short')).toBe('short');
    expect(capError('y'.repeat(9000))).toEndWith('… (truncated)');
  });
});
