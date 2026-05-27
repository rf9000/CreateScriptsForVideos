import { readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { AppConfig } from '../types/index.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PrunerDeps {
  /** Top-level entry names in a directory. Throws if the dir is missing/unreadable. */
  readDirEntries: (dir: string) => string[];
  /** Newest mtime (ms epoch) of any file under `path`; null if not a readable directory. */
  statNewestMtime: (path: string) => number | null;
  /** Recursively delete a directory. */
  removeDir: (path: string) => void;
  now: () => number;
  log: (message: string) => void;
}

/** Default deps backed by node:fs. */
function newestMtime(path: string): number | null {
  let st;
  try {
    st = statSync(path);
  } catch {
    return null;
  }
  if (!st.isDirectory()) return null;
  // Seed with the dir's own mtime so an empty folder still has a sensible age.
  let newest = st.mtimeMs;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      let s;
      try {
        s = statSync(full);
      } catch {
        continue; // entry vanished between readdir and stat — skip it
      }
      if (s.isDirectory()) walk(full);
      else if (s.mtimeMs > newest) newest = s.mtimeMs;
    }
  };
  walk(path);
  return newest;
}

const defaultDeps: PrunerDeps = {
  readDirEntries: (dir) => readdirSync(dir),
  statNewestMtime: newestMtime,
  removeDir: (path) => rmSync(path, { recursive: true, force: true }),
  now: () => Date.now(),
  log: (message) => {
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
    console.log(`[${ts}] ${message}`);
  },
};

/**
 * Delete per-item output folders (numeric-named direct children of the output dirs)
 * whose newest file mtime is older than `config.outputRetentionDays`. A retention of
 * 0 disables pruning entirely. Returns the number of folders deleted.
 */
export function pruneOldOutputs(
  config: AppConfig,
  deps: PrunerDeps = defaultDeps,
): number {
  const retentionDays = config.outputRetentionDays;
  if (retentionDays <= 0) return 0;

  const maxAgeMs = retentionDays * DAY_MS;
  const now = deps.now();
  const dirs = [...new Set([config.workspaceOutputDir, config.pteOutputDir])];

  let pruned = 0;
  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = deps.readDirEntries(dir);
    } catch {
      continue; // dir missing/unreadable — nothing to prune here
    }
    for (const name of entries) {
      if (!/^\d+$/.test(name)) continue; // only per-item <id> folders
      const full = join(dir, name);
      const mtime = deps.statNewestMtime(full);
      if (mtime === null) continue;
      const ageMs = now - mtime;
      if (ageMs > maxAgeMs) {
        try {
          deps.removeDir(full);
        } catch (err) {
          deps.log(`Failed to prune ${full}/: ${err}`);
          continue;
        }
        deps.log(`Pruned ${full}/ (age ${Math.floor(ageMs / DAY_MS)}d)`);
        pruned++;
      }
    }
  }
  return pruned;
}
