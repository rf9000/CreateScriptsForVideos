import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname } from 'path';
import type { LedgerRecord } from '../types/index.ts';

/** A finished run before the ledger adds the item's earlier spend. */
export type RunRecord = Omit<LedgerRecord, 'costUsd'>;

const MAX_REASON_CHARS = 200;
const MAX_ERROR_CHARS = 8000;

/** First non-empty line of an error, short enough for a list row. */
export function summarizeError(text: string): string {
  const line = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  return line.length > MAX_REASON_CHARS ? `${line.slice(0, MAX_REASON_CHARS - 1)}…` : line;
}

/** The full error output, capped so one run can't bloat the ledger. */
export function capError(text: string): string {
  return text.length > MAX_ERROR_CHARS ? `${text.slice(0, MAX_ERROR_CHARS)}\n… (truncated)` : text;
}

/** The item's spend so far: the costUsd of its latest ledger line, 0 when it has none. */
export function itemSpend(path: string, workItemId: number): number {
  if (!existsSync(path)) return 0;
  let latest: { at: string; costUsd: number } | undefined;
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    let entry: Partial<LedgerRecord>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.workItemId !== workItemId || typeof entry.costUsd !== 'number' || typeof entry.at !== 'string') continue;
    if (!latest || latest.at < entry.at) latest = { at: entry.at, costUsd: entry.costUsd };
  }
  return latest?.costUsd ?? 0;
}

/**
 * Append one run to the JSONL ledger. costUsd is the item's spend so far (the
 * dashboard sums the latest line per item), so a retagged item's line includes
 * its earlier runs. Throws on I/O errors; the caller decides whether that matters.
 */
export function appendRun(path: string, run: RunRecord): void {
  const costUsd = Math.round((itemSpend(path, run.workItemId) + run.runCostUsd) * 10_000) / 10_000;
  const record: LedgerRecord = { ...run, costUsd };
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, 'utf-8');
}
