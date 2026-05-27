import { describe, test, expect, mock } from 'bun:test';
import { join } from 'node:path';
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
    const deps = makeDeps({ '/out': ['42'] }, { [join('/out', '42')]: 30 });

    const pruned = pruneOldOutputs(mockConfig({ outputRetentionDays: 14 }), deps);

    expect(pruned).toBe(1);
    expect(deps.removeDir).toHaveBeenCalledWith(join('/out', '42'));
  });

  test('keeps a folder newer than the retention window', () => {
    const deps = makeDeps({ '/out': ['42'] }, { [join('/out', '42')]: 3 });

    const pruned = pruneOldOutputs(mockConfig({ outputRetentionDays: 14 }), deps);

    expect(pruned).toBe(0);
    expect(deps.removeDir).toHaveBeenCalledTimes(0);
  });

  test('never deletes a non-numeric-named entry', () => {
    const deps = makeDeps({ '/out': ['README.md', 'scratch'] }, {
      [join('/out', 'README.md')]: 999,
      [join('/out', 'scratch')]: 999,
    });

    const pruned = pruneOldOutputs(mockConfig({ outputRetentionDays: 14 }), deps);

    expect(pruned).toBe(0);
    expect(deps.removeDir).toHaveBeenCalledTimes(0);
  });

  test('retention 0 prunes nothing and does not scan', () => {
    const deps = makeDeps({ '/out': ['42'] }, { [join('/out', '42')]: 999 });

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
      { [join('/ws', '1')]: 30, [join('/pte', '2')]: 30 },
    );

    const pruned = pruneOldOutputs(
      mockConfig({ workspaceOutputDir: '/ws', pteOutputDir: '/pte' }),
      deps,
    );

    expect(pruned).toBe(2);
    expect(deps.readDirEntries).toHaveBeenCalledTimes(2);
  });

  test('skips folders whose mtime cannot be read (statNewestMtime null)', () => {
    const deps = makeDeps({ '/out': ['42'] }, {}); // join('/out','42') not in age map -> null

    const pruned = pruneOldOutputs(mockConfig(), deps);

    expect(pruned).toBe(0);
    expect(deps.removeDir).toHaveBeenCalledTimes(0);
  });

  test('continues pruning the rest after one removeDir fails', () => {
    const deps = makeDeps(
      { '/out': ['10', '20'] },
      { [join('/out', '10')]: 30, [join('/out', '20')]: 30 },
      {
        removeDir: mock((path: string) => {
          if (path === join('/out', '10')) throw new Error('EBUSY');
        }),
      },
    );

    const pruned = pruneOldOutputs(mockConfig({ outputRetentionDays: 14 }), deps);

    expect(pruned).toBe(1);
    expect(deps.removeDir).toHaveBeenCalledTimes(2);
  });

  test('keeps a folder whose age exactly equals the window', () => {
    const deps = makeDeps({ '/out': ['42'] }, { [join('/out', '42')]: 14 });

    const pruned = pruneOldOutputs(mockConfig({ outputRetentionDays: 14 }), deps);

    expect(pruned).toBe(0);
    expect(deps.removeDir).toHaveBeenCalledTimes(0);
  });
});
