import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve, sep } from 'path';
import { maxBcVersion } from './bc-version.ts';

/**
 * Read-only facts about the continia-banking clone: which BC version its apps
 * target, and which country app matches a localization. Adapted from
 * DevOpsCoder's al-app-graph.
 */

export interface BankingApp {
  /** Repo-relative directory, forward slashes. */
  dir: string;
  name: string;
  application?: string;
  platform?: string;
}

const SKIP_DIRS = new Set(['.git', '.alpackages', 'node_modules', '.vscode', '.claude']);
const MAX_APP_DEPTH = 3;

export function discoverBankingApps(repoPath: string): BankingApp[] {
  const root = resolve(repoPath);
  const apps: BankingApp[] = [];

  const walk = (absDir: string, depth: number): void => {
    if (depth > MAX_APP_DEPTH) return;
    const manifest = join(absDir, 'app.json');
    if (existsSync(manifest)) {
      try {
        const raw = JSON.parse(readFileSync(manifest, 'utf-8')) as Record<string, unknown>;
        if (typeof raw['name'] === 'string') {
          apps.push({
            dir: relative(root, absDir).split(sep).join('/'),
            name: raw['name'],
            application: typeof raw['application'] === 'string' ? raw['application'] : undefined,
            platform: typeof raw['platform'] === 'string' ? raw['platform'] : undefined,
          });
          return; // an app contains no nested apps
        }
      } catch {
        // malformed app.json: keep scanning siblings
      }
    }
    let entries: string[];
    try {
      entries = readdirSync(absDir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;
      const abs = join(absDir, entry);
      try {
        if (statSync(abs).isDirectory()) walk(abs, depth + 1);
      } catch {
        // vanished mid-scan
      }
    }
  };

  walk(root, 0);
  return apps.sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
}

/** Highest `application` / `platform` version any app declares; the env must satisfy it. */
export function requiredBcVersion(apps: BankingApp[]): string | undefined {
  const declared: string[] = [];
  for (const app of apps) {
    if (app.application) declared.push(app.application);
    if (app.platform) declared.push(app.platform);
  }
  return maxBcVersion(declared);
}

/**
 * The `banking-<cc>` country app for a localization (`base` maps to
 * `banking-w1`), falling back to `banking-w1` when the country has no app.
 */
export function countryAppDir(apps: BankingApp[], localization: string): string | undefined {
  const cc = localization.trim().toLowerCase();
  const wanted = cc === '' || cc === 'base' ? 'w1' : cc;
  const byCc = (code: string) => apps.find((a) => a.dir.toLowerCase() === `banking-${code}`);
  return (byCc(wanted) ?? byCc('w1'))?.dir;
}
