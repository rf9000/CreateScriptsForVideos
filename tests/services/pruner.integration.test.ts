import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from '../../src/types/index.ts';
import { pruneOldOutputs } from '../../src/services/pruner.ts';

const DAY_SEC = 24 * 60 * 60;

/** Build an AppConfig whose output dirs both point at `dir`. */
function config(dir: string, retentionDays: number): AppConfig {
  return {
    org: 'o', orgUrl: 'u', project: 'p', pat: 't',
    wiqlQuery: 'q', pollIntervalMinutes: 5, claudeModel: 'm', promptPath: 'pp',
    dryRun: false, areaPath: '', createScriptTag: 'create script',
    continiaBankingPath: './cb', continiaApiToken: '', anthropicApiKey: '',
    workspaceOutputDir: dir, pteOutputDir: dir, lspPluginPath: '',
    agentMaxTurns: 120, outputRetentionDays: retentionDays,
  };
}

/** Create an `<id>/script.md`-style folder and back-date every level to `ageDays` old. */
function makeItemFolder(root: string, name: string, ageDays: number): string {
  const folder = join(root, name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'script.md'), '# demo\n');
  mkdirSync(join(folder, 'pte'), { recursive: true });
  writeFileSync(join(folder, 'pte', 'app.json'), '{}\n');

  const when = new Date(Date.now() - ageDays * DAY_SEC * 1000);
  // Back-date files first, then their dirs last, so writing a file doesn't
  // bump a parent dir's mtime back to "now" afterwards.
  utimesSync(join(folder, 'pte', 'app.json'), when, when);
  utimesSync(join(folder, 'script.md'), when, when);
  utimesSync(join(folder, 'pte'), when, when);
  utimesSync(folder, when, when);
  return folder;
}

describe('pruneOldOutputs (real filesystem)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'prune-it-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('deletes an aged item folder but keeps a fresh one and a non-numeric folder', () => {
    const old = makeItemFolder(root, '100', 30);
    const fresh = makeItemFolder(root, '200', 1);
    const keep = makeItemFolder(root, 'notes', 30); // non-numeric name

    const pruned = pruneOldOutputs(config(root, 14));

    expect(pruned).toBe(1);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(keep)).toBe(true);
  });

  test('retention 0 deletes nothing on disk', () => {
    const old = makeItemFolder(root, '100', 30);

    const pruned = pruneOldOutputs(config(root, 0));

    expect(pruned).toBe(0);
    expect(existsSync(old)).toBe(true);
  });

  test('a missing output dir is a no-op', () => {
    const pruned = pruneOldOutputs(config(join(root, 'does-not-exist'), 14));

    expect(pruned).toBe(0);
  });
});
