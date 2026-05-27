# Age-based Output Pruning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the watcher automatically delete `output/<workItemId>/` folders older than a configurable retention window, so disk usage on the output bind mount stops growing without bound.

**Architecture:** A new injectable `src/services/pruner.ts` walks each output dir, finds numeric-named per-item folders whose newest file mtime exceeds the retention window, and deletes them. `runPollCycle` calls it once per cycle. Retention is a new Zod env var (`OUTPUT_RETENTION_DAYS`, default 14; `0` disables).

**Tech Stack:** Bun + TypeScript, Zod env validation, `node:fs` (`readdirSync`/`statSync`/`rmSync`), `bun:test` with `mock()`. Dependency-injection pattern via a `deps` parameter, matching `watcher.ts`/`processor.ts`.

---

## File Structure

- **Create** `src/services/pruner.ts` — `pruneOldOutputs(config, deps?)` + `PrunerDeps` interface + default fs-backed deps. Sole responsibility: decide which per-item output folders are stale and delete them.
- **Modify** `src/types/index.ts` — add `outputRetentionDays: number` to `AppConfig`.
- **Modify** `src/config/index.ts` — add `OUTPUT_RETENTION_DAYS` to the Zod schema and map it onto the returned config.
- **Modify** `src/services/watcher.ts` — add `pruneOutputs` to `WatcherDeps`; invoke it at the end of `runPollCycle`.
- **Create** `tests/services/pruner.test.ts` — unit tests for the pruner with fully mocked fs deps.
- **Modify** four existing test config builders to include the new required field (TypeScript will not compile otherwise): `tests/services/watcher.test.ts`, `tests/services/processor.test.ts`, `tests/services/orchestrator-agent.test.ts`, `tests/sdk/azure-devops-client.test.ts`.
- **Modify** `tests/config/config.test.ts` — assert the default and a custom value for the new var.
- **Modify** `DEPLOY.md` — update the "Operational notes" cost/cleanup bullet.

---

## Task 1: Add `outputRetentionDays` to config

**Files:**
- Modify: `src/types/index.ts` (after line 29, inside `AppConfig`)
- Modify: `src/config/index.ts:6-23` (schema) and `src/config/index.ts:40-59` (return object)
- Modify: `tests/config/config.test.ts`
- Modify (compile fix): `tests/services/watcher.test.ts:25`, `tests/services/processor.test.ts:25`, `tests/services/orchestrator-agent.test.ts:32`, `tests/sdk/azure-devops-client.test.ts:41`

- [ ] **Step 1: Write the failing test**

Add these two tests inside the `describe("loadConfig", ...)` block in `tests/config/config.test.ts` (e.g. after the existing "applies default values when optional vars are absent" test):

```typescript
  it("defaults outputRetentionDays to 14", () => {
    const config = loadConfig(validEnv);
    expect(config.outputRetentionDays).toBe(14);
  });

  it("reads a custom OUTPUT_RETENTION_DAYS", () => {
    const config = loadConfig({ ...validEnv, OUTPUT_RETENTION_DAYS: "0" });
    expect(config.outputRetentionDays).toBe(0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/config/config.test.ts`
Expected: FAIL — the two new tests fail (`outputRetentionDays` is `undefined`), and TypeScript errors on `config.outputRetentionDays` not existing on `AppConfig`.

- [ ] **Step 3: Add the field to the `AppConfig` interface**

In `src/types/index.ts`, add this property at the end of the `AppConfig` interface (immediately after the `agentMaxTurns` line, before the closing `}` on line 30):

```typescript
  /** Days to keep generated output/<id>/ folders before the watcher prunes them. 0 = never prune. */
  outputRetentionDays: number;
```

- [ ] **Step 4: Add the env var to the schema and return object**

In `src/config/index.ts`, add this line to the `envSchema` object (e.g. directly after the `AGENT_MAX_TURNS` line, currently line 20):

```typescript
  OUTPUT_RETENTION_DAYS: z.coerce.number().int().min(0).default(14),
```

Then add this line to the object returned by `loadConfig` (e.g. directly after `agentMaxTurns: parsed.AGENT_MAX_TURNS,`, currently line 58):

```typescript
    outputRetentionDays: parsed.OUTPUT_RETENTION_DAYS,
```

- [ ] **Step 5: Fix the four full-literal config builders**

Each of these files builds a complete `AppConfig` literal containing `agentMaxTurns: 120,`. Add the new field on the line immediately after `agentMaxTurns: 120,` in each:

`tests/services/watcher.test.ts` (after line 25), `tests/services/processor.test.ts` (after line 25), `tests/services/orchestrator-agent.test.ts` (after line 32), `tests/sdk/azure-devops-client.test.ts` (after line 41):

```typescript
    outputRetentionDays: 14,
```

(Watcher and processor builders end with `...overrides,` after this — keep that line last.)

- [ ] **Step 6: Run config tests + typecheck to verify they pass**

Run: `bun test tests/config/config.test.ts && bun run typecheck`
Expected: PASS — both new config tests pass and `tsc` reports no errors.

- [ ] **Step 7: Commit**

```bash
git add src/types/index.ts src/config/index.ts tests/config/config.test.ts tests/services/watcher.test.ts tests/services/processor.test.ts tests/services/orchestrator-agent.test.ts tests/sdk/azure-devops-client.test.ts
git commit -m "Add OUTPUT_RETENTION_DAYS config (default 14)"
```

---

## Task 2: Implement the pruner

**Files:**
- Create: `src/services/pruner.ts`
- Test: `tests/services/pruner.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/services/pruner.test.ts`:

```typescript
import { describe, test, expect, mock } from 'bun:test';
import type { AppConfig } from '../../src/types/index.ts';
import { pruneOldOutputs } from '../../src/services/pruner.ts';
import type { PrunerDeps } from '../../src/services/pruner.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_000 * DAY_MS; // fixed "now" so age math is deterministic

function mockConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    org: 'o', orgUrl: 'u', project: 'p', pat: 't',
    wiqlQuery: 'q', pollIntervalMinutes: 5, claudeModel: 'm', promptPath: 'pp',
    dryRun: false, areaPath: '', createScriptTag: 'create script',
    continiaBankingPath: './cb', continiaApiToken: '', anthropicApiKey: '',
    workspaceOutputDir: '/out', pteOutputDir: '/out', lspPluginPath: '',
    agentMaxTurns: 120, outputRetentionDays: 14,
    ...overrides,
  };
}

/** Build deps where each folder name maps to an age in days (via newest mtime). */
function makeDeps(
  entriesByDir: Record<string, string[]>,
  ageDaysByPath: Record<string, number>,
  overrides: Partial<PrunerDeps> = {},
): PrunerDeps {
  return {
    readDirEntries: mock((dir: string) => entriesByDir[dir] ?? []),
    statNewestMtime: mock((path: string) =>
      path in ageDaysByPath ? NOW - ageDaysByPath[path]! * DAY_MS : null,
    ),
    removeDir: mock((_path: string) => {}),
    now: mock(() => NOW),
    log: mock((_msg: string) => {}),
    ...overrides,
  };
}

describe('pruneOldOutputs', () => {
  test('deletes a folder older than the retention window', () => {
    const deps = makeDeps({ '/out': ['42'] }, { '/out/42': 30 });

    const pruned = pruneOldOutputs(mockConfig({ outputRetentionDays: 14 }), deps);

    expect(pruned).toBe(1);
    expect(deps.removeDir).toHaveBeenCalledWith('/out/42');
  });

  test('keeps a folder newer than the retention window', () => {
    const deps = makeDeps({ '/out': ['42'] }, { '/out/42': 3 });

    const pruned = pruneOldOutputs(mockConfig({ outputRetentionDays: 14 }), deps);

    expect(pruned).toBe(0);
    expect(deps.removeDir).toHaveBeenCalledTimes(0);
  });

  test('never deletes a non-numeric-named entry', () => {
    const deps = makeDeps({ '/out': ['README.md', 'scratch'] }, {
      '/out/README.md': 999,
      '/out/scratch': 999,
    });

    const pruned = pruneOldOutputs(mockConfig({ outputRetentionDays: 14 }), deps);

    expect(pruned).toBe(0);
    expect(deps.removeDir).toHaveBeenCalledTimes(0);
  });

  test('retention 0 prunes nothing and does not scan', () => {
    const deps = makeDeps({ '/out': ['42'] }, { '/out/42': 999 });

    const pruned = pruneOldOutputs(mockConfig({ outputRetentionDays: 0 }), deps);

    expect(pruned).toBe(0);
    expect(deps.readDirEntries).toHaveBeenCalledTimes(0);
    expect(deps.removeDir).toHaveBeenCalledTimes(0);
  });

  test('an unreadable / missing output dir is a no-op', () => {
    const deps = makeDeps({}, {}, {
      readDirEntries: mock((_dir: string) => {
        throw new Error('ENOENT');
      }),
    });

    const pruned = pruneOldOutputs(mockConfig(), deps);

    expect(pruned).toBe(0);
    expect(deps.removeDir).toHaveBeenCalledTimes(0);
  });

  test('prunes the union of workspace and pte dirs, scanning each once', () => {
    const deps = makeDeps(
      { '/ws': ['1'], '/pte': ['2'] },
      { '/ws/1': 30, '/pte/2': 30 },
    );

    const pruned = pruneOldOutputs(
      mockConfig({ workspaceOutputDir: '/ws', pteOutputDir: '/pte' }),
      deps,
    );

    expect(pruned).toBe(2);
    expect(deps.readDirEntries).toHaveBeenCalledTimes(2);
  });

  test('skips folders whose mtime cannot be read (statNewestMtime null)', () => {
    const deps = makeDeps({ '/out': ['42'] }, {}); // '/out/42' not in age map -> null

    const pruned = pruneOldOutputs(mockConfig(), deps);

    expect(pruned).toBe(0);
    expect(deps.removeDir).toHaveBeenCalledTimes(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/services/pruner.test.ts`
Expected: FAIL — `Cannot find module '../../src/services/pruner.ts'`.

- [ ] **Step 3: Write the implementation**

Create `src/services/pruner.ts`:

```typescript
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
      const s = statSync(full);
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
        deps.removeDir(full);
        deps.log(`Pruned ${full}/ (age ${Math.floor(ageMs / DAY_MS)}d)`);
        pruned++;
      }
    }
  }
  return pruned;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/services/pruner.test.ts && bun run typecheck`
Expected: PASS — all 7 pruner tests pass; `tsc` clean.

- [ ] **Step 5: Commit**

```bash
git add src/services/pruner.ts tests/services/pruner.test.ts
git commit -m "Add age-based output pruner"
```

---

## Task 3: Wire the pruner into the watcher cycle

**Files:**
- Modify: `src/services/watcher.ts:9-26` (deps wiring) and `src/services/watcher.ts:38-63` (`runPollCycle`)
- Test: `tests/services/watcher.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/services/watcher.test.ts`, update the `makeDeps` helper (lines 44-50) to include the new dep, and add two tests inside the `describe('runPollCycle', ...)` block.

Replace the `makeDeps` body so it returns a `pruneOutputs` mock:

```typescript
function makeDeps(overrides: Partial<WatcherDeps> = {}): WatcherDeps {
  return {
    fetchItems: mock(() => Promise.resolve([])),
    processItem: mock(() => Promise.resolve({ itemId: 0, processed: true })),
    pruneOutputs: mock(() => 0),
    ...overrides,
  };
}
```

Add these tests to the `describe('runPollCycle', ...)` block:

```typescript
  test('prunes outputs once per cycle when retention is enabled', async () => {
    const deps = makeDeps();

    await runPollCycle(mockConfig({ outputRetentionDays: 14 }), deps);

    expect(deps.pruneOutputs).toHaveBeenCalledTimes(1);
  });

  test('does not prune when retention is disabled (0)', async () => {
    const deps = makeDeps();

    await runPollCycle(mockConfig({ outputRetentionDays: 0 }), deps);

    expect(deps.pruneOutputs).toHaveBeenCalledTimes(0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/services/watcher.test.ts`
Expected: FAIL — TypeScript errors that `pruneOutputs` is not a member of `WatcherDeps`, and the two new tests fail.

- [ ] **Step 3: Add `pruneOutputs` to the watcher deps**

In `src/services/watcher.ts`, add the import after the existing `proc` import (line 7):

```typescript
import * as pruner from './pruner.ts';
```

Add `pruneOutputs` to the `WatcherDeps` interface (currently lines 9-15), after `processItem`:

```typescript
  /** Delete aged per-item output folders. Returns the count pruned. */
  pruneOutputs: (config: AppConfig) => number;
```

Add it to `defaultDeps` (currently lines 23-26), after `processItem: proc.processItem,`:

```typescript
  pruneOutputs: pruner.pruneOldOutputs,
```

- [ ] **Step 4: Call the pruner at the end of the cycle**

In `src/services/watcher.ts`, in `runPollCycle`, insert this block after the `for (const item of items) { ... }` loop and before `return { processed: ... };` (currently between lines 60 and 62):

```typescript
  if (config.outputRetentionDays > 0) {
    const prunedCount = deps.pruneOutputs(config);
    if (prunedCount > 0) log(`  Pruned ${prunedCount} aged output folder(s)`);
  }
```

- [ ] **Step 5: Run tests + typecheck to verify they pass**

Run: `bun test tests/services/watcher.test.ts && bun run typecheck`
Expected: PASS — all watcher tests (existing + 2 new) pass; `tsc` clean.

- [ ] **Step 6: Commit**

```bash
git add src/services/watcher.ts tests/services/watcher.test.ts
git commit -m "Run output pruning each poll cycle"
```

---

## Task 4: Document the behavior

**Files:**
- Modify: `DEPLOY.md` (the "Operational notes" section, the `Cost/cleanup` bullet near line 132)

- [ ] **Step 1: Update the cost/cleanup note**

In `DEPLOY.md`, replace the existing `**Cost/cleanup:**` bullet (currently lines 132-133) with:

```markdown
- **Cost/cleanup:** each processed item provisions a BC environment and leaves it running
  (`create-script.md` step 6) — track environments and prune old ones (still manual). On-disk
  output is pruned automatically: the watcher deletes `output/<id>/` folders older than
  `OUTPUT_RETENTION_DAYS` (default 14; set `0` to disable) at the end of each poll cycle. The
  script content survives as the ADO work-item comment and the PTE is rebuildable, so this loses
  nothing irreplaceable.
```

- [ ] **Step 2: Verify the full suite still passes**

Run: `bun test && bun run typecheck`
Expected: PASS — entire suite green, `tsc` clean.

- [ ] **Step 3: Commit**

```bash
git add DEPLOY.md
git commit -m "Document automatic output pruning in DEPLOY.md"
```

---

## Final verification

- [ ] Run the full suite once more: `bun test && bun run typecheck` — expect all green.
- [ ] Sanity-check the new var is documented: `OUTPUT_RETENTION_DAYS` appears in `src/config/index.ts` and `DEPLOY.md`.
