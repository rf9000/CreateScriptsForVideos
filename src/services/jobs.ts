import { mkdirSync, renameSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import type { ItemMode } from '../types/index.ts';
import type { PipelineStage } from './pipeline.ts';

/** A pipeline step, or 'deliver': attaching the script (and video) and posting the comment. */
export type JobPhase = PipelineStage | 'deliver';

/** One item the watcher is working on, as the dashboard reads it from jobs.json. */
export interface Job {
  itemId: number;
  title: string;
  mode: ItemMode;
  phase: JobPhase;
  /** When the item entered its current phase. */
  phaseSince: string;
  startedAt: string;
  updatedAt: string;
}

/**
 * The items in flight, written to <STATE_DIR>/jobs.json on every change so the
 * dashboard can show each item's stage. Bookkeeping only: a failed write is
 * logged and never changes a run.
 */
export class JobBoard {
  private jobs = new Map<number, Job>();

  constructor(
    private path: string,
    private now: () => Date = () => new Date(),
    private write: (path: string, text: string) => void = writeAtomic,
  ) {}

  enter(itemId: number, title: string, mode: ItemMode, phase: JobPhase): void {
    const at = this.now().toISOString();
    const prev = this.jobs.get(itemId);
    this.jobs.set(itemId, {
      itemId, title, mode, phase,
      phaseSince: prev?.phase === phase ? prev.phaseSince : at,
      startedAt: prev?.startedAt ?? at,
      updatedAt: at,
    });
    this.flush();
  }

  finish(itemId: number): void {
    if (this.jobs.delete(itemId)) this.flush();
  }

  private flush(): void {
    try {
      this.write(this.path, `${JSON.stringify({ jobs: [...this.jobs.values()] }, null, 2)}\n`);
    } catch (err) {
      console.log(`  Skipping jobs.json write — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// A rename replaces the file in one step, so a reader never sees half a file.
function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, text, 'utf-8');
  renameSync(`${path}.tmp`, path);
}

const boards = new Map<string, JobBoard>();

/** One board per jobs.json path, shared by every item the process runs. */
export function jobBoard(path: string): JobBoard {
  let board = boards.get(path);
  if (!board) boards.set(path, (board = new JobBoard(path)));
  return board;
}
