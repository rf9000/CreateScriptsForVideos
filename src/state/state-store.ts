import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import type { ProcessedState } from '../types/index.ts';

export class StateStore {
  private filePath: string;
  private state: ProcessedState;
  private processedSet: Set<number>;

  private attempts: Map<number, number>;

  constructor(stateDir: string) {
    this.filePath = join(stateDir, 'processed-items.json');
    this.state = this.load();
    this.processedSet = new Set(this.state.processedItemIds);
    this.attempts = new Map(
      Object.entries(this.state.attempts ?? {}).map(([id, n]) => [Number(id), n]),
    );
  }

  private load(): ProcessedState {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8');
        const parsed: unknown = JSON.parse(raw);
        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          'processedItemIds' in parsed &&
          Array.isArray((parsed as ProcessedState).processedItemIds)
        ) {
          return parsed as ProcessedState;
        }
      }
    } catch {
      // file doesn't exist or is corrupted JSON — start fresh
    }
    return { processedItemIds: [], lastRunAt: '' };
  }

  save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    this.state.lastRunAt = new Date().toISOString();
    this.state.attempts = Object.fromEntries(this.attempts);
    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf-8');
  }

  /** Number of times processing has been attempted for an item. */
  attemptCount(itemId: number): number {
    return this.attempts.get(itemId) ?? 0;
  }

  /** Record one more attempt for an item and return the new count. */
  recordAttempt(itemId: number): number {
    const next = this.attemptCount(itemId) + 1;
    this.attempts.set(itemId, next);
    return next;
  }

  isProcessed(itemId: number): boolean {
    return this.processedSet.has(itemId);
  }

  markProcessed(itemId: number): void {
    if (!this.processedSet.has(itemId)) {
      this.processedSet.add(itemId);
      this.state.processedItemIds.push(itemId);
    }
  }

  reset(): void {
    this.state = { processedItemIds: [], lastRunAt: '', attempts: {} };
    this.processedSet = new Set();
    this.attempts = new Map();
    this.save();
  }

  get processedCount(): number {
    return this.state.processedItemIds.length;
  }
}
