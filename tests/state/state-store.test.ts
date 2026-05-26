import { describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { StateStore } from '../../src/state/state-store.ts';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'state-store-test-'));
}

describe('StateStore', () => {
  it('save + load roundtrip preserves processed items', () => {
    const dir = makeTmpDir();
    const store = new StateStore(dir);

    store.markProcessed(101);
    store.markProcessed(202);
    store.markProcessed(303);
    store.save();

    const store2 = new StateStore(dir);

    expect(store2.isProcessed(101)).toBe(true);
    expect(store2.isProcessed(202)).toBe(true);
    expect(store2.isProcessed(303)).toBe(true);
    expect(store2.processedCount).toBe(3);
  });

  it('starts empty when the state file does not exist', () => {
    const dir = makeTmpDir();
    const subDir = join(dir, 'nonexistent', 'nested');
    const store = new StateStore(subDir);

    expect(store.processedCount).toBe(0);
    expect(store.isProcessed(1)).toBe(false);
  });

  it('starts fresh when the state file contains corrupt JSON', () => {
    const dir = makeTmpDir();
    const filePath = join(dir, 'processed-items.json');
    writeFileSync(filePath, '{{not valid json!!!', 'utf-8');

    const store = new StateStore(dir);

    expect(store.processedCount).toBe(0);
    expect(store.isProcessed(1)).toBe(false);
  });

  it('does not duplicate when marking the same item twice', () => {
    const dir = makeTmpDir();
    const store = new StateStore(dir);

    store.markProcessed(42);
    store.markProcessed(42);

    expect(store.processedCount).toBe(1);
  });

  it('isProcessed returns false for unprocessed IDs', () => {
    const dir = makeTmpDir();
    const store = new StateStore(dir);

    store.markProcessed(1);

    expect(store.isProcessed(1)).toBe(true);
    expect(store.isProcessed(2)).toBe(false);
    expect(store.isProcessed(999)).toBe(false);
  });

  it('reset clears all state and persists the empty state', () => {
    const dir = makeTmpDir();
    const store = new StateStore(dir);

    store.markProcessed(10);
    store.markProcessed(20);
    store.save();

    store.reset();

    expect(store.processedCount).toBe(0);
    expect(store.isProcessed(10)).toBe(false);
    expect(store.isProcessed(20)).toBe(false);

    const store2 = new StateStore(dir);
    expect(store2.processedCount).toBe(0);
  });

  it('attemptCount defaults to 0 for unseen items', () => {
    const store = new StateStore(makeTmpDir());
    expect(store.attemptCount(7)).toBe(0);
  });

  it('recordAttempt increments and returns the new count', () => {
    const store = new StateStore(makeTmpDir());
    expect(store.recordAttempt(7)).toBe(1);
    expect(store.recordAttempt(7)).toBe(2);
    expect(store.attemptCount(7)).toBe(2);
  });

  it('persists attempt counts across reloads', () => {
    const dir = makeTmpDir();
    const store = new StateStore(dir);
    store.recordAttempt(7);
    store.recordAttempt(7);
    store.save();

    const store2 = new StateStore(dir);
    expect(store2.attemptCount(7)).toBe(2);
  });

  it('processedCount returns the correct count', () => {
    const dir = makeTmpDir();
    const store = new StateStore(dir);

    expect(store.processedCount).toBe(0);

    store.markProcessed(1);
    expect(store.processedCount).toBe(1);

    store.markProcessed(2);
    expect(store.processedCount).toBe(2);

    store.markProcessed(3);
    expect(store.processedCount).toBe(3);
  });
});
