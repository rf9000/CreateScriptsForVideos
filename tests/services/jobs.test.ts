import { describe, test, expect } from 'bun:test';
import { JobBoard } from '../../src/services/jobs.ts';

describe('JobBoard', () => {
  test('writes the items in flight with their phase and when it started', () => {
    let now = new Date('2026-10-20T10:00:00Z');
    const writes: string[] = [];
    const board = new JobBoard('/s/jobs.json', () => now, (_p, text) => writes.push(text));
    board.enter(42, 'Demo', 'video', 'generate');
    now = new Date('2026-10-20T10:05:00Z');
    board.enter(42, 'Demo', 'video', 'generate');
    now = new Date('2026-10-20T10:20:00Z');
    board.enter(42, 'Demo', 'video', 'deploy');
    const last = JSON.parse(writes.at(-1)!);
    expect(last.jobs).toEqual([{
      itemId: 42, title: 'Demo', mode: 'video', phase: 'deploy',
      phaseSince: '2026-10-20T10:20:00.000Z', startedAt: '2026-10-20T10:00:00.000Z', updatedAt: '2026-10-20T10:20:00.000Z',
    }]);
    expect(JSON.parse(writes[1]!).jobs[0].phaseSince).toBe('2026-10-20T10:00:00.000Z');
    board.finish(42);
    expect(JSON.parse(writes.at(-1)!).jobs).toEqual([]);
  });

  test('a failed write does not throw', () => {
    const board = new JobBoard('/s/jobs.json', () => new Date(), () => { throw new Error('disk full'); });
    expect(() => board.enter(1, 't', 'script', 'generate')).not.toThrow();
  });
});
