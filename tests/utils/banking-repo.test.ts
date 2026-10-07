import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { countryAppDir, discoverBankingApps, requiredBcVersion } from '../../src/utils/banking-repo.ts';

let repo: string;

function app(dir: string, manifest: Record<string, unknown>) {
  mkdirSync(join(repo, dir), { recursive: true });
  writeFileSync(join(repo, dir, 'app.json'), JSON.stringify(manifest));
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'banking-'));
  app('base-application', { name: 'Continia Banking', application: '28.0.0.0', platform: '28.0.0.0' });
  app('banking-dk', { name: 'Banking DK', application: '29.0.0.0' });
  app('banking-w1', { name: 'Banking W1', application: '28.0.0.0' });
  app('base-application/nested', { name: 'Nested', application: '99.0.0.0' });
  app('.alpackages/x', { name: 'Cached', application: '99.0.0.0' });
  mkdirSync(join(repo, 'broken'));
  writeFileSync(join(repo, 'broken', 'app.json'), '{not json');
});

afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe('discoverBankingApps', () => {
  test('finds apps, skips nested apps, caches and malformed manifests', () => {
    expect(discoverBankingApps(repo).map((a) => a.dir)).toEqual(['banking-dk', 'banking-w1', 'base-application']);
  });

  test('returns nothing for a missing repo', () => {
    expect(discoverBankingApps(join(repo, 'nope'))).toEqual([]);
  });
});

describe('requiredBcVersion', () => {
  test('is the highest declared application or platform version', () => {
    expect(requiredBcVersion(discoverBankingApps(repo))).toBe('29.0.0.0');
  });
});

describe('countryAppDir', () => {
  const apps = () => discoverBankingApps(repo);
  test('matches the localization, maps base to w1, falls back to w1', () => {
    expect(countryAppDir(apps(), 'dk')).toBe('banking-dk');
    expect(countryAppDir(apps(), 'base')).toBe('banking-w1');
    expect(countryAppDir(apps(), 'nl')).toBe('banking-w1');
  });

  test('is undefined when there is no country app', () => {
    expect(countryAppDir([], 'dk')).toBeUndefined();
  });
});
